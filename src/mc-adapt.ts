/**
 * mc-adapt —— 穿越者三层自我进化（2026-08-18 扛枪拍板全量上线）
 *
 * L1 死亡学习（确定性注入）：监听自身死亡 → 从系统消息解析死因 → 坐标聚类热点档
 *   （data/death-hotspots.json，mc-data 共享卷，世界侧女神同样可读）→ promptBlock()
 *   每步注入「死亡教训」。与 mc-loop 的 wiki 反思互补：wiki 靠语义检索（可能漏），
 *   热点档按坐标聚类确定性注入（永不漏，同类死 3 次必然出现在下一次决策里）。
 * L2 参数自调：白名单生存参数（data/self-tuning-<username>.json），bot 用 mc_selftune
 *   工具自调——改行为不改代码；clamp 兜底防失控；改动私语女神备案。
 * L3 提议进化：mc_evolve_propose 把行为进化提案写入共享卷 evolution-proposals/，
 *   世界侧女神（mc-evolve-review）审核 → 核准指令落 evolution-directives/<username>.json
 *   → 本插件每步读回注入 prompt（最高优先级）。提议→神裁→生效，热更新无需重启。
 *
 * 服务：ctx.mcAdapt.promptBlock(username, x, z) → string（死亡热点 + 自调参数 + 神谕核准）
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'mc-adapt'
export const inject = ['mcbot', 'tools', 'mcMemos']

export interface Config {
  enabled: boolean
  dataDir: string
  godName: string
  /** 热点聚类桶边长（格） */
  clusterSize: number
  /** promptBlock 注入的热点条数上限 */
  maxHotspots: number
  /** 神谕核准指令保留条数上限 */
  maxDirectives: number
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  dataDir: Schema.string().default('./data'),
  godName: Schema.string().default('Goddess'),
  clusterSize: Schema.number().default(8),
  maxHotspots: Schema.number().default(4),
  maxDirectives: Schema.number().default(10),
})

// ── 数据结构 ──────────────────────────────────────────────────────────
interface HotspotCluster {
  cause: string
  zh: string
  x: number
  y: number
  z: number
  count: number
  firstAt: number
  lastAt: number
  usernames: string[]
}

interface HotspotFile {
  clusters: Record<string, HotspotCluster>
}

/** L2 白名单：key → {默认值, 下限, 上限, 中文说明}。越界自动 clamp。 */
const TUNABLE: Record<string, { v: number; min: number; max: number; label: string }> = {
  fleeHp: { v: 6, min: 2, max: 12, label: '血量低于此值立即撤退避险' },
  keepFood: { v: 8, min: 2, max: 16, label: '饱食度低于此值先觅食再干活' },
  riskTolerance: { v: 5, min: 0, max: 10, label: '探险激进度（低=谨慎，高=大胆）' },
  nightSafety: { v: 7, min: 0, max: 10, label: '夜间警惕度（越高越早回屋避险）' },
  torchMin: { v: 8, min: 0, max: 32, label: '火把保底携带数（低于就去补）' },
  waterCaution: { v: 6, min: 0, max: 10, label: '水域警惕（溺水后会想提高它）' },
  cliffCaution: { v: 6, min: 0, max: 10, label: '高处警惕（摔落后会想提高它）' },
}

interface TuningFile {
  params: Record<string, number>
  history: Array<{ at: number; key: string; from: number; to: number; reason: string }>
}

interface ProposalFile {
  id: string
  username: string
  title: string
  motivation: string
  change: string
  expected: string
  status: 'pending' | 'approved' | 'rejected' | 'pending_human' | 'stale'
  createdAt: string
  attempts?: number
  verdictAt?: string
  verdictReason?: string
  directive?: string
}

interface DirectiveFile {
  items: Array<{ directive: string; reason: string; title: string; approvedAt: string }>
}

