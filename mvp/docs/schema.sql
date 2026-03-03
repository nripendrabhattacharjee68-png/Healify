-- Helify Paralysis MVP (post-stroke hemiparesis) schema

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('patient', 'caregiver', 'physio')),
  phone TEXT NOT NULL,
  email TEXT,
  name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE patient_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  affected_side TEXT NOT NULL CHECK (affected_side IN ('left', 'right')),
  stroke_date TEXT NOT NULL,
  mobility_level TEXT NOT NULL CHECK (mobility_level IN ('mild', 'moderate')),
  caregiver_user_id TEXT REFERENCES users(id)
);

CREATE TABLE care_plans (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  physio_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'closed')),
  target_sessions_per_week INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE plan_exercises (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES care_plans(id),
  exercise_code TEXT NOT NULL,
  sets_target INTEGER NOT NULL,
  reps_target INTEGER NOT NULL,
  min_rom_target INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
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

CREATE TABLE exercise_results (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  exercise_code TEXT NOT NULL,
  total_reps INTEGER NOT NULL,
  valid_reps INTEGER NOT NULL,
  avg_rom REAL NOT NULL,
  avg_quality REAL NOT NULL,
  assisted_reps INTEGER NOT NULL
);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT REFERENCES sessions(id),
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  created_at TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  resolution_note TEXT
);

CREATE TABLE physio_notes (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  alert_id TEXT REFERENCES alerts(id),
  physio_id TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  next_action TEXT NOT NULL,
  followup_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);
