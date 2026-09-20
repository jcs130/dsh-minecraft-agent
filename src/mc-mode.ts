/**
 * mc-mode —— 模式与态势分类层（快决策的第二个用法）。
 *
 * 用户口径（2026-09-20）：「jev 模型作为快速分类器，其实可以不仅仅用于动作选择，
 * 还可以选择一些模式，比如危险程度、模式切换之类的」。
 *
 * 依据：
 *   · 微信公众号那篇 Jev 自动驾驶实测：「**Jev 不是自回归，本质上是一个分类器**」；
 *     决策 = 从 6 个候选动作里选 + **额外判断「要不要停下等待」「是否被堵死」**（并列判断）；
 *     还做了 A/B：换成自回归 LLM「又慢、卡在狭缝、任务失败」。
 *   · jev-craft：`threat_level` 用 Score(5 档) 与动作选择**并列**问，一次调用四问。
 *   · 我们的 body-lease：模式切换同样需要**迟滞余量**（不然会在两个模式间抖）。
 *
 * 本模块给快决策加了第二种用法：不问"做什么"，而问"现在算什么局面"——
 *   `mode`   模式（九种行为体制：探索/采集/赶路/避险/逃跑/战斗/复原/社交/待命）
 *   `danger` 危险程度（5 档 Score，独立于模式：避险模式也可能只是 1 档）
 *   `stalled` **是否卡住/该换法子**（并列判断，照文章那个"是否被堵死"）
 *
 * 三种影响方式（分类结果必须能驱动行为，否则只是标签）：
 *   ① 进上下文（一条 `【模式】…` 行，随指引队列原地更新）
 *   ② **决定节奏**：危险越高、快决策越勤（安全时 2s；high/critical 时 600ms）
 *   ③ 模式切换有**迟滞**：驻留下限 + 分布余量；但 **danger ≥ high 可无视驻留**（保命不排队）
 *
 * 纪律：分类器不可用时**一律退回确定性启发式**（我们的 worldModel 里已经有威胁分级/瘫痪三态/
 * 防御姿态，足够撑起一个不瞎的降级路径），绝不因为分类服务不可用而卡住。
 */
// ─────────────────────────────────────────────────────────────────────────────
// 模式与危险度
// ─────────────────────────────────────────────────────────────────────────────

export type ModeId =
  | 'explore' | 'gather' | 'travel' | 'shelter' | 'flee' | 'fight' | 'recover' | 'social' | 'idle'

export interface ModeSpec { id: ModeId; zh: string; when: string }

/** 九种行为体制。`when` 就是给分类器的 criteria 文本（写"何时适用"）。 */
export const MODES: readonly ModeSpec[] = [
  { id: 'explore', zh: '探索', when: '世界安全、有精力、想看看新地方或找资源' },
  { id: 'gather', zh: '采集', when: '有明确的产出目标（挖/砍/采/合成），环境安全' },
  { id: 'travel', zh: '赶路', when: '主要是长距离移动去某个已知地点' },
  { id: 'shelter', zh: '避险', when: '夜晚/危险但还没到必须跑，先找安全处待着（挖洞、进屋、靠墙）' },
  { id: 'flee', zh: '逃跑', when: '被围殴、濒死、贴脸苦力怕——活着比什么都重要' },
  { id: 'fight', zh: '战斗', when: '必须打（被堵死/退无可退）或打得赢且打掉更划算' },
  { id: 'recover', zh: '复原', when: '饥饿/受伤/溺水/工具报废——先把状态补回来' },
  { id: 'social', zh: '社交', when: '有人（玩家/观众/神谕）在跟你说话，值得回应' },
  { id: 'idle', zh: '待命', when: '无事可做、目标不明、或刚被打断需要重新想' },
] as const

export type DangerLevel = 0 | 1 | 2 | 3 | 4

/** 五档危险度（Score 的档位描述；写具体局面，照 TypeSafe 的 criteria 纪律）。 */
export const DANGER_LEVELS: readonly string[] = [
  '安全——没有威胁，血量食物都够',
  '留意——有轻微威胁或天要黑了',
  '中度——有怪靠近但可控，或者状态在下滑',
  '高危——近处强敌/血量很低/多只围上来',
  '危急——不加干预马上会死（濒死、贴脸苦力怕、溺水）',
] as const

