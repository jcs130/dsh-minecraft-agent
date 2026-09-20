/**
 * mc-execution —— 执行层（快循环第③环）+ 反馈层契约（第④环）。
 *
 * 研读来源（2026-09-20，取长补短）：
 *   · neko `src/agent/action_manager.js`：统一回执 `{success,message,interrupted,timedout}`、
 *     动作级日志作用域、输出摘要（前后各截 250 字符）、超时写 system 历史、打转检测。
 *   · Cortico `executor.ts`：终态分类 `done|partial|blocked|superseded|reflex|cancelled`、
 *     每步下场账本（有上限、超出写「前 N 步略」）、被切断补一条、中断带来源 `by`、
 *     `deriveExpect`→`ExpectVerdict{met,actual,measured,gain}`、因果闸、受阻头名统计（窗口+门槛）。
 *   · Cortico `receipt.ts`：`measured` 短读数 / `actual` 详述 / **`gain` 本步增量**、
 *     `readAt` 实测时刻（回执重放原读数，**不重读世界**）、受阻归属 `server|local`、
 *     报错中文化但**认不出的原样保留**、`verdictNote`「按…核验:达成/落空(实测 X,读于 T)」、
 *     **既有存量不能证明本步产出**。
 *   · Cortico `precheck.ts`：每步至多一条前置提示、**hard 优先于 soft**、**只报否定**
 *     （"只报否定才让信号稀缺、token 成本近零"）、**只报事实不修改任务**。
 *   · Cortico `until.ts`：早停名单解析，**认不出的名字不许静默吃掉**，要在回执里点名。
 *
 * 我们的两处「长」：
 *   ① **`noop`（世界没变，工具却"成功"了）** 提升为一等终态 —— 光看工具返回字符串分不清
 *      「做成了」和「跑完了」（我们审计里"验收"只出现 1 次，正是这个洞）。
 *   ② **`by`（谁打断的）** —— neko §8「五类控制流抢身体」的教训：不留痕就查不出是谁在抢。
 *
 * 纪律：本模块**不改动作语义**，只在执行的前后加闸与核验；失败一律降级为"照常执行 + 记录"。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 回执契约
// ─────────────────────────────────────────────────────────────────────────────

/** 终态（取 Cortico 的分类，按我们的场景调整：加 timeout，加 noop）。 */
import { appendJsonl } from './mc-perception'
import { createBodyLease, type BodyOwner, type BodyOwnerKind, type BodyUtilityFactors } from './mc-body-lease'

export type ActionOutcome = 'done' | 'partial' | 'blocked' | 'noop' | 'interrupted' | 'timeout'

/** 期望的后置状态——一律写成**对世界的陈述**（不带人称），便于回读核验。 */
export type Expectation =
  | { kind: 'has'; item: string; count: number }
  | { kind: 'holding'; item: string }
  | { kind: 'near'; at: [number, number, number]; within: number }
  | { kind: 'blockAt'; at: [number, number, number]; became: string }

export interface ExpectVerdict {
  met: boolean
  /** 详述（进受阻说明） */
  actual: string
  /** 极短读数（回显用）：一个数、一个物名、一个距离 */
  measured: string
  /** 相对执行前是否有增量（**已有存量不能证明本步产出**） */
  gain?: boolean
}

export interface ActionReceipt {
  id: string
  action: string
  at: number
  ms: number
  outcome: ActionOutcome
  /** 受阻/落空的人话原因；认不出的报错原文照留 */
  why?: string
  /** 受阻归属：服务端拒绝 vs 我们自己的问题（Cortico `blockedSourceOf`） */
  source?: 'server' | 'local'
  expect?: Expectation | null
  verdict?: ExpectVerdict | null
  /** 实测时刻（回执重放原读数，不重读世界） */
  readAt?: string
  /** 谁打断的（neko 的教训：不留痕查不出是谁在抢身体） */
  by?: string
  /** 动作输出摘要（前后各截 N 字符） */
  out?: string
}

/** 报错中文化：**认不出的原样保留**（排查后再补映射，别编）。 */
export function zhErrorText(msg: string): string {
  const m = msg ?? ''
  if (/path was stopped/i.test(m)) return '寻路半途被叫停'
  if (/took to+ long to decide/i.test(m)) return '限时内没算完'
  if (/no path|unreachable|cannot reach/i.test(m)) return '走不过去'
  if (/timeout|timed out/i.test(m)) return '超时'
  if (/not connected|connection/i.test(m)) return '连接断了'
  return m   // 认不出：原样保留
}

