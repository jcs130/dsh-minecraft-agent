// 一次性迁移脚本（2026-08-21 数据层改造阶段 1）：
//   把现有 episodic-<username>.jsonl + progress-<username>.json 灌入
//   data/client.db（node:sqlite，零依赖）。
//
// 语义 = 「从文件重建 SQLite」（源文件是权威，本脚本可重复跑，重复跑结果一致）。
// 用法：node scripts/migrate-to-sqlite.mjs [dataDir]   （dataDir 默认 ./data）
//
// ⚠️ 时序约定：本脚本应在「代码切换 SQLite 写入」之前跑一次；切换后旧 jsonl/json
//   不再写、保留作回滚锚（不删）。切换后请勿再跑本脚本——它会清空目标表重灌，
//   抹掉切换后新写入 SQLite 的数据。
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dataDir = resolve(process.argv[2] ?? './data')
const dbFile = join(dataDir, 'client.db')

mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(dbFile)
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

// 重建语义：先清空，再从源文件灌（幂等）。
db.exec('DELETE FROM episodic')
db.exec('DELETE FROM progress')

// ── 1) episodic-<username>.jsonl ──────────────────────────────────────
const insEp = db.prepare('INSERT INTO episodic (username, ts, text) VALUES (?, ?, ?)')
let epTotal = 0
for (const f of readdirSync(dataDir)) {
  const m = /^episodic-(.+)\.jsonl$/.exec(f)
  if (!m) continue
  const username = m[1]
  const lines = readFileSync(join(dataDir, f), 'utf-8').split('\n').filter(Boolean)
  db.exec('BEGIN')
  let n = 0
  for (const l of lines) {
    try {
      const e = JSON.parse(l)
      if (e && typeof e.text === 'string') {
        insEp.run(username, typeof e.ts === 'string' ? e.ts : '', e.text)
        n++
      }
    } catch { /* 跳过损坏行 */ }
  }
  db.exec('COMMIT')
  epTotal += n
  console.log(`[migrate] episodic-${username}.jsonl → ${n} 行`)
}

// ── 2) progress-<username>.json ───────────────────────────────────────
const upsert = db.prepare(`INSERT INTO progress (username, state_json, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(username) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`)
let pgTotal = 0
for (const f of readdirSync(dataDir)) {
  const m = /^progress-(.+)\.json$/.exec(f)
  if (!m) continue
  const username = m[1]
  try {
    const state = JSON.parse(readFileSync(join(dataDir, f), 'utf-8'))
    if (state && state.version === 1) {
      upsert.run(username, JSON.stringify(state), Date.now())
      pgTotal++
      console.log(`[migrate] progress-${username}.json → OK`)
    } else {
      console.warn(`[migrate] progress-${username}.json 版本不符（version=${state?.version}），跳过`)
    }
  } catch (e) {
    console.warn(`[migrate] progress-${username}.json 解析失败，跳过: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const epCount = db.prepare('SELECT COUNT(*) AS c FROM episodic').get().c
const pgCount = db.prepare('SELECT COUNT(*) AS c FROM progress').get().c
console.log(`[migrate] 完成：episodic ${epCount} 行（本次灌入 ${epTotal}），progress ${pgCount} 用户（本次灌入 ${pgTotal}）`)
console.log(`[migrate] db = ${dbFile}`)
db.close()
