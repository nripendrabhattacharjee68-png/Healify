const STORAGE_KEY = "helify_mvp_db_v1";
const AUTH_KEY = "helify_mvp_auth_v1";
const CONSENT_VERSION = "2026-03-v1";
const OTP_TTL_MS = 5 * 60 * 1000;
const API_BASE_QUERY_PARAM = "api_base";

const urlParams = new URLSearchParams(window.location.search);
const queryApiBase = urlParams.get(API_BASE_QUERY_PARAM);
if (queryApiBase) {
  localStorage.setItem("helify_api_base", queryApiBase);
}

const REMOTE_API_BASE = (localStorage.getItem("helify_api_base") || "").replace(/\/+$/, "");
const USE_REMOTE_API = Boolean(REMOTE_API_BASE);

const EXERCISES = [
  { code: "seated_knee_extension", label: "Seated knee extension", defaultReps: 10, minROM: 30 },
  { code: "assisted_straight_leg_raise", label: "Assisted straight leg raise", defaultReps: 8, minROM: 20 },
  { code: "ankle_dorsiflexion_or_heel_slide", label: "Ankle dorsiflexion / heel slide", defaultReps: 10, minROM: 15 }
];

const el = {
  activeUserLabel: document.getElementById("active-user-label"),
  signOutBtn: document.getElementById("sign-out-btn"),
  tabbar: document.getElementById("tabbar"),

  loginForm: document.getElementById("login-form"),
  otpForm: document.getElementById("otp-form"),
  loginRole: document.getElementById("login-role"),
  loginPhone: document.getElementById("login-phone"),
  otpCode: document.getElementById("otp-code"),
  otpDebug: document.getElementById("otp-debug"),

  onboardingForm: document.getElementById("onboarding-form"),
  patientName: document.getElementById("patient-name"),
  affectedSide: document.getElementById("affected-side"),
  strokeDate: document.getElementById("stroke-date"),
  mobilityLevel: document.getElementById("mobility-level"),
  caregiverPhone: document.getElementById("caregiver-phone"),
  consentCheckbox: document.getElementById("consent-checkbox"),

  patientProfileSummary: document.getElementById("patient-profile-summary"),
  todayStats: document.getElementById("today-stats"),
  startCheckinBtn: document.getElementById("start-checkin-btn"),
  goProgressBtn: document.getElementById("go-progress-btn"),

  checkinForm: document.getElementById("checkin-form"),
  painPre: document.getElementById("pain-pre"),
  fatiguePre: document.getElementById("fatigue-pre"),
  painPreValue: document.getElementById("pain-pre-value"),
  fatiguePreValue: document.getElementById("fatigue-pre-value"),
  rfChestPain: document.getElementById("rf-chest-pain"),
  rfUncontrolledBp: document.getElementById("rf-uncontrolled-bp"),
  rfNewNeuro: document.getElementById("rf-new-neuro"),
  checkinStatus: document.getElementById("checkin-status"),
  backHomeBtn: document.getElementById("back-home-btn"),

  sessionAffectedSide: document.getElementById("session-affected-side"),
  cameraVideo: document.getElementById("camera-video"),
  cameraOverlay: document.getElementById("camera-overlay"),
  startCameraBtn: document.getElementById("start-camera-btn"),
  stopCameraBtn: document.getElementById("stop-camera-btn"),
  toggleVoiceBtn: document.getElementById("toggle-voice-btn"),
  aiCoachText: document.getElementById("ai-coach-text"),
  exerciseSelect: document.getElementById("exercise-select"),
  assistedToggle: document.getElementById("assisted-toggle"),
  repControls: document.getElementById("rep-controls"),
  romInput: document.getElementById("rom-input"),
  qualityInput: document.getElementById("quality-input"),
  exerciseLiveMetrics: document.getElementById("exercise-live-metrics"),
  finishSessionBtn: document.getElementById("finish-session-btn"),

  summaryContent: document.getElementById("summary-content"),
  summaryHomeBtn: document.getElementById("summary-home-btn"),
  summaryProgressBtn: document.getElementById("summary-progress-btn"),

  progressKpis: document.getElementById("progress-kpis"),
  progressBars: document.getElementById("progress-bars"),
  progressHomeBtn: document.getElementById("progress-home-btn"),

  cgStartSession: document.getElementById("cg-start-session"),
  cgValid: document.getElementById("cg-valid"),
  cgInvalid: document.getElementById("cg-invalid"),
  cgAssistToggle: document.getElementById("cg-assist-toggle"),
  cgFinish: document.getElementById("cg-finish"),
  caregiverStatus: document.getElementById("caregiver-status"),

  physioAlertFilter: document.getElementById("physio-alert-filter"),
  physioAlertList: document.getElementById("physio-alert-list"),
  physioPatientCards: document.getElementById("physio-patient-cards"),

  physioPatientDetail: document.getElementById("physio-patient-detail"),
  physioNoteForm: document.getElementById("physio-note-form"),
  physioNoteText: document.getElementById("physio-note-text"),
  physioNextAction: document.getElementById("physio-next-action"),
  physioFollowupDate: document.getElementById("physio-followup-date"),

  physioPlanForm: document.getElementById("physio-plan-form"),
  planTargetSessions: document.getElementById("plan-target-sessions"),
  planKneeReps: document.getElementById("plan-knee-reps"),
  planSlrReps: document.getElementById("plan-slr-reps"),
  planAnkleReps: document.getElementById("plan-ankle-reps"),
  backPhysioDashboard: document.getElementById("back-physio-dashboard"),

  toastContainer: document.getElementById("toast-container")
};

const state = {
  db: null,
  currentUser: null,
  currentAuthToken: null,
  currentRefreshToken: null,
  pendingOtpContext: null,
  currentSessionId: null,
  activeCheckin: null,
  sessionExerciseBuffer: {},
  selectedPhysioPatientId: null,
  caregiverAssistedMode: false,
  voiceEnabled: true,
  cameraStream: null
};

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function toDateOnly(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString().slice(0, 10);
}

function todayDateOnly() {
  return toDateOnly(Date.now());
}

function daysAgoDateOnly(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function showToast(message, type = "info") {
  const node = document.createElement("div");
  node.className = `toast${type === "warn" ? " warn" : type === "error" ? " error" : ""}`;
  node.textContent = message;
  el.toastContainer.appendChild(node);
  setTimeout(() => {
    node.remove();
  }, 3200);
}

function speak(text) {
  if (!state.voiceEnabled || !window.speechSynthesis) {
    return;
  }
  const msg = new SpeechSynthesisUtterance(text);
  msg.rate = 1;
  msg.pitch = 1;
  window.speechSynthesis.speak(msg);
}

function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function getEmptyDb() {
  return {
    users: [],
    patient_profiles: [],
    care_plans: [],
    plan_exercises: [],
    sessions: [],
    exercise_results: [],
    alerts: [],
    physio_notes: [],
    consents: [],
    otp_requests: []
  };
}

function loadDb() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return getEmptyDb();
  }
  return safeParse(raw, getEmptyDb());
}

function saveDb() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.db));
}

function upsertById(collection, row) {
  if (!row?.id) {
    return;
  }
  const index = collection.findIndex((item) => item.id === row.id);
  if (index === -1) {
    collection.push(row);
    return;
  }
  collection[index] = { ...collection[index], ...row };
}

function upsertByKey(collection, row, key) {
  if (!row || !row[key]) {
    return;
  }
  const index = collection.findIndex((item) => item[key] === row[key]);
  if (index === -1) {
    collection.push(row);
    return;
  }
  collection[index] = { ...collection[index], ...row };
}

function syncProfileBundle(profilePayload) {
  if (!profilePayload) {
    return;
  }
  if (profilePayload.user) {
    upsertById(state.db.users, profilePayload.user);
  }
  if (profilePayload.patient_profile) {
    upsertByKey(state.db.patient_profiles, profilePayload.patient_profile, "user_id");
  }
  if (profilePayload.active_plan) {
    upsertById(state.db.care_plans, profilePayload.active_plan);
  }
}

