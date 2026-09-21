/**
 * mc-reflex —— 反射层（L0）：在 LLM 步与 LLM 步之间守住安全底线。
 *
 * 用户口径：「LLM 比如 2 秒一次，在这个过程中都是 Jev 在做快决策」。
 * 这一层就是那"过程中"：它不规划、不做业务决策，**只做保命**。
 *
 * 分工（三层速率）：
 *   L0 反射（本模块，300–500ms 巡检）：溺水/濒死/贴脸威胁/饿到没招 → 立刻动作
 *   L1 目标环（dsh goal + LLM，2–10s）：目标推进、业务决策
 *   L2 慢环（反思/教训/准则）：改自己
 *
 * 三条纪律（都是别的项目用血换的）：
 *   ① **只做安全类**：反射只在"不动作就会死"时动手（neko §8：五类控制流抢身体 → 调度陷阱家族）
 *   ② **不抢正在跑的动作，除非危急**：agent 正忙时只有 danger ≥ 4（危急）才插手，
 *      否则排队等它这一步结束（否则会与 LLM 的工具调用拔河）
 *   ③ **留痕**：每次插手都记 `by: reflex:<id>` 与原因（不留痕就查不出是谁在抢身体）
 *
 * 与执行层的关系：反射动作**也过身体租约**（ownerKind='reflex'，survival 给高分才抢得到），
 * 租约里那条"反射层仅安全类可抢"的纪律由 `mc-body-lease` 强制。
 */
import type { DangerLevel, ModeId } from './mc-mode'
import Vec3 from 'vec3'

export interface ReflexInput {
  hp: number
  food: number
  oxygen: number
  /** 最近威胁（行动级）的距离，-1 表示没有 */
  nearestThreat: number
  creeperDistance: number
  /** 当前模式与危险度（来自 mc-mode） */
  mode: ModeId
  danger: DangerLevel
  /** LLM 那一步是否正在跑（dsh agent/status） */
  agentBusy: boolean
  /** 有可吃的东西吗 */
  hasEdible: boolean
  /** 多久没有实质进展（毫秒）——来自世界模型 paralysis.stalledMs */
  stalledMs?: number
  /** 该方向是否安全（供选逃向：返回 true 表示那一侧没危险/不是悬崖） */
  safeDirection?: (dx: number, dz: number) => boolean
  /** 各敌对相对方位（用于选"背离"方向） */
  threats?: Array<{ dx: number; dz: number; distance: number }>
}

export type ReflexId = 'surface' | 'escape' | 'eat' | 'unstick'

/** 「证明性卡死」阈值：这么久没有任何进展，允许抢占正在打转的 LLM（须留痕）。 */
export const UNSTICK_AFTER_MS = 8 * 60_000

export interface ReflexSpec {
  id: ReflexId
  zh: string
  /** 触发条件（纯函数，可单测） */
  when: (s: ReflexInput) => boolean
  /** 为什么触发（进日志与审计） */
  why: (s: ReflexInput) => string
  /** 生存分（0..10；≥5 才允许抢占别人的租约） */
  survival: number
  /** 最长持续（毫秒；反射不许长期占着身体） */
  maxMs: number
}

/** 溺水：氧气见底，先浮上去（这一条最不容置疑）。 */
const surface: ReflexSpec = {
  id: 'surface', zh: '上浮换气',
  when: (s) => s.oxygen <= 5,
  why: (s) => `氧气只剩 ${s.oxygen}/10，再不浮上去就溺死了`,
  survival: 9, maxMs: 2500,
}

/** 逃命：贴脸苦力怕 / 濒死且有威胁 / 危险度危急且有威胁。 */
const escape: ReflexSpec = {
  id: 'escape', zh: '躲开威胁',
  when: (s) => (s.creeperDistance >= 0 && s.creeperDistance <= 4)
    || (s.hp <= 6 && s.nearestThreat >= 0)
    || (s.danger >= 4 && s.nearestThreat >= 0),
  why: (s) => s.creeperDistance >= 0 && s.creeperDistance <= 4
    ? `苦力怕贴到 ${s.creeperDistance} 格，不跑会被炸`
    : `血 ${s.hp}/20 且有威胁在 ${s.nearestThreat} 格，先拉开距离`,
  survival: 9, maxMs: 1500,
}

/** 进食：饿到危险线又没有别的办法（模式已经是复原）。 */
const eat: ReflexSpec = {
  id: 'eat', zh: '吃点东西',
  when: (s) => s.food <= 6 && s.hasEdible && (s.mode === 'recover' || s.danger >= 2),
  why: (s) => `饱食度只剩 ${s.food}/20 且包里能吃，先把状态补回来`,
  survival: 6, maxMs: 3000,
}

/** 解卡：脚下可挖就挖穿（掉下去）——纯判定，便于单测。 */
export function shouldDigDown(blockBelow: { name?: string } | null | undefined): boolean {
  if (!blockBelow?.name) return false
  const nm = blockBelow.name.replace(/^minecraft:/, '')
  if (nm === 'air' || nm === 'cave_air' || nm === 'void_air') return false
  return !/lava|water|fire|bedrock|barrier|portal|obsidian/i.test(nm)
}