export const DANGER_ZH: Record<DangerLevel, string> = { 0: '安全', 1: '留意', 2: '中度', 3: '高危', 4: '危急' }

// ─────────────────────────────────────────────────────────────────────────────
// 模式机（带迟滞；危险时保命优先，不排队）
// ─────────────────────────────────────────────────────────────────────────────

export interface ModeConfig {
  /** 模式最少驻留多久才允许换（保命除外） */
  minDwellMs?: number
  /** 新模式的分布概率要超出当前模式这么多才换（分布余量，防抖） */
  switchMargin?: number
  /** 危险到这一档就无视驻留与余量，立刻允许切换 */
  emergencyDanger?: DangerLevel
}

export interface ModeDecision {
  at: number
  mode: ModeId
  danger: DangerLevel
  stalled: boolean
  /** 本轮是否真的换了模式 */
  switched: boolean
  /** 为什么（人话，进上下文与审计） */
  why: string
  /** 判断来自哪条路 */
  source: 'classifier' | 'heuristic'
  /** 建议的快决策间隔（毫秒）：危险越高越勤 */
  tickMs: number
}

export function createModeMachine(cfg: ModeConfig = {}) {
  const minDwellMs = cfg.minDwellMs ?? 20_000
  const switchMargin = cfg.switchMargin ?? 0.2
  const emergency = cfg.emergencyDanger ?? 3
  let current: ModeId | null = null
  let since = 0

  return {
    current: () => current,
    dwellMs: (now = Date.now()): number => (current ? now - since : 0),

    /**
     * 决定当前模式。`probs` 是分类器给的模式分布（可缺省 → 只看建议模式）。
     * 迟滞规则：① 危险 ≥ emergency ⇒ 立刻换（保命不排队）
     *           ② 否则要过驻留下限，且新模式的概率要超出当前模式 switchMargin
     */
    decide(input: { mode: ModeId; danger: DangerLevel; stalled: boolean; probs?: Record<string, number>; source: 'classifier' | 'heuristic' }, now = Date.now()): ModeDecision {
      const { mode, danger, stalled } = input
      const tickMs = tickFor(danger)
      if (current === null) {
        current = mode; since = now
        return { at: now, mode, danger, stalled, switched: true, why: `首次确立模式：${zhOf(mode)}`, source: input.source, tickMs }
      }
      if (mode === current) {
        return { at: now, mode: current, danger, stalled, switched: false, why: `维持${zhOf(current)}（已 ${Math.round((now - since) / 1000)}s）`, source: input.source, tickMs }
      }
      const dwell = now - since
      const emergencyNow = danger >= emergency
      if (!emergencyNow && dwell < minDwellMs) {
        return { at: now, mode: current, danger, stalled, switched: false, why: `想换到${zhOf(mode)}，但${zhOf(current)}才 ${Math.round(dwell / 1000)}s（驻留下限 ${Math.round(minDwellMs / 1000)}s）`, source: input.source, tickMs }
      }
      if (!emergencyNow && input.probs) {
        const pNew = input.probs[mode] ?? 0
        const pCur = input.probs[current] ?? 0
        if (pNew - pCur < switchMargin) {
          return { at: now, mode: current, danger, stalled, switched: false, why: `想换到${zhOf(mode)}，但分布余量不足（${pNew.toFixed(2)} vs ${pCur.toFixed(2)}，需差 ${switchMargin}）`, source: input.source, tickMs }
        }
      }
      const from = current
      current = mode; since = now
      return {
        at: now, mode, danger, stalled, switched: true,
        why: `${zhOf(from)} → ${zhOf(mode)}${emergencyNow ? '（危险已达' + DANGER_ZH[danger] + '，保命优先）' : ''}`,
        source: input.source, tickMs,
      }
    },

    reset(): void { current = null; since = 0 },
  }
}

export function zhOf(m: ModeId): string {
  return MODES.find((x) => x.id === m)?.zh ?? m
}

/** 快决策间隔：危险越高越勤（安全 2s / 留意 1.5s / 中度 1s / 高危 600ms / 危急 500ms）。 */
export function tickFor(danger: DangerLevel): number {
  return [2000, 1500, 1000, 600, 500][danger] ?? 2000
}