function performRemoteRequest(method, path, body, userId) {
  if (!USE_REMOTE_API) {
    throw new Error("Remote API is not enabled");
  }

  const xhr = new XMLHttpRequest();
  xhr.open(method, `${REMOTE_API_BASE}${path}`, false);
  xhr.setRequestHeader("Content-Type", "application/json");
  if (state.currentAuthToken) {
    xhr.setRequestHeader("Authorization", `Bearer ${state.currentAuthToken}`);
  }
  if (userId) {
    xhr.setRequestHeader("x-user-id", userId);
  } else if (state.currentUser?.id) {
    xhr.setRequestHeader("x-user-id", state.currentUser.id);
  }

  xhr.send(body ? JSON.stringify(body) : null);

  return {
    status: xhr.status,
    payload: safeParse(xhr.responseText || "{}", {})
  };
}

function refreshAccessToken() {
  if (!state.currentRefreshToken) {
    return false;
  }

  const result = performRemoteRequest("POST", "/auth/refresh", {
    refresh_token: state.currentRefreshToken
  });

  if (result.status >= 400) {
    return false;
  }

  state.currentAuthToken = result.payload?.access_token || null;
  state.currentRefreshToken = result.payload?.refresh_token || state.currentRefreshToken;
  if (result.payload?.user) {
    state.currentUser = result.payload.user;
  }
  saveAuth(state.currentUser, state.currentAuthToken, state.currentRefreshToken);
  return true;
}

function remoteRequest(method, path, body, userId, retryOnAuthFailure = true) {
  const result = performRemoteRequest(method, path, body, userId);
  if (
    result.status === 401 &&
    retryOnAuthFailure &&
    path !== "/auth/refresh" &&
    path !== "/auth/send-otp" &&
    path !== "/auth/verify-otp"
  ) {
    const refreshed = refreshAccessToken();
    if (refreshed) {
      return remoteRequest(method, path, body, userId, false);
    }
    clearAuth();
    state.currentUser = null;
  }

  if (result.status >= 400) {
    const message = result.payload?.error || `Request failed with status ${result.status}`;
    throw new Error(message);
  }
  return result.payload;
}

function refreshSnapshotFromRemote() {
  try {
    const snapshot = remoteRequest("GET", "/debug/snapshot");
    state.db = {
      ...getEmptyDb(),
      ...snapshot
    };
    saveDb();
  } catch (_error) {
    // Snapshot is optional in hardened deployments.
  }
}

function saveAuth(user, accessToken = null, refreshToken = null) {
  const authState = {
    user_id: user?.id || null,
    role: user?.role || null,
    access_token: accessToken || state.currentAuthToken || null,
    refresh_token: refreshToken || state.currentRefreshToken || null
  };
  state.currentAuthToken = authState.access_token;
  state.currentRefreshToken = authState.refresh_token;
  localStorage.setItem(AUTH_KEY, JSON.stringify(authState));
}

function clearAuth() {
  state.currentAuthToken = null;
  state.currentRefreshToken = null;
  localStorage.removeItem(AUTH_KEY);
}

function loadAuth() {
  const auth = safeParse(localStorage.getItem(AUTH_KEY), null);
  if (!auth || !auth.user_id) {
    return null;
  }
  return auth;
}

function seedPhysioUser() {
  if (state.db.users.some((u) => u.role === "physio")) {
    return;
  }
  state.db.users.push({
    id: createId("usr"),
    role: "physio",
    phone: "+910000000001",
    email: "physio@helify.demo",
    name: "Demo Physio",
    created_at: nowIso()
  });
}

function getPrimaryPhysioId() {
  const physio = state.db.users.find((u) => u.role === "physio");
  return physio ? physio.id : null;
}

function getCurrentPatientId() {
  if (!state.currentUser) {
    return null;
  }
  if (state.currentUser.role === "patient") {
    return state.currentUser.id;
  }
  if (state.currentUser.role === "caregiver") {
    const profile = state.db.patient_profiles.find((p) => p.caregiver_user_id === state.currentUser.id);
    return profile ? profile.user_id : null;
  }
  return null;
}

function getPatientProfile(patientId) {
  return state.db.patient_profiles.find((p) => p.user_id === patientId) || null;
}

function getActivePlan(patientId) {
  return state.db.care_plans.find((p) => p.patient_id === patientId && p.status === "active") || null;
}

function getPlanExercises(planId) {
  return state.db.plan_exercises.filter((item) => item.plan_id === planId);
}

function createAlert({ patient_id, session_id = null, type, severity, message }) {
  const duplicate = state.db.alerts.find((alert) => {
    const samePatient = alert.patient_id === patient_id;
    const sameType = alert.type === type;
    const open = alert.status === "open";
    const sameSession = session_id ? alert.session_id === session_id : true;
    return samePatient && sameType && open && sameSession;
  });
  if (duplicate) {
    return duplicate;
  }

  const alert = {
    id: createId("alr"),
    patient_id,
    session_id,
    type,
    severity,
    message,
    status: "open",
    created_at: nowIso(),
    reviewed_by: null,
    resolved_at: null,
    resolution_note: null
  };
  state.db.alerts.push(alert);
  return alert;
}

function ensureDefaultPlan(patientId) {
  let plan = getActivePlan(patientId);
  if (plan) {
    return plan;
  }

  const physioId = getPrimaryPhysioId();
  plan = {
    id: createId("pln"),
    patient_id: patientId,
    physio_id: physioId,
    status: "active",
    target_sessions_per_week: 5,
    created_at: nowIso(),
    updated_at: nowIso()
  };
  state.db.care_plans.push(plan);

  EXERCISES.forEach((exercise) => {
    state.db.plan_exercises.push({
      id: createId("pex"),
      plan_id: plan.id,
      exercise_code: exercise.code,
      sets_target: 1,
      reps_target: exercise.defaultReps,
      min_rom_target: exercise.minROM,
      updated_at: nowIso()
    });
  });

  return plan;
}

function normalizePhone(phone) {
  return (phone || "").trim();
}

function findUserByPhoneAndRole(phone, role) {
  return state.db.users.find((u) => u.phone === phone && u.role === role) || null;
}

