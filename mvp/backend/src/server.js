import cors from "cors";
import express from "express";

import { config } from "./config.js";
import { seedDefaultPhysio } from "./db.js";
import { issueAccessToken, verifyAccessToken } from "./auth.js";
import { applyBasicSecurityHeaders, createRateLimiter, preventParameterPollution } from "./security.js";
import {
  createAuditLog,
  createOtp,
  createPhysioNote,
  createSession,
  findUserById,
  finishSession,
  getCaregiverLinkedPatientId,
  getPatientProgress,
  getPhysioAlerts,
  getPhysioPatientDetail,
  getSessionAlerts,
  getSessionById,
  getSnapshot,
  getUserWithProfile,
  hasConsent,
  issueRefreshToken,
  listPhysioPatients,
  resolveAlert,
  revokeRefreshToken,
  rotateRefreshToken,
  updatePlan,
  updateSessionCheckin,
  upsertExerciseResult,
  upsertPatientOnboarding,
  verifyOtp
} from "./service.js";
import { getRequestIp, isRole, parseNumber } from "./utils.js";

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(applyBasicSecurityHeaders(config));

const allowedOrigins = String(config.corsOrigin || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS origin not allowed"));
    },
    credentials: false
  })
);

app.use(express.json({ limit: "32kb" }));
app.use(preventParameterPollution());

const globalLimiter = createRateLimiter({
  name: "global",
  windowMs: config.rateLimitGlobalWindowMs,
  max: config.rateLimitGlobalMax,
  keyBuilder(req) {
    return `global:${getRequestIp(req)}`;
  },
  message: "Too many requests. Please retry shortly."
});

const authLimiter = createRateLimiter({
  name: "auth",
  windowMs: config.rateLimitAuthWindowMs,
  max: config.rateLimitAuthMax,
  keyBuilder(req) {
    return `auth:${getRequestIp(req)}`;
  },
  message: "Too many authentication requests. Please try again later."
});

app.use(globalLimiter);

seedDefaultPhysio();

function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

function requiredFields(body, fields) {
  const source = body || {};
  return fields.filter((field) => source[field] === undefined || source[field] === null || source[field] === "");
}

function extractBearerToken(req) {
  const value = req.header("authorization") || "";
  if (!value.startsWith("Bearer ")) {
    return null;
  }
  const token = value.slice("Bearer ".length).trim();
  return token || null;
}

function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return sendError(res, 401, "Missing Bearer token");
  }

  try {
    const payload = verifyAccessToken(token);
    const user = findUserById(payload.sub);
    if (!user) {
      return sendError(res, 401, "Invalid token subject");
    }
    req.auth = { token, payload, user };
    return next();
  } catch (_error) {
    return sendError(res, 401, "Invalid or expired token");
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.auth?.user?.role;
    if (!role || !roles.includes(role)) {
      return sendError(res, 403, "Forbidden for current role");
    }
    return next();
  };
}

function canAccessPatient(authUser, patientId) {
  if (!authUser || !patientId) {
    return false;
  }

  if (authUser.role === "physio") {
    return true;
  }

  if (authUser.role === "patient") {
    return authUser.id === patientId;
  }

  if (authUser.role === "caregiver") {
    const linkedPatientId = getCaregiverLinkedPatientId(authUser.id);
    return linkedPatientId === patientId;
  }

  return false;
}

function resolvePatientIdForStart(authUser, requestedPatientId) {
  if (authUser.role === "patient") {
    if (requestedPatientId && requestedPatientId !== authUser.id) {
      throw new Error("Patient can only start their own session");
    }
    return authUser.id;
  }

  if (authUser.role === "caregiver") {
    const linkedPatientId = getCaregiverLinkedPatientId(authUser.id);
    if (!linkedPatientId) {
      throw new Error("Caregiver is not linked to any patient");
    }
    if (requestedPatientId && requestedPatientId !== linkedPatientId) {
      throw new Error("Caregiver can only start linked patient session");
    }
    return linkedPatientId;
  }

  throw new Error("Only patient or caregiver can start sessions");
}

function getAccessibleSessionOrSendError(req, res) {
  const session = getSessionById(req.params.id);
  if (!session) {
    sendError(res, 404, "Session not found");
    return null;
  }

  if (!canAccessPatient(req.auth.user, session.patient_id)) {
    sendError(res, 403, "Forbidden for this session");
    return null;
  }

  return session;
}

// Audit every request/response pair with actor, route and status.
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    try {
      createAuditLog({
        userId: req.auth?.user?.id || null,
        eventType: "api_request",
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        ip: getRequestIp(req),
        userAgent: String(req.headers["user-agent"] || ""),
        metadata: {
          duration_ms: Date.now() - startedAt
        }
      });
    } catch (_error) {
      // Avoid breaking API flow if audit logging fails.
    }
  });
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "helify-paralysis-mvp-backend", now: new Date().toISOString() });
});