// ─────────────────────────────────────────────────────────────────────────────
// 确定性降级：分类器不在时，用 worldModel 的派生判断撑起一个不瞎的答案
// ─────────────────────────────────────────────────────────────────────────────

export interface ModeStateInput {
  hp: number
  food: number
  oxygen: number
  isNight: boolean
  /** 世界模型里的威胁分级 */
  actionableThreats: number
  nearestThreatDistance: number
  creeperDistance: number
  /** 世界模型里的瘫痪三态 */
  starving: boolean
  longStall: boolean
  trappedInDeathZone: boolean
  hasEdible: boolean
  /** 有人说话吗（观众/聊天/NPC） */
  socialPending: boolean
  /** 有明确目标吗 */
  hasGoal: boolean
}

export interface ModeAdvice {
  mode: ModeId
  danger: DangerLevel
  stalled: boolean
  why: string
  source: 'classifier' | 'heuristic'
  probs?: Record<string, number>
}

/** 纯函数启发式（可单测）：危险优先，其次保命，再次目标与社交。 */
export function heuristicMode(s: ModeStateInput): ModeAdvice {
  const danger: DangerLevel = (() => {
    if (s.oxygen <= 5 || s.hp <= 6 || (s.creeperDistance >= 0 && s.creeperDistance <= 4)) return 4
    if (s.hp <= 10 || s.actionableThreats >= 3) return 3
    if (s.actionableThreats >= 1 || s.food <= 6 || s.trappedInDeathZone) return 2
    if (s.isNight || s.starving) return 1
    return 0
  })()
  const stalled = s.longStall || (s.actionableThreats === 0 && !s.hasGoal)
  const mode: ModeId = (() => {
    if (danger === 4) return s.actionableThreats > 0 ? 'flee' : 'recover'
    if (s.oxygen <= 6) return 'recover'
    if (s.hp <= 10 && s.actionableThreats > 0) return 'shelter'
    if (s.starving || (s.food <= 6 && !s.hasEdible)) return 'recover'
    if (danger >= 3 && s.actionableThreats >= 2) return 'flee'
    if (danger >= 2 && s.isNight) return 'shelter'
    if (s.socialPending) return 'social'
    if (danger >= 2 && s.actionableThreats === 1) return 'fight'
    if (!s.hasGoal) return 'idle'
    if (s.isNight) return 'shelter'
    return 'gather'
  })()
  const why = `启发式：危险${DANGER_ZH[danger]}（威胁 ${s.actionableThreats}、最近 ${s.nearestThreatDistance < 0 ? '无' : s.nearestThreatDistance + '格'}、血 ${s.hp}、饥 ${s.food}）`
  return { mode, danger, stalled, why, source: 'heuristic' }
}

/** 渲染成一行（进指引队列的常驻项：原地更新，永远只有一行）。 */
export function renderMode(d: ModeDecision, dwellMs: number): string {
  const parts = [`当前模式：**${zhOf(d.mode)}**（已驻留 ${Math.round(dwellMs / 1000)}s）`, `危险度 ${d.danger}/4 ${DANGER_ZH[d.danger]}`]
  if (d.stalled) parts.push('⚠可能卡住了')
  parts.push(`决策节奏 ${d.tickMs}ms`)
  parts.push(d.why)
  return `【模式】${parts.join('｜')}`
}


// ─────────────────────────────────────────────────────────────────────────────
// 分类器一问三题：模式 / 危险度 / 是否卡住（**并列判断**，照那篇 Jev 自驾文章的"是否被堵死"）
// ─────────────────────────────────────────────────────────────────────────────

export interface ModeQuestionDeps {
  /** 注入的分类器调用（便于单测；生产传 callSystemOne） */
  call: (state: Record<string, unknown>, questions: Record<string, unknown>) => Promise<{ answers: Record<string, { type: string; choice?: string; score?: number; noul?: number; probabilities?: Record<string, number>; confidence?: number }> }>
}

