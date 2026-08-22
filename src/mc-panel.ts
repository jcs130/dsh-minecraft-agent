/**
 * mc-panel: per-agent visualization dashboard for transmigrators.
 *
 * 阶段 2（2026-08-21）：控制面板内聚化。废独立 HTTP（:3200 createServer），
 * 改走 dsh 官方 ctx.connection RPC：
 *   - server 半：ctx.connection.rpc.handle('/mc-panel', …) 注册端点；
 *   - client 半：ctx.connection.rpc.call('/mc-panel', 'snapshot', …) 取数。
 *
 * ⚠️ 关键修正：文档原写 `intercept('/api', …)`，但 dsh 的 /api 通道是
 * 「单拦截器」模型——typert 网关（dsh-api-gateway）在构造时已独占 /api 拦截器
 * （rpc-host.ts registerInterceptor：/api 已有拦截器即 throw）。
 * 故 mc-panel 改用**专属逻辑通道** `handle('/mc-panel', …)`，效果等价且零冲突。
 *
 * 数据源：status / map / episodic 已收口进 mc-store（SQLite）；其余
 * （mystic-state.json / wiki-*.jsonl / mc-memory.json / defects/ /
 *  transmigrators.json / mc-connection.json）仍文件，仅从「独立 HTTP」改由
 * 「RPC 路由」。截图本体留文件、索引在 status 快照内。
 *
 * 端点（channel=/mc-panel，authority=loopback）：
 *   snapshot          {user?}     -> PanelPayload（dashboard 全量）
 *   connection.set    {host,port} -> 保存服务器地址覆盖（bot 自动重连）
 *   connection.reset  {}          -> 清除覆盖，回落到 profile 默认
 *   另：webServer GET /mc-panel/shot/<file> 提供截图二进制（同一 dsh 服务器，非独立端口）
 *
 * Config: MC_PANEL_DATA_DIR（默认 ./data）/ MC_PANEL_USERNAME（默认 ''=auto）。
 */
import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { CONNECTION_FILE, RUNTIME_FILE, validateOverrides, type RuntimeConnection } from './mc-connection'
import type { McStoreService } from './mc-store'

export const name = 'mc-panel'
export const inject = ['mcStore']

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  dataDir: Schema.string().default('./data'),
  /** which agent this panel shows; '' = auto-pick the freshest status in mc-store */
  username: Schema.string().default(''),
})

export interface PanelConfig {
  enabled: boolean
  dataDir: string
  username: string
}

// ── RPC 结果类型（对齐 dsh-host-apiproxy 的 RpcResult / RpcError）────────────
type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

function okRpc<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}
function errRpc(message: string, code = 'internal'): RpcResult<never> {
  return { ok: false, error: { code, message, details: {} } }
}

// ── data shapes (tolerant: all fields optional) ────────────────────────────
interface StatusSnapshot {
  updatedAt?: string
  connected?: boolean
  bot?: {
    username?: string
    personaName?: string
    viewerPort?: number
    position?: { x: number; y: number; z: number } | null
    yaw?: number | null
    health?: number
    food?: number
    sleeping?: boolean
    heldItem?: string | null
    inventory?: Array<{ name: string; count: number }>
  }
  context?: { cards?: Array<{ id: string; remain: number }> }
  recentSteps?: Array<{
    ts?: string
    step?: number
    thought?: string
    goal?: string
    tool?: string
    args?: Record<string, unknown>
    outcome?: string
    shot?: string
  }>
}

