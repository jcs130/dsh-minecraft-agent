/**
 * mc-decider —— 本地 System One（Jev 系）快决策客户端 + 决策保鲜层。
 *
 * 参考实现（本轮研读，2026-09-20）：
 *   - `akash-kamat/jev-craft`：每 600ms 一次并行四问（threat_level/action/should_eat/flee_direction），
 *     "**code owns the workflow, the model supplies the common sense**"；恒定阈值命名化、目标防抖。
 *   - `ellistev/typesafe-minecraft-demo`：`fresh-decision.cjs`（陈旧答案**不重放只重观察**）、
 *     `validateAnswer`（选项集 + 每个键都要有概率且和≈1）、`observe`（地形状态枚举）。
 *   - TypeSafe 官方 skill 的纪律（我们已核对）：类型化答案**保证接口不保证真相**；
 *     Choice/Score 的 confidence 只是**分布集中度**，**不是行动许可**——阈值必须按后果分别校准。
 *
 * 本机实测（2026-09-20，`decider-dev` @ 127.0.0.1:8000）：
 *   一问四题并行一次调用：**暖态 190ms / 冷启 2463ms / 642 input tokens**，返回完整校准分布。
 *   协议与 typesafe 托管端点一致（POST /v1/systemone，请求/响应同形）⇒ 零 API 成本可用。
 *   **冷启 2.5s 必须预热**（见 prewarm()）。
 *
 * ⚠️ 本模块目前**尚未接进生产循环**（那是下一步「反射层」的事）：
 *   它是把 B（保鲜门）/C（严格校验）/E（命名阈值）/F（审计）四件**先做成可测的积木**。
 */
import { appendJsonl } from './mc-perception'

/** 阈值按**后果**分别校准，不共享一个"置信度"闸（官方纪律；jev-craft 同款命名）。 */
export const DECIDER_THRESHOLDS = {
  /** 吃：饱食度百分位低于此 + 有食物 + 非交战 → 吃 */
  eatFoodRatio: 0.6,
  /** 逃：flee 概率高于此 → 逃（逃错代价小，阈值可低） */
  fleeConfidence: 0.5,
  /** 打：fight 概率高于此（打错代价大，阈值更高） */
  fightConfidence: 0.6,
  /** 目标切换：urgency 高于此才换目标 */
  goalSwitchUrgency: 2.0,
  /** 目标防抖：一个目标至少活这么久才允许换（jev-craft minGoalTime） */
  minGoalTimeMs: 15_000,
  /** 决策有效期（demo `isFresh`：≤5s 且位移 <0.8 格） */
  freshMaxMs: 5000,
  freshMaxDisplacement: 0.8,
} as const

export interface ScoreAnswer { type: 'score'; score: number; confidence: number; certainty?: number; probabilities: Record<string, number> }
export interface ChoiceAnswer { type: 'choice'; choice: string; confidence: number; certainty?: number; probabilities: Record<string, number> }
export interface NoulAnswer { type: 'noul'; noul: number }
export type SystemOneAnswer = ScoreAnswer | ChoiceAnswer | NoulAnswer

export interface QuestionSpec {
  type: 'score' | 'choice' | 'noul'
  instructions: string
  /** choice 用 {label: 何时适用}；score 用有序档位描述数组；noul 用 {true,false} */
  criteria: Record<string, string> | string[]
}

export interface SystemOneResponse {
  model?: string
  answers: Record<string, SystemOneAnswer>
  usage?: { input_tokens?: number; output_tokens?: number }
}

export interface DeciderConfig {
  baseUrl: string
  model: string
  /** 单次请求超时（暖态 ~200ms，冷启 ~2.5s，故留足） */
  timeoutMs: number
  maxAttempts: number
  dataDir?: string
}

export function defaultDeciderConfig(): DeciderConfig {
  return {
    baseUrl: process.env.MC_DECIDER_URL ?? 'http://127.0.0.1:8000',
    model: process.env.MC_DECIDER_MODEL ?? 'decider-dev',
    timeoutMs: 8000,
    maxAttempts: 2,
  }
}

/** 可重试的 HTTP 状态（demo `decisionFresh` 同集合：429/500/502/503/504/529）。 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529])

const isRetryable = (err: unknown): boolean => {
  const e = err as { retryable?: boolean; status?: number }
  if (e?.retryable) return true
  return typeof e?.status === 'number' && RETRYABLE_STATUS.has(e.status)
}

/**
 * 严格校验分类答案（demo `validateAnswer` 的等价物 + 我们补的类型检查）。
 * 纪律：**类型化输出保证接口，不保证真相** —— 真相要在我们自己的场景里评估；
 * 但接口必须严格：选项集、概率覆盖、和≈1，任何一条不满足就抛错（宁可不行动）。
 */