// 死因关键词表：英文 death message 片段 → 中文死因。
const CAUSE_MAP: Array<[RegExp, string]> = [
  [/drowned/i, '溺水'],
  [/hit the ground too hard|fell (from|from a)/i, '坠落'],
  [/tried to swim in lava|lava/i, '岩浆'],
  [/burned to death|went up in flames|fire/i, '火烧'],
  [/starved|died of hunger/i, '饥饿'],
  [/suffocated|squashed/i, '窒息'],
  [/blew up|explosion|blast/i, '爆炸'],
  [/froze|freezing|powder snow/i, '冰冻'],
  [/withered away/i, '凋零'],
  [/shot by|arrow/i, '中箭'],
  [/slain by|killed by|stabbed|beaten/i, '被击杀'],
  [/zombie|husk|drowned\b.*slain|zombified/i, '僵尸袭击'],
  [/skeleton|stray/i, '骷髅射杀'],
  [/creeper/i, '苦力怕'],
  [/spider|cave spider/i, '蜘蛛袭击'],
  [/witch/i, '女巫毒杀'],
  [/fell out of the world|the void/i, '坠入虚空'],
  [/magic|spell/i, '魔法反噬'],
  [/lightning/i, '雷击'],
  [/pricked|cactus/i, '仙人掌'],
  [/died/i, '死亡'],
]

function zhCause(text: string): string {
  for (const [re, zh] of CAUSE_MAP) if (re.test(text)) return zh
  return '未知（' + text.slice(0, 24) + '）'
}

function loadJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function saveJson(path: string, data: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
}

function text(value: unknown) {
  return [{ type: 'text' as const, text: String(value) }]
}