const localApi = {
  // POST /auth/send-otp
  sendOtp(payload) {
    const phone = normalizePhone(payload.phone);
    if (!phone) {
      throw new Error("phone is required");
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const request = {
      id: createId("otp"),
      phone,
      role: payload.role,
      code,
      created_at: nowIso(),
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      verified: false
    };
    state.db.otp_requests.push(request);
    saveDb();

    return {
      request_id: request.id,
      expires_at: request.expires_at,
      demo_code: code
    };
  },

  // POST /auth/verify-otp
  verifyOtp(payload) {
    const phone = normalizePhone(payload.phone);
    const role = payload.role;
    const otp = state.db.otp_requests
      .filter((item) => item.phone === phone && item.role === role)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

    if (!otp) {
      throw new Error("OTP request not found");
    }

    if (new Date(otp.expires_at) < new Date()) {
      throw new Error("OTP expired");
    }

    if (String(payload.code) !== String(otp.code)) {
      throw new Error("Invalid OTP");
    }

    otp.verified = true;

    let user = findUserByPhoneAndRole(phone, role);
    if (!user) {
      user = {
        id: createId("usr"),
        role,
        phone,
        email: "",
        name: role === "physio" ? "Physio user" : "",
        created_at: nowIso()
      };
      state.db.users.push(user);
    }

    saveDb();
    return { user };
  },

  // GET /me/profile
  meProfile(userId) {
    const user = state.db.users.find((u) => u.id === userId);
    if (!user) {
      throw new Error("User not found");
    }

    const profile = user.role === "patient" ? getPatientProfile(user.id) : null;
    const patientId = user.role === "patient" ? user.id : getCurrentPatientId();
    const plan = patientId ? getActivePlan(patientId) : null;

    return {
      user,
      patient_profile: profile,
      active_plan: plan
    };
  },

  // POST /patients/onboarding
  onboardPatient(payload) {
    const patientId = payload.user_id;
    const patientUser = state.db.users.find((u) => u.id === patientId && u.role === "patient");
    if (!patientUser) {
      throw new Error("Patient user not found");
    }

    let caregiverUser = findUserByPhoneAndRole(normalizePhone(payload.caregiver_phone), "caregiver");
    if (!caregiverUser) {
      caregiverUser = {
        id: createId("usr"),
        role: "caregiver",
        phone: normalizePhone(payload.caregiver_phone),
        email: "",
        name: "Caregiver",
        created_at: nowIso()
      };
      state.db.users.push(caregiverUser);
    }

    patientUser.name = payload.name;

    const existing = getPatientProfile(patientId);
    const profilePayload = {
      user_id: patientId,
      affected_side: payload.affected_side,
      stroke_date: payload.stroke_date,
      mobility_level: payload.mobility_level,
      caregiver_user_id: caregiverUser.id
    };

    if (existing) {
      Object.assign(existing, profilePayload);
    } else {
      state.db.patient_profiles.push(profilePayload);
    }

    if (payload.consent_accepted) {
      const already = state.db.consents.find(
        (c) => c.user_id === patientId && c.version === CONSENT_VERSION
      );
      if (!already) {
        state.db.consents.push({
          id: createId("cns"),
          user_id: patientId,
          version: CONSENT_VERSION,
          accepted_at: nowIso()
        });
      }
    }

    const plan = ensureDefaultPlan(patientId);
    saveDb();

    return { patient_profile: profilePayload, active_plan: plan };
  },

  // POST /sessions/start
  startSession(payload) {
    const patientId = payload.patient_id;
    const plan = getActivePlan(patientId);
    if (!plan) {
      throw new Error("No active plan for patient");
    }

    const session = {
      id: createId("ses"),
      patient_id: patientId,
      plan_id: plan.id,
      started_at: nowIso(),
      ended_at: null,
      pain_pre: null,
      pain_post: null,
      fatigue_pre: null,
      fatigue_post: null,
      red_flags: {
        chest_pain: false,
        uncontrolled_bp: false,
        new_neuro: false
      },
      status: "started"
    };
    state.db.sessions.push(session);
    saveDb();
    return { session };
  },

  // POST /sessions/{id}/checkin
  checkinSession(sessionId, payload) {
    const session = state.db.sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    session.pain_pre = Number(payload.pain_pre);
    session.fatigue_pre = Number(payload.fatigue_pre);
    session.red_flags = {
      chest_pain: Boolean(payload.red_flags.chest_pain),
      uncontrolled_bp: Boolean(payload.red_flags.uncontrolled_bp),
      new_neuro: Boolean(payload.red_flags.new_neuro)
    };

    const hasRedFlag = Object.values(session.red_flags).some(Boolean);
    if (hasRedFlag) {
      session.status = "blocked";
      createAlert({
        patient_id: session.patient_id,
        session_id: session.id,
        type: "RED_FLAG_CHECKIN",
        severity: "high",
        message: "Red-flag symptom reported at pre-session check-in."
      });
    }

    saveDb();
    return { session, has_red_flag: hasRedFlag };
  },

  // POST /sessions/{id}/exercise-result
  upsertExerciseResult(sessionId, payload) {
    const session = state.db.sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const existing = state.db.exercise_results.find(
      (x) => x.session_id === sessionId && x.exercise_code === payload.exercise_code
    );

    const normalized = {
      exercise_code: payload.exercise_code,
      total_reps: Number(payload.total_reps),
      valid_reps: Number(payload.valid_reps),
      avg_rom: Number(payload.avg_rom),
      avg_quality: Number(payload.avg_quality),
      assisted_reps: Number(payload.assisted_reps)
    };

    if (existing) {
      Object.assign(existing, normalized);
      saveDb();
      return { exercise_result: existing };
    }

    const row = {
      id: createId("res"),
      session_id: sessionId,
      ...normalized
    };
    state.db.exercise_results.push(row);
    saveDb();
    return { exercise_result: row };
  },

  // POST /sessions/{id}/finish
  finishSession(sessionId, payload) {
    const session = state.db.sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    session.pain_post = Number(payload.pain_post);
    session.fatigue_post = Number(payload.fatigue_post);
    session.ended_at = nowIso();

    if (session.status !== "blocked") {
      session.status = "completed";
    }

    evaluateSessionAlerts(session.patient_id, session.id);
    evaluateMissedSessionAlert(session.patient_id);

    saveDb();
    return { session, alerts: state.db.alerts.filter((a) => a.session_id === session.id) };
  },

  // GET /patients/{id}/progress?days=7
  getPatientProgress(patientId, days = 7) {
    const fromDate = daysAgoDateOnly(days - 1);
    const sessions = state.db.sessions
      .filter((s) => s.patient_id === patientId && s.ended_at && toDateOnly(s.ended_at) >= fromDate)
      .sort((a, b) => new Date(a.ended_at) - new Date(b.ended_at));

    const byDay = {};
    for (let i = 0; i < days; i += 1) {
      const key = daysAgoDateOnly(days - 1 - i);
      byDay[key] = { completed_sessions: 0, valid_reps: 0, total_reps: 0, avg_pain_delta: 0, samples: 0 };
    }

    sessions.forEach((session) => {
      const key = toDateOnly(session.ended_at);
      const bucket = byDay[key];
      if (!bucket) {
        return;
      }
      bucket.completed_sessions += session.status === "completed" ? 1 : 0;

      const sessionResults = state.db.exercise_results.filter((r) => r.session_id === session.id);
      sessionResults.forEach((result) => {
        bucket.valid_reps += result.valid_reps;
        bucket.total_reps += result.total_reps;
      });

      if (Number.isFinite(session.pain_pre) && Number.isFinite(session.pain_post)) {
        bucket.avg_pain_delta += session.pain_post - session.pain_pre;
        bucket.samples += 1;
      }
    });

    const trend = Object.entries(byDay).map(([date, metric]) => {
      const painDelta = metric.samples > 0 ? metric.avg_pain_delta / metric.samples : 0;
      const validRate = metric.total_reps > 0 ? (metric.valid_reps / metric.total_reps) * 100 : 0;
      return {
        date,
        completed_sessions: metric.completed_sessions,
        valid_rep_rate: Math.round(validRate),
        pain_delta: Number(painDelta.toFixed(2))
      };
    });

    const totalSessions = sessions.filter((s) => s.status === "completed").length;
    const adherenceTarget = getActivePlan(patientId)?.target_sessions_per_week || 5;
    const adherencePct = Math.round((totalSessions / adherenceTarget) * 100);

    return {
      trend,
      totals: {
        completed_sessions: totalSessions,
        adherence_pct: Math.max(0, Math.min(200, adherencePct))
      }
    };
  },

  // GET /physio/alerts?status=open
  getPhysioAlerts(status = "open") {
    if (status === "all") {
      return [...state.db.alerts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return state.db.alerts
      .filter((alert) => alert.status === status)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // POST /physio/alerts/{id}/resolve
  resolvePhysioAlert(alertId, payload) {
    const alert = state.db.alerts.find((a) => a.id === alertId);
    if (!alert) {
      throw new Error("Alert not found");
    }
    alert.status = "resolved";
    alert.reviewed_by = payload.physio_id;
    alert.resolution_note = payload.resolution_note || "Reviewed";
    alert.resolved_at = nowIso();
    saveDb();
    return { alert };
  },

  // POST /physio/patients/{id}/plan
  updatePhysioPlan(patientId, payload) {
    const plan = ensureDefaultPlan(patientId);
    plan.target_sessions_per_week = Number(payload.target_sessions_per_week);
    plan.updated_at = nowIso();

    const updates = [
      { code: "seated_knee_extension", reps: Number(payload.knee_extension_reps) },
      { code: "assisted_straight_leg_raise", reps: Number(payload.straight_leg_raise_reps) },
      { code: "ankle_dorsiflexion_or_heel_slide", reps: Number(payload.ankle_or_heel_slide_reps) }
    ];

    updates.forEach((update) => {
      const row = state.db.plan_exercises.find(
        (item) => item.plan_id === plan.id && item.exercise_code === update.code
      );
      if (row) {
        row.reps_target = update.reps;
        row.updated_at = nowIso();
      }
    });

    saveDb();
    return { plan, exercises: getPlanExercises(plan.id) };
  },

  listPhysioPatients() {
    return state.db.patient_profiles.map((profile) => {
      const user = state.db.users.find((u) => u.id === profile.user_id);
      const openAlerts = state.db.alerts.filter(
        (alert) => alert.patient_id === profile.user_id && alert.status === "open"
      ).length;
      const progress = localApi.getPatientProgress(profile.user_id, 7);
      return {
        ...profile,
        patient_name: user?.name || profile.user_id,
        patient_phone: user?.phone || "",
        open_alerts: openAlerts,
        sessions_7d: progress.totals.completed_sessions,
        adherence_7d: progress.totals.adherence_pct
      };
    });
  },

  getPhysioPatientDetail(patientId) {
    const user = state.db.users.find((u) => u.id === patientId);
    const profile = getPatientProfile(patientId);
    const plan = ensureDefaultPlan(patientId);
    const exercises = getPlanExercises(plan.id);
    const alerts = state.db.alerts
      .filter((alert) => alert.patient_id === patientId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);
    const notes = state.db.physio_notes
      .filter((note) => note.patient_id === patientId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);
    return {
      user,
      profile,
      plan,
      exercises,
      alerts,
      notes,
      progress_7d: localApi.getPatientProgress(patientId, 7)
    };
  },

  createPhysioNote(patientId, payload) {
    const note = {
      id: createId("nt"),
      patient_id: patientId,
      alert_id: payload.alert_id || null,
      physio_id: payload.physio_id,
      note: payload.note,
      next_action: payload.next_action,
      followup_date: payload.followup_date,
      created_at: nowIso()
    };
    state.db.physio_notes.push(note);
    saveDb();
    return { note };
  }
};

const remoteApi = {
  sendOtp(payload) {
    return remoteRequest("POST", "/auth/send-otp", payload);
  },

  verifyOtp(payload) {
    const response = remoteRequest("POST", "/auth/verify-otp", payload);
    state.currentAuthToken = response.access_token || null;
    state.currentRefreshToken = response.refresh_token || null;
    syncProfileBundle({ user: response.user });
    refreshSnapshotFromRemote();
    return response;
  },

  meProfile() {
    const response = remoteRequest("GET", "/me/profile");
    syncProfileBundle(response);
    return response;
  },

  onboardPatient(payload) {
    const response = remoteRequest("POST", "/patients/onboarding", payload);
    syncProfileBundle(response);
    refreshSnapshotFromRemote();
    return response;
  },

  startSession(payload) {
    const response = remoteRequest("POST", "/sessions/start", payload);
    if (response?.session) {
      upsertById(state.db.sessions, response.session);
      saveDb();
    }
    refreshSnapshotFromRemote();
    return response;
  },

  checkinSession(sessionId, payload) {
    const response = remoteRequest("POST", `/sessions/${sessionId}/checkin`, payload);
    if (response?.session) {
      upsertById(state.db.sessions, response.session);
      saveDb();
    }
    refreshSnapshotFromRemote();
    return response;
  },

  upsertExerciseResult(sessionId, payload) {
    const response = remoteRequest("POST", `/sessions/${sessionId}/exercise-result`, payload);
    if (response?.exercise_result) {
      upsertById(state.db.exercise_results, response.exercise_result);
      saveDb();
    }
    refreshSnapshotFromRemote();
    return response;
  },

  finishSession(sessionId, payload) {
    const response = remoteRequest("POST", `/sessions/${sessionId}/finish`, payload);
    if (response?.session) {
      upsertById(state.db.sessions, response.session);
    }
    if (Array.isArray(response?.alerts)) {
      response.alerts.forEach((alert) => upsertById(state.db.alerts, alert));
    }
    saveDb();
    refreshSnapshotFromRemote();
    return response;
  },

  getPatientProgress(patientId, days = 7) {
    return remoteRequest("GET", `/patients/${patientId}/progress?days=${days}`);
  },

  getPhysioAlerts(status = "open") {
    const response = remoteRequest("GET", `/physio/alerts?status=${encodeURIComponent(status)}`);
    if (Array.isArray(response)) {
      response.forEach((alert) => upsertById(state.db.alerts, alert));
      saveDb();
    }
    refreshSnapshotFromRemote();
    return response;
  },

  resolvePhysioAlert(alertId, payload) {
    const response = remoteRequest("POST", `/physio/alerts/${alertId}/resolve`, payload);
    if (response?.alert) {
      upsertById(state.db.alerts, response.alert);
      saveDb();
    }
    refreshSnapshotFromRemote();
    return response;
  },

  updatePhysioPlan(patientId, payload) {
    const response = remoteRequest("POST", `/physio/patients/${patientId}/plan`, payload);
    if (response?.plan) {
      upsertById(state.db.care_plans, response.plan);
    }
    if (Array.isArray(response?.exercises)) {
      response.exercises.forEach((exercise) => upsertById(state.db.plan_exercises, exercise));
    }
    saveDb();
    refreshSnapshotFromRemote();
    return response;
  },

  listPhysioPatients() {
    return remoteRequest("GET", "/physio/patients");
  },

  getPhysioPatientDetail(patientId) {
    const response = remoteRequest("GET", `/physio/patients/${patientId}`);
    syncProfileBundle({
      user: response?.user,
      patient_profile: response?.profile,
      active_plan: response?.plan
    });
    if (Array.isArray(response?.exercises)) {
      response.exercises.forEach((exercise) => upsertById(state.db.plan_exercises, exercise));
    }
    if (Array.isArray(response?.alerts)) {
      response.alerts.forEach((alert) => upsertById(state.db.alerts, alert));
    }
    if (Array.isArray(response?.notes)) {
      response.notes.forEach((note) => upsertById(state.db.physio_notes, note));
    }
    saveDb();
    return response;
  },

  createPhysioNote(patientId, payload) {
    const response = remoteRequest("POST", `/physio/patients/${patientId}/notes`, payload);
    if (response?.note) {
      upsertById(state.db.physio_notes, response.note);
      saveDb();
    }
    refreshSnapshotFromRemote();
    return response;
  },

  logout() {
    if (!state.currentRefreshToken) {
      return { ok: true };
    }
    return remoteRequest("POST", "/auth/logout", {
      refresh_token: state.currentRefreshToken
    });
  }
};

let backendApi = USE_REMOTE_API ? remoteApi : localApi;

function getSessionResults(sessionId) {
  return state.db.exercise_results.filter((item) => item.session_id === sessionId);
}

function getCompletedSessions(patientId) {
  return state.db.sessions
    .filter((session) => session.patient_id === patientId && session.status === "completed")
    .sort((a, b) => new Date(a.ended_at) - new Date(b.ended_at));
}

function aggregateSessionQuality(sessionId) {
  const results = getSessionResults(sessionId);
  const totals = results.reduce(
    (acc, row) => {
      acc.valid += row.valid_reps;
      acc.total += row.total_reps;
      acc.assisted += row.assisted_reps;
      return acc;
    },
    { valid: 0, total: 0, assisted: 0 }
  );
  const validRate = totals.total > 0 ? totals.valid / totals.total : 0;
  const assistedRate = totals.total > 0 ? totals.assisted / totals.total : 0;
  return { ...totals, validRate, assistedRate };
}

function evaluateSessionAlerts(patientId, sessionId) {
  const sessions = getCompletedSessions(patientId);

  // Rule 2: pain increase >=2 points in 2 consecutive sessions.
  if (sessions.length >= 2) {
    const lastTwo = sessions.slice(-2);
    const twoConsecutiveHighDelta = lastTwo.every((session) => {
      const delta = (session.pain_post ?? 0) - (session.pain_pre ?? 0);
      return delta >= 2;
    });
    if (twoConsecutiveHighDelta) {
      createAlert({
        patient_id: patientId,
        session_id: sessionId,
        type: "PAIN_WORSENING_2X",
        severity: "medium",
        message: "Pain increased by >=2 points in two consecutive sessions."
      });
    }
  }

  // Rule 3: valid rep rate <50% for 3 sessions.
  if (sessions.length >= 3) {
    const lastThree = sessions.slice(-3);
    const lowQualityThree = lastThree.every((session) => {
      const quality = aggregateSessionQuality(session.id);
      return quality.total > 0 && quality.validRate < 0.5;
    });
    if (lowQualityThree) {
      createAlert({
        patient_id: patientId,
        session_id: sessionId,
        type: "LOW_VALID_REP_RATE_3X",
        severity: "medium",
        message: "Valid rep rate stayed below 50% across three sessions."
      });
    }
  }

  // Rule 5: assisted reps trend worsening week-over-week.
  const now = new Date();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const thisWeekSessions = sessions.filter((session) => now - new Date(session.ended_at) <= sevenDaysMs);
  const prevWeekSessions = sessions.filter((session) => {
    const age = now - new Date(session.ended_at);
    return age > sevenDaysMs && age <= 2 * sevenDaysMs;
  });

  if (thisWeekSessions.length >= 2 && prevWeekSessions.length >= 2) {
    const thisWeekRate =
      thisWeekSessions.reduce((sum, session) => sum + aggregateSessionQuality(session.id).assistedRate, 0) /
      thisWeekSessions.length;
    const prevWeekRate =
      prevWeekSessions.reduce((sum, session) => sum + aggregateSessionQuality(session.id).assistedRate, 0) /
      prevWeekSessions.length;

    if (thisWeekRate > prevWeekRate + 0.2) {
      createAlert({
        patient_id: patientId,
        session_id: sessionId,
        type: "ASSISTED_REPS_WORSENING",
        severity: "medium",
        message: "Assisted rep dependency increased week-over-week."
      });
    }
  }
}

function evaluateMissedSessionAlert(patientId) {
  // Rule 4: missed sessions for 3 straight days.
  const completedDates = new Set(
    state.db.sessions
      .filter((session) => session.patient_id === patientId && session.status === "completed")
      .map((session) => toDateOnly(session.ended_at))
  );

  const missedThreeDays = [0, 1, 2].every((offset) => !completedDates.has(daysAgoDateOnly(offset)));
  if (missedThreeDays) {
    createAlert({
      patient_id: patientId,
      session_id: null,
      type: "MISSED_3_DAYS",
      severity: "low",
      message: "Patient has missed sessions for three straight days."
    });
  }
}

function screenIdFromNav(navKey) {
  return `screen-${navKey}`;
}

function showScreen(navKey) {
  document.querySelectorAll(".screen").forEach((node) => {
    node.classList.toggle("active", node.id === screenIdFromNav(navKey));
  });

  el.tabbar.querySelectorAll("button[data-nav]").forEach((node) => {
    node.classList.toggle("active", node.dataset.nav === navKey);
  });
}

function setNavVisibility(keys) {
  const allowed = new Set(keys);
  el.tabbar.querySelectorAll("button[data-nav]").forEach((btn) => {
    btn.hidden = !allowed.has(btn.dataset.nav);
  });
}

function refreshHeader() {
  const modeSuffix = backendApi === remoteApi ? " [API]" : " [LOCAL]";
  if (!state.currentUser) {
    el.activeUserLabel.textContent = `Not signed in${modeSuffix}`;
    return;
  }
  const suffix = state.currentUser.phone ? ` (${state.currentUser.phone})` : "";
  el.activeUserLabel.textContent = `${state.currentUser.role.toUpperCase()}${suffix}${modeSuffix}`;
}

function startRoleHome() {
  if (!state.currentUser) {
    setNavVisibility(["login"]);
    showScreen("login");
    return;
  }

  if (state.currentUser.role === "physio") {
    setNavVisibility(["physio-dashboard", "physio-patient"]);
    renderPhysioDashboard();
    showScreen("physio-dashboard");
    return;
  }

  if (state.currentUser.role === "caregiver") {
    setNavVisibility(["caregiver", "patient-home", "checkin", "session", "summary", "progress"]);
    renderCaregiverMode();
    showScreen("caregiver");
    return;
  }

  // patient role
  const patientProfile = getPatientProfile(state.currentUser.id);
  const hasConsent = state.db.consents.some(
    (c) => c.user_id === state.currentUser.id && c.version === CONSENT_VERSION
  );

  if (!patientProfile || !hasConsent) {
    setNavVisibility(["login"]);
    showScreen("onboarding");
    return;
  }

  setNavVisibility(["patient-home", "checkin", "session", "summary", "progress"]);
  renderPatientHome();
  showScreen("patient-home");
}

function formatDate(isoDate) {
  if (!isoDate) {
    return "-";
  }
  const d = new Date(isoDate);
  return d.toLocaleDateString();
}

function formatDateTime(isoDate) {
  if (!isoDate) {
    return "-";
  }
  const d = new Date(isoDate);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function renderPatientHome() {
  const patientId = getCurrentPatientId();
  if (!patientId) {
    el.patientProfileSummary.innerHTML = "<div>No linked patient profile found.</div>";
    return;
  }

  if (backendApi === localApi) {
    evaluateMissedSessionAlert(patientId);
    saveDb();
  }

  const user = state.db.users.find((u) => u.id === patientId);
  const profile = getPatientProfile(patientId);
  const plan = backendApi === localApi ? ensureDefaultPlan(patientId) : getActivePlan(patientId);
  const openAlerts = state.db.alerts.filter((a) => a.patient_id === patientId && a.status === "open");

  el.patientProfileSummary.innerHTML = `
    <div><strong>Name:</strong> ${user?.name || "Patient"}</div>
    <div><strong>Affected side:</strong> ${profile?.affected_side || "-"}</div>
    <div><strong>Stroke date:</strong> ${profile?.stroke_date || "-"}</div>
    <div><strong>Mobility:</strong> ${profile?.mobility_level || "-"}</div>
    <div><strong>Target sessions/week:</strong> ${plan?.target_sessions_per_week || "-"}</div>
    <div><strong>Open alerts:</strong> ${openAlerts.length}</div>
  `;

  const todaysSessions = state.db.sessions.filter(
    (session) => session.patient_id === patientId && toDateOnly(session.started_at) === todayDateOnly()
  );

  const latest = todaysSessions.sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0];
  const progress = backendApi.getPatientProgress(patientId, 7);

  el.todayStats.innerHTML = `
    <div><strong>Sessions today:</strong> ${todaysSessions.length}</div>
    <div><strong>Weekly adherence:</strong> ${progress.totals.adherence_pct}%</div>
    <div><strong>Last session status:</strong> ${latest ? latest.status : "none"}</div>
  `;
}

function renderProgress() {
  const patientId = getCurrentPatientId();
  if (!patientId) {
    el.progressKpis.innerHTML = "<div class='kpi'>No patient linked.</div>";
    el.progressBars.innerHTML = "";
    return;
  }

  const progress = backendApi.getPatientProgress(patientId, 7);
  const completed = progress.totals.completed_sessions;
  const adherence = progress.totals.adherence_pct;
  const openAlerts = state.db.alerts.filter((a) => a.patient_id === patientId && a.status === "open").length;

  el.progressKpis.innerHTML = `
    <div class="kpi"><strong>Completed sessions (7d)</strong><div>${completed}</div></div>
    <div class="kpi"><strong>Adherence</strong><div>${adherence}%</div></div>
    <div class="kpi"><strong>Open alerts</strong><div>${openAlerts}</div></div>
    <div class="kpi"><strong>Scope</strong><div>Post-stroke hemiparesis</div></div>
  `;

  el.progressBars.innerHTML = progress.trend
    .map((day) => {
      const bar = Math.max(0, Math.min(100, day.valid_rep_rate));
      return `
        <div class="progress-row">
          <div>${day.date}</div>
          <div class="progress-track"><div class="progress-fill" style="width:${bar}%"></div></div>
          <div>${bar}%</div>
        </div>
      `;
    })
    .join("");
}

function getPlanExerciseLabel(code) {
  const found = EXERCISES.find((e) => e.code === code);
  return found ? found.label : code;
}

function initSessionBuffer(patientId) {
  const plan = backendApi === localApi ? ensureDefaultPlan(patientId) : getActivePlan(patientId);
  if (!plan) {
    throw new Error("No active plan found for patient");
  }
  const items = getPlanExercises(plan.id);

  state.sessionExerciseBuffer = {};
  items.forEach((item) => {
    state.sessionExerciseBuffer[item.exercise_code] = {
      exercise_code: item.exercise_code,
      target_reps: item.reps_target,
      min_rom_target: item.min_rom_target,
      total_reps: 0,
      valid_reps: 0,
      assisted_reps: 0,
      rom_sum: 0,
      quality_sum: 0,
      samples: 0
    };
  });

  el.exerciseSelect.innerHTML = items
    .map((item) => `<option value="${item.exercise_code}">${getPlanExerciseLabel(item.exercise_code)}</option>`)
    .join("");

  renderExerciseMetrics();
}

function getActiveExerciseBuffer() {
  const code = el.exerciseSelect.value;
  return state.sessionExerciseBuffer[code];
}

function renderExerciseMetrics() {
  const current = getActiveExerciseBuffer();
  if (!current) {
    el.exerciseLiveMetrics.innerHTML = "<div>No exercise selected.</div>";
    return;
  }

  const validRate = current.total_reps > 0 ? Math.round((current.valid_reps / current.total_reps) * 100) : 0;
  const avgROM = current.samples > 0 ? Math.round(current.rom_sum / current.samples) : 0;
  const avgQuality = current.samples > 0 ? Math.round(current.quality_sum / current.samples) : 0;

  el.exerciseLiveMetrics.innerHTML = `
    <div><strong>Target reps:</strong> ${current.target_reps}</div>
    <div><strong>Total reps:</strong> ${current.total_reps}</div>
    <div><strong>Valid reps:</strong> ${current.valid_reps}</div>
    <div><strong>Valid rate:</strong> ${validRate}%</div>
    <div><strong>Assisted reps:</strong> ${current.assisted_reps}</div>
    <div><strong>Average ROM:</strong> ${avgROM} deg</div>
    <div><strong>Average quality:</strong> ${avgQuality}/100</div>
  `;
}

function updateCoachText(exerciseBuffer, wasValid) {
  const quality = Number(el.qualityInput.value || 0);
  const rom = Number(el.romInput.value || 0);

  let text = "Coach: Keep movements controlled and pain-free.";
  if (!wasValid) {
    text = "Coach: Repeat slowly, focus on alignment and breathing.";
  } else if (quality < 55) {
    text = "Coach: Improve control, reduce speed, stabilize trunk.";
  } else if (rom < exerciseBuffer.min_rom_target) {
    text = "Coach: Try slightly larger range, only if pain stays manageable.";
  } else if (el.assistedToggle.checked) {
    text = "Coach: Assisted mode active. Let caregiver support safely.";
  }

  el.aiCoachText.textContent = text;
  speak(text.replace("Coach:", ""));
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Camera API is not supported on this browser.", "error");
    return;
  }

  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });
    el.cameraVideo.srcObject = state.cameraStream;
    el.cameraOverlay.textContent = "Camera active";
  } catch (error) {
    showToast("Camera access denied or unavailable.", "error");
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
  }
  el.cameraVideo.srcObject = null;
  el.cameraOverlay.textContent = "Camera idle";
}

