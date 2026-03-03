import { db, getPrimaryPhysioId, rowToSession } from "./db.js";
import { config } from "./config.js";
import { ALERT_TYPES, EXERCISES } from "./constants.js";
import { sendOtpByProvider, verifyOtpByProvider } from "./otp-provider.js";
import {
  clampNumber,
  createId,
  daysAgoDateOnly,
  normalizePhone,
  nowIso,
  parseNumber,
  randomToken,
  sha256,
  toDateOnly
} from "./utils.js";

export function findUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

export function findUserByRolePhone(role, phone) {
  return (
    db.prepare("SELECT * FROM users WHERE role = ? AND phone = ? LIMIT 1").get(role, normalizePhone(phone)) ||
    null
  );
}

export function createUser({ role, phone, email = "", name = "" }) {
  const id = createId("usr");
  db.prepare(
    `INSERT INTO users (id, role, phone, email, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, role, normalizePhone(phone), email, name, nowIso());
  return findUserById(id);
}

export function getPatientProfile(patientId) {
  return db.prepare("SELECT * FROM patient_profiles WHERE user_id = ?").get(patientId) || null;
}

export function getCaregiverLinkedPatientId(caregiverId) {
  const row = db
    .prepare(
      `SELECT user_id
       FROM patient_profiles
       WHERE caregiver_user_id = ?
       ORDER BY user_id ASC
       LIMIT 1`
    )
    .get(caregiverId);
  return row ? row.user_id : null;
}

export function getActivePlan(patientId) {
  return (
    db.prepare(
      `SELECT * FROM care_plans
       WHERE patient_id = ? AND status = 'active'
       ORDER BY updated_at DESC LIMIT 1`
    ).get(patientId) || null
  );
}

export function getPlanExercises(planId) {
  return db
    .prepare(
      `SELECT * FROM plan_exercises
       WHERE plan_id = ?
       ORDER BY exercise_code ASC`
    )
    .all(planId);
}

export function ensureActivePlan(patientId) {
  const existing = getActivePlan(patientId);
  if (existing) {
    return existing;
  }

  const planId = createId("pln");
  const now = nowIso();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO care_plans
       (id, patient_id, physio_id, status, target_sessions_per_week, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 5, ?, ?)`
    ).run(planId, patientId, getPrimaryPhysioId(), now, now);

    const stmt = db.prepare(
      `INSERT INTO plan_exercises
       (id, plan_id, exercise_code, sets_target, reps_target, min_rom_target, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`
    );

    for (const ex of EXERCISES) {
      stmt.run(createId("pex"), planId, ex.code, ex.defaultReps, ex.minROM, now);
    }
  });

  tx();
  return getActivePlan(patientId);
}

export function upsertPatientOnboarding(payload, consentVersion) {
  const patient = findUserById(payload.user_id);
  if (!patient || patient.role !== "patient") {
    throw new Error("Patient user not found");
  }

  const caregiverPhone = normalizePhone(payload.caregiver_phone);
  if (!caregiverPhone) {
    throw new Error("caregiver_phone is required");
  }

  let caregiver = findUserByRolePhone("caregiver", caregiverPhone);
  if (!caregiver) {
    caregiver = createUser({ role: "caregiver", phone: caregiverPhone, name: "Caregiver" });
  }

  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(payload.name, patient.id);

  db.prepare(
    `INSERT INTO patient_profiles (user_id, affected_side, stroke_date, mobility_level, caregiver_user_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       affected_side = excluded.affected_side,
       stroke_date = excluded.stroke_date,
       mobility_level = excluded.mobility_level,
       caregiver_user_id = excluded.caregiver_user_id`
  ).run(
    patient.id,
    payload.affected_side,
    payload.stroke_date,
    payload.mobility_level,
    caregiver.id
  );

  if (payload.consent_accepted) {
    db.prepare(
      `INSERT INTO consents (id, user_id, version, accepted_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, version) DO NOTHING`
    ).run(createId("cns"), patient.id, consentVersion, nowIso());
  }

  const plan = ensureActivePlan(patient.id);

  return {
    patient_profile: getPatientProfile(patient.id),
    active_plan: plan
  };
}

