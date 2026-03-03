import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { createId, nowIso } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolvedDbPath = path.resolve(process.cwd(), config.dbPath);
fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

export const db = new Database(resolvedDbPath);
db.pragma("foreign_keys = ON");

const initSqlPath = path.resolve(__dirname, "../scripts/init.sql");
const initSql = fs.readFileSync(initSqlPath, "utf8");
db.exec(initSql);

function columnExists(table, column) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((entry) => entry.name === column);
}

function runMigrations() {
  if (!columnExists("otp_requests", "provider")) {
    db.exec("ALTER TABLE otp_requests ADD COLUMN provider TEXT NOT NULL DEFAULT 'mock'");
  }
  if (!columnExists("otp_requests", "provider_ref")) {
    db.exec("ALTER TABLE otp_requests ADD COLUMN provider_ref TEXT");
  }
  if (!columnExists("otp_requests", "attempts")) {
    db.exec("ALTER TABLE otp_requests ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnExists("otp_requests", "last_attempt_at")) {
    db.exec("ALTER TABLE otp_requests ADD COLUMN last_attempt_at TEXT");
  }
}

runMigrations();

export function rowToSession(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    red_flags: row.red_flags_json ? JSON.parse(row.red_flags_json) : {
      chest_pain: false,
      uncontrolled_bp: false,
      new_neuro: false
    }
  };
}

export function seedDefaultPhysio() {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'physio' LIMIT 1").get();
  if (existing) {
    return existing.id;
  }

  const id = createId("usr");
  db.prepare(
    `INSERT INTO users (id, role, phone, email, name, created_at)
     VALUES (@id, 'physio', @phone, @email, @name, @created_at)`
  ).run({
    id,
    phone: "+910000000001",
    email: "physio@helify.demo",
    name: "Demo Physio",
    created_at: nowIso()
  });

  return id;
}

export function getPrimaryPhysioId() {
  const physio = db.prepare("SELECT id FROM users WHERE role = 'physio' ORDER BY created_at ASC LIMIT 1").get();
  return physio ? physio.id : seedDefaultPhysio();
}