export interface PanelPayload {
  username: string
  status: StatusSnapshot | null
  staleMs: number | null
  online: boolean
  archive: { name?: string; epithet?: string; source?: string } | null
  mystic: { innateSkill?: string; level?: number } | null
  wiki: { total: number; cards: Array<{ topic: string; source: string; ts: number; content: string }> }
  memory: {
    base?: { x: number; y: number; z: number }
    publicChest?: { x: number; y: number; z: number }
    resourcePoints?: Record<string, Array<{ x: number; y: number; z: number }>>
    currentGoal?: string
  } | null
  defects: Array<Record<string, unknown> & { file: string; tool: string }>
  latestShot: string | null
  uptimeSec: number
  /** 俯视地形快照（mc-session 每步写 mc-store.map） */
  topo: {
    updatedAt?: string
    r?: number
    cx?: number
    cy?: number
    cz?: number
    yaw?: number | null
    cells?: string
    heights?: number[]
    entities?: Array<{ name: string; dx: number; dz: number }>
  } | null
  /** 编年史事件流（episodic 尾部）与击杀聚合 */
  events: Array<{ ts: string; text: string; kill: boolean }>
  kills: { recent: number; items: Array<{ ts: string; text: string }> }
  /** 服务器连接（地址页面可配）。override = 用户覆盖文件；runtime = bot 回写真相 */
  connection: {
    override: { host?: string; port?: number; updatedAt?: string; updatedBy?: string } | null
    runtime: RuntimeConnection | null
  }
}

const KILL_RE = /击杀|杀死|斩杀|斩了|killed|slain|defeated|击败/

const START_MS = Date.now()

// 统一数据层（2026-08-21）：status/map/episodic 读取改走 SQLite。collect 是纯函数
// 不持 ctx，故 apply 时经 cordis 服务把 store 注入到本 bundle 的模块级变量；
// 单测则直接传第 3 参 store，不依赖模块级单例。
let panelStore: McStoreService | undefined

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Pick which agent this panel is about: config.username or freshest status in mc-store. */
export function resolveUsername(dataDir: string, configured: string, store?: McStoreService): string {
  void dataDir
  if (configured) return configured
  const s = store ?? panelStore
  try {
    const rows = s?.listStatusAgents() ?? []
    let best = ''
    let bestTs = ''
    for (const a of rows) {
      if (!a.username || a.username === 'unknown') continue
      if (a.updatedAt > bestTs) {
        bestTs = a.updatedAt
        best = a.username
      }
    }
    return best
  } catch {
    return ''
  }
}

/** yaw (radians) → 中文方位。mineflayer 朝向向量 = (-sin,cos)；已用实测标定（yaw=-π/2 ↔ 东）. */
export function facingLabel(yaw: number | null | undefined): string {
  if (yaw == null || !Number.isFinite(yaw)) return '—'
  // heading: 从 +Z(南) 朝 +X(东) 顺时针的角度
  const heading = (((-yaw * 180) / Math.PI) % 360 + 360) % 360
  // vanilla 罗盘刻度：0=南, 90=西, 180=北, 270=东
  const compass = (360 - heading) % 360
  if (compass >= 315 || compass < 45) return '南 (+Z)'
  if (compass < 135) return '西 (-X)'
  if (compass < 225) return '北 (-Z)'
  return '东 (+X)'
}

/** Guarded screenshot path: only files strictly under <dataDir>/screenshots. */
export function resolveShotPath(dataDir: string, shot: string): string | null {
  if (!shot) return null
  const root = resolve(dataDir, 'screenshots')
  const full = resolve(root, shot)
  if (full !== root && !full.startsWith(root + sep)) return null
  return existsSync(full) ? full : null
}

