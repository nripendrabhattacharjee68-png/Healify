PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('patient', 'caregiver', 'physio')),
  phone TEXT NOT NULL,
  email TEXT,
  name TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(role, phone)
);

CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  affected_side TEXT NOT NULL CHECK (affected_side IN ('left', 'right')),
  stroke_date TEXT NOT NULL,
  mobility_level TEXT NOT NULL CHECK (mobility_level IN ('mild', 'moderate')),
  caregiver_user_id TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS care_plans (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  physio_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'closed')),
  target_sessions_per_week INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_exercises (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,
  exercise_code TEXT NOT NULL,
  sets_target INTEGER NOT NULL,
  reps_target INTEGER NOT NULL,
  min_rom_target INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_id, exercise_code)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES care_plans(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  pain_pre INTEGER,
  pain_post INTEGER,
  fatigue_pre INTEGER,
  fatigue_post INTEGER,
  red_flags_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('started', 'blocked', 'completed', 'abandoned'))
);

CREATE TABLE IF NOT EXISTS exercise_results (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  exercise_code TEXT NOT NULL,
  total_reps INTEGER NOT NULL,
  valid_reps INTEGER NOT NULL,
  avg_rom REAL NOT NULL,
  avg_quality REAL NOT NULL,
  assisted_reps INTEGER NOT NULL,
  UNIQUE(session_id, exercise_code)
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  created_at TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  resolution_note TEXT
);

CREATE TABLE IF NOT EXISTS physio_notes (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_id TEXT REFERENCES alerts(id) ON DELETE SET NULL,
  physio_id TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  next_action TEXT NOT NULL,
  followup_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  UNIQUE(user_id, version)
);

CREATE TABLE IF NOT EXISTS otp_requests (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  role TEXT NOT NULL,
  code TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'mock',
  provider_ref TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  family_id TEXT NOT NULL,
  replaced_by_token_id TEXT REFERENCES refresh_tokens(id),
  revoked_at TEXT,
  revoke_reason TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  created_ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_patient_end ON sessions(patient_id, ended_at);
CREATE INDEX IF NOT EXISTS idx_alerts_patient_status ON alerts(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_alerts_status_created ON alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
