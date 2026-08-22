/**
 * agent-store —— 通用 MC AI Agent 人物注册表数据层（纯逻辑，零 cordis 依赖）。
 *
 * 读写 data/agents.json：每个人物 = 一个 dsh agent（= session），拥有独立
 * 工作空间（meta.cwd）与上下文记忆（dsh-session-persistence）。字段契约见
 * agents.json 的 _comment：id=唯一标识（=sessionId=cwd 目录名）；name=显示名
 * （中文）；username=MC 登录名（mineflayer 用户名）；background=背景身份
 * （自由文本，注入人格/行为方式，不再强制「穿越者+魔法」结构）；skin=皮肤
 * 预设 key（对应 skins.json 的 presets）；server=连接目标；status=stopped/running。
 *
 * 控制页面的人物管理（新增/删除/编辑名字/背景身份/皮肤）经 mc-panel 的
 * /api/agents* 端点落到本模块。本模块只做「读文件 → 改内存 → 原子写回」，
 * 不关心谁在消费（mc-session 装配、控制页展示、皮肤注入都从同一份文件读）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** 服务器连接目标。 */
export interface AgentServer {
  host: string
  port: number
}

/** 通用人物字段（与 data/agents.json 一一对应）。 */
export interface AgentRecord {
  /** 唯一标识（= sessionId = cwd 目录名）。 */
  id: string
  /** 显示名（中文）。 */
  name: string
  /** MC 登录名（mineflayer username）。 */
  username: string
  /** 背景身份（注入人格/行为方式）。 */
  background: string
  /** 皮肤预设 key（对应 skins.json 的 presets）。 */
  skin?: string
  /** 连接目标。 */
  server?: AgentServer
  /** stopped / running。 */
  status?: 'stopped' | 'running'
  createdAt?: string
  updatedAt?: string
}

interface AgentsFile {
  _comment?: string
  agents: AgentRecord[]
}

const DEFAULT_COMMENT =
  '通用 MC AI Agent 人物注册表。每个人物 = 一个 dsh agent（= session），拥有独立工作空间（meta.cwd）与上下文记忆（dsh-session-persistence）。字段：id=唯一标识（=sessionId=cwd 目录名）；name=显示名（中文）；username=MC 登录名（mineflayer 用户名）；background=背景身份（自由文本，注入人格/行为方式，不再强制「穿越者+魔法」结构）；skin=皮肤预设 key（对应 skins.json 的 presets）；server=连接目标；status=stopped/running。控制页面的人物管理（新增/删除/编辑名字背景身份）读写本文件。'

/** 人物注册表文件路径（相对 dataDir）。 */
export const AGENTS_FILE = 'agents.json'

function filePath(dataDir: string): string {
  return resolve(dataDir, AGENTS_FILE)
}