export function createSession(patientId) {
  const patient = findUserById(patientId);
  if (!patient || patient.role !== "patient") {
    throw new Error("Patient not found");
  }

  const plan = ensureActivePlan(patientId);
  const id = createId("ses");

  db.prepare(
    `INSERT INTO sessions (
      id, patient_id, plan_id, started_at, ended_at,
      pain_pre, pain_post, fatigue_pre, fatigue_post,
      red_flags_json, status
    ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, 'started')`
  ).run(
    id,
    patientId,
    plan.id,
    nowIso(),
    JSON.stringify({ chest_pain: false, uncontrolled_bp: false, new_neuro: false })
  );

  return getSessionById(id);
}

export function getSessionById(sessionId) {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
  return rowToSession(row);
}

export function updateSessionCheckin(sessionId, payload) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const redFlags = {
    chest_pain: Boolean(payload.red_flags?.chest_pain),
    uncontrolled_bp: Boolean(payload.red_flags?.uncontrolled_bp),
    new_neuro: Boolean(payload.red_flags?.new_neuro)
  };

  db.prepare(
    `UPDATE sessions
     SET pain_pre = ?, fatigue_pre = ?, red_flags_json = ?
     WHERE id = ?`
  ).run(
    clampNumber(parseNumber(payload.pain_pre), 0, 10),
    clampNumber(parseNumber(payload.fatigue_pre), 0, 10),
    JSON.stringify(redFlags),
    sessionId
  );

  const hasRedFlag = Object.values(redFlags).some(Boolean);
  if (hasRedFlag) {
    db.prepare("UPDATE sessions SET status = 'blocked' WHERE id = ?").run(sessionId);
    createAlertIfMissing({
      patientId: session.patient_id,
      sessionId,
      type: ALERT_TYPES.RED_FLAG_CHECKIN,
      severity: "high",
      message: "Red-flag symptom reported at pre-session check-in."
    });
  }

  return { session: getSessionById(sessionId), hasRedFlag };
}

export function upsertExerciseResult(sessionId, payload) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const row = {
    id: createId("res"),
    session_id: sessionId,
    exercise_code: payload.exercise_code,
    total_reps: Math.max(0, parseNumber(payload.total_reps)),
    valid_reps: Math.max(0, parseNumber(payload.valid_reps)),
    avg_rom: Math.max(0, parseNumber(payload.avg_rom)),
    avg_quality: clampNumber(parseNumber(payload.avg_quality), 0, 100),
    assisted_reps: Math.max(0, parseNumber(payload.assisted_reps))
  };

  db.prepare(
    `INSERT INTO exercise_results
     (id, session_id, exercise_code, total_reps, valid_reps, avg_rom, avg_quality, assisted_reps)
     VALUES (@id, @session_id, @exercise_code, @total_reps, @valid_reps, @avg_rom, @avg_quality, @assisted_reps)
     ON CONFLICT(session_id, exercise_code) DO UPDATE SET
       total_reps = excluded.total_reps,
       valid_reps = excluded.valid_reps,
       avg_rom = excluded.avg_rom,
       avg_quality = excluded.avg_quality,
       assisted_reps = excluded.assisted_reps`
  ).run(row);

  return db
    .prepare("SELECT * FROM exercise_results WHERE session_id = ? AND exercise_code = ?")
    .get(sessionId, payload.exercise_code);
}