/** 受阻归属：显式声明是服务端的，其余一律算我们自己的问题。 */
export function blockedSourceOf(err: unknown): 'server' | 'local' {
  const e = err as { source?: 'server' | 'local' } | null
  return e?.source === 'server' ? 'server' : 'local'
}

/** 输出摘要：前后各截 maxChars（neko 的动作级摘要做法）。 */
export function summarizeOutput(text: unknown, maxChars = 250): string {
  const s = typeof text === 'string' ? text : String(text ?? '')
  if (s.length <= maxChars * 2) return s
  return `${s.slice(0, maxChars)}…（省略 ${s.length - maxChars * 2} 字）…${s.slice(-maxChars)}`
}

/** 期望渲染成一句**对世界的陈述**（进核验句）。 */
export function describeExpect(e: Expectation): string {
  switch (e.kind) {
    case 'has': return `背包内 ${e.item} ≥${e.count}`
    case 'holding': return `主手持有 ${e.item}`
    case 'near': return `距 (${e.at.join(',')}) ${e.within} 格内`
    case 'blockAt': return `(${e.at.join(',')}) 变成 ${e.became}`
  }
}

/** 核验句：按…核验:达成/落空(实测 X,读于 T)。 */
export function verdictNote(e: Expectation, v: ExpectVerdict, readAt?: string): string {
  const what = v.gain && e.kind === 'has' ? `这一步进包 ${e.item} ≥${e.count}` : describeExpect(e)
  return `按「${what}」核验:${v.met ? '达成' : '落空'}(实测 ${v.measured}${readAt ? `,读于 ${readAt}` : ''})`
}

/** 成功时的极短核验标记（≤10 字；让模型确认"真的发生了"，但别吃预算）。 */
export function shortVerdict(e: Expectation | null | undefined, v: ExpectVerdict | null | undefined): string {
  if (!e || !v) return ''
  if (e.kind === 'has') return v.met ? `核验✓ ${e.item}×${v.measured}` : `核验✗ 实测 ${v.measured}`
  if (e.kind === 'holding') return v.met ? `核验✓ 手持${e.item}` : `核验✗ 手上是${v.measured}`
  if (e.kind === 'near') return v.met ? '核验✓ 到位' : `核验✗ 还差 ${v.measured}`
  return v.met ? `核验✓ 已成 ${e.became}` : `核验✗ 实测 ${v.measured}`
}


// ─────────────────────────────────────────────────────────────────────────────
// 期望推导：从动作名 + 参数推出"应当出现的后置状态"（推不准就返回 null，交给工具自己说话）
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpectContext {
  /** 读背包某物品总数 */
  countItem: (name: string) => number
  /** 当前手持 */
  held: () => string | null
  /** 当前位置 */
  position: () => { x: number; y: number; z: number } | null
  /** 读某格方块名 */
  blockNameAt: (x: number, y: number, z: number) => string | null
}

const num = (v: unknown, d = 1): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/**
 * 只给我们**确知**的那些动作推期望（不猜）。
 * 目前覆盖：mc_collect/mc_craft/mc_take_chest（进包数量）、mc_equip（手持）、mc_goto（到位）。
 * 其余（dig/place/attack/smelt/eat/pickup/sleep/tunnel…）参数语义不足以断言，一律返回 null。
 */
export function deriveExpect(action: string, args: Record<string, unknown>): Expectation | null {
  // ⚠️ 参数名要认全：真跑发现 mc_collect 用的是 `blockType`（不是 item/block），
  // 认漏的后果是"collected 0"这种完美 noop 案例被漏检 —— 旗舰功能白做。
  const item = typeof args.item === 'string' ? args.item
    : typeof args.blockType === 'string' ? args.blockType
      : typeof args.block === 'string' ? args.block : ''
  switch (action) {
    case 'mc_collect':
      return item ? { kind: 'has', item, count: num(args.count, 1) } : null
    case 'mc_dig':
      return item ? { kind: 'has', item, count: num(args.count, 1) } : null
    case 'mc_craft':
      return item ? { kind: 'has', item, count: num(args.count, 1) } : null
    case 'mc_take_chest':
      return item ? { kind: 'has', item, count: num(args.count, 1) } : null
    case 'mc_equip':
      return item ? { kind: 'holding', item } : null
    case 'mc_goto': {
      const x = args.x, y = args.y, z = args.z
      return typeof x === 'number' && typeof y === 'number' && typeof z === 'number'
        ? { kind: 'near', at: [x, y, z], within: 2 }
        : null
    }
    default:
      return null
  }
}