function startCheckinFlow() {
  const patientId = getCurrentPatientId();
  if (!patientId) {
    showToast("No patient is linked for this account.", "error");
    return;
  }

  const { session } = backendApi.startSession({ patient_id: patientId });
  state.currentSessionId = session.id;
  state.activeCheckin = null;
  el.checkinStatus.textContent = "";
  showScreen("checkin");
}

function applyCheckinRanges() {
  el.painPreValue.textContent = el.painPre.value;
  el.fatiguePreValue.textContent = el.fatiguePre.value;
}

function resetSessionForms() {
  el.assistedToggle.checked = false;
  el.romInput.value = 35;
  el.qualityInput.value = 70;
  el.rfChestPain.checked = false;
  el.rfUncontrolledBp.checked = false;
  el.rfNewNeuro.checked = false;
  el.painPre.value = 2;
  el.fatiguePre.value = 3;
  applyCheckinRanges();
}

function promptPostSessionMetrics() {
  const painRaw = window.prompt("Enter pain after session (0-10)", "2");
  const fatigueRaw = window.prompt("Enter fatigue after session (0-10)", "3");

  const pain = Math.max(0, Math.min(10, Number(painRaw ?? 0)));
  const fatigue = Math.max(0, Math.min(10, Number(fatigueRaw ?? 0)));

  return { pain_post: pain, fatigue_post: fatigue };
}

