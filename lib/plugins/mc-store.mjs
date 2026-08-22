// src/mc-store.ts
import Schema from "@deepseek-ai/schemastery";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
var name = "mc-store";
var inject = [];
var Config = Schema.object({
  dataDir: Schema.string().default("./data"),
  dbFile: Schema.string().default("client.db")
});
var degradedService = {
  appendEpisodic() {
  },
  episodicTail() {
    return [];
  },
  loadProgress() {
    return null;
  },
  saveProgress() {
  },
  saveStatus() {
  },
  loadStatus() {
    return null;
  },
  listStatusAgents() {
    return [];
  },
  saveMap() {
  },
  loadMap() {
    return null;
  },
  saveSpellbook() {
  },
  loadSpellbook() {
    return null;
  }
};
function openDb(dataDir, dbFile) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(resolve(dataDir, dbFile));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS episodic (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    ts TEXT NOT NULL,
    text TEXT NOT NULL
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_episodic_user ON episodic(username, id)");
  db.exec(`CREATE TABLE IF NOT EXISTS progress (
    username TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS status (
    username TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS map (
    username TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS spellbook (
    username TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    skill_json TEXT NOT NULL
  )`);
  return db;
}
function apply(ctx, config = {}) {
  const log = (msg) => console.log(`[mc-store] ${msg}`);
  const dataDir = config.dataDir ?? "./data";
  const dbFile = config.dbFile ?? "client.db";
  let db;
  try {
    db = openDb(dataDir, dbFile);
  } catch (e) {
    console.error(`[mc-store] SQLite \u521D\u59CB\u5316\u5931\u8D25\uFF08episodic/progress \u8BFB\u5199\u964D\u7EA7\u4E3A no-op\uFF09: ${e instanceof Error ? e.message : String(e)}`);
    ctx.provide("mcStore", degradedService);
    return;
  }
  log(`SQLite ready: ${resolve(dataDir, dbFile)} (WAL)`);
  const svc = {
    appendEpisodic(username, text) {
      if (!username) return;
      try {
        db.prepare("INSERT INTO episodic (username, ts, text) VALUES (?, ?, ?)").run(username, (/* @__PURE__ */ new Date()).toISOString(), text);
      } catch {
      }
    },
    episodicTail(username, n) {
      if (!username) return [];
      try {
        const rows = db.prepare(
          "SELECT ts, text FROM episodic WHERE username = ? ORDER BY id DESC LIMIT ?"
        ).all(username, n);
        return rows.reverse();
      } catch {
        return [];
      }
    },
    loadProgress(username) {
      if (!username) return null;
      try {
        const row = db.prepare("SELECT state_json FROM progress WHERE username = ?").get(username);
        if (!row?.state_json) return null;
        return JSON.parse(row.state_json);
      } catch {
        return null;
      }
    },
    saveProgress(username, state) {
      if (!username) return;
      try {
        db.prepare(
          `INSERT INTO progress (username, state_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(username) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
        ).run(username, JSON.stringify(state), Date.now());
      } catch {
      }
    },
    saveStatus(username, snapshot) {
      if (!username || !snapshot) return;
      try {
        const u = snapshot;
        const updatedAt = typeof u.updatedAt === "string" ? u.updatedAt : (/* @__PURE__ */ new Date()).toISOString();
        db.prepare(
          `INSERT INTO status (username, updated_at, snapshot_json) VALUES (?, ?, ?)
           ON CONFLICT(username) DO UPDATE SET updated_at = excluded.updated_at, snapshot_json = excluded.snapshot_json`
        ).run(username, updatedAt, JSON.stringify(snapshot));
      } catch {
      }
    },
    loadStatus(username) {
      if (!username) return null;
      try {
        const row = db.prepare("SELECT snapshot_json FROM status WHERE username = ?").get(username);
        if (!row?.snapshot_json) return null;
        return JSON.parse(row.snapshot_json);
      } catch {
        return null;
      }
    },
    listStatusAgents() {
      try {
        return db.prepare("SELECT username, updated_at AS updatedAt FROM status ORDER BY username").all();
      } catch {
        return [];
      }
    },
    saveMap(username, snapshot) {
      if (!username || !snapshot) return;
      try {
        const u = snapshot;
        const updatedAt = typeof u.updatedAt === "string" ? u.updatedAt : (/* @__PURE__ */ new Date()).toISOString();
        db.prepare(
          `INSERT INTO map (username, updated_at, snapshot_json) VALUES (?, ?, ?)
           ON CONFLICT(username) DO UPDATE SET updated_at = excluded.updated_at, snapshot_json = excluded.snapshot_json`
        ).run(username, updatedAt, JSON.stringify(snapshot));
      } catch {
      }
    },
    loadMap(username) {
      if (!username) return null;
      try {
        const row = db.prepare("SELECT snapshot_json FROM map WHERE username = ?").get(username);
        if (!row?.snapshot_json) return null;
        return JSON.parse(row.snapshot_json);
      } catch {
        return null;
      }
    },
    saveSpellbook(username, state) {
      if (!username || !state) return;
      try {
        db.prepare(
          `INSERT INTO spellbook (username, updated_at, skill_json) VALUES (?, ?, ?)
           ON CONFLICT(username) DO UPDATE SET updated_at = excluded.updated_at, skill_json = excluded.skill_json`
        ).run(username, (/* @__PURE__ */ new Date()).toISOString(), JSON.stringify(state));
      } catch {
      }
    },
    loadSpellbook(username) {
      if (!username) return null;
      try {
        const row = db.prepare("SELECT skill_json FROM spellbook WHERE username = ?").get(username);
        if (!row?.skill_json) return null;
        return JSON.parse(row.skill_json);
      } catch {
        return null;
      }
    }
  };
  ctx.provide("mcStore", svc);
}
export {
  Config,
  apply,
  inject,
  name
};