/** Build the whole dashboard payload. Never throws. store 可选（单测注入；生产用模块级 panelStore）。 */
export function collect(dataDir: string, username: string, store?: McStoreService): PanelPayload {
  const s = store ?? panelStore
  const u = resolveUsername(dataDir, username, s)
  const payload: PanelPayload = {
    username: u,
    status: null,
    staleMs: null,
    online: false,
    archive: null,
    mystic: null,
    wiki: { total: 0, cards: [] },
    memory: null,
    defects: [],
    latestShot: null,
    uptimeSec: Math.round((Date.now() - START_MS) / 1000),
    topo: null,
    events: [],
    kills: { recent: 0, items: [] },
    connection: { override: null, runtime: null },
  }
  // 服务器连接信息（进程级，与 username 无关）
  payload.connection.override = readJson(join(dataDir, CONNECTION_FILE)) as PanelPayload['connection']['override']
  payload.connection.runtime = readJson(join(dataDir, RUNTIME_FILE)) as RuntimeConnection | null
  if (!u) return payload
  const statusRaw = s?.loadStatus(u)
  const status = (statusRaw ?? {}) as StatusSnapshot
  payload.status = statusRaw ? status : null
  if (status.updatedAt) {
    const age = Date.now() - new Date(status.updatedAt).getTime()
    if (Number.isFinite(age)) {
      payload.staleMs = age
      payload.online = status.connected === true
    }
  }
  // transmigrator archive (persona name / epithet / IP source)
  const tr = readJson(join(dataDir, 'transmigrators.json'))
  const list = (tr?.transmigrators as Array<Record<string, unknown>> | undefined) ?? []
  const entry = list.find((t) => t.username === u)
  if (entry) payload.archive = { name: entry.name as string, epithet: entry.epithet as string, source: entry.source as string }
  // mystic state (level + innate skill)
  const mystic = readJson(join(dataDir, 'mystic-state.json'))
  const players = (mystic?.players as Record<string, Record<string, unknown>> | undefined) ?? {}
  if (players[u]) payload.mystic = { innateSkill: players[u].innateSkill as string, level: players[u].level as number }
  // wiki cards (JSONL, show last 8)
  try {
    const lines = readFileSync(join(dataDir, `wiki-${u}.jsonl`), 'utf-8').split('\n').filter(Boolean)
    payload.wiki.total = lines.length
    payload.wiki.cards = lines.slice(-8).reverse().map((l) => {
      try {
        const c = JSON.parse(l) as { topic?: string; source?: string; ts?: number; content?: string }
        return { topic: c.topic ?? '', source: c.source ?? '', ts: c.ts ?? 0, content: c.content ?? '' }
      } catch {
        return { topic: '(损坏行)', source: '', ts: 0, content: '' }
      }
    })
  } catch { /* no wiki yet */ }
  // long-term memory (base / chest / resource points / current goal)
  payload.memory = readJson(join(dataDir, 'mc-memory.json')) as PanelPayload['memory']
  // defect tickets
  try {
    const ddir = join(dataDir, 'defects')
    for (const f of readdirSync(ddir)) {
      if (!f.endsWith('.json')) continue
      const d = readJson(join(ddir, f))
      if (!d) continue
      const toolFromName = /^DEFECT-\d{14}-(.+)\.json$/.exec(f)?.[1] ?? f
      payload.defects.push({ ...d, file: f, tool: (d.tool as string) ?? toolFromName })
    }
    payload.defects.sort((a, b) => String(b.file).localeCompare(String(a.file)))
  } catch { /* no defects dir */ }
  // latest screenshot referenced by recentSteps
  for (let i = (status.recentSteps?.length ?? 0) - 1; i >= 0; i--) {
    const step = status.recentSteps![i]
    if (step.shot && resolveShotPath(dataDir, step.shot)) {
      payload.latestShot = step.shot
      break
    }
  }
  // 兜底（2026-08-21）：recentSteps 由旧 mc-loop 生产，迁移 session 形态后为空；
  // 但 mc_see 截图仍持续落盘 screenshots/<username>/。直接扫目录取最新一张，
  // 不依赖 recentSteps 索引——「最近所见」据此恢复。
  if (!payload.latestShot) {
    try {
      const shotDir = join(dataDir, 'screenshots', u)
      const files = readdirSync(shotDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()
      if (files.length) {
        const rel = join(u, files[files.length - 1])
        if (resolveShotPath(dataDir, rel)) payload.latestShot = rel
      }
    } catch { /* no screenshots yet */ }
  }
  // 俯视地形快照（mc-session writeMapSnapshot 每步写 mc-store.map）
  payload.topo = (s?.loadMap(u) ?? null) as PanelPayload['topo']
  // 编年史事件流（SQLite 尾部 40 条）+ 击杀聚合
  try {
    const rows = s?.episodicTail(u, 40) ?? []
    const events: Array<{ ts: string; text: string; kill: boolean }> = rows.map((r) => ({
      ts: r.ts,
      text: r.text,
      kill: KILL_RE.test(r.text),
    }))
    payload.events = events.reverse()
    const kills = events.filter((e) => e.kill).slice(0, 10)
    payload.kills = { recent: events.filter((e) => e.kill).length, items: kills }
  } catch { /* no episodic yet */ }
  return payload
}

export function apply(ctx: Context, config: PanelConfig): void {
  if (!config.enabled) return
  const dataDir = resolve(config.dataDir)
  panelStore = ctx.get('mcStore') as McStoreService | undefined

  // ── RPC：专属逻辑通道（不抢 /api 单拦截器）─────────────────────────────────
  ctx.inject(['connection'], (connectionCtx) => {
    const rpc = (connectionCtx as unknown as { connection?: { rpc?: {
      handle?: (channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>, options: { authority: 'loopback' | 'trusted-host' }) => () => Promise<void>
    } } }).connection?.rpc
    if (!rpc || typeof rpc.handle !== 'function') {
      console.warn('[mc-panel] connection.rpc.handle unavailable — RPC 面板不启用')
      return
    }
    const disposeRpc = rpc.handle('/mc-panel', async (endpoint, payload) => {
      try {
        switch (endpoint) {
          case 'snapshot': {
            const user = ((payload as { user?: string } | undefined)?.user) ?? config.username
            return okRpc(collect(dataDir, user))
          }
          case 'connection.set': {
            const v = validateOverrides(payload)
            if (!v.ok) return errRpc(v.error, 'bad-request')
            mkdirSync(dataDir, { recursive: true })
            const saved = { ...v.value, updatedAt: new Date().toISOString(), updatedBy: 'mc-panel' }
            writeFileSync(join(dataDir, CONNECTION_FILE), JSON.stringify(saved, null, 2) + '\n', 'utf-8')
            console.log(`[mc-panel] connection override saved: ${v.value.host}:${v.value.port ?? '(default)'} (bot auto-reconnects)`)
            return okRpc({ saved: v.value })
          }
          case 'connection.reset': {
            try { unlinkSync(join(dataDir, CONNECTION_FILE)) } catch { /* no override file */ }
            console.log('[mc-panel] connection override removed (back to profile defaults)')
            return okRpc({ reset: true })
          }
          default:
            return errRpc(`unknown endpoint: ${endpoint}`)
        }
      } catch (e) {
        return errRpc(e instanceof Error ? e.message : String(e))
      }
    }, { authority: 'loopback' })
    ctx.effect(() => () => { void disposeRpc() })
    console.log(`[mc-panel] RPC mounted at /mc-panel (data=${dataDir})`)
  })

  // ── 截图二进制：同一 dsh web 服务器路由，非独立端口 ─────────────────────────
  const SHOT_PREFIX = '/mc-panel/shot/'
  ctx.inject(['webServer'], () => {
    const ws = ctx.get('webServer') as { register?: (spec: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => () => void } | undefined
    if (!ws || typeof ws.register !== 'function') return
    const disposeShot = ws.register({
      kind: 'prefix',
      path: SHOT_PREFIX,
      handler: (req, res) => {
        try {
          const raw = (req.url ?? '').split('?')[0]
          const rel = decodeURIComponent(raw.slice(SHOT_PREFIX.length))
          const full = resolveShotPath(dataDir, rel)
          if (!full) {
            res.writeHead(404).end('not found')
            return
          }
          const img = readFileSync(full)
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length, 'Cache-Control': 'no-cache' })
          res.end(img)
        } catch {
          try { res.writeHead(404).end('gone') } catch { /* socket gone */ }
        }
      },
    })
    ctx.effect(() => disposeShot)
    console.log(`[mc-panel] screenshot route mounted at ${SHOT_PREFIX}`)
  })
}