/** 构建三个问题（纯函数，可单测）：instructions 写判断、criteria 定义可能答案。 */
export function buildModeQuestions(s: ModeStateInput, ctx: {
  modeList: readonly ModeSpec[]
  dangerLevels: readonly string[]
  extra?: Record<string, unknown>
}): { state: Record<string, unknown>; questions: Record<string, unknown> } {
  const situation = [
    `HP ${s.hp}/20, hunger ${s.food}/20, oxygen ${s.oxygen}/10.`,
    `Time: ${s.isNight ? 'night' : 'day'}.`,
    `Actionable hostiles: ${s.actionableThreats}${s.nearestThreatDistance >= 0 ? `, nearest ${s.nearestThreatDistance} blocks` : ''}${s.creeperDistance >= 0 ? `, creeper ${s.creeperDistance} blocks` : ''}.`,
    `Starving: ${s.starving ? 'yes' : 'no'}; has food: ${s.hasEdible ? 'yes' : 'no'}.`,
    `Long stall: ${s.longStall ? 'yes' : 'no'}; trapped in a known death zone: ${s.trappedInDeathZone ? 'yes' : 'no'}.`,
    `Someone is talking to the bot: ${s.socialPending ? 'yes' : 'no'}.`,
    `Has an active goal: ${s.hasGoal ? 'yes' : 'no'}.`,
  ].join(' ')
  const modeCriteria: Record<string, string> = {}
  for (const m of ctx.modeList) modeCriteria[m.id] = `${m.zh} — ${m.when}`
  return {
    state: { situation, ...(ctx.extra ?? {}) },
    questions: {
      mode: {
        type: 'choice',
        instructions: `What behavioral mode should the bot adopt right now? ${situation} Pick the mode that best fits the whole situation.`,
        criteria: modeCriteria,
      },
      danger: {
        type: 'score',
        instructions: `How dangerous is the bot's situation right now? ${situation}`,
        criteria: [...ctx.dangerLevels],
      },
      stalled: {
        type: 'noul',
        instructions: `Does the bot look stuck — repeating a failing approach, or unable to make progress? ${situation}`,
        criteria: { true: 'Stuck: repeating a failing approach or making no progress', false: 'Not stuck: work is progressing normally' },
      },
    },
  }
}

export interface DecideModeDeps {
  machine: ReturnType<typeof createModeMachine>
  /** 分类器（可缺省 → 直接走启发式） */
  classifier?: ModeQuestionDeps
  now?: () => number
}

export interface DecideModeResult extends ModeDecision {
  /** 分类器不可用时的原因（审计用） */
  classifierError?: string
}

/** 问一次"现在算什么局面"，过模式机（迟滞），返回本轮模式决策。失败一律降级启发式。 */
export async function decideMode(s: ModeStateInput, deps: DecideModeDeps, extraState?: Record<string, unknown>): Promise<DecideModeResult> {
  const now = deps.now ?? (() => Date.now())
  let advice: ModeAdvice
  let classifierError: string | undefined
  if (deps.classifier) {
    try {
      const { state, questions } = buildModeQuestions(s, { modeList: MODES, dangerLevels: DANGER_LEVELS, extra: extraState })
      const r = await deps.classifier.call(state, questions)
      const modeAns = r.answers.mode
      const dangerAns = r.answers.danger
      const stalledAns = r.answers.stalled
      if (modeAns?.type === 'choice' && typeof modeAns.choice === 'string' && MODES.some((m) => m.id === modeAns.choice)) {
        const dangerRaw = typeof dangerAns?.score === 'number' ? dangerAns.score : 0
        advice = {
          mode: modeAns.choice as ModeId,
          danger: Math.max(0, Math.min(4, Math.round(dangerRaw))) as DangerLevel,
          stalled: (stalledAns?.noul ?? 0) >= 0.5,
          why: `分类器：模式 ${zhOf(modeAns.choice as ModeId)}（p=${(modeAns.probabilities?.[modeAns.choice] ?? modeAns.confidence ?? 0).toFixed(2)}）｜危险 ${dangerRaw.toFixed(2)}/4`,
          source: 'classifier',
          probs: modeAns.probabilities,
        }
      } else {
        classifierError = `分类器没给出合法模式（${String(modeAns?.choice)}）`
        advice = heuristicMode(s)
      }
    } catch (e) {
      classifierError = e instanceof Error ? e.message : String(e)
      advice = heuristicMode(s)
    }
  } else {
    advice = heuristicMode(s)
  }
  const d = deps.machine.decide(advice, now())
  return { ...d, ...(classifierError ? { classifierError } : {}) }
}