export function validateAnswers(
  response: unknown,
  expected: Record<string, QuestionSpec>,
  sumTolerance = 0.03,
): SystemOneResponse {
  const r = response as SystemOneResponse | null
  const answers = r?.answers
  if (!answers || typeof answers !== 'object') throw new Error('decider: 响应里没有 answers')
  for (const [id, spec] of Object.entries(expected)) {
    const a = answers[id] as SystemOneAnswer | undefined
    if (!a) throw new Error(`decider: 缺少答案 ${id}`)
    if (a.type !== spec.type) throw new Error(`decider: 答案 ${id} 类型不符（期望 ${spec.type}，得到 ${a.type}）`)
    if (spec.type === 'noul') {
      const v = (a as NoulAnswer).noul
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new Error(`decider: ${id} 的 noul 不在 [0,1]`)
      continue
    }
    const probs = (a as ChoiceAnswer | ScoreAnswer).probabilities
    const keys = spec.type === 'choice' ? Object.keys(spec.criteria as Record<string, string>) : (spec.criteria as string[]).map((_, i) => String(i))
    if (!probs || typeof probs !== 'object') throw new Error(`decider: ${id} 缺少 probabilities`)
    for (const k of keys) {
      if (!Object.prototype.hasOwnProperty.call(probs, k)) throw new Error(`decider: ${id} 缺少概率键 ${k}`)
      const v = probs[k]
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new Error(`decider: ${id} 的概率 ${k} 非法（${String(v)}）`)
    }
    const got = Object.keys(probs)
    if (got.length !== keys.length || keys.some((k) => !got.includes(k))) throw new Error(`decider: ${id} 的概率键与允许集不符`)
    const sum = Object.values(probs).reduce((s2, v) => s2 + v, 0)
    if (Math.abs(sum - 1) > sumTolerance) throw new Error(`decider: ${id} 概率和 ${sum.toFixed(3)} 偏离 1 超过 ${sumTolerance}`)
    const conf = (a as ChoiceAnswer | ScoreAnswer).confidence
    if (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1) throw new Error(`decider: ${id} 的 confidence 非法`)
    if (spec.type === 'choice') {
      const c = (a as ChoiceAnswer).choice
      if (typeof c !== 'string' || !Object.prototype.hasOwnProperty.call(spec.criteria, c)) {
        throw new Error(`decider: ${id} 选了不在允许集里的选项 ${String(c)}`)
      }
    } else {
      const sc = (a as ScoreAnswer).score
      const n = (spec.criteria as string[]).length
      if (typeof sc !== 'number' || !Number.isFinite(sc) || sc < 0 || sc > n - 1) throw new Error(`decider: ${id} 的 score 超出档位范围`)
    }
  }
  return r as SystemOneResponse
}

/**
 * 从原始答案里取"代码要用的那个决定"（分布留在审计里，不在这里）。
 * ⚠️ 不要用 confidence 当"是否行动"的闸：见文件头纪律。阈值请用 DECIDER_THRESHOLDS 里的具名项。
 */
export function pickChoice(answer: ChoiceAnswer): string { return answer.choice }
export function pickScore(answer: ScoreAnswer): number { return answer.score }
export function pickNoul(answer: NoulAnswer): number { return answer.noul }

/**
 * 决策保鲜（demo `fresh-decision.cjs`）：观察 → 决策 → 再看一眼世界 → 只有仍然新鲜才交给执行器。
 * **被判陈旧的答案绝不重放，只重新观察。**
 */
export function isFresh(
  observed: { x: number; y: number; z: number },
  current: { x: number; y: number; z: number },
  elapsedMs: number,
  maxMs = DECIDER_THRESHOLDS.freshMaxMs,
  maxDisplacement = DECIDER_THRESHOLDS.freshMaxDisplacement,
): boolean {
  if (elapsedMs > maxMs) return false
  return Math.hypot(observed.x - current.x, observed.y - current.y, observed.z - current.z) < maxDisplacement
}

export interface DecideFreshDeps<TState, TAnswer> {
  observe: () => TState
  decide: (state: TState) => Promise<TAnswer>
  positionOf: (state: TState) => { x: number; y: number; z: number }
  position: () => { x: number; y: number; z: number }
  isActive?: () => boolean
  now?: () => number
  wait?: (ms: number) => Promise<void>
  maxAttempts?: number
  onDiscard?: (info: { state: TState; answer: TAnswer; elapsedMs: number; displacement: number; attempt: number }) => void
  onServiceError?: (info: { httpStatus: number | null; errorType: 'timeout' | 'http'; attempt: number; delayMs: number; retry: boolean }) => void
}