export function finishSession(sessionId, payload) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const finalStatus = session.status === "blocked" ? "blocked" : "completed";

  db.prepare(
    `UPDATE sessions
     SET pain_post = ?, fatigue_post = ?, ended_at = ?, status = ?
     WHERE id = ?`
  ).run(
    clampNumber(parseNumber(payload.pain_post), 0, 10),
    clampNumber(parseNumber(payload.fatigue_post), 0, 10),
    nowIso(),
    finalStatus,
    sessionId
  );

  evaluateSessionAlerts(session.patient_id, sessionId);
  evaluateMissedSessionAlert(session.patient_id);

  return getSessionById(sessionId);
}

export function getSessionAlerts(sessionId) {
  return db
    .prepare(
      `SELECT * FROM alerts
       WHERE session_id = ?
       ORDER BY created_at DESC`
    )
    .all(sessionId);
}

export function getPatientProgress(patientId, days = 7) {
  const daysInt = Math.max(1, Math.min(30, Number(days) || 7));
  const fromDate = daysAgoDateOnly(daysInt - 1);

  const sessions = db
    .prepare(
      `SELECT * FROM sessions
       WHERE patient_id = ?
         AND ended_at IS NOT NULL
         AND substr(ended_at, 1, 10) >= ?
       ORDER BY ended_at ASC`
    )
    .all(patientId, fromDate)
    .map(rowToSession);

  const byDay = {};
  for (let i = 0; i < daysInt; i += 1) {
    const day = daysAgoDateOnly(daysInt - 1 - i);
    byDay[day] = {
      completed_sessions: 0,
      valid_reps: 0,
      total_reps: 0,
      pain_delta_sum: 0,
      pain_samples: 0
    };
  }

  for (const session of sessions) {
    const day = toDateOnly(session.ended_at);
    const bucket = byDay[day];
    if (!bucket) {
      continue;
    }

    if (session.status === "completed") {
      bucket.completed_sessions += 1;
    }

    const agg = getSessionQualityAggregate(session.id);
    bucket.valid_reps += agg.valid;
    bucket.total_reps += agg.total;

    if (Number.isFinite(session.pain_pre) && Number.isFinite(session.pain_post)) {
      bucket.pain_delta_sum += session.pain_post - session.pain_pre;
      bucket.pain_samples += 1;
    }
  }

  const trend = Object.entries(byDay).map(([date, value]) => ({
    date,
    completed_sessions: value.completed_sessions,
    valid_rep_rate: value.total_reps > 0 ? Math.round((value.valid_reps / value.total_reps) * 100) : 0,
    pain_delta:
      value.pain_samples > 0 ? Number((value.pain_delta_sum / value.pain_samples).toFixed(2)) : 0
  }));

  const completed = sessions.filter((session) => session.status === "completed").length;
  const target = getActivePlan(patientId)?.target_sessions_per_week || 5;
  const adherence = Math.round((completed / target) * 100);

  return {
    trend,
    totals: {
      completed_sessions: completed,
      adherence_pct: Math.max(0, Math.min(200, adherence))
    }
  };
}

export function getPhysioAlerts(status = "open") {
  evaluateAllPatientsMissedSessions();

  let sql = `
    SELECT a.*, u.name AS patient_name
    FROM alerts a
    LEFT JOIN users u ON u.id = a.patient_id
  `;

  const params = [];
  if (status === "open" || status === "resolved") {
    sql += " WHERE a.status = ?";
    params.push(status);
  }

  sql += " ORDER BY a.created_at DESC";

  return db.prepare(sql).all(...params);
}

export function resolveAlert(alertId, physioId, note) {
  const exists = db.prepare("SELECT id FROM alerts WHERE id = ?").get(alertId);
  if (!exists) {
    throw new Error("Alert not found");
  }

  db.prepare(
    `UPDATE alerts
     SET status = 'resolved', reviewed_by = ?, resolved_at = ?, resolution_note = ?
     WHERE id = ?`
  ).run(physioId, nowIso(), note || "Reviewed", alertId);

  return db.prepare("SELECT * FROM alerts WHERE id = ?").get(alertId);
}