/** 名字匹配（兼容命名空间与后缀匹配：“iron_ingot” ↔ “minecraft:iron_ingot” ↔ 带前缀物品） */
export function matchItemName(want: string, got: string | null | undefined): boolean {
  if (!want || !got) return false
  const a = want.replace(/^minecraft:/, '')
  const b = got.replace(/^minecraft:/, '')
  return a === b || b.endsWith(`_${a}`) || a.endsWith(`_${b}`)
}

/** 回读世界，得到核验结论（`before` 是执行前的同量纲读数，用来算**本步增量**）。 */
export function readExpectation(e: Expectation, ctx: ExpectContext, before?: number | null): ExpectVerdict {
  switch (e.kind) {
    case 'has': {
      const n = ctx.countItem(e.item)
      const gain = typeof before === 'number' ? n > before : undefined
      return { met: n >= e.count, actual: `背包里 ${e.item} 有 ${n} 个（判据 ≥${e.count}）`, measured: String(n), ...(gain !== undefined ? { gain } : {}) }
    }
    case 'holding': {
      const held = ctx.held()
      return { met: !!held && matchItemName(e.item, held), actual: held ? `主手是 ${held}` : '主手是空的', measured: held ?? '空手' }
    }
    case 'near': {
      const p = ctx.position()
      if (!p) return { met: false, actual: '读不到位置', measured: '未知' }
      const d = Math.hypot(p.x - e.at[0], p.y - e.at[1], p.z - e.at[2])
      return { met: d <= e.within + 0.5, actual: `距目标 ${d.toFixed(1)} 格（判据 ≤${e.within}）`, measured: `${Math.round(d)}格` }
    }
    case 'blockAt': {
      const got = ctx.blockNameAt(e.at[0], e.at[1], e.at[2])
      return { met: !!got && matchItemName(e.became, got), actual: `那格现在是 ${got ?? '读数不可用'}`, measured: got ?? '不可用' }
    }
  }
}

/** 执行前给"要有增量"的期望取基线（**已有存量不能证明本步产出**）。 */
export function baselineFor(e: Expectation | null, ctx: ExpectContext): number | null {
  if (!e) return null
  return e.kind === 'has' ? ctx.countItem(e.item) : null
}

/** 终态判定：期望达成 → done；有增量但没到量 → partial；完全没变 → **noop**。 */
/**
 * 工具结果里「自己说失败」的特征（工具不抛错、而是把错误写进返回内容）。
 * 真跑证据：mc_see 成功时返回 `{message, images}`（图块对象），失败时返回
 * `{message: "tool error: mc_see unavailable — 视觉操作超时…"}` —— 只认字符串会把后者记成 done ✗。
 */
export function looksLikeToolError(result: unknown): boolean {
  const probe = (): string => {
    if (typeof result === 'string') return result
    if (result && typeof result === 'object') {
      const m = (result as { message?: unknown }).message
      if (typeof m === 'string') return m
      const s = (result as { text?: unknown }).text
      if (typeof s === 'string') return s
    }
    return ''
  }
  const raw = probe().trim()
  if (!raw) return false
  if (raw.startsWith('tool error:') || raw.startsWith('ERROR:')) return true
  return /unavailable|not connected|尚未|失败|超时|timeout/i.test(raw.slice(0, 120)) && raw.length < 400
}

export function classifyOutcome(input: {
  threw?: boolean
  timedOut?: boolean
  interrupted?: boolean
  /** 工具没抛错、但返回串里自己说失败（真跑：mc_see 超时返回 "tool error: …"） */
  toolSaidError?: boolean
  expect?: Expectation | null
  verdict?: ExpectVerdict | null
}): ActionOutcome {
  if (input.timedOut) return 'timeout'
  if (input.interrupted) return 'interrupted'
  if (input.threw || input.toolSaidError) return 'blocked'
  if (!input.expect || !input.verdict) return 'done'
  if (input.verdict.met) return 'done'
  return input.verdict.gain ? 'partial' : 'noop'
}

// ─────────────────────────────────────────────────────────────────────────────
// 受阻账 + 头名统计 + 先验结果记忆（Cortico blockedHeadline / PriorOutcome）
// ─────────────────────────────────────────────────────────────────────────────