function finishSessionFlow() {
  if (!state.currentSessionId) {
    showToast("No active session found.", "warn");
    return;
  }

  const payloads = Object.values(state.sessionExerciseBuffer);
  payloads.forEach((item) => {
    const avgRom = item.samples > 0 ? item.rom_sum / item.samples : 0;
    const avgQuality = item.samples > 0 ? item.quality_sum / item.samples : 0;

    backendApi.upsertExerciseResult(state.currentSessionId, {
      exercise_code: item.exercise_code,
      total_reps: item.total_reps,
      valid_reps: item.valid_reps,
      avg_rom: Number(avgRom.toFixed(2)),
      avg_quality: Number(avgQuality.toFixed(2)),
      assisted_reps: item.assisted_reps
    });
  });

  const postMetrics = promptPostSessionMetrics();
  const { session } = backendApi.finishSession(state.currentSessionId, postMetrics);

  state.currentSessionId = null;
  stopCamera();
  renderSummary(session.id);
  renderPatientHome();
  showScreen("summary");
  showToast("Session saved and alert engine evaluated.");
}

function renderSummary(sessionId) {
  const session = state.db.sessions.find((s) => s.id === sessionId);
  const results = getSessionResults(sessionId);
  const alerts = state.db.alerts.filter((a) => a.session_id === sessionId);

  const totalReps = results.reduce((sum, item) => sum + item.total_reps, 0);
  const validReps = results.reduce((sum, item) => sum + item.valid_reps, 0);
  const avgRom =
    results.length > 0
      ? Math.round(results.reduce((sum, item) => sum + item.avg_rom, 0) / Math.max(1, results.length))
      : 0;

  const painDelta = (session.pain_post ?? 0) - (session.pain_pre ?? 0);

  const alertHtml =
    alerts.length > 0
      ? alerts
          .map(
            (a) =>
              `<div><span class="alert-chip ${a.severity}">${a.severity.toUpperCase()}</span> ${a.type} - ${a.message}</div>`
          )
          .join("")
      : "<div>No new session alerts.</div>";

  el.summaryContent.innerHTML = `
    <div><strong>Session:</strong> ${session.id}</div>
    <div><strong>Status:</strong> ${session.status}</div>
    <div><strong>Total reps:</strong> ${totalReps}</div>
    <div><strong>Valid reps:</strong> ${validReps}</div>
    <div><strong>Average ROM:</strong> ${avgRom} deg</div>
    <div><strong>Pain delta:</strong> ${painDelta >= 0 ? "+" : ""}${painDelta}</div>
    <div><strong>Fatigue post:</strong> ${session.fatigue_post}</div>
    <div><strong>Alerts:</strong></div>
    ${alertHtml}
  `;
}