// 1) POST /auth/send-otp
app.post("/auth/send-otp", authLimiter, async (req, res) => {
  const missing = requiredFields(req.body, ["phone", "role"]);
  if (missing.length > 0) {
    return sendError(res, 400, `Missing fields: ${missing.join(", ")}`);
  }

  if (!isRole(req.body.role)) {
    return sendError(res, 400, "Invalid role");
  }

  try {
    const otp = await createOtp({ phone: req.body.phone, role: req.body.role, ttlMinutes: config.otpTtlMinutes });
    return res.json({
      request_id: otp.id,
      expires_at: otp.expires_at,
      demo_code: otp.code
    });
  } catch (error) {
    return sendError(res, 400, error.message);
  }
});

// 2) POST /auth/verify-otp
app.post("/auth/verify-otp", authLimiter, async (req, res) => {
  const missing = requiredFields(req.body, ["phone", "role", "code"]);
  if (missing.length > 0) {
    return sendError(res, 400, `Missing fields: ${missing.join(", ")}`);
  }

  if (!isRole(req.body.role)) {
    return sendError(res, 400, "Invalid role");
  }

  try {
    const user = await verifyOtp(req.body);
    const accessToken = issueAccessToken(user);
    const refresh = issueRefreshToken(user.id, getRequestIp(req), String(req.headers["user-agent"] || ""));
    return res.json({
      user,
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: config.jwtExpiresIn,
      refresh_token: refresh.token
    });
  } catch (error) {
    return sendError(res, 400, error.message);
  }
});

// Refresh flow with rotation.
app.post("/auth/refresh", authLimiter, (req, res) => {
  const missing = requiredFields(req.body, ["refresh_token"]);
  if (missing.length > 0) {
    return sendError(res, 400, `Missing fields: ${missing.join(", ")}`);
  }

  try {
    const rotated = rotateRefreshToken(
      req.body.refresh_token,
      getRequestIp(req),
      String(req.headers["user-agent"] || "")
    );

    const accessToken = issueAccessToken(rotated.user);
    return res.json({
      user: rotated.user,
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: config.jwtExpiresIn,
      refresh_token: rotated.refreshToken
    });
  } catch (error) {
    return sendError(res, 401, error.message);
  }
});

app.use(requireAuth);

app.post("/auth/logout", (req, res) => {
  const refreshToken = req.body?.refresh_token;
  if (refreshToken) {
    revokeRefreshToken(refreshToken, "logout");
  }
  return res.json({ ok: true });
});

// 3) GET /me/profile
app.get("/me/profile", (req, res) => {
  const userId = req.auth.user.id;
  const profile = getUserWithProfile(userId);
  if (!profile) {
    return sendError(res, 404, "User not found");
  }

  return res.json({
    ...profile,
    consent_accepted: hasConsent(userId, config.consentVersion)
  });
});

// 4) POST /patients/onboarding
app.post("/patients/onboarding", requireRole("patient"), (req, res) => {
  const missing = requiredFields(req.body, ["name", "affected_side", "stroke_date", "mobility_level", "caregiver_phone"]);
  if (missing.length > 0) {
    return sendError(res, 400, `Missing fields: ${missing.join(", ")}`);
  }

  if (!["left", "right"].includes(req.body.affected_side)) {
    return sendError(res, 400, "affected_side must be left or right");
  }

  if (!["mild", "moderate"].includes(req.body.mobility_level)) {
    return sendError(res, 400, "mobility_level must be mild or moderate");
  }

  try {
    const payload = { ...req.body, user_id: req.auth.user.id };
    const result = upsertPatientOnboarding(payload, config.consentVersion);
    return res.json(result);
  } catch (error) {
    return sendError(res, 400, error.message);
  }
});

// 5) POST /sessions/start
app.post("/sessions/start", requireRole("patient", "caregiver"), (req, res) => {
  try {
    const patientId = resolvePatientIdForStart(req.auth.user, req.body?.patient_id || null);
    const session = createSession(patientId);
    return res.json({ session });
  } catch (error) {
    return sendError(res, 403, error.message);
  }
});

// 6) POST /sessions/{id}/checkin
app.post("/sessions/:id/checkin", requireRole("patient", "caregiver"), (req, res) => {
  if (!req.body?.red_flags || typeof req.body.red_flags !== "object") {
    return sendError(res, 400, "red_flags object is required");
  }

  const session = getAccessibleSessionOrSendError(req, res);
  if (!session) {
    return;
  }

  try {
    const { session: updated, hasRedFlag } = updateSessionCheckin(req.params.id, req.body);
    return res.json({ session: updated, has_red_flag: hasRedFlag });
  } catch (error) {
    return sendError(res, 400, error.message);
  }
});