export interface BlockedEntry { at: number; action: string; outcome: ActionOutcome; why: string; key?: string }

export interface BlockedLedgerConfig {
  /** 先验记忆窗口（同类任务近期未达成 → 重试前先提醒） */
  priorWindowMs?: number
  /** 头名统计窗口与起报门槛（低于门槛不出声，避免噪声） */
  headlineWindowMs?: number
  headlineMin?: number
  size?: number
}

export function createBlockedLedger(cfg: BlockedLedgerConfig = {}) {
  const priorWindowMs = cfg.priorWindowMs ?? 15 * 60_000
  const headlineWindowMs = cfg.headlineWindowMs ?? 60 * 60_000
  const headlineMin = cfg.headlineMin ?? 5
  const cap = cfg.size ?? 400
  const entries: BlockedEntry[] = []

  const ledger = {
    record(r: ActionReceipt): void {
      if (r.outcome === 'done') return
      const why = r.why ?? (r.verdict ? verdictNote(r.expect as Expectation, r.verdict) : r.outcome)
      entries.push({ at: r.at, action: r.action, outcome: r.outcome, why })
      if (entries.length > cap) entries.splice(0, entries.length - cap)
    },
    /** 同类动作近期是否已经栽过（重试前先提醒；**只报否定**） */
    priorFailure(action: string, now = Date.now()): { count: number; why: string; outcome: ActionOutcome } | null {
      const hit = entries.filter((e) => e.action === action && now - e.at <= priorWindowMs)
      if (hit.length === 0) return null
      const last = hit[hit.length - 1]
      return { count: hit.length, why: last.why, outcome: last.outcome }
    },
    /** 头名统计：最近最常卡在哪（窗口 + 门槛；低于门槛不出声） */
    headline(now = Date.now()): Array<{ why: string; count: number }> {
      const inWin = entries.filter((e) => now - e.at <= headlineWindowMs)
      const tally = new Map<string, number>()
      for (const e of inWin) tally.set(e.why, (tally.get(e.why) ?? 0) + 1)
      return [...tally.entries()]
        .filter(([, n]) => n >= headlineMin)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([why, count]) => ({ why, count }))
    },
    /** noop/blocked 连击（喂指引队列：这招最近不管用） */
    streak(action: string, now = Date.now()): number {
      let n = 0
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].action !== action) continue
        if (now - entries[i].at > priorWindowMs) break
        if (entries[i].outcome === 'done') break
        n++
      }
      return n
    },
    all: () => entries.slice(),
    size: () => entries.length,
  }
  return ledger
}

// ─────────────────────────────────────────────────────────────────────────────
// 前置闸：每步至多一条、hard 优先 soft、**只报否定**、只报事实不改任务
// ─────────────────────────────────────────────────────────────────────────────

export interface PrecheckNote { severity: 'hard' | 'soft'; why: string }

/** 会往包里加东西的动作（决定"包满"这条提示要不要出） */
const ADDS_ITEMS = new Set(['mc_collect', 'mc_craft', 'mc_take_chest', 'mc_pickup', 'mc_smelt', 'mc_dig', 'mc_tunnel'])