function renderCaregiverMode() {
  const patientId = getCurrentPatientId();
  if (!patientId) {
    el.caregiverStatus.textContent = "No linked patient found. Patient onboarding must include this caregiver number.";
    return;
  }

  const patientUser = state.db.users.find((u) => u.id === patientId);
  el.caregiverStatus.textContent = `Linked patient: ${patientUser?.name || patientId}. Use large controls to assist safely.`;
}

function renderPhysioDashboard() {
  const status = el.physioAlertFilter.value;
  const alerts = backendApi.getPhysioAlerts(status);

  if (alerts.length === 0) {
    el.physioAlertList.innerHTML = "<div>No alerts in this filter.</div>";
  } else {
    el.physioAlertList.innerHTML = alerts
      .map((alert) => {
        const patient = state.db.users.find((u) => u.id === alert.patient_id);
        return `
          <div class="alert-card">
            <div class="stack compact">
              <div>
                <span class="alert-chip ${alert.severity}">${alert.severity.toUpperCase()}</span>
                <strong>${alert.type}</strong>
              </div>
              <div>${alert.message}</div>
              <div><strong>Patient:</strong> ${patient?.name || alert.patient_id}</div>
              <div><strong>Created:</strong> ${formatDateTime(alert.created_at)}</div>
              <div class="button-row">
                <button data-alert-open="${alert.patient_id}" class="ghost">Open patient</button>
                ${
                  alert.status === "open"
                    ? `<button data-alert-resolve="${alert.id}">Resolve</button>`
                    : "<span>Resolved</span>"
                }
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  const patients = backendApi.listPhysioPatients();
  const patientCards = patients.map((patient) => {
    return `
      <div class="patient-card">
        <div><strong>${patient.patient_name || patient.user_id}</strong></div>
        <div>Affected side: ${patient.affected_side}</div>
        <div>7d sessions: ${patient.sessions_7d}</div>
        <div>Open alerts: ${patient.open_alerts}</div>
        <div class="button-row">
          <button data-open-patient="${patient.user_id}" class="ghost">View detail</button>
        </div>
      </div>
    `;
  });

  el.physioPatientCards.innerHTML =
    patientCards.length > 0 ? patientCards.join("") : "<div>No patients onboarded yet.</div>";
}

function renderPhysioPatientDetail(patientId) {
  state.selectedPhysioPatientId = patientId;
  const detail = backendApi.getPhysioPatientDetail(patientId);
  const user = detail.user;
  const profile = detail.profile;
  const plan = detail.plan;
  const planExercises = detail.exercises || [];
  const alerts = (detail.alerts || []).slice(0, 8);
  const notes = (detail.notes || []).slice(0, 8);
  const progress = detail.progress_7d || backendApi.getPatientProgress(patientId, 7);

  el.physioPatientDetail.innerHTML = `
    <div><strong>Patient:</strong> ${user?.name || patientId}</div>
    <div><strong>Affected side:</strong> ${profile?.affected_side || "-"}</div>
    <div><strong>Stroke date:</strong> ${profile?.stroke_date || "-"}</div>
    <div><strong>Mobility level:</strong> ${profile?.mobility_level || "-"}</div>
    <div><strong>Adherence (7d):</strong> ${progress.totals.adherence_pct}%</div>
    <div><strong>Sessions completed (7d):</strong> ${progress.totals.completed_sessions}</div>
    <div><strong>Plan target sessions/week:</strong> ${plan.target_sessions_per_week}</div>
    <div><strong>Current exercise targets:</strong></div>
    <ul>
      ${planExercises
        .map(
          (item) =>
            `<li>${getPlanExerciseLabel(item.exercise_code)}: ${item.reps_target} reps (min ROM ${item.min_rom_target})</li>`
        )
        .join("")}
    </ul>
    <div><strong>Recent alerts:</strong></div>
    <ul>
      ${
        alerts.length > 0
          ? alerts
              .map((a) => `<li>[${a.severity}] ${a.type} (${a.status}) on ${formatDateTime(a.created_at)}</li>`)
              .join("")
          : "<li>No alerts yet</li>"
      }
    </ul>
    <div><strong>Recent physio notes:</strong></div>
    <ul>
      ${
        notes.length > 0
          ? notes
              .map(
                (n) =>
                  `<li>${formatDateTime(n.created_at)}: ${n.note}. Next: ${n.next_action}. Follow-up: ${n.followup_date}</li>`
              )
              .join("")
          : "<li>No notes yet</li>"
      }
    </ul>
  `;

  const byCode = Object.fromEntries(planExercises.map((row) => [row.exercise_code, row]));
  el.planTargetSessions.value = plan.target_sessions_per_week;
  el.planKneeReps.value = byCode.seated_knee_extension?.reps_target || 10;
  el.planSlrReps.value = byCode.assisted_straight_leg_raise?.reps_target || 8;
  el.planAnkleReps.value = byCode.ankle_dorsiflexion_or_heel_slide?.reps_target || 10;
}

function handleNavClick(event) {
  const btn = event.target.closest("button[data-nav]");
  if (!btn) {
    return;
  }
  const key = btn.dataset.nav;

  if (key === "patient-home") {
    renderPatientHome();
  }
  if (key === "progress") {
    renderProgress();
  }
  if (key === "physio-dashboard") {
    renderPhysioDashboard();
  }
  if (key === "physio-patient") {
    if (state.selectedPhysioPatientId) {
      renderPhysioPatientDetail(state.selectedPhysioPatientId);
    }
  }

  showScreen(key);
}

function handlePhysioDashboardClicks(event) {
  const resolveBtn = event.target.closest("button[data-alert-resolve]");
  if (resolveBtn) {
    const alertId = resolveBtn.dataset.alertResolve;
    backendApi.resolvePhysioAlert(alertId, {
      physio_id: state.currentUser.id,
      resolution_note: "Reviewed in physio dashboard"
    });
    showToast("Alert resolved.");
    renderPhysioDashboard();
    return;
  }

  const openPatientFromAlert = event.target.closest("button[data-alert-open]");
  if (openPatientFromAlert) {
    const patientId = openPatientFromAlert.dataset.alertOpen;
    renderPhysioPatientDetail(patientId);
    showScreen("physio-patient");
    return;
  }

  const openPatientBtn = event.target.closest("button[data-open-patient]");
  if (openPatientBtn) {
    const patientId = openPatientBtn.dataset.openPatient;
    renderPhysioPatientDetail(patientId);
    showScreen("physio-patient");
  }
}

function bindEvents() {
  el.tabbar.addEventListener("click", handleNavClick);

  el.signOutBtn.addEventListener("click", () => {
    if (USE_REMOTE_API) {
      try {
        backendApi.logout?.();
      } catch (_error) {
        // Best effort logout for token revocation.
      }
    }
    stopCamera();
    state.currentUser = null;
    clearAuth();
    resetSessionForms();
    setNavVisibility(["login"]);
    showScreen("login");
    refreshHeader();
  });

  el.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const result = backendApi.sendOtp({
        role: el.loginRole.value,
        phone: el.loginPhone.value
      });
      state.pendingOtpContext = {
        role: el.loginRole.value,
        phone: normalizePhone(el.loginPhone.value)
      };
      el.otpForm.hidden = false;
      el.otpDebug.textContent = `Demo OTP code: ${result.demo_code}`;
      showToast("OTP generated. Use demo code displayed below.");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  el.otpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.pendingOtpContext) {
      showToast("Send OTP first.", "warn");
      return;
    }

    try {
      const loginResponse = backendApi.verifyOtp({
        role: state.pendingOtpContext.role,
        phone: state.pendingOtpContext.phone,
        code: el.otpCode.value.trim()
      });
      const user = loginResponse.user;
      state.currentAuthToken = loginResponse.access_token || null;
      state.currentRefreshToken = loginResponse.refresh_token || null;
      state.currentUser = user;
      saveAuth(user, state.currentAuthToken, state.currentRefreshToken);
      refreshHeader();
      el.otpCode.value = "";
      el.otpForm.hidden = true;
      el.otpDebug.textContent = "";
      startRoleHome();
      showToast("Signed in successfully.");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  el.onboardingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.currentUser || state.currentUser.role !== "patient") {
      showToast("Only patient account can complete onboarding.", "error");
      return;
    }

    try {
      backendApi.onboardPatient({
        user_id: state.currentUser.id,
        name: el.patientName.value.trim(),
        affected_side: el.affectedSide.value,
        stroke_date: el.strokeDate.value,
        mobility_level: el.mobilityLevel.value,
        caregiver_phone: el.caregiverPhone.value.trim(),
        consent_accepted: el.consentCheckbox.checked
      });
      showToast("Onboarding saved.");
      renderPatientHome();
      setNavVisibility(["patient-home", "checkin", "session", "summary", "progress"]);
      showScreen("patient-home");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  el.startCheckinBtn.addEventListener("click", () => {
    resetSessionForms();
    startCheckinFlow();
  });

  el.goProgressBtn.addEventListener("click", () => {
    renderProgress();
    showScreen("progress");
  });

  el.backHomeBtn.addEventListener("click", () => {
    renderPatientHome();
    showScreen("patient-home");
  });

  [el.painPre, el.fatiguePre].forEach((rangeInput) => {
    rangeInput.addEventListener("input", applyCheckinRanges);
  });

  el.checkinForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!state.currentSessionId) {
      showToast("No active session. Start check-in again.", "error");
      return;
    }

    const redFlags = {
      chest_pain: el.rfChestPain.checked,
      uncontrolled_bp: el.rfUncontrolledBp.checked,
      new_neuro: el.rfNewNeuro.checked
    };

    try {
      const { session, has_red_flag: hasRedFlag } = backendApi.checkinSession(state.currentSessionId, {
        pain_pre: Number(el.painPre.value),
        fatigue_pre: Number(el.fatiguePre.value),
        red_flags: redFlags
      });

      state.activeCheckin = {
        pain_pre: session.pain_pre,
        fatigue_pre: session.fatigue_pre,
        red_flags: redFlags
      };

      if (hasRedFlag) {
        el.checkinStatus.textContent =
          "Session blocked due to red flags. Contact physiotherapist immediately.";
        showToast("Red flag alert generated and physio notified.", "warn");
        speak("Red flag detected. Please stop exercise and contact your physiotherapist.");
        renderSummary(session.id);
        showScreen("summary");
        state.currentSessionId = null;
        return;
      }

      const patientId = getCurrentPatientId();
      const profile = getPatientProfile(patientId);
      initSessionBuffer(patientId);
      el.sessionAffectedSide.textContent = `Affected side: ${profile?.affected_side || "not set"}`;
      el.cameraOverlay.textContent = "Camera idle";
      el.aiCoachText.textContent = "Coach: Keep posture upright, move slowly.";
      showScreen("session");
      showToast("Check-in passed. Session started.");
      speak("Check in passed. Begin the guided exercises.");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  el.startCameraBtn.addEventListener("click", startCamera);
  el.stopCameraBtn.addEventListener("click", stopCamera);

  el.toggleVoiceBtn.addEventListener("click", () => {
    state.voiceEnabled = !state.voiceEnabled;
    el.toggleVoiceBtn.textContent = `Voice cue: ${state.voiceEnabled ? "On" : "Off"}`;
    if (state.voiceEnabled) {
      speak("Voice cue enabled");
    }
  });

  el.exerciseSelect.addEventListener("change", renderExerciseMetrics);

  el.repControls.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-rep]");
    if (!btn) {
      return;
    }

    const current = getActiveExerciseBuffer();
    if (!current) {
      return;
    }

    const isValid = btn.dataset.rep === "valid";
    const assisted = el.assistedToggle.checked;
    const rom = Math.max(0, Number(el.romInput.value || 0));
    const quality = Math.max(0, Math.min(100, Number(el.qualityInput.value || 0)));

    current.total_reps += 1;
    if (isValid) {
      current.valid_reps += 1;
    }
    if (assisted) {
      current.assisted_reps += 1;
    }
    current.rom_sum += rom;
    current.quality_sum += quality;
    current.samples += 1;

    renderExerciseMetrics();
    updateCoachText(current, isValid);
  });

  el.finishSessionBtn.addEventListener("click", finishSessionFlow);

  el.summaryHomeBtn.addEventListener("click", () => {
    renderPatientHome();
    showScreen("patient-home");
  });

  el.summaryProgressBtn.addEventListener("click", () => {
    renderProgress();
    showScreen("progress");
  });

  el.progressHomeBtn.addEventListener("click", () => {
    renderPatientHome();
    showScreen("patient-home");
  });

  el.cgStartSession.addEventListener("click", () => {
    startCheckinFlow();
    showScreen("checkin");
    el.caregiverStatus.textContent = "Check-in started for linked patient.";
  });

  el.cgValid.addEventListener("click", () => {
    if (!state.currentSessionId) {
      el.caregiverStatus.textContent = "No active session. Start check-in first.";
      return;
    }
    const current = getActiveExerciseBuffer();
    if (!current) {
      el.caregiverStatus.textContent = "Open session screen once to initialize exercises.";
      return;
    }
    current.total_reps += 1;
    current.valid_reps += 1;
    if (state.caregiverAssistedMode) {
      current.assisted_reps += 1;
    }
    current.rom_sum += Number(el.romInput.value || 30);
    current.quality_sum += Number(el.qualityInput.value || 65);
    current.samples += 1;
    renderExerciseMetrics();
    el.caregiverStatus.textContent = "Valid rep recorded.";
  });

  el.cgInvalid.addEventListener("click", () => {
    if (!state.currentSessionId) {
      el.caregiverStatus.textContent = "No active session.";
      return;
    }
    const current = getActiveExerciseBuffer();
    if (!current) {
      el.caregiverStatus.textContent = "Open session screen once to initialize exercises.";
      return;
    }
    current.total_reps += 1;
    if (state.caregiverAssistedMode) {
      current.assisted_reps += 1;
    }
    current.rom_sum += Number(el.romInput.value || 20);
    current.quality_sum += Number(el.qualityInput.value || 45);
    current.samples += 1;
    renderExerciseMetrics();
    el.caregiverStatus.textContent = "Invalid rep recorded.";
  });

  el.cgAssistToggle.addEventListener("click", () => {
    state.caregiverAssistedMode = !state.caregiverAssistedMode;
    el.cgAssistToggle.textContent = `Assisted: ${state.caregiverAssistedMode ? "On" : "Off"}`;
    el.assistedToggle.checked = state.caregiverAssistedMode;
  });

  el.cgFinish.addEventListener("click", () => {
    if (!state.currentSessionId) {
      el.caregiverStatus.textContent = "No active session.";
      return;
    }
    finishSessionFlow();
    el.caregiverStatus.textContent = "Session completed.";
  });

  el.physioAlertFilter.addEventListener("change", renderPhysioDashboard);
  el.physioAlertList.addEventListener("click", handlePhysioDashboardClicks);
  el.physioPatientCards.addEventListener("click", handlePhysioDashboardClicks);

  el.physioNoteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.selectedPhysioPatientId) {
      showToast("Select a patient first.", "warn");
      return;
    }

    const openAlert = state.db.alerts.find(
      (a) => a.patient_id === state.selectedPhysioPatientId && a.status === "open"
    );

    backendApi.createPhysioNote(state.selectedPhysioPatientId, {
      physio_id: state.currentUser.id,
      alert_id: openAlert ? openAlert.id : null,
      note: el.physioNoteText.value.trim(),
      next_action: el.physioNextAction.value.trim(),
      followup_date: el.physioFollowupDate.value
    });

    renderPhysioPatientDetail(state.selectedPhysioPatientId);
    el.physioNoteForm.reset();
    showToast("Physio note saved.");
  });

  el.physioPlanForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.selectedPhysioPatientId) {
      showToast("Select a patient first.", "warn");
      return;
    }

    backendApi.updatePhysioPlan(state.selectedPhysioPatientId, {
      target_sessions_per_week: Number(el.planTargetSessions.value),
      knee_extension_reps: Number(el.planKneeReps.value),
      straight_leg_raise_reps: Number(el.planSlrReps.value),
      ankle_or_heel_slide_reps: Number(el.planAnkleReps.value)
    });

    renderPhysioPatientDetail(state.selectedPhysioPatientId);
    showToast("Care plan updated.");
  });

  el.backPhysioDashboard.addEventListener("click", () => {
    renderPhysioDashboard();
    showScreen("physio-dashboard");
  });
}

function init() {
  state.db = loadDb();
  const savedAuth = loadAuth();
  if (savedAuth) {
    state.currentAuthToken = savedAuth.access_token || null;
    state.currentRefreshToken = savedAuth.refresh_token || null;
  }

  if (USE_REMOTE_API) {
    if (state.currentAuthToken) {
      try {
        const profile = backendApi.meProfile();
        if (profile?.user) {
          state.currentUser = profile.user;
          saveAuth(profile.user, state.currentAuthToken, state.currentRefreshToken);
        }
        refreshSnapshotFromRemote();
      } catch (error) {
        clearAuth();
        state.currentUser = null;
        state.currentAuthToken = null;
        state.db = getEmptyDb();
        showToast("Saved API session expired. Please sign in again.", "warn");
      }
    } else {
      state.db = getEmptyDb();
    }
  } else {
    seedPhysioUser();
    saveDb();
    if (savedAuth?.user_id) {
      state.currentUser = state.db.users.find((user) => user.id === savedAuth.user_id) || null;
    }
  }

  bindEvents();
  resetSessionForms();

  refreshHeader();
  startRoleHome();
}

init();
