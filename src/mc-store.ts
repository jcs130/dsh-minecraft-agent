/**
 * mc-store —— 客户端统一数据层（2026-08-21 阶段 1）。
 *
 * 「索引进库、本体留文件」落到唯一 SQLite 库 data/client.db（node:sqlite，
 * 零新依赖；sqlite-vec 留到语义记忆阶段再接入）。阶段 1 迁入：
 *   - episodic  编年史（append-only 事件流，原 episodic-<username>.jsonl）
 *   - progress  学习进度账本（原 progress-<username>.json，整行 JSON blob）
 *
 * 服务边界：本插件经 ctx.provide('mcStore') 对外暴露读写口，消费方（mc-tools /
 * mc-progress / mc-session / mc-panel）在 inject 里声明依赖 'mcStore' 保证
 * 本插件先于它们 apply（cordis 拓扑排序）。⚠️ 不要用模块级单例跨插件共享 db
 * —— build.mjs 每个插件独立 bundle，模块级变量在各 bundle 里是互相独立的副本，
 * 只有 cordis 服务（provide/get）能跨 bundle 传递同一份运行时实例。
 *
 * 阶段 1 不涉及「本体留文件」：episodic/progress 都是纯结构化小数据（每条几十
 * 到几百字节），天然该全量进库；「本体留文件」用于语义记忆正文与截图等大块，
 * 属后续阶段。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export const name = 'mc-store'
export const inject: string[] = []

export interface Config {
  dataDir: string
  dbFile: string
}
export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string().default('./data'),
  dbFile: Schema.string().default('client.db'),
})

/** episodic 编年史一行（与旧 jsonl 的 {ts,text} 结构对齐）。 */
export interface EpisodicRow {
  ts: string
  text: string
}

export interface McStoreService {
  /** 追加一条情景记忆（ts 由 store 生成）。写失败静默——记忆是增强不是依赖。 */
  appendEpisodic(username: string, text: string): void
  /** 尾部 n 条情景记忆，正序（最旧在前），与旧 readFileSync + slice(-n) 语义一致。 */
  episodicTail(username: string, n: number): EpisodicRow[]
  /** 读学习账本（整行 JSON），无则 null。 */
  loadProgress(username: string): Record<string, unknown> | null
  /** 写学习账本（整行 JSON，UPSERT）。 */
  saveProgress(username: string, state: unknown): void
  /** 写状态快照（整行 JSON，UPSERT；updated_at = snapshot.updatedAt）。 */
  saveStatus(username: string, snapshot: Record<string, unknown>): void
  /** 读状态快照（整行 JSON），无则 null。 */
  loadStatus(username: string): Record<string, unknown> | null
  /** 列所有有状态快照的 agent（username + updatedAt ISO），供面板切换视角。 */
  listStatusAgents(): Array<{ username: string; updatedAt: string }>
  /** 写俯视地形快照（整行 JSON，UPSERT）。 */
  saveMap(username: string, snapshot: Record<string, unknown>): void
  /** 读俯视地形快照，无则 null。 */
  loadMap(username: string): Record<string, unknown> | null
}

/** db 打开失败时的降级服务：全 no-op，保证依赖方（mc-tools 等）不因本插件异常而卡死。 */
const degradedService: McStoreService = {
  appendEpisodic() {},
  episodicTail() { return [] },
  loadProgress() { return null },
  saveProgress() {},
  saveStatus() {},
  loadStatus() { return null },
  listStatusAgents() { return [] },
  saveMap() {},
  loadMap() { return null },
}