export function precheckAction(action: string, args: Record<string, unknown>, facts: {
  emptySlots: number
  heldDurabilityRatio: number | null
  hasItem: (name: string) => boolean
}): PrecheckNote | null {
  // hard：包一个空位都没有、而这动作又要往里装东西 —— 这是确定会失败，值得拒绝在动手之前
  if (ADDS_ITEMS.has(action) && facts.emptySlots === 0) {
    return { severity: 'hard', why: '背包一个空位都没有了，这一趟装不下——先卸货或合并同类再动手' }
  }
  // soft：包快满（阈值取 Cortico 的 BAG_LOW_FREE=5）
  if (ADDS_ITEMS.has(action) && facts.emptySlots > 0 && facts.emptySlots <= 5) {
    return { severity: 'soft', why: `背包只剩 ${facts.emptySlots} 个空位，这一趟可能中途装不下` }
  }
  // soft：手持工具快坏了（挖/砍类）
  if ((action === 'mc_dig' || action === 'mc_tunnel' || action === 'mc_collect') && facts.heldDurabilityRatio !== null && facts.heldDurabilityRatio <= 0.15) {
    return { severity: 'soft', why: `手上工具耐久只剩 ${Math.round(facts.heldDurabilityRatio * 100)}%，可能中途报废` }
  }
  const item = typeof args.item === 'string' ? args.item : ''
  if (action === 'mc_equip' && item && !facts.hasItem(item)) {
    return { severity: 'soft', why: `背包里没有 ${item}，这一装会落空` }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// 早停条件（Cortico until.ts）：名字→方块 id；**认不出的不许静默吃掉**
// ─────────────────────────────────────────────────────────────────────────────

export const UNTIL_DEFAULT_HAZARDS = ['lava', 'water', 'fire'] as const
/** 行军途中扫早停的半径 / 挖通道时扫的半径（取 Cortico 的原值） */
export const UNTIL_TRAVEL_RADIUS = 16
export const UNTIL_DIG_RADIUS = 4

export function untilText(until: readonly string[] | undefined): string {
  if (!until?.length) return ''
  return `,碰到${until.join('/')}就停`
}

/** 把名字映射成方块名集合；认不出的名字要**报出来**（静默吃掉参数是这条链上最贵的一类失败）。 */
export function resolveUntil(until: readonly string[], known: (name: string) => boolean): { names: string[]; unknown: string[] } {
  const names: string[] = []
  const unknown: string[] = []
  for (const raw of until) {
    const n = raw.replace(/^minecraft:/, '')
    if (known(n)) names.push(n)
    else unknown.push(n)
  }
  return { names, unknown }
}

export function untilUnknownNote(unknown: readonly string[]): string {
  return unknown.length ? `(早停名单里 ${unknown.join('、')} 认不出来，这几样没算进去)` : ''
}


// ─────────────────────────────────────────────────────────────────────────────
// 执行门面：一次动作 = 闸 → 执行 → 回读核验 → 回执 → 账本
// ─────────────────────────────────────────────────────────────────────────────

/** 执行层要用到的世界事实（由调用方注入，便于单测）。 */
export interface ExecutionFacts {
  emptySlots: number
  heldDurabilityRatio: number | null
}

export interface RunContext {
  action: string
  args: Record<string, unknown>
  expectCtx: ExpectContext
  facts: ExecutionFacts
  /** 真正执行（我们的工具体） */
  exec: () => Promise<unknown>
  /** 谁在跑（租约用）：LLM 工具调用默认 'goal'；反射层传 'reflex' */
  ownerKind?: BodyOwnerKind
  owner?: BodyOwner
  intent?: string
  utility?: Partial<BodyUtilityFactors>
  /** 早停名单（可选；只解析与点名，真正的巡检由工具内部按需实现） */
  until?: readonly string[]
  knownBlock?: (name: string) => boolean
  /** 回执回调（用于接指引队列 / decision_trace） */
  onReceipt?: (r: ActionReceipt) => void
}

export interface RunResult { result: unknown; receipt: ActionReceipt; notes: string[] }

export interface ExecutionLayerOptions {
  /**
   * 回执落盘目录。**可以是函数**：插件里 dataDir 常在 apply 后段才赋值，
   * 闭包创建时就捕获会拿到赋值前的默认值（2026-09-20 真跑踩过：回执写丢了）。
   */
  dataDir?: string | (() => string)
  lease?: ReturnType<typeof createBodyLease>
  ledger?: ReturnType<typeof createBlockedLedger>
  now?: () => number
}

/** LLM 工具调用的默认效用（可被调用方覆盖）：可行性与连续性偏高，破坏性低。 */
/** ⚠️ 0..10 量纲（见 mc-body-lease.ts 的说明）；破坏性取小正数表示「会打断当前动作」。 */
export const DEFAULT_TOOL_UTILITY: Partial<BodyUtilityFactors> = {
  survival: 2, urgency: 3, feasibility: 10, progress: 5, continuity: 4, disruption: 1,
}

export function createExecutionLayer(opts: ExecutionLayerOptions = {}) {
  const now = opts.now ?? (() => Date.now())
  const ledger = opts.ledger ?? createBlockedLedger()
  const lease = opts.lease
  let seq = 0

  return {
    ledger,
    lease,
    /** 跑一次动作，返回 { 原结果, 回执, 提示 }。**不改动作语义**：只在前后加闸与核验。 */
    async run(ctx: RunContext): Promise<RunResult> {
      const at = now()
      const notes: string[] = []
      const id = `a${++seq}`
      const owner: BodyOwner = ctx.owner ?? {}
      const finish = (r: ActionReceipt, result: unknown): RunResult => {
        ledger.record(r)
        try { ctx.onReceipt?.(r) } catch { /* 回调失败不影响动作 */ }
        const dir = typeof opts.dataDir === 'function' ? opts.dataDir() : opts.dataDir
        if (dir) appendJsonl(dir, 'execution.jsonl', r)
        return { result, receipt: r, notes }
      }

      // ① 租约（当前无竞争者 ⇒ 不会拒绝；反射层上线后抢占/留痕自动生效）
      if (lease) {
        const d = lease.propose({
          owner, ownerKind: ctx.ownerKind ?? 'goal', intent: ctx.intent ?? ctx.action,
          utility: { ...DEFAULT_TOOL_UTILITY, ...(ctx.utility ?? {}) },
        })
        if (!d.granted) {
          const why = d.reason === 'reflex-not-safety'
            ? '反射层不许以非安全理由抢身体'
            : `身体被占用（${d.reason}${d.incumbent ? `：正在 ${d.incumbent.intent}` : ''}）`
          return finish({ id, action: ctx.action, at, ms: 0, outcome: 'blocked', why, source: 'local' }, `（未执行：${why}）`)
        }
      }

      try {
        // ② 早停名单：认不出的名字要点名（不许静默吃掉参数）
        if (ctx.until?.length) {
          const { unknown } = resolveUntil(ctx.until, ctx.knownBlock ?? (() => false))
          const n = untilUnknownNote(unknown)
          if (n) notes.push(`（先提醒：${n}）`)
        }

        // ③ 前置闸：hard → 不动手；soft → **只报事实**，照常执行
        const pre = precheckAction(ctx.action, ctx.args, {
          emptySlots: ctx.facts.emptySlots,
          heldDurabilityRatio: ctx.facts.heldDurabilityRatio,
          hasItem: (n) => ctx.expectCtx.countItem(n) > 0,
        })
        if (pre?.severity === 'hard') {
          return finish({ id, action: ctx.action, at, ms: 0, outcome: 'blocked', why: pre.why, source: 'local' }, `（未执行：${pre.why}）`)
        }
        if (pre) notes.push(`（先提醒：${pre.why}）`)

        // ④ 先验结果记忆：这招最近栽过就提醒（只报否定）
        const prior = ledger.priorFailure(ctx.action, at)
        if (prior) notes.push(`（这招最近 ${prior.count} 次没做成：${prior.why}）`)

        // ⑤ 执行 + 计时
        const expect = deriveExpect(ctx.action, ctx.args)
        const baseline = baselineFor(expect, ctx.expectCtx)
        const t0 = now()
        let result: unknown = null
        let threw: unknown = null
        try { result = await ctx.exec() } catch (e) { threw = e }
        const ms = now() - t0

        // ⑥ 回读核验（只读当下；读的时刻进回执）
        let verdict: ExpectVerdict | null = null
        if (expect && !threw) {
          try { verdict = readExpectation(expect, ctx.expectCtx, baseline) } catch { verdict = null }
        }
        const toolSaidError = !threw && looksLikeToolError(result)
        const outcome = classifyOutcome({ threw: !!threw, toolSaidError, expect, verdict })
        let why: string | undefined
        const note = verdict && expect ? verdictNote(expect, verdict) : ''
        if (threw) why = zhErrorText(threw instanceof Error ? threw.message : String(threw))
        else if (toolSaidError) why = `工具自己报了失败：${summarizeOutput(result, 120)}`
        else if (outcome === 'noop') why = `工具说做完了，但世界没变${note ? `（${note}）` : ''}`
        else if (outcome === 'partial') why = note || undefined

        const receipt: ActionReceipt = {
          id, action: ctx.action, at, ms, outcome,
          ...(why ? { why } : {}),
          ...(threw ? { source: blockedSourceOf(threw) } : {}),
          expect, verdict,
          ...(verdict ? { readAt: new Date(now()).toISOString().slice(11, 19) } : {}),
          out: summarizeOutput(typeof result === 'string' ? result : JSON.stringify(result ?? '')),
        }
        const streak = ledger.streak(ctx.action, at)
        if (streak >= 2) notes.push(`（这招连着 ${streak} 次没进展了，建议换个法子）`)
        return finish(receipt, result)
      } finally {
        try { lease?.release(owner) } catch { /* 释放失败不影响动作 */ }
      }
    },
  }
}
