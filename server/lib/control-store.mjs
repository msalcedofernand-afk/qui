import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function readLegacy(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function backupOnce(file) {
  if (!fs.existsSync(file) || fs.existsSync(`${file}.bak`)) return;
  fs.copyFileSync(file, `${file}.bak`);
}

export class ControlStore {
  constructor(dataDir, defaults) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dataDir = dataDir;
    this.db = new DatabaseSync(path.join(dataDir, "control-plane.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, action TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_leases (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.migrate(defaults);
  }

  migrate(defaults) {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM profiles").get().count;
    if (Number(count) === 0) {
      const profiles = readLegacy(path.join(this.dataDir, "profiles.json"), defaults);
      const insert = this.db.prepare("INSERT OR REPLACE INTO profiles (id, data) VALUES (?, ?)");
      for (const profile of profiles) insert.run(profile.id, JSON.stringify(profile));
      backupOnce(path.join(this.dataDir, "profiles.json"));
    }
    if (!this.getSetting("runtime_state")) {
      const stateFile = path.join(this.dataDir, "state.json");
      const state = readLegacy(stateFile, { activeProfile: "normal", previous: null });
      delete state.audit;
      this.setSetting("runtime_state", state);
      backupOnce(stateFile);
    }
    if (this.db.prepare("SELECT COUNT(*) AS count FROM devices").get().count === 0) {
      const accessFile = path.join(this.dataDir, "access.json");
      const access = readLegacy(accessFile, { devices: [] });
      const insert = this.db.prepare("INSERT OR REPLACE INTO devices (id, data) VALUES (?, ?)");
      for (const device of access.devices || []) insert.run(device.id, JSON.stringify(device));
      backupOnce(accessFile);
    }
    if (this.db.prepare("SELECT COUNT(*) AS count FROM audit").get().count === 0) {
      const auditFile = path.join(this.dataDir, "audit.json");
      const state = readLegacy(path.join(this.dataDir, "state.json"), {});
      const entries = readLegacy(auditFile, state.audit || []);
      const insert = this.db.prepare("INSERT OR IGNORE INTO audit (id, action, detail, at) VALUES (?, ?, ?, ?)");
      for (const entry of entries || []) insert.run(entry.id, entry.action, JSON.stringify(entry.detail || {}), entry.at);
      backupOnce(auditFile);
    }
  }

  getSetting(key) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? JSON.parse(row.value) : null;
  }

  setSetting(key, value) {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
  }

  getProfiles(fallback = []) {
    return this.db.prepare("SELECT data FROM profiles ORDER BY rowid").all().map(row => JSON.parse(row.data)) || fallback;
  }

  setProfiles(profiles) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM profiles").run();
      const insert = this.db.prepare("INSERT INTO profiles (id, data) VALUES (?, ?)");
      for (const profile of profiles) insert.run(profile.id, JSON.stringify(profile));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getState(fallback = {}) { return this.getSetting("runtime_state") || fallback; }
  setState(state) { this.setSetting("runtime_state", state); }

  getAudit() {
    return this.db.prepare("SELECT id, action, detail, at FROM audit ORDER BY at DESC LIMIT 200").all().map(row => ({ id: row.id, action: row.action, detail: JSON.parse(row.detail), at: row.at }));
  }

  prependAudit(entry) {
    this.db.prepare("INSERT OR REPLACE INTO audit (id, action, detail, at) VALUES (?, ?, ?, ?)").run(entry.id, entry.action, JSON.stringify(entry.detail || {}), entry.at);
    this.db.prepare("DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY at DESC LIMIT 200)").run();
  }

  getDevices() {
    return this.db.prepare("SELECT data FROM devices ORDER BY rowid").all().map(row => JSON.parse(row.data));
  }

  setDevices(devices) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM devices").run();
      const insert = this.db.prepare("INSERT INTO devices (id, data) VALUES (?, ?)");
      for (const device of devices) insert.run(device.id, JSON.stringify(device));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createOperation(operation) {
    const now = new Date().toISOString();
    const value = { ...operation, createdAt: operation.createdAt || now, updatedAt: now };
    this.db.prepare("INSERT INTO operations (id, type, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(value.id, value.type, value.status || "queued", JSON.stringify(value), value.createdAt, value.updatedAt);
    return value;
  }

  getOperation(id) {
    const row = this.db.prepare("SELECT data FROM operations WHERE id = ?").get(id);
    return row ? JSON.parse(row.data) : null;
  }

  findOperationByIdempotency(key) {
    if (!key) return null;
    const rows = this.db.prepare("SELECT data FROM operations ORDER BY created_at DESC LIMIT 100").all();
    return rows.map(row => JSON.parse(row.data)).find(item => item.idempotencyKey === key) || null;
  }

  updateOperation(id, patch) {
    const current = this.getOperation(id);
    if (!current) return null;
    const value = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare("UPDATE operations SET status = ?, data = ?, updated_at = ? WHERE id = ?")
      .run(value.status, JSON.stringify(value), value.updatedAt, id);
    return value;
  }

  nextOperation() {
    const row = this.db.prepare("SELECT data FROM operations WHERE status IN ('queued', 'claimed') ORDER BY created_at LIMIT 1").get();
    return row ? JSON.parse(row.data) : null;
  }

  createSession(session) {
    this.db.prepare("INSERT OR REPLACE INTO sessions (id, data) VALUES (?, ?)").run(session.id, JSON.stringify(session));
    return session;
  }

  getSession(id) {
    const row = this.db.prepare("SELECT data FROM sessions WHERE id = ?").get(id);
    return row ? JSON.parse(row.data) : null;
  }

  deleteSession(id) { this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id); }

  purgeSessions(now = Date.now()) {
    const rows = this.db.prepare("SELECT id, data FROM sessions").all();
    for (const row of rows) if (Number(JSON.parse(row.data).expiresAt || 0) <= now) this.deleteSession(row.id);
  }

  createLease(lease) {
    this.db.prepare("INSERT OR REPLACE INTO remote_leases (id, data) VALUES (?, ?)").run(lease.id, JSON.stringify(lease));
    return lease;
  }

  getLease(id) {
    const row = this.db.prepare("SELECT data FROM remote_leases WHERE id = ?").get(id);
    return row ? JSON.parse(row.data) : null;
  }

  listLeases() { return this.db.prepare("SELECT data FROM remote_leases ORDER BY rowid DESC").all().map(row => JSON.parse(row.data)); }

  revokeLease(id) { this.db.prepare("DELETE FROM remote_leases WHERE id = ?").run(id); }

  close() { this.db.close(); }
}
