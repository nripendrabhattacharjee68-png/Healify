import dotenv from "dotenv";

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8787),
  dbPath: process.env.DB_PATH || "./data/helify_mvp.db",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 5),
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
  smsProvider: process.env.SMS_PROVIDER || "mock",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || "",
  consentVersion: process.env.CONSENT_VERSION || "2026-03-v1",
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  jwtRefreshExpiresDays: Number(process.env.JWT_REFRESH_EXPIRES_DAYS || 30),
  rateLimitGlobalWindowMs: Number(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || 60_000),
  rateLimitGlobalMax: Number(process.env.RATE_LIMIT_GLOBAL_MAX || 120),
  rateLimitAuthWindowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS || 900_000),
  rateLimitAuthMax: Number(process.env.RATE_LIMIT_AUTH_MAX || 12),
  enableDebugSnapshot: process.env.ENABLE_DEBUG_SNAPSHOT === "true"
};

if (config.nodeEnv === "production" && config.jwtSecret === "dev-only-secret-change-me") {
  throw new Error("JWT_SECRET must be set to a secure value in production");
}