// 7) POST /sessions/{id}/exercise-result
app.post("/sessions/:id/exercise-result", requireRole("patient", "caregiver"), (req, res) => {
  const missing = requiredFields(req.body, [
    "exercise_code",
    "total_reps",
    "valid_reps",
    "avg_rom",
    "avg_quality",
    "assisted_reps"
  ]);
  if (missing.length > 0) {
    return sendError(res, 400, `Missing fields: ${missing.join(", ")}`);
  }

  const session = getAccessibleSessionOrSendError(req, res);
  if (!session) {
    return;
  }

  try {
    const exercise_result = upsertExerciseResult(req.params.id, req.body);
    return res.json({ exercise_result });
  } catch (error) {
    return sendError(res, 400, error.message);
  }
});

// 8) POST /sessions/{id}/finish
app.post("/sessions/:id/finish", requireRole("patient", "caregiver"), (req, res) => {
  const missing = requiredFields(req.body, ["pain_post", "fatigue_post"]);
  if (missing.length > 0) {
    return sendError(res, 400, `Missing fields: ${missing.join(", ")}`);
  }

  const session = getAccessibleSessionOrSendError(req, res);
  if (!session) {
    return;
  }

  try {
    const updated = finishSession(req.params.id, req.body);
    const alerts = getSessionAlerts(req.params.id);
    return res.json({ session: updated, alerts });
  } catch (error) {
    return sendError(res, 400, error.message);
  }
});

// 9) GET /patients/{id}/progress?days=7
app.get("/patients/:id/progress", (req, res) => {
  if (!canAccessPatient(req.auth.user, req.params.id)) {
    return sendError(res, 403, "Forbidden for this patient");
  }

  const days = parseNumber(req.query.days, 7);
  try {
    const progress = getPatientProgress(req.params.id, days);
    return res.json(progress);
  } catch (error) {
    return sendError(res, 400, error.message);
  }
});

// 10) GET /physio/alerts?status=open
app.get("/physio/alerts", requireRole("physio"), (req, res) => {
  const status = String(req.query.status || "open");
  if (!["open", "resolved", "all"].includes(status)) {
    return sendError(res, 400, "status must be open, resolved, or all");
  }
  const alerts = getPhysioAlerts(status);
  return res.json(alerts);
});

// 11) POST /physio/alerts/{id}/resolve
app.post("/physio/alerts/:id/resolve", requireRole("physio"), (req, res) => {
  try {
    const alert = resolveAlert(req.params.id, req.auth.user.id, req.body?.resolution_note || "Reviewed");
    return res.json({ alert });
  } catch (error) {
    return sendError(res, 400, error.message);
  }
});

// 12) POST /physio/patients/{id}/plan
app.post("/physio/patients/:id/plan", requireRole("physio"), (req, res) => {
  const missing = requiredFields(req.body, [
    "target_sessions_per_week",
    "knee_extension_reps",
    "straight_leg_raise_reps",
    "ankle_or_heel_slide_reps"
  ]);

  if (missing.length > 0) {
    return sendError(res, 400, `Missing fields: ${missing.join(", ")}`);
  }

  try {
    const result = updatePlan(req.params.id, req.body);
    return res.json(result);
  } catch (error) {
    return sendError(res, 400, error.message);
  }
});

// Additional endpoints for physio UI
app.get("/physio/patients", requireRole("physio"), (_req, res) => {
  return res.json(listPhysioPatients());
});

app.get("/physio/patients/:id", requireRole("physio"), (req, res) => {
  try {
    const detail = getPhysioPatientDetail(req.params.id);
    return res.json(detail);
  } catch (error) {
    return sendError(res, 404, error.message);
  }
});

app.post("/physio/patients/:id/notes", requireRole("physio"), (req, res) => {
  const missing = requiredFields(req.body, ["note", "next_action", "followup_date"]);
  if (missing.length > 0) {
    return sendError(res, 400, `Missing fields: ${missing.join(", ")}`);
  }

  try {
    const note = createPhysioNote(req.params.id, req.auth.user.id, req.body);
    return res.json({ note });
  } catch (error) {
    return sendError(res, 400, error.message);
  }
});

app.get("/sessions/:id", (req, res) => {
  const session = getAccessibleSessionOrSendError(req, res);
  if (!session) {
    return;
  }
  return res.json({ session });
});

app.get("/debug/snapshot", (req, res) => {
  if (!config.enableDebugSnapshot) {
    return sendError(res, 404, "Not found");
  }

  return res.json(getSnapshot());
});

app.use((err, _req, res, _next) => {
  if (err && err.message === "CORS origin not allowed") {
    return sendError(res, 403, "CORS origin not allowed");
  }
  return sendError(res, 500, "Internal server error");
});

app.use((_req, res) => {
  sendError(res, 404, "Not found");
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Helify backend listening on http://localhost:${config.port}`);
});
