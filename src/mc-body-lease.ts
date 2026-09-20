/**
 * mc-body-lease —— 身体租约与仲裁（执行层 E4）。
 *
 * 研读来源：Cortico `src/worlds/minecraft/body-lease.ts`（取长补短，常量照抄）：
 *   · **效用评分仲裁**，不是固定优先级：`BodyUtilityFactors{survival,urgency,feasibility,progress,continuity,disruption}`
 *     权重 survival .34 / urgency .22 / feasibility .20 / progress .08 / continuity .08 / **disruption −.08**
 *   · **租约 2.5s**（`BODY_LEASE_MS = 2500`）、**抢占地需超过在位者 4 分**（`BODY_PREEMPT_MARGIN = 4`，迟滞余量防抖）
 *   · **owner 是一次动作实例**（object 身份）—— 同类的新实例**不能**继承旧实例的授权
 *   · 租约带 **连接代次**与**到期时刻**（换连接/超时自动失效）
 *   · 决策带 **reason**：`empty | acquire | renew | same-owner | preempt | hysteresis`
 *   · 仲裁过程发**事件流**（可审计：谁在什么时候因为什么拿到了身体）
 *
 * 我们的额外纪律（比参考更紧）：**反射层只有"安全类"才能抢占** ——
 * `survival` 低于阈值就拒绝，不许拿"紧急"当借口抢身体（neko §8 五控制流抢身体的教训）。
 *
 * 现状说明：反射层（L0）还没落地，所以现在**没有任何竞争者** —— 本模块已接线但不会拒绝任何动作。
 * 它是为 L0 准备好的地基：等反射层上线，抢占与 `by` 留痕自动生效。
 */

export type BodyOwnerKind = 'goal' | 'reflex' | 'system'

/** 身体 owner 是**一次动作实例**：同类新实例不能继承旧实例的授权。 */
export type BodyOwner = object

export interface BodyUtilityFactors {
  survival: number
  urgency: number
  feasibility: number
  progress: number
  continuity: number
  disruption: number
}

/**
 * 权重取 Cortico 原值（生存优先，破坏性为负）。
 * ⚠️ **尺度**：因子取 0..10（不是 0..1）—— 因为权重和只有 0.84，
 * 若因子是 0..1 则满分 0.84，永远够不到下面的 `BODY_PREEMPT_MARGIN = 4`，抢占将永不触发。
 * 这是从参考实现的常量反推出来的量纲约定，写在这里以免后来人再踩。
 */
export const UTILITY_WEIGHTS: Readonly<Record<keyof BodyUtilityFactors, number>> = {
  survival: 0.34,
  urgency: 0.22,
  feasibility: 0.20,
  progress: 0.08,
  continuity: 0.08,
  disruption: -0.08,
}

/** 租约时长（毫秒）——2.5s，到期需续约。 */
export const BODY_LEASE_MS = 2_500
/** 抢占地必须比在位者高出这么多分才允许接管（迟滞余量）。 */
export const BODY_PREEMPT_MARGIN = 4
/** 反射层抢占的生存分下限（0..10 量纲，即 5/10；我们的额外纪律：不许拿"紧急"当借口抢身体）。 */
export const REFLEX_SAFETY_MIN = 5

export function bodyUtilityScore(u: Partial<BodyUtilityFactors>): number {
  const full: BodyUtilityFactors = {
    survival: 0, urgency: 0, feasibility: 0, progress: 0, continuity: 0, disruption: 0, ...u,
  }
  return (Object.keys(UTILITY_WEIGHTS) as Array<keyof BodyUtilityFactors>)
    .reduce((sum, k) => sum + full[k] * UTILITY_WEIGHTS[k], 0)
}

export interface BodyProposal {
  owner: BodyOwner
  ownerKind: BodyOwnerKind
  /** 人话说明"我要拿身体干什么"（进拒绝理由与审计） */
  intent: string
  utility: Partial<BodyUtilityFactors>
}

export interface BodyLeaseToken {
  leaseId: number
  /** 连接代次：换身体/重连后旧租约自动失效 */
  generation: number
  owner: BodyOwner
  ownerKind: BodyOwnerKind
  intent: string
  grantedAt: number
  expiresAt: number
}

export type LeaseReason = 'empty' | 'acquire' | 'renew' | 'same-owner' | 'preempt' | 'hysteresis' | 'reflex-not-safety'

export interface BodyDecision {
  at: number
  granted: boolean
  reason: LeaseReason
  score: number
  lease?: BodyLeaseToken
  /** 拒绝时：谁拿着身体、在干什么 */
  incumbent?: { intent: string; ownerKind: BodyOwnerKind; score: number }
}

