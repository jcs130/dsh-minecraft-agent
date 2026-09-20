/**
 * mc-guidance —— 「指引信息」的统一抽象与队列。
 *
 * 用户口径（2026-09-20）：「所以应该抽象为指引信息，在今天这个循环中可以作为未来的插入信息之后插进来」。
 * 即：不要把弹幕当成一路特殊感知 —— 它只是**指引的一个生产者**；女神神谕、死亡教训、自调准则、
 * 慢环反思结论、系统告警，都是同一种东西：**一条可能（也可能不）影响行为的指引**。
 *
 * 统一契约（一条指引 = 谁给的 + 说的是什么 + 能影响到哪一级 + 什么时候生效/失效）：
 *   source    谁给的：观众 / 女神 / 系统 / 教训 / 自调 / 反思 / 使命
 *   kind      性质：规则(rule) / 告警(warning) / 请求(request) / 信息(info)
 *   level     影响等级 L0–L3（复用弹幕那套：L0 无影响 … L3 可改目标）
 *   lifetime  standing（常驻：安全铁律、长期准则）｜ transient（限时：一条点播、一句神谕）
 *   from/until 生效与失效时刻 —— **from 让指引可以"未来才插进来"**
 *   evidence  证据引用（反思/教训必须可追溯）
 *   adopted   是否已被采纳（配合影响配额记账）
 *
 * 「未来插入」的语义：push 进来先挂 pending；每次组装上下文时只取 **已生效（now ≥ from）** 且未过期、
 * 且没过预算的那几条 —— 所以它天然是"下一步/稍后那一步才出现的信息"，而不是当步立刻打断。
 *
 * 去重与刷屏：同来源 + 同归一化文本 且仍在有效期内 → **合并刷新有效期并计次**（不新增行）。
 * 预算：每轮最多注入 maxInject 条；超预算时按 等级 > 性质 > 新近 排序取前 N。
 */
import type { InfluenceLevel } from './mc-audience'

export type GuidanceSource = 'audience' | 'deity' | 'system' | 'lesson' | 'tuning' | 'reflection' | 'mission'
export type GuidanceKind = 'rule' | 'warning' | 'request' | 'info'
export type GuidanceLifetime = 'standing' | 'transient'

export interface GuidanceItem {
  id: string
  at: number
  source: GuidanceSource
  kind: GuidanceKind
  /** 正文（允许多行：教训/守则这类本来就是一段） */
  text: string
  level: InfluenceLevel
  lifetime: GuidanceLifetime
  /** 从此刻起才生效（毫秒）——「未来才插进来」 */
  from?: number
  /** 失效时刻（毫秒）；transient 默认 at + ttlMs */
  until?: number
  /** 证据引用（反思/教训要能追溯） */
  evidence?: string[]
  /** 命中次数（同一句话被反复提及时累加，不新增行） */
  hits: number
  /** 已被采纳（影响配额记账） */
  adopted?: boolean
}

export interface GuidanceInput {
  source: GuidanceSource
  text: string
  kind?: GuidanceKind
  level?: InfluenceLevel
  lifetime?: GuidanceLifetime
  at?: number
  from?: number
  until?: number
  ttlMs?: number
  evidence?: string[]
}

export interface GuidanceQueueConfig {
  /** 每轮最多注入几条（默认 4，含常驻） */
  maxInject?: number
  /** transient 默认存活时长（默认 45s） */
  defaultTtlMs?: number
}