/** 解卡反射：证明性卡死（≥8min 无进展）时做一次脱困。 */
const unstick: ReflexSpec = {
  id: 'unstick', zh: '解卡脱困',
  when: (s) => (s.stalledMs ?? 0) >= UNSTICK_AFTER_MS,
  why: (s) => `已经 ${Math.round((s.stalledMs ?? 0) / 60000)} 分钟没有任何进展（位置/背包/目标都没动）——不能再等它自己转出来`,
  survival: 7, maxMs: 3000,
}

export const REFLEXES: readonly ReflexSpec[] = [surface, escape, eat, unstick] as const

/**
 * 选一个该做的反射（纯函数）。返回 null = 不必插手。
 * 只做安全类；agent 忙时**只有危急（danger ≥ 4）才插手**（否则排队）。
 */
export function pickReflex(s: ReflexInput): ReflexSpec | null {
  const critical = s.danger >= 4
  // 正当抢占只有两种：①安全（危急，立即）②**证明性卡死**（≥8min 无进展）。
  // 后者是 2026-09-20 真跑加的：爱德华卡在树冠上 50 分钟，LLM 一直在转却毫无进展，
  // 而"不跟忙碌中的 agent 拔河"这条规则恰好让它帮不上忙 —— 那种情况下必须允许插手。
  const provenStuck = (s.stalledMs ?? 0) >= UNSTICK_AFTER_MS
  if (s.agentBusy && !critical && !provenStuck) return null
  // 按生存分从高到低挑第一条满足的
  const candidates = [...REFLEXES].sort((a, b) => b.survival - a.survival).filter((r) => {
    try { return r.when(s) } catch { return false }
  })
  return candidates[0] ?? null
}

/**
 * 选逃向：背离所有威胁的加权反方向，并避开不安全的一侧。
 * 返回单位向量（dx,dz）；没有威胁时给 null。
 */
export function escapeDirection(s: ReflexInput): { dx: number; dz: number } | null {
  const ts = s.threats?.filter((t) => t.distance > 0) ?? []
  if (ts.length === 0) return null
  let ax = 0, az = 0
  for (const t of ts) {
    const w = 1 / Math.max(1, t.distance)   // 越近权重越大
    ax -= t.dx * w
    az -= t.dz * w
  }
  let len = Math.hypot(ax, az)
  if (len < 1e-6) { ax = 1; az = 0; len = 1 }
  let dx = ax / len, dz = az / len
  // 若不安全（悬崖/岩浆/水），左右各转 45°/90° 试一次
  if (s.safeDirection && !s.safeDirection(dx, dz)) {
    const angles = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]
    for (const a of angles) {
      const nx = dx * Math.cos(a) - dz * Math.sin(a)
      const nz = dx * Math.sin(a) + dz * Math.cos(a)
      if (s.safeDirection(nx, nz)) { dx = nx; dz = nz; break }
    }
  }
  return { dx, dz }
}

export interface ReflexJournalEntry {
  at: number
  reflex: ReflexId
  why: string
  ms: number
  grabbed: boolean
  reason?: string
}

/**
 * 跑一条反射动作。**动作实现由调用方注入**（便于单测，也避免本模块依赖 mineflayer）。
 * @returns 日志条目（成功与否都记）
 */
export async function runReflex(
  spec: ReflexSpec,
  input: ReflexInput,
  io: {
    /** 拿身体：返回 false 表示租约没拿到（身体被别人占着） */
    acquire: (survival: number) => boolean
    release: () => void
    /** 具体动作（毫秒级，不许长） */
    act: (ms: number) => Promise<void>
    now?: () => number
    onJournal?: (e: ReflexJournalEntry) => void
  },
): Promise<ReflexJournalEntry> {
  const now = io.now ?? (() => Date.now())
  const at = now()
  const why = spec.why(input)
  const grabbed = io.acquire(spec.survival)
  let entry: ReflexJournalEntry
  if (!grabbed) {
    entry = { at, reflex: spec.id, why, ms: 0, grabbed: false, reason: '身体被别人占着（等它这一步结束）' }
  } else {
    try {
      await io.act(spec.maxMs)
      entry = { at, reflex: spec.id, why, ms: now() - at, grabbed: true }
    } catch (e) {
      entry = { at, reflex: spec.id, why, ms: now() - at, grabbed: true, reason: e instanceof Error ? e.message : String(e) }
    } finally {
      try { io.release() } catch { /* 释放失败不影响 */ }
    }
  }
  try { io.onJournal?.(entry) } catch { /* 日志失败不影响 */ }
  return entry
}

// ─────────────────────────────────────────────────────────────────────────────
// mineflayer 侧的动作实现（薄；只碰控制状态，不做寻路规划）
// ─────────────────────────────────────────────────────────────────────────────

