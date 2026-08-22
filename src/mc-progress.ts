/**
 * mc-progress —— 穿越者的「学习进度账本」+ 停滞诊断（2026-08-21 扛枪需求）。
 *
 * 背景：用户观察——魔法机制本应让穿越者持续学习；若「这么久都没学会魔法」，
 * 说明机制有问题。但旧实现（mc-mystic 的 mystic-state.json）只存出生天赋 +
 * 等级，没有「咏唱多少次、成没成、多久没升层、学会了啥」的观测数据，因此
 * 「机制到底坏没坏」无从回答。
 *
 * 本插件是**纯观测层**（零权限、零硬编码法术判定，不违反「魔法 ID 映射不进
 * 客户端」铁律）：只记录客户端天然可见的事实——
 *   1. 咏唱账本：mc_chant 调用次数 / 成功 / 失败（成败由 mc-mystic 依据信使
 *      回执语义判定后传入，best-effort）。
 *   2. 魔力层级曲线：bot.experience.level（MC 原生经验等级）采样，只记「达到
 *      更高层级」的首次时间戳（死亡掉经验不回退，学会就不会忘）。
 *   3. 停滞诊断：最近一次「学会」（升层）距今多久；超阈值且期间有在尝试，
 *      判定停滞并产出可定位到具体环节的告警。
 *
 * 产出：
 *   - data/progress-<username>.json（持久账本，跨重启）
 *   - diagnose() 告警 → 日志 + mc-panel status 文件（人可见）
 *
 * 集成方：
 *   - mc-mystic：mc_chant 结束时调 recordChant(username, success, chant)。
 *   - mc-session：writeStatus（3s）里读 bot.experience.level 调 sampleLevel，
 *     并把 summary()/diagnose() 写进 status-<username>.json 供 mc-panel 展示。
 * 两者经 ctx.get('mcProgress') 免 inject 读取（cordis 官方读服务口），
 * 本插件未就绪时返回 undefined，调用方 `?.` 容错。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { resolve } from 'node:path'
import type { McStoreService } from './mc-store'

export const name = 'mc-progress'
export const inject = ['mcStore']

export interface Config {
  enabled: boolean
  /** 账本目录（须与 mc-session/mc-panel 的 dataDir 同源）。 */
  dataDir: string
  /** 学习停滞阈值（小时）：最近一次升层距今超过此值且期间有尝试，判停滞。 */
  stagnationHours: number
  /** 同类告警冷却（毫秒）：避免同一诊断反复刷屏。 */
  alertCooldownMs: number
  /** 至少采样几次后才开始诊断（防启动瞬间误报）。 */
  minSamples: number
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  dataDir: Schema.string().default('./data'),
  stagnationHours: Schema.number().default(24),
  alertCooldownMs: Schema.number().default(6 * 3600_000),
  minSamples: Schema.number().default(2),
})

// ── 账本数据结构 ──────────────────────────────────────────────────────
export interface ProgressState {
  version: 1
  username: string
  // 咏唱账本
  chantTotal: number
  chantSuccess: number
  chantFail: number
  lastChantAt: number | null
  lastChantText: string | null
  // 层级曲线（level = 历史最高层级；死亡掉经验不回退）
  level: number
  firstSampledAt: number | null
  samples: number
  levelHistory: Array<{ level: number; at: number }>
  lastLevelUpAt: number | null
  // 停滞诊断
  stagnationSince: number | null
  alerts: Array<{ at: number; kind: string; msg: string }>
  lastAlertAt: number | null
}

function emptyState(username: string): ProgressState {
  return {
    version: 1,
    username,
    chantTotal: 0,
    chantSuccess: 0,
    chantFail: 0,
    lastChantAt: null,
    lastChantText: null,
    level: 0,
    firstSampledAt: null,
    samples: 0,
    levelHistory: [],
    lastLevelUpAt: null,
    stagnationSince: null,
    alerts: [],
    lastAlertAt: null,
  }
}

export interface McProgressService {
  /** 记录一次咏唱（success 由调用方依据回执语义判定）。 */
  recordChant(username: string, success: boolean, chant: string): void
  /** 采样魔力层级；升层则记录学会时间线并解除停滞。 */
  sampleLevel(username: string, level: number): void
  /** 学习进度摘要（人/LLM 可读，供面板展示）。 */
  summary(username: string): string
  /** 停滞诊断：超阈值返回告警文案，否则 null（内部有冷却，可高频调用）。 */
  diagnose(username: string): string | null
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcProgress?: McProgressService
  }
}

/** 层级 → 解锁法术层说明（仅展示，不参与任何施法判定）。 */
function levelHint(level: number): string {
  if (level <= 0) return '尚未觉醒魔力'
  if (level >= 7) return `已解锁全部 7 层法术`
  return `已解锁 1~${level} 级法术`
}