export interface McAdaptService {
  /** 供 mc-loop 每步调用：死亡热点 + 自调参数 + 神谕核准 三块 prompt 注入。 */
  promptBlock(username: string, x: number | null, z: number | null): string
  /** 记录一次死亡（供测试/外部调用）。 */
  recordDeath(username: string, causeZh: string, x: number, y: number, z: number, rawText: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcAdapt?: McAdaptService
  }
}

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-adapt] ${msg}`)
  if (!config.enabled) return
  const dataDir = config.dataDir
  const hotspotsPath = join(dataDir, 'death-hotspots.json')
  const proposalsDir = join(dataDir, 'evolution-proposals')
  const directivesPathOf = (u: string) => join(dataDir, `evolution-directives-${u}.json`)
  const tuningPathOf = (u: string) => join(dataDir, `self-tuning-${u}.json`)
  mkdirSync(proposalsDir, { recursive: true })

  // ── L1：死亡监听 ────────────────────────────────────────────────────
  // mcbot 是跨重连稳定门面：监听器持久注册，重连后自动重挂。
  const msgRing: Array<{ at: number; text: string }> = []
  let lastDeathAt = 0
  try {
    ctx.mcbot.on('message', (json: unknown) => {
      const t = String(json ?? '')
      if (!t) return
      msgRing.push({ at: Date.now(), text: t })
      if (msgRing.length > 12) msgRing.shift()
    })
    ctx.mcbot.on('death', () => {
      const bot = ctx.mcbot as unknown as { username?: string; entity?: { position?: { x: number; y: number; z: number } } }
      const username = bot.username ?? 'unknown'
      const pos = bot.entity?.position
      const x = pos ? Math.floor(pos.x) : 0
      const y = pos ? Math.floor(pos.y) : 64
      const z = pos ? Math.floor(pos.z) : 0
      lastDeathAt = Date.now()
      // 从最近的系统消息里找死因（死亡消息一般在 death 事件前后 3 秒内出现）
      const lines = msgRing
        .filter((m) => Math.abs(m.at - lastDeathAt) < 4_000)
        .map((m) => m.text)
      const deathLine = lines.reverse().find((l) => l.includes(username))
      const raw = deathLine ?? `${username} died`
      const zh = zhCause(raw)
      recordDeath(username, zh, x, y, z, raw)
    })
    log('L1 death listeners armed')
  } catch (err) {
    log(`death listener failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  function recordDeath(username: string, causeZh: string, x: number, y: number, z: number, rawText: string): void {
    try {
      const file = loadJson<HotspotFile>(hotspotsPath, { clusters: {} })
      const bx = Math.floor(x / config.clusterSize)
      const bz = Math.floor(z / config.clusterSize)
      const key = `${causeZh}@${bx}_${bz}`
      const now = Date.now()
      const c = file.clusters[key]
      if (c) {
        c.count += 1
        c.lastAt = now
        c.x = x; c.y = y; c.z = z
        if (!c.usernames.includes(username)) c.usernames.push(username)
      } else {
        file.clusters[key] = { cause: causeZh, zh: causeZh, x, y, z, count: 1, firstAt: now, lastAt: now, usernames: [username] }
      }
      saveJson(hotspotsPath, file)
      log(`death recorded: ${username} ${causeZh} @(${x},${y},${z}) cluster count=${file.clusters[key].count}`)
      // 同步写入长期记忆（语义可召回，女神侧仪式感文案）
      void ctx.mcMemos?.remember(username, `【死亡教训】我在坐标(${x},${y},${z})附近因「${causeZh}」死亡（系统消息：${rawText.slice(0, 80)}）。此地危险，应绕行或提前防备。`).catch(() => {})
    } catch (err) {
      log(`recordDeath failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function tuningOf(username: string): TuningFile {
    const f = loadJson<TuningFile>(tuningPathOf(username), { params: {}, history: [] })
    let dirty = false
    for (const [k, spec] of Object.entries(TUNABLE)) {
      if (typeof f.params[k] !== 'number' || !Number.isFinite(f.params[k])) {
        f.params[k] = spec.v
        dirty = true
      }
    }
    if (dirty) saveJson(tuningPathOf(username), f)
    return f
  }

  // ── prompt 注入块 ───────────────────────────────────────────────────
  function promptBlock(username: string, x: number | null, z: number | null): string {
    if (!username) return ''
    const blocks: string[] = []
    // 1) 死亡热点（L1）
    try {
      const file = loadJson<HotspotFile>(hotspotsPath, { clusters: {} })
      const all = Object.values(file.clusters)
      if (all.length) {
        const scored = all
          .map((c) => {
            let score = c.count * 2 + Math.max(0, 3 - (Date.now() - c.lastAt) / 86_400_000)
            if (x !== null && z !== null) {
              const d = Math.hypot(c.x - x, c.z - z)
              score += d <= 48 ? 6 : d <= 128 ? 2 : 0 // 当前位置附近的危险加倍醒目
            }
            return { c, score }
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, config.maxHotspots)
        blocks.push([
          '',
          '你的死亡教训（血泪换来的禁地清单，经过时务必防备或绕行）：',
          ...scored.map(({ c }) => {
            const n = `${c.x},${c.y},${c.z}`
            return `- 坐标(${n})附近已因「${c.zh}」死亡${c.count}次——${c.zh === '溺水' ? '远离水域/备船/不夜泳' : c.zh === '坠落' ? '走近边缘先减速、看脚下' : c.zh === '被击杀' || c.zh.includes('袭') || c.zh.includes('杀') ? '带武器、白天再去、结伴而行' : '此处危险，绕行'}`
          }),
        ].join('\n'))
      }
    } catch { /* 读取失败静默 */ }
    // 2) 自调参数（L2）
    try {
      const t = tuningOf(username)
      blocks.push([
        '',
        '你的自调生存守则（你自己定下的行为参数，数字由你用 mc_selftune 调整）：',
        ...Object.entries(TUNABLE).map(([k, spec]) => `- ${spec.label}：${t.params[k] ?? spec.v}`),
        '若最近吃过亏（淹死/摔死/夜间遇袭），主动调高对应警惕项。',
      ].join('\n'))
    } catch { /* 静默 */ }
    // 3) 神谕核准的进化方向（L3，最高优先）
    try {
      const d = loadJson<DirectiveFile>(directivesPathOf(username), { items: [] })
      if (d.items.length) {
        blocks.push([
          '',
          '【女神核准的进化方向】（你此前提案、女神亲批的长期行为准则，优先遵守）：',
          ...d.items.slice(-config.maxDirectives).map((it) => `- ${it.directive}（${it.reason}）`),
        ].join('\n'))
      }
    } catch { /* 静默 */ }
    return blocks.join('\n')
  }

  ctx.provide('mcAdapt', { promptBlock, recordDeath })

  // ── L2 工具：mc_selftune ────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_selftune',
    description: '调整你自己的生存行为参数（自我进化的第二步：从教训里改参数）。只改一个参数，并给出理由。同类死亡两次以上就该调高对应警惕。',
    parameters: {
      key: { type: 'string', required: true, description: `要调的参数名，可选：${Object.entries(TUNABLE).map(([k, s]) => `${k}（${s.label}，${s.min}~${s.max}）`).join('、')}` },
      value: { type: 'string', required: true, description: '目标数值（纯数字字符串，会自动限制在安全范围内）' },
      reason: { type: 'string', required: true, description: '一句话理由（通常引用某次死亡/教训）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    execute: async (args: Record<string, unknown>) => {
      const bot = ctx.mcbot as unknown as { username?: string }
      const username = bot.username ?? 'unknown'
      const key = String(args.key ?? '')
      const reason = String(args.reason ?? '')
      const spec = TUNABLE[key]
      if (!spec) return text(`没有这个参数。可调：${Object.keys(TUNABLE).join(', ')}`)
      const num = Number(args.value)
      if (!Number.isFinite(num)) return text(`value 必须是数字，收到的是「${String(args.value).slice(0, 20)}」。`)
      const clamped = Math.max(spec.min, Math.min(spec.max, Math.round(num)))
      const f = tuningOf(username)
      const from = f.params[key] ?? spec.v
      f.params[key] = clamped
      f.history.push({ at: Date.now(), key, from, to: clamped, reason: reason.slice(0, 120) })
      if (f.history.length > 60) f.history = f.history.slice(-60)
      saveJson(tuningPathOf(username), f)
      try { ctx.mcbot.whisper(config.godName, `[自我进化] 我把「${spec.label}」从 ${from} 调到 ${clamped}。理由：${reason.slice(0, 80)}`) } catch { /* 女神不在线 */ }
      log(`selftune ${username}: ${key} ${from} -> ${clamped} (${reason.slice(0, 60)})`)
      return text(`已调整「${spec.label}」：${from} → ${clamped}（安全范围 ${spec.min}~${spec.max}）。新守则即刻生效，已向女神备案。`)
    },
  }))

  // ── L3 工具：mc_evolve_propose ──────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_evolve_propose',
    description: '向女神提交「行为进化提案」——当你意识到自己需要长期改变某个行为习惯（不是临时动作）时用。提案由女神亲自审核：核准后成为你的长期准则（注入你之后的每一次决策）；也会被驳回。每次只提一件小事。',
    parameters: {
      title: { type: 'string', required: true, description: '提案标题（如：夜间不外出探险）' },
      motivation: { type: 'string', required: true, description: '动机：什么经历让你想改（引用具体事件/死亡）' },
      change: { type: 'string', required: true, description: '想改变的具体行为（现在怎样 → 想改成怎样）' },
      expected: { type: 'string', required: true, description: '预期效果（怎样算改好了）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    execute: async (args: Record<string, unknown>) => {
      const bot = ctx.mcbot as unknown as { username?: string }
      const username = bot.username ?? 'unknown'
      const title = String(args.title ?? '')
      const motivation = String(args.motivation ?? '')
      const change = String(args.change ?? '')
      const expected = String(args.expected ?? '')
      const id = `${Date.now().toString(36)}-${username}`
      const p: ProposalFile = {
        id,
        username,
        title: title.slice(0, 60),
        motivation: motivation.slice(0, 300),
        change: change.slice(0, 300),
        expected: expected.slice(0, 200),
        status: 'pending',
        createdAt: new Date().toISOString(),
      }
      saveJson(join(proposalsDir, `${id}.json`), p)
      try { ctx.mcbot.whisper(config.godName, `[自我进化] 我提交了行为进化提案「${p.title}」，静候神谕。`) } catch { /* 女神不在线 */ }
      log(`proposal ${id}: ${p.title}`)
      return text(`提案「${p.title}」已递呈女神。神谕通常几分钟内送达——核准后它会成为你的长期准则；若被驳回，信使会带回女神的理由。`)
    },
  }))

  log(`adapt ready (L1 hotspots + L2 ${Object.keys(TUNABLE).length} params + L3 proposals, dir=${dataDir})`)
}