/** 读注册表：文件缺失/损坏一律回落空列表，不抛错。 */
function loadFile(dataDir: string): AgentsFile {
  const path = filePath(dataDir)
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AgentsFile>
      if (Array.isArray(raw.agents)) {
        return { _comment: raw._comment, agents: raw.agents.filter(isValidRecord) }
      }
    }
  } catch (err) {
    console.error(`[agent-store] 读取 ${path} 失败（回落空表）: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { agents: [] }
}

function isValidRecord(e: unknown): e is AgentRecord {
  return (
    !!e &&
    typeof e === 'object' &&
    typeof (e as AgentRecord).id === 'string' &&
    typeof (e as AgentRecord).name === 'string' &&
    typeof (e as AgentRecord).username === 'string'
  )
}

/** 原子写回（先建目录，UTF-8 无 BOM，末尾换行）。 */
function saveFile(dataDir: string, file: AgentsFile): void {
  mkdirSync(dataDir, { recursive: true })
  const out: AgentsFile = { _comment: DEFAULT_COMMENT, agents: file.agents }
  writeFileSync(filePath(dataDir), JSON.stringify(out, null, 2) + '\n', 'utf-8')
}

/** 名字 → 唯一 id：转小写、空白转连字符、剔除非字母数字（保留中文），空则回落 hash。 */
export function slugifyId(name: string): string {
  const s = String(name ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  // 保留中文/字母/数字/连字符；其余剔除
  const cleaned = s.replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '')
  if (cleaned) return cleaned
  return 'agent-' + Date.now().toString(36)
}

function nowIso(): string {
  return new Date().toISOString()
}

/** 列全部人物（副本，调用方可安全改）。 */
export function listAgents(dataDir: string): AgentRecord[] {
  return loadFile(dataDir).agents.map((a) => ({ ...a }))
}

/** 按 id 查单个人物。 */
export function getAgent(dataDir: string, id: string): AgentRecord | null {
  const a = loadFile(dataDir).agents.find((x) => x.id === id)
  return a ? { ...a } : null
}

/** 新增人物。id 冲突（已存在）时返回 null；username 冲突也拒绝。 */
export function createAgent(
  dataDir: string,
  input: { name: string; username: string; background?: string; skin?: string; server?: AgentServer },
): AgentRecord | null {
  const file = loadFile(dataDir)
  const id = slugifyId(input.name)
  const uname = String(input.username ?? '').trim()
  if (!uname) return null
  if (file.agents.some((a) => a.id === id)) return null
  if (file.agents.some((a) => a.username.toLowerCase() === uname.toLowerCase())) return null
  const record: AgentRecord = {
    id,
    name: String(input.name).trim(),
    username: uname,
    background: String(input.background ?? '').trim(),
    skin: input.skin,
    server: input.server,
    status: 'stopped',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  file.agents.push(record)
  saveFile(dataDir, file)
  return { ...record }
}

/** 更新人物（patch 只改传入字段，username 冲突仍拒绝）。 */
export function updateAgent(
  dataDir: string,
  id: string,
  patch: Partial<Omit<AgentRecord, 'id' | 'createdAt'>>,
): AgentRecord | null {
  const file = loadFile(dataDir)
  const idx = file.agents.findIndex((a) => a.id === id)
  if (idx < 0) return null
  const cur = file.agents[idx]
  const next: AgentRecord = { ...cur }
  if (patch.name !== undefined) next.name = String(patch.name).trim() || cur.name
  if (patch.username !== undefined) {
    const uname = String(patch.username).trim()
    if (!uname) return null
    if (file.agents.some((a) => a.id !== id && a.username.toLowerCase() === uname.toLowerCase())) return null
    next.username = uname
  }
  if (patch.background !== undefined) next.background = String(patch.background).trim()
  if (patch.skin !== undefined) next.skin = patch.skin
  if (patch.server !== undefined) next.server = patch.server
  if (patch.status !== undefined) next.status = patch.status
  next.updatedAt = nowIso()
  file.agents[idx] = next
  saveFile(dataDir, file)
  return { ...next }
}

/** 删除人物。返回是否真的删掉了。 */
export function removeAgent(dataDir: string, id: string): boolean {
  const file = loadFile(dataDir)
  const before = file.agents.length
  file.agents = file.agents.filter((a) => a.id !== id)
  if (file.agents.length === before) return false
  saveFile(dataDir, file)
  return true
}

/** 皮肤库（skins.json）读取：presets + assignments（用户名→预设）。 */
export interface SkinPreset {
  value?: string
  signature?: string
  url?: string
  model?: string
  mineskinId?: number
  displayName?: string
  png?: string
  source?: string
}

export interface SkinsFile {
  presets: Record<string, SkinPreset>
  assignments: Record<string, string>
  _note?: string
}

export function loadSkins(dataDir: string): SkinsFile {
  try {
    const raw = JSON.parse(readFileSync(resolve(dataDir, 'skins.json'), 'utf-8')) as Partial<SkinsFile>
    return {
      presets: (raw.presets ?? {}) as Record<string, SkinPreset>,
      assignments: (raw.assignments ?? {}) as Record<string, string>,
      _note: raw._note,
    }
  } catch {
    return { presets: {}, assignments: {} }
  }
}

/** 皮肤预设 key 列表（供 UI 下拉选择）。 */
export function listSkinPresets(dataDir: string): string[] {
  return Object.keys(loadSkins(dataDir).presets)
}