/** 上浮：持续跳跃 + 抬头（水中向前上推进）。 */
export async function actSurface(bot: unknown, ms: number): Promise<void> {
  const b = bot as { setControlState?: (k: string, v: boolean) => void; look?: (yaw: number, pitch: number, force?: boolean) => Promise<void>; entity?: { yaw?: number } }
  if (!b?.setControlState) return
  try { await b.look?.(b.entity?.yaw ?? 0, -Math.PI / 2.2, true) } catch { /* 看向失败照常上浮 */ }
  b.setControlState('jump', true)
  b.setControlState('forward', true)
  await sleep(ms)
  b.setControlState('jump', false)
  b.setControlState('forward', false)
}

/** 躲开：朝某个方向冲刺 ms 毫秒（不寻路；方向盘短、随时可被下一拍改）。 */
export async function actEscape(bot: unknown, dir: { dx: number; dz: number }, ms: number): Promise<void> {
  const b = bot as {
    setControlState?: (k: string, v: boolean) => void
    look?: (yaw: number, pitch: number, force?: boolean) => Promise<void>
    setControlStateSafe?: unknown
  }
  if (!b?.setControlState) return
  // yaw 约定：forward = (-sin yaw, -cos yaw) ⇒ 解出朝 (dx,dz) 的 yaw
  const yaw = Math.atan2(-dir.dx, -dir.dz)
  try { await b.look?.(yaw, 0, true) } catch { /* 转向失败照常冲 */ }
  b.setControlState('sprint', true)
  b.setControlState('forward', true)
  await sleep(ms)
  b.setControlState('forward', false)
  b.setControlState('sprint', false)
}

/** 吃：拿包里的食物进食（equip 到主手 → consume）。 */
export async function actEat(bot: unknown, ms: number): Promise<void> {
  const b = bot as {
    inventory?: { items: () => Array<{ name: string; count: number }> }
    equip?: (item: unknown, dest: string) => Promise<void>
    consume?: () => Promise<void>
    registry?: { foodsByName?: Record<string, unknown> }
  }
  if (!b?.inventory?.items || !b.equip || !b.consume) return
  const foods = (b.registry?.foodsByName ?? {}) as Record<string, unknown>
  const edible = b.inventory.items().find((i) => Object.prototype.hasOwnProperty.call(foods, i.name.replace(/^minecraft:/, '')))
  if (!edible) return
  const withTimeout = (p: Promise<unknown>, t: number) => Promise.race([p, sleep(t).then(() => { throw new Error('超时') })])
  await withTimeout(b.equip(edible, 'hand'), Math.min(ms, 1500))
  await withTimeout(b.consume(), Math.max(500, ms - 1500))
}

/** 解卡动作：脚下可挖就挖穿，否则朝朝向迈一步冲出悬空边缘。 */
export async function actUnstick(bot: unknown, ms: number): Promise<void> {
  const b = bot as {
    entity?: { position?: { x: number; y: number; z: number }; yaw?: number }
    blockAt?: (v: unknown) => { name?: string } | null
    dig?: (block: unknown) => Promise<void>
    setControlState?: (k: string, v: boolean) => void
    look?: (yaw: number, pitch: number, force?: boolean) => Promise<void>
  }
  const p = b?.entity?.position
  if (!p || !b.blockAt || !b.setControlState) return
  const below = ((): { name?: string } | null => {
    try { return b.blockAt!(new Vec3(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z))) as { name?: string } | null } catch { return null }
  })()
  if (shouldDigDown(below) && b.dig) {
    try { await b.dig(below) } catch { /* 挖不动，退化为迈步 */ }
    return
  }
  // ⚠️ 迈步前先判险：脱困动作不许把人带进水里/岩浆/悬崖（真跑：这一步可能把爱德华带进了水）
  const ahead = ((): { name?: string } | null => {
    try { return b.blockAt!(new Vec3(Math.floor(p.x + 1), Math.floor(p.y), Math.floor(p.z + 1))) as { name?: string } | null } catch { return null }
  })()
  const aheadBelow = ((): { name?: string } | null => {
    try { return b.blockAt!(new Vec3(Math.floor(p.x + 1), Math.floor(p.y) - 1, Math.floor(p.z + 1))) as { name?: string } | null } catch { return null }
  })()
  const unsafe = (x: { name?: string } | null): boolean => !!x?.name && /lava|water|fire|cactus|powder_snow/i.test(x.name)
  const noFloor = !aheadBelow?.name || aheadBelow.name === 'air'
  if (unsafe(ahead) || unsafe(aheadBelow) || noFloor) return   // 前方是水/岩浆/悬空 → 这次只挖不迈
  const yaw = b.entity?.yaw ?? 0
  try { await b.look?.(yaw, 0, true) } catch { /* 转向失败照常走 */ }
  b.setControlState('forward', true)
  b.setControlState('sprint', true)
  await new Promise<void>((r) => setTimeout(r, Math.max(400, ms)))
  b.setControlState('jump', true)
  await new Promise<void>((r) => setTimeout(r, 150))
  b.setControlState('jump', false)
  b.setControlState('forward', false)
  b.setControlState('sprint', false)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