function openDb(dataDir: string, dbFile: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(resolve(dataDir, dbFile))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS episodic (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    ts TEXT NOT NULL,
    text TEXT NOT NULL
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_episodic_user ON episodic(username, id)')
  db.exec(`CREATE TABLE IF NOT EXISTS progress (
    username TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  // 阶段 2：status / map 快照收口进库（替代 status-<username>.json / map-<username>.json）。
  // 均为「当前快照」语义（每 agent 一行，UPSERT），updated_at 存 snapshot 里的 ISO 时间戳。
  db.exec(`CREATE TABLE IF NOT EXISTS status (
    username TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS map (
    username TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL
  )`)
  return db
}

export function apply(ctx: Context, config: Config = {} as Config) {
  const log = (msg: string) => console.log(`[mc-store] ${msg}`)
  const dataDir = config.dataDir ?? './data'
  const dbFile = config.dbFile ?? 'client.db'

  let db: DatabaseSync
  try {
    db = openDb(dataDir, dbFile)
  } catch (e) {
    console.error(`[mc-store] SQLite 初始化失败（episodic/progress 读写降级为 no-op）: ${e instanceof Error ? e.message : String(e)}`)
    ctx.provide('mcStore', degradedService)
    return
  }
  log(`SQLite ready: ${resolve(dataDir, dbFile)} (WAL)`)

  const svc: McStoreService = {
    appendEpisodic(username, text) {
      if (!username) return
      try {
        db.prepare('INSERT INTO episodic (username, ts, text) VALUES (?, ?, ?)')
          .run(username, new Date().toISOString(), text)
      } catch { /* 记忆写失败不影响行动 */ }
    },
    episodicTail(username, n) {
      if (!username) return []
      try {
        const rows = db.prepare(
          'SELECT ts, text FROM episodic WHERE username = ? ORDER BY id DESC LIMIT ?',
        ).all(username, n) as Array<{ ts: string; text: string }>
        return rows.reverse()
      } catch { return [] }
    },
    loadProgress(username) {
      if (!username) return null
      try {
        const row = db.prepare('SELECT state_json FROM progress WHERE username = ?')
          .get(username) as { state_json?: string } | undefined
        if (!row?.state_json) return null
        return JSON.parse(row.state_json) as Record<string, unknown>
      } catch { return null }
    },
    saveProgress(username, state) {
      if (!username) return
      try {
        db.prepare(
          `INSERT INTO progress (username, state_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(username) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
        ).run(username, JSON.stringify(state), Date.now())
      } catch { /* 写失败静默 */ }
    },
    saveStatus(username, snapshot) {
      if (!username || !snapshot) return
      try {
        const u = snapshot as { updatedAt?: unknown }
        const updatedAt = typeof u.updatedAt === 'string' ? u.updatedAt : new Date().toISOString()
        db.prepare(
          `INSERT INTO status (username, updated_at, snapshot_json) VALUES (?, ?, ?)
           ON CONFLICT(username) DO UPDATE SET updated_at = excluded.updated_at, snapshot_json = excluded.snapshot_json`,
        ).run(username, updatedAt, JSON.stringify(snapshot))
      } catch { /* 写失败静默 */ }
    },
    loadStatus(username) {
      if (!username) return null
      try {
        const row = db.prepare('SELECT snapshot_json FROM status WHERE username = ?')
          .get(username) as { snapshot_json?: string } | undefined
        if (!row?.snapshot_json) return null
        return JSON.parse(row.snapshot_json) as Record<string, unknown>
      } catch { return null }
    },
    listStatusAgents() {
      try {
        return db.prepare('SELECT username, updated_at AS updatedAt FROM status ORDER BY username')
          .all() as Array<{ username: string; updatedAt: string }>
      } catch { return [] }
    },
    saveMap(username, snapshot) {
      if (!username || !snapshot) return
      try {
        const u = snapshot as { updatedAt?: unknown }
        const updatedAt = typeof u.updatedAt === 'string' ? u.updatedAt : new Date().toISOString()
        db.prepare(
          `INSERT INTO map (username, updated_at, snapshot_json) VALUES (?, ?, ?)
           ON CONFLICT(username) DO UPDATE SET updated_at = excluded.updated_at, snapshot_json = excluded.snapshot_json`,
        ).run(username, updatedAt, JSON.stringify(snapshot))
      } catch { /* 写失败静默 */ }
    },
    loadMap(username) {
      if (!username) return null
      try {
        const row = db.prepare('SELECT snapshot_json FROM map WHERE username = ?')
          .get(username) as { snapshot_json?: string } | undefined
        if (!row?.snapshot_json) return null
        return JSON.parse(row.snapshot_json)
      } catch { return null }
    },
  }
  ctx.provide('mcStore', svc)
}
