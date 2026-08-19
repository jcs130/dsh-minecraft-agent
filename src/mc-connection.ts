/**
 * mc-connection —— 服务器地址运行时可配（页面可配，不写死）。
 *
 * 机制（2026-08-20 需求：服务器地址不应该写死在 cordis.patch.yml）：
 *   data/mc-connection.json —— 用户意图（面板写入的覆盖值，host/port）
 *   data/bot-connection.json —— 运行时真相（mc-bot 每次连接/断开回写）
 *
 * mc-bot 启动时读覆盖文件（优先于 cordis config），并用 fs.watchFile 轮询监听
 * 变化：文件一变即用新地址重建连接（门面跨重连存活，上层插件零感知）。
 * 面板只读写文件，与 mc-bot 零耦合（保持 panel 纯观察者边界）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 用户可编辑的连接覆盖（面板写入）。 */
export interface ConnectionOverrides {
  host?: string
  port?: number
}

export const CONNECTION_FILE = 'mc-connection.json'
export const RUNTIME_FILE = 'bot-connection.json'

/** 运行时真相（mc-bot 回写，面板展示）。 */
export interface RuntimeConnection {
  host: string
  port: number
  username: string
  /** 本次连接尝试是否已 spawn（进入世界）。 */
  connected: boolean
  /** 'override' = 来自覆盖文件；'default' = 来自 cordis config。 */
  source?: 'override' | 'default'
  updatedAt: string
}

/** 宽容读取覆盖文件：坏 JSON / 越界值一律视为无覆盖。 */
export function loadOverrides(dataDir: string): ConnectionOverrides {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, CONNECTION_FILE), 'utf-8')) as Record<string, unknown>
    const out: ConnectionOverrides = {}
    if (typeof raw.host === 'string' && raw.host.trim()) out.host = raw.host.trim()
    if (typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port >= 1 && raw.port <= 65535) {
      out.port = raw.port
    }
    return out
  } catch {
    return {}
  }
}

/** 校验面板提交的覆盖值；返回错误文案（中文，可直接展示）。 */
export function validateOverrides(input: unknown): { ok: true; value: ConnectionOverrides } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: '请求体必须是 JSON 对象' }
  const raw = input as Record<string, unknown>
  const value: ConnectionOverrides = {}
  if (typeof raw.host !== 'string' || !raw.host.trim()) return { ok: false, error: 'host 不能为空' }
  const host = raw.host.trim()
  if (host.length > 253 || /\s/.test(host)) return { ok: false, error: 'host 不是合法的地址（域名或 IP）' }
  value.host = host
  const port = raw.port
  if (port !== undefined && port !== null && port !== '') {
    const p = typeof port === 'number' ? port : Number.parseInt(String(port), 10)
    if (!Number.isInteger(p) || p < 1 || p > 65535) return { ok: false, error: '端口必须是 1-65535 的整数' }
    value.port = p
  }
  return { ok: true, value }
}