export function updatePlan(patientId, payload) {
  const plan = ensureActivePlan(patientId);

  db.prepare(
    `UPDATE care_plans
     SET target_sessions_per_week = ?, updated_at = ?
     WHERE id = ?`
  ).run(parseNumber(payload.target_sessions_per_week, 5), nowIso(), plan.id);

  const updates = [
    { code: "seated_knee_extension", reps: parseNumber(payload.knee_extension_reps, 10) },
    { code: "assisted_straight_leg_raise", reps: parseNumber(payload.straight_leg_raise_reps, 8) },
    {
      code: "ankle_dorsiflexion_or_heel_slide",
      reps: parseNumber(payload.ankle_or_heel_slide_reps, 10)
    }
  ];

  const stmt = db.prepare(
    `UPDATE plan_exercises
     SET reps_target = ?, updated_at = ?
     WHERE plan_id = ? AND exercise_code = ?`
  );

  for (const update of updates) {
    stmt.run(Math.max(1, update.reps), nowIso(), plan.id, update.code);
  }

  return {
    plan: getActivePlan(patientId),
    exercises: getPlanExercises(plan.id)
  };
}

export function listPhysioPatients() {
  const profiles = db
    .prepare(
      `SELECT p.*, u.name, u.phone
       FROM patient_profiles p
       JOIN users u ON u.id = p.user_id
       ORDER BY u.created_at DESC`
    )
    .all();

  return profiles.map((profile) => {
    const openAlerts = db
      .prepare("SELECT COUNT(*) AS c FROM alerts WHERE patient_id = ? AND status = 'open'")
      .get(profile.user_id).c;
    const progress = getPatientProgress(profile.user_id, 7);
    return {
      ...profile,
      patient_name: profile.name,
      patient_phone: profile.phone,
      open_alerts: openAlerts,
      sessions_7d: progress.totals.completed_sessions,
      adherence_7d: progress.totals.adherence_pct
    };
  });
}