function fmtAgo(at: number | null, now: number): string {
  if (at == null) return '（从未）'
  const h = Math.round((now - at) / 3600_000)
  if (h < 1) return '不足 1 小时前'
  if (h < 24) return `${h} 小时前`
  return `${Math.round(h / 24)} 天前`
}

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return
  const log = (msg: string) => console.log(`[mc-progress] ${msg}`)
  const dataDir = resolve(config.dataDir)
  // 统一数据层（2026-08-21）：账本迁 SQLite（mc-store），原 progress-*.json 保留作回滚锚。
  const store = (ctx as unknown as { get?: (n: string) => unknown }).get?.('mcStore') as McStoreService | undefined

  // 内存缓存：recordChant/sampleLevel/diagnose 高频，不每次读盘。
  const cache = new Map<string, ProgressState>()

  function load(username: string): ProgressState {
    let s = cache.get(username)
    if (s) return s
    s = emptyState(username)
    try {
      const raw = store?.loadProgress(username)
      if (raw && typeof raw === 'object' && raw.version === 1) {
        s = { ...emptyState(username), ...(raw as ProgressState) }
      }
    } catch {
      /* 损坏记录 → 从零开始 */
    }
    cache.set(username, s)
    return s
  }

  function persist(s: ProgressState): void {
    try {
      store?.saveProgress(s.username, s)
    } catch (e) {
      log(`persist failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function recordChant(username: string, success: boolean, chant: string): void {
    if (!username) return
    const s = load(username)
    const now = Date.now()
    s.chantTotal += 1
    if (success) s.chantSuccess += 1
    else s.chantFail += 1
    s.lastChantAt = now
    s.lastChantText = chant.slice(0, 80)
    persist(s)
  }

  function sampleLevel(username: string, level: number): void {
    if (!username) return
    if (!Number.isInteger(level) || level < 0) return // 未连接/未出生读到无效值
    const s = load(username)
    const now = Date.now()
    if (s.firstSampledAt == null) {
      s.firstSampledAt = now
    }
    s.samples += 1
    if (level > s.level) {
      // 升层（或首次达到更高）：记录学会时间线，解除停滞。
      s.level = level
      s.levelHistory.push({ level, at: now })
      s.lastLevelUpAt = now
      s.stagnationSince = null
      log(`${username} 学会新层级 → Lv.${level}（累计 ${s.levelHistory.length} 次升层）`)
      persist(s)
    }
    // level 下降（死亡掉经验）不回退「已学会」记录：s.level 保持峰值。
  }

  function summary(username: string): string {
    const s = load(username)
    const now = Date.now()
    const lines: string[] = []
    lines.push(`魔力层级 Lv.${s.level}（${levelHint(s.level)}）`)
    if (s.levelHistory.length > 0) {
      lines.push(`升层轨迹：${s.levelHistory.map((h) => `Lv.${h.level}@${fmtAgo(h.at, now)}`).join(' → ')}`)
    } else {
      lines.push(`升层轨迹：（尚未升层）`)
    }
    lines.push(`咏唱 ${s.chantTotal} 次：成功 ${s.chantSuccess}、失败 ${s.chantFail}`)
    lines.push(`最近咏唱：${s.lastChantAt != null ? fmtAgo(s.lastChantAt, now) : '（从未）'}`)
    lines.push(`最近升层：${fmtAgo(s.lastLevelUpAt, now)}`)
    return lines.join('\n')
  }

  function diagnose(username: string): string | null {
    const s = load(username)
    const now = Date.now()
    // 启动早期宽限：采样不足不诊断。
    if (s.samples < config.minSamples) return null
    if (s.firstSampledAt == null) return null
    const ageMs = now - s.firstSampledAt
    if (ageMs < config.stagnationHours * 3600_000) return null // 观察期未满

    let kind = ''
    let msg = ''
    if (s.chantTotal === 0) {
      kind = 'zero-attempt'
      msg = `魔法学习停滞（零尝试）：穿越者 ${username} 已活跃 ${fmtAgo(s.firstSampledAt, now)}，却从未咏唱过一次魔法——引导或工具暴露可能有问题（mc_chant 没被引导去用？）。`
    } else if (s.level <= 1 && s.lastLevelUpAt == null) {
      kind = 'no-progress'
      msg = `魔法学习停滞（有尝试无进展）：${username} 咏唱 ${s.chantTotal} 次（成功 ${s.chantSuccess} / 失败 ${s.chantFail}），但魔力层级从未提升——若成功 ${s.chantSuccess} 次仍不涨层，施法可能没给经验（世界侧学习闭环断了）。`
    } else if (s.lastLevelUpAt != null && now - s.lastLevelUpAt >= config.stagnationHours * 3600_000) {
      kind = 'stagnant'
      msg = `魔法学习停滞（长期未升层）：${username} 卡在 Lv.${s.level} 已 ${fmtAgo(s.lastLevelUpAt, now)}（期间咏唱 ${s.chantTotal} 次，成功 ${s.chantSuccess}）——学习机制可能坏了：施法经验没累计、等级门槛不合理、或穿越者没在尝试新法术。`
    } else {
      return null // 健康：近期有升层或尚未超阈值
    }

    // 同类告警冷却（防刷屏）。
    const lastSame = s.alerts.filter((a) => a.kind === kind).map((a) => a.at).sort((a, b) => b - a)[0]
    if (lastSame != null && now - lastSame < config.alertCooldownMs) return null

    const alert = { at: now, kind, msg }
    s.alerts.push(alert)
    if (s.alerts.length > 20) s.alerts = s.alerts.slice(-20)
    s.lastAlertAt = now
    s.stagnationSince = s.stagnationSince ?? now
    persist(s)
    log(`[停滞诊断] ${msg}`)
    return msg
  }

  ctx.provide('mcProgress', {
    recordChant,
    sampleLevel,
    summary,
    diagnose,
  } satisfies McProgressService)

  log(`learning-progress ledger ready (dir=${dataDir}, stagnation=${config.stagnationHours}h)`)
}