const KIND_WEIGHT: Record<GuidanceKind, number> = { rule: 3, warning: 2, request: 1, info: 0 }
const norm = (s: string): string => s.replace(/[\s，。！？、,.!?~…\-_/\\'"]+/g, '').toLowerCase()

export interface GuidanceQueue {
  push: (g: GuidanceInput) => GuidanceItem
  /** 本轮该注入的指引（已生效、未过期、过了预算筛） */
  select: (now?: number) => GuidanceItem[]
  /** 渲染成上下文块（空队列 → 空串，不占预算） */
  render: (now?: number) => string
  markAdopted: (id: string) => void
  /**
   * 原地替换某来源的常驻指引（教训/守则这类是"算出来的"整块 —— 每次重算就换掉旧的，
   * 否则队列会越堆越多，常驻项又永不过期）。
   */
  replaceStanding: (source: GuidanceSource, g: GuidanceInput) => GuidanceItem
  /** 清掉过期项；常驻项不参与清理 */
  expire: (now?: number) => void
  stats: (now?: number) => { total: number; standing: number; transient: number; pending: number }
  all: () => GuidanceItem[]
}

let seq = 0

export function createGuidanceQueue(cfg: GuidanceQueueConfig = {}): GuidanceQueue {
  const maxInject = cfg.maxInject ?? 4
  const defaultTtlMs = cfg.defaultTtlMs ?? 45_000
  const items: GuidanceItem[] = []

  const queue: GuidanceQueue = {
    push(input: GuidanceInput): GuidanceItem {
      const at = input.at ?? Date.now()
      const lifetime: GuidanceLifetime = input.lifetime ?? (input.kind === 'rule' ? 'standing' : 'transient')
      const key = `${input.source}|${norm(input.text)}`
      // 同来源同话再提一次：**合并刷新**，不新增行（刷屏保护；也是"它还在说这件事"的信号）
      const live = items.find((it) => `${it.source}|${norm(it.text)}` === key && (it.until === undefined || it.until > at))
      if (live) {
        live.hits += 1
        // 刷新有效期同样要"从生效时刻起算"（否则未来生效的项会被当场续到过期）
        if (lifetime === 'transient') live.until = input.until ?? (input.from ?? at) + (input.ttlMs ?? defaultTtlMs)
        if (input.level !== undefined && input.level > live.level) live.level = input.level
        return live
      }
      const item: GuidanceItem = {
        id: `g${++seq}`,
        at,
        source: input.source,
        kind: input.kind ?? (input.source === 'audience' ? 'request' : 'info'),
        text: input.text,
        level: input.level ?? (input.source === 'audience' ? 1 : 2),
        lifetime,
        from: input.from,
        // ★ 有效期从**生效时刻**起算（修自测试：原先从 at 起算 ⇒ 未来生效的指引会在出生时就过期，
        //   等于"未来插入"根本插不进来）
        until: input.until ?? (lifetime === 'transient' ? (input.from ?? at) + (input.ttlMs ?? defaultTtlMs) : undefined),
        evidence: input.evidence,
        hits: 1,
      }
      items.push(item)
      return item
    },

    select(now = Date.now()): GuidanceItem[] {
      queue.expire(now)
      const live = items.filter((it) => {
        if (it.from !== undefined && now < it.from) return false          // 「未来才插进来」
        if (it.until !== undefined && now > it.until) return false
        return true
      })
      const rank = (it: GuidanceItem): number => it.level * 10 + KIND_WEIGHT[it.kind] * 3 + Math.min(2, it.hits - 1)
      return live
        .slice()
        .sort((a, b) => rank(b) - rank(a) || b.at - a.at)
        .slice(0, maxInject)
    },

    render(now = Date.now()): string {
      const picked = queue.select(now)
      if (!picked.length) return ''
      const lines = picked.map((it) => {
        const src = { audience: '观众', deity: '神谕', system: '系统', lesson: '教训', tuning: '自调', reflection: '反思', mission: '使命' }[it.source]
        const kind = { rule: '规则', warning: '告警', request: '请求', info: '信息' }[it.kind]
        const hits = it.hits > 1 ? ` ×${it.hits}` : ''
        const adopted = it.adopted ? '（已采纳）' : ''
        return `[指引·${src}·${kind}·L${it.level}${hits}]${adopted} ${it.text}`
      })
      return lines.join('\n')
    },

    markAdopted(id: string): void {
      const it = items.find((x) => x.id === id)
      if (it) it.adopted = true
    },

    replaceStanding(source: GuidanceSource, g: GuidanceInput): GuidanceItem {
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].source === source && items[i].lifetime === 'standing') items.splice(i, 1)
      }
      return queue.push({ ...g, source, lifetime: 'standing' })
    },

    expire(now = Date.now()): void {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]
        if (it.lifetime === 'standing') continue
        if (it.until !== undefined && now > it.until) items.splice(i, 1)
      }
    },

    stats(now = Date.now()): { total: number; standing: number; transient: number; pending: number } {
      const live = items.filter((it) => (it.until === undefined || it.until > now))
      return {
        total: live.length,
        standing: live.filter((it) => it.lifetime === 'standing').length,
        transient: live.filter((it) => it.lifetime === 'transient').length,
        pending: live.filter((it) => it.from !== undefined && it.from > now).length,
      }
    },

    all: () => items.slice(),
  }
  return queue
}