export function getPhysioPatientDetail(patientId) {
  const user = findUserById(patientId);
  if (!user) {
    throw new Error("Patient not found");
  }

  const profile = getPatientProfile(patientId);
  const plan = ensureActivePlan(patientId);

  const alerts = db
    .prepare(
      `SELECT * FROM alerts
       WHERE patient_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .all(patientId);

  const notes = db
    .prepare(
      `SELECT * FROM physio_notes
       WHERE patient_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .all(patientId);

  return {
    user,
    profile,
    plan,
    exercises: getPlanExercises(plan.id),
    alerts,
    notes,
    progress_7d: getPatientProgress(patientId, 7)
  };
}

export function createPhysioNote(patientId, physioId, payload) {
  const note = {
    id: createId("nt"),
    patient_id: patientId,
    alert_id: payload.alert_id || null,
    physio_id: physioId,
    note: payload.note,
    next_action: payload.next_action,
    followup_date: payload.followup_date,
    created_at: nowIso()
  };

  db.prepare(
    `INSERT INTO physio_notes
     (id, patient_id, alert_id, physio_id, note, next_action, followup_date, created_at)
     VALUES (@id, @patient_id, @alert_id, @physio_id, @note, @next_action, @followup_date, @created_at)`
  ).run(note);

  return note;
}

function createAlertIfMissing({ patientId, sessionId = null, type, severity, message }) {
  const duplicate = db
    .prepare(
      `SELECT id FROM alerts
       WHERE patient_id = ? AND type = ? AND status = 'open'
       LIMIT 1`
    )
    .get(patientId, type);

  if (duplicate) {
    return duplicate.id;
  }

  const id = createId("alr");
  db.prepare(
    `INSERT INTO alerts
     (id, patient_id, session_id, type, severity, message, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
  ).run(id, patientId, sessionId, type, severity, message, nowIso());

  return id;
}

function getCompletedSessions(patientId) {
  return db
    .prepare(
      `SELECT * FROM sessions
       WHERE patient_id = ? AND status = 'completed' AND ended_at IS NOT NULL
       ORDER BY ended_at ASC`
    )
    .all(patientId)
    .map(rowToSession);
}

function getSessionQualityAggregate(sessionId) {
  const agg = db
    .prepare(
      `SELECT
         COALESCE(SUM(valid_reps), 0) AS valid,
         COALESCE(SUM(total_reps), 0) AS total,
         COALESCE(SUM(assisted_reps), 0) AS assisted
       FROM exercise_results
       WHERE session_id = ?`
    )
    .get(sessionId);

  const total = agg.total || 0;
  return {
    valid: agg.valid || 0,
    total,
    assisted: agg.assisted || 0,
    validRate: total > 0 ? (agg.valid || 0) / total : 0,
    assistedRate: total > 0 ? (agg.assisted || 0) / total : 0
  };
}

function evaluateSessionAlerts(patientId, sessionId) {
  const sessions = getCompletedSessions(patientId);

  // Rule 2: pain increase >=2 in 2 consecutive completed sessions.
  if (sessions.length >= 2) {
    const lastTwo = sessions.slice(-2);
    const isPainWorsening = lastTwo.every((session) => (session.pain_post ?? 0) - (session.pain_pre ?? 0) >= 2);
    if (isPainWorsening) {
      createAlertIfMissing({
        patientId,
        sessionId,
        type: ALERT_TYPES.PAIN_WORSENING_2X,
        severity: "medium",
        message: "Pain increased by >=2 points in two consecutive sessions."
      });
    }
  }

  // Rule 3: valid rep rate <50% for 3 consecutive completed sessions.
  if (sessions.length >= 3) {
    const lastThree = sessions.slice(-3);
    const lowQuality = lastThree.every((session) => {
      const quality = getSessionQualityAggregate(session.id);
      return quality.total > 0 && quality.validRate < 0.5;
    });

    if (lowQuality) {
      createAlertIfMissing({
        patientId,
        sessionId,
        type: ALERT_TYPES.LOW_VALID_REP_RATE_3X,
        severity: "medium",
        message: "Valid rep rate stayed below 50% across three sessions."
      });
    }
  }

  // Rule 5: assisted reps trend worsening week-over-week.
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  const thisWeek = sessions.filter((session) => now - new Date(session.ended_at).getTime() <= weekMs);
  const prevWeek = sessions.filter((session) => {
    const age = now - new Date(session.ended_at).getTime();
    return age > weekMs && age <= 2 * weekMs;
  });

  if (thisWeek.length >= 2 && prevWeek.length >= 2) {
    const thisRate = thisWeek.reduce((sum, session) => sum + getSessionQualityAggregate(session.id).assistedRate, 0) /
      thisWeek.length;
    const prevRate = prevWeek.reduce((sum, session) => sum + getSessionQualityAggregate(session.id).assistedRate, 0) /
      prevWeek.length;

    if (thisRate > prevRate + 0.2) {
      createAlertIfMissing({
        patientId,
        sessionId,
        type: ALERT_TYPES.ASSISTED_REPS_WORSENING,
        severity: "medium",
        message: "Assisted rep dependency increased week-over-week."
      });
    }
  }
}

function evaluateMissedSessionAlert(patientId) {
  const completedDates = db
    .prepare(
      `SELECT DISTINCT substr(ended_at, 1, 10) AS day
       FROM sessions
       WHERE patient_id = ? AND status = 'completed' AND ended_at IS NOT NULL`
    )
    .all(patientId)
    .map((row) => row.day);

  const daySet = new Set(completedDates);
  const missedThree = [0, 1, 2].every((offset) => !daySet.has(daysAgoDateOnly(offset)));

  if (missedThree) {
    createAlertIfMissing({
      patientId,
      sessionId: null,
      type: ALERT_TYPES.MISSED_3_DAYS,
      severity: "low",
      message: "Patient has missed sessions for three straight days."
    });
  }
}

function evaluateAllPatientsMissedSessions() {
  const patientIds = db
    .prepare("SELECT id FROM users WHERE role = 'patient'")
    .all()
    .map((row) => row.id);

  for (const patientId of patientIds) {
    evaluateMissedSessionAlert(patientId);
  }
}

export function hasConsent(userId, version) {
  const row = db
    .prepare("SELECT id FROM consents WHERE user_id = ? AND version = ?")
    .get(userId, version);
  return Boolean(row);
}

export function getUserWithProfile(userId) {
  const user = findUserById(userId);
  if (!user) {
    return null;
  }

  const patientProfile = user.role === "patient" ? getPatientProfile(userId) : null;
  const activePlan = user.role === "patient" ? getActivePlan(userId) : null;

  return { user, patient_profile: patientProfile, active_plan: activePlan };
}

function generateMockOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function refreshTokenExpiryIso() {
  const ms = config.jwtRefreshExpiresDays * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

function getActiveRefreshRecordByToken(rawRefreshToken) {
  const tokenHash = sha256(rawRefreshToken);
  return (
    db
      .prepare(
        `SELECT * FROM refresh_tokens
         WHERE token_hash = ?
         LIMIT 1`
      )
      .get(tokenHash) || null
  );
}

function revokeRefreshTokenFamily(familyId, reason) {
  db.prepare(
    `UPDATE refresh_tokens
     SET revoked_at = COALESCE(revoked_at, ?),
         revoke_reason = COALESCE(revoke_reason, ?)
     WHERE family_id = ?`
  ).run(nowIso(), reason, familyId);
}

export function issueRefreshToken(userId, ip, userAgent, familyId = null) {
  const token = randomToken(48);
  const tokenHash = sha256(token);
  const recordId = createId("rt");
  const family = familyId || createId("rtfam");

  db.prepare(
    `INSERT INTO refresh_tokens
     (id, user_id, token_hash, family_id, replaced_by_token_id, revoked_at, revoke_reason, expires_at, created_at, last_used_at, created_ip, user_agent)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?, ?)`
  ).run(recordId, userId, tokenHash, family, refreshTokenExpiryIso(), nowIso(), ip || "", userAgent || "");

  return { token, recordId, familyId: family };
}

export function rotateRefreshToken(rawRefreshToken, ip, userAgent) {
  const existing = getActiveRefreshRecordByToken(rawRefreshToken);
  if (!existing) {
    throw new Error("Invalid refresh token");
  }

  if (existing.revoked_at) {
    revokeRefreshTokenFamily(existing.family_id, "refresh_reuse_detected");
    throw new Error("Refresh token already revoked");
  }

  if (new Date(existing.expires_at).getTime() < Date.now()) {
    db.prepare(
      `UPDATE refresh_tokens
       SET revoked_at = ?, revoke_reason = ?
       WHERE id = ?`
    ).run(nowIso(), "refresh_expired", existing.id);
    throw new Error("Refresh token expired");
  }

  const tx = db.transaction(() => {
    db.prepare("UPDATE refresh_tokens SET last_used_at = ? WHERE id = ?").run(nowIso(), existing.id);
    const rotated = issueRefreshToken(existing.user_id, ip, userAgent, existing.family_id);
    db.prepare(
      `UPDATE refresh_tokens
       SET revoked_at = ?, revoke_reason = ?, replaced_by_token_id = ?
       WHERE id = ?`
    ).run(nowIso(), "rotated", rotated.recordId, existing.id);
    return rotated;
  });

  const newToken = tx();
  const user = findUserById(existing.user_id);
  if (!user) {
    throw new Error("User for refresh token not found");
  }

  return { user, refreshToken: newToken.token };
}

export function revokeRefreshToken(rawRefreshToken, reason = "logout") {
  const existing = getActiveRefreshRecordByToken(rawRefreshToken);
  if (!existing) {
    return;
  }
  db.prepare(
    `UPDATE refresh_tokens
     SET revoked_at = COALESCE(revoked_at, ?), revoke_reason = COALESCE(revoke_reason, ?)
     WHERE id = ?`
  ).run(nowIso(), reason, existing.id);
}

export async function createOtp({ phone, role, ttlMinutes }) {
  const id = createId("otp");
  const normalizedPhone = normalizePhone(phone);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  // Prevent stale buildup and make brute-force harder.
  db.prepare("DELETE FROM otp_requests WHERE phone = ? AND role = ?").run(normalizedPhone, role);

  if (config.smsProvider === "twilio") {
    const providerResult = await sendOtpByProvider(normalizedPhone);

    db.prepare(
      `INSERT INTO otp_requests
       (id, phone, role, code, provider, provider_ref, attempts, last_attempt_at, created_at, expires_at, verified)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, 0)`
    ).run(id, normalizedPhone, role, "", providerResult.provider, providerResult.providerRef, createdAt, expiresAt);

    return { id, code: null, expires_at: expiresAt };
  }

  const mockCode = generateMockOtpCode();
  db.prepare(
    `INSERT INTO otp_requests
     (id, phone, role, code, provider, provider_ref, attempts, last_attempt_at, created_at, expires_at, verified)
     VALUES (?, ?, ?, ?, 'mock', NULL, 0, NULL, ?, ?, 0)`
  ).run(id, normalizedPhone, role, sha256(mockCode), createdAt, expiresAt);

  return { id, code: mockCode, expires_at: expiresAt };
}

export async function verifyOtp({ phone, role, code }) {
  const normalizedPhone = normalizePhone(phone);
  const row = db
    .prepare(
      `SELECT * FROM otp_requests
       WHERE phone = ? AND role = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(normalizedPhone, role);

  if (!row) {
    throw new Error("OTP request not found");
  }

  if (row.verified === 1) {
    throw new Error("OTP already used");
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new Error("OTP expired");
  }

  if (row.attempts >= config.otpMaxAttempts) {
    throw new Error("Too many OTP attempts");
  }

  let verified = false;
  if (row.provider === "twilio") {
    verified = await verifyOtpByProvider({ phone: normalizedPhone, code, provider: "twilio" });
  } else {
    verified = sha256(code) === row.code;
  }

  db.prepare(
    `UPDATE otp_requests
     SET attempts = attempts + 1, last_attempt_at = ?
     WHERE id = ?`
  ).run(nowIso(), row.id);

  if (!verified) {
    throw new Error("Invalid OTP");
  }

  db.prepare("UPDATE otp_requests SET verified = 1 WHERE id = ?").run(row.id);

  let user = findUserByRolePhone(role, normalizedPhone);
  if (!user) {
    user = createUser({ role, phone: normalizedPhone, name: role === "physio" ? "Physio user" : "" });
  }

  return user;
}

export function createAuditLog({ userId = null, eventType, method, path, statusCode, ip, userAgent, metadata }) {
  db.prepare(
    `INSERT INTO audit_logs
     (id, user_id, event_type, method, path, status_code, ip, user_agent, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    createId("audit"),
    userId,
    eventType,
    method,
    path,
    statusCode,
    ip || "",
    userAgent || "",
    metadata ? JSON.stringify(metadata) : null,
    nowIso()
  );
}

export function getSnapshot() {
  const tables = [
    "users",
    "patient_profiles",
    "care_plans",
    "plan_exercises",
    "sessions",
    "exercise_results",
    "alerts",
    "physio_notes",
    "consents",
    "otp_requests",
    "refresh_tokens",
    "audit_logs"
  ];

  const snapshot = {};
  for (const table of tables) {
    snapshot[table] = db.prepare(`SELECT * FROM ${table}`).all();
  }
  return snapshot;
}