export interface BodyLeaseEvent {
  at: number
  type: 'granted' | 'renewed' | 'preempted' | 'denied' | 'released' | 'expired' | 'generation-reset'
  ownerKind?: BodyOwnerKind
  intent?: string
  reason?: LeaseReason
}

export interface BodyLeaseOptions {
  generation?: number
  leaseMs?: number
  preemptMargin?: number
  emit?: (e: BodyLeaseEvent) => void
  now?: () => number
}

export function createBodyLease(opts: BodyLeaseOptions = {}) {
  const leaseMs = opts.leaseMs ?? BODY_LEASE_MS
  const margin = opts.preemptMargin ?? BODY_PREEMPT_MARGIN
  const now = opts.now ?? (() => Date.now())
  let generation = opts.generation ?? 1
  let active: { token: BodyLeaseToken; score: number } | null = null
  let leaseSeq = 0

  const emit = (e: BodyLeaseEvent): void => { try { opts.emit?.(e) } catch { /* 事件失败不影响仲裁 */ } }

  const expired = (): boolean => !!active && active.token.expiresAt <= now()
  if (active && expired()) active = null

  return {
    /** 换连接/重进世界：旧租约一律作废（代次变了）。 */
    setGeneration(g: number): void {
      generation = g
      active = null
      emit({ at: now(), type: 'generation-reset', reason: 'acquire' })
    },
    current: () => (active && !expired() ? active.token : null),
    scoreOf: (p: BodyProposal): number => bodyUtilityScore(p.utility),

    propose(p: BodyProposal): BodyDecision {
      const at = now()
      const score = bodyUtilityScore(p.utility)
      // 到期即释放
      if (active && active.token.expiresAt <= at) {
        emit({ at, type: 'expired', ownerKind: active.token.ownerKind, intent: active.token.intent })
        active = null
      }
      // 我们的额外纪律：反射层只有安全类才能抢
      if (p.ownerKind === 'reflex' && (p.utility.survival ?? 0) < REFLEX_SAFETY_MIN) {
        emit({ at, type: 'denied', ownerKind: p.ownerKind, intent: p.intent, reason: 'reflex-not-safety' })
        return { at, granted: false, reason: 'reflex-not-safety', score }
      }
      // 无人持有 → 直接拿
      if (!active) {
        const token: BodyLeaseToken = { leaseId: ++leaseSeq, generation, owner: p.owner, ownerKind: p.ownerKind, intent: p.intent, grantedAt: at, expiresAt: at + leaseMs }
        active = { token, score }
        emit({ at, type: 'granted', ownerKind: p.ownerKind, intent: p.intent, reason: 'acquire' })
        return { at, granted: true, reason: 'acquire', score, lease: token }
      }
      // 同一实例 → 续约
      if (active.token.owner === p.owner) {
        active.token.expiresAt = at + leaseMs
        active.score = score
        emit({ at, type: 'renewed', ownerKind: p.ownerKind, intent: p.intent, reason: 'renew' })
        return { at, granted: true, reason: 'renew', score, lease: active.token }
      }
      // 不同实例：要超过在位者 + 迟滞余量才允许抢占
      if (score > active.score + margin) {
        const prev = active.token
        const token: BodyLeaseToken = { leaseId: ++leaseSeq, generation, owner: p.owner, ownerKind: p.ownerKind, intent: p.intent, grantedAt: at, expiresAt: at + leaseMs }
        active = { token, score }
        emit({ at, type: 'preempted', ownerKind: p.ownerKind, intent: p.intent, reason: 'preempt' })
        return { at, granted: true, reason: 'preempt', score, lease: token, ...(prev ? { incumbent: { intent: prev.intent, ownerKind: prev.ownerKind, score: 0 } } : {}) }
      }
      emit({ at, type: 'denied', ownerKind: p.ownerKind, intent: p.intent, reason: 'hysteresis' })
      return {
        at, granted: false, reason: 'hysteresis', score,
        incumbent: { intent: active.token.intent, ownerKind: active.token.ownerKind, score: active.score },
      }
    },

    /** 动作结束释放；不传 owner 则强制释放（停机/重连）。 */
    release(owner?: BodyOwner): void {
      if (!active) return
      if (owner && active.token.owner !== owner) return
      emit({ at: now(), type: 'released', ownerKind: active.token.ownerKind, intent: active.token.intent })
      active = null
    },

    snapshot: () => (active ? { ...active.token, score: active.score } : null),
  }
}