/** 保鲜循环：陈旧 → 重观察；服务错误 → 退避重试；最终失败 → 抛错且**不执行任何动作**。 */
export async function decideFresh<TState, TAnswer>(deps: DecideFreshDeps<TState, TAnswer>): Promise<{ state: TState; answer: TAnswer; elapsedMs: number } | null> {
  const maxAttempts = deps.maxAttempts ?? 3
  const now = deps.now ?? (() => Date.now())
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const active = deps.isActive ?? (() => true)
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (!active()) return null
    const state = deps.observe()
    const started = now()
    let answer: TAnswer
    try {
      answer = await deps.decide(state)
    } catch (error) {
      if (!active()) return null
      const err = error as { name?: string; status?: number }
      const timedOut = err?.name === 'TimeoutError'
      if (!timedOut && !isRetryable(error)) throw error
      const retry = attempt < maxAttempts
      const delayMs = retry ? 1000 * 2 ** (attempt - 1) : 0
      deps.onServiceError?.({ httpStatus: timedOut ? null : err?.status ?? null, errorType: timedOut ? 'timeout' : 'http', attempt, delayMs, retry })
      if (!retry) throw new Error('decider 连续失败，未执行任何动作（检查服务与日志）')
      await wait(delayMs)
      continue
    }
    if (!active()) return null
    const current = deps.position()
    const elapsedMs = now() - started
    const at = deps.positionOf(state)
    const displacement = Math.hypot(at.x - current.x, at.y - current.y, at.z - current.z)
    if (isFresh(at, current, elapsedMs)) return { state, answer, elapsedMs }
    deps.onDiscard?.({ state, answer, elapsedMs, displacement, attempt })
    if (attempt < maxAttempts) await wait(0)
  }
  throw new Error('连续三次观察到过期世界；被判陈旧的决策一个都没执行（见审计日志）')
}

export interface DeciderCallResult { answer: SystemOneAnswer; latencyMs: number; usage?: { input_tokens?: number; output_tokens?: number } }

/**
 * 调一次 System One（一问多题并行）——含超时、退避重试、严格校验、审计落盘。
 * 审计每次留 `{request, answer, raw, latencyMs}`（jev-craft/demo 都这么做：失败要能分清
 * 是"证据缺失 / 模型错 / 代码错 / 服务故障"）。
 */
export async function callSystemOne(
  state: Record<string, unknown>,
  questions: Record<string, QuestionSpec>,
  cfg: DeciderConfig = defaultDeciderConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<{ answers: Record<string, SystemOneAnswer>; latencyMs: number; usage?: SystemOneResponse['usage'] }> {
  const request = { model: cfg.model, state, questions }
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    const t0 = Date.now()
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
      let res: Response
      try {
        res = await fetchImpl(`${cfg.baseUrl}/v1/systemone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(request),
          signal: ctrl.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        const e = new Error(`decider HTTP ${res.status}`) as Error & { status: number }
        e.status = res.status
        throw e
      }
      const raw = (await res.json()) as SystemOneResponse
      const valid = validateAnswers(raw, questions)
      const latencyMs = Date.now() - t0
      if (cfg.dataDir) {
        // 瘦身：成功路径不再写 raw（answer 已含决定，raw 只是同样内容再来一遍）。
        // 真跑实测 decider.jsonl 1.2MB/10 分钟，砍掉 raw 约减半。
        appendJsonl(cfg.dataDir, 'decider.jsonl', {
          ts: new Date().toISOString(), latencyMs, attempt,
          request, answer: valid.answers, usage: valid.usage ?? null,
        })
      }
      return { answers: valid.answers, latencyMs, usage: valid.usage }
    } catch (err) {
      lastErr = err
      const name = (err as { name?: string }).name
      const timedOut = name === 'AbortError' || name === 'TimeoutError'
      const typed = err as { status?: number; retryable?: boolean }
      const retryable = timedOut || isRetryable(err)
      const latencyMs = Date.now() - t0
      if (cfg.dataDir) {
        appendJsonl(cfg.dataDir, 'decider.jsonl', {
          ts: new Date().toISOString(), latencyMs, attempt, request,
          error: { message: err instanceof Error ? err.message : String(err), type: timedOut ? 'timeout' : 'http', status: typed?.status ?? null },
        })
      }
      if (!retryable || attempt >= cfg.maxAttempts) break
      await new Promise<void>((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** 预热：冷启 ~2.5s，正式决策前先打一发极小的问，避免第一次真决策慢（本机实测结论）。 */
export async function prewarm(cfg: DeciderConfig = defaultDeciderConfig(), fetchImpl: typeof fetch = fetch): Promise<number> {
  const t0 = Date.now()
  try {
    await callSystemOne({ ping: true }, { alive: { type: 'noul', instructions: 'Is the service alive?', criteria: { true: 'alive', false: 'not alive' } } }, cfg, fetchImpl)
    return Date.now() - t0
  } catch {
    return -1
  }
}
