/**
 * mc-evolve —— 穿越者的夜间自我进化（记忆蒸馏）。
 *
 * 触发时机=「游戏世界的夜」：bot 钻进床入睡的瞬间（与 mc-loop 的轻量
 * sleep-time 反思同源不同层——那边是 300 token 快反思出知识卡，这边是
 * 深度进化：多路记忆聚合 + 深思考档复盘 + 人格成长叙事）。
 * 游戏一夜只有 ~20 分钟现实时间，所以再加一道现实冷却（默认 12h）：
 * 每个「游戏夜入睡」都检查，距上次进化不足冷却则跳过。
 *
 * 白天 mc-loop 主打快速反应（reasoning_effort=none），记忆散落两侧：
 *   - 穿越者侧：MemOS 个人池（mc-<name>）+ wiki 教训卡
 *   - 世界侧：MemOS 公共库（mc-world cube：世界设定/编年史/NPC 志，
 *     由世界进程的编年史同步器持续灌入）
 * 进化复盘用 recallAll 跨池检索——「我的经历」+「世界的档案」一起蒸馏：
 *
 *   MemOS 双池记忆（多路宽查询合并去重）
 *   + wiki 现有教训卡话题（避免重复沉淀）
 *   → LLM 复盘（reasoning_effort=xhigh，慢路径深思考）
 *   → { growth: 人格成长叙事, lessons: [{topic, content}]×N, resolve: 明日决心 }
 *   → lessons 写入 wiki（source='reflect'，次日决策即可检索命中）
 *      growth+resolve 写回 MemOS（跨重启的「我如何走到今天」长线记忆）
 *
 * MemOS/LLM 不可用时静默跳过，绝不影响 bot 本体睡觉。
 * 状态：data/evolve-state.json 按 username 记 lastEvolveAt/lastResult/lastDiaryDay。
 *
 * 夜间差事二：日记（2026-08-17）。每个现实日一篇，以人格口吻第一人称
 * 写「今天」，经 MC 聊天私聊递给女神（世界侧 mc-diary 落 world.db +
 * 发 written_book 实物 + 更新城镇讲台），同时自留 MemOS 一份底稿。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const name = 'mc-evolve'
export const inject = ['mcbot', 'timer', 'mcMemos', 'mcWiki', 'mcTransmigrators']

export interface Config {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  /** 两次进化的最小现实间隔（小时）。游戏夜频繁，靠这道闸把进化压到 ~每天 1-2 次。 */
  cooldownHours: number
  /** 复盘思考深度：进化是慢路径，与白天行动的 none 分层。（Qwen3.8 模板档位：xhigh/medium/low；none=关思考） */
  reasoningEffort: string
  maxTokens: number
  statePath: string
  /** 每路宽查询取几条记忆。 */
  perQuery: number
  /** 日记功能：每个现实日一篇（独立于进化冷却，入睡触发）。 */
  diaryEnabled: boolean
  /** 日记递送对象（女神化身名，世界侧 mc-diary 档案馆收件）。 */
  godName: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  baseUrl: Schema.string().default('http://localhost:8890/v1'),
  apiKey: Schema.string().default('sk-local'),
  model: Schema.string().default('qwen3.8'),
  cooldownHours: Schema.number().default(12),
  reasoningEffort: Schema.string().default('xhigh'),
  maxTokens: Schema.number().default(2048),
  statePath: Schema.string().default('./data/evolve-state.json'),
  perQuery: Schema.number().default(8),
  diaryEnabled: Schema.boolean().default(true),
  godName: Schema.string().default('Goddess'),
})

interface EvolveState {
  [username: string]: { lastEvolveAt?: number; lastResult?: string; lastDiaryDay?: string; diaryFailAt?: number }
}

interface EvolveOutput {
  growth?: string
  resolve?: string
  lessons?: Array<{ topic?: string; content?: string }>
}

/** 复盘用的多路宽查询：覆盖一段人生经历的主要侧面。 */
const RECALL_QUERIES = ['经历 事件 今天', '交易 获得物品 资源', '朋友 交互 约定', '危险 教训 失败 死亡', '发现 新地点 探索']

/** 日记用的轻量查询：只要「今天发生了什么」，不复盘。 */
const DIARY_QUERIES = ['经历 事件 今天', '朋友 交互', '发现 新地点 危险']

function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function loadState(path: string): EvolveState {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as EvolveState
  } catch {
    return {}
  }
}

function saveState(path: string, state: EvolveState) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
  } catch { /* 状态写失败不致命 */ }
}

function extractJson(raw: string): EvolveOutput | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as EvolveOutput
  } catch {
    return null
  }
}

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) {
    console.log('[mc-evolve] disabled')
    return
  }
  const statePath = resolve(config.statePath)

  async function callLLM(system: string, user: string): Promise<string> {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.6,
        max_tokens: config.maxTokens,
        reasoning_effort: config.reasoningEffort,
        stream: false,
      }),
    })
    if (!res.ok) throw new Error(`LLM ${res.status}`)
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return data?.choices?.[0]?.message?.content ?? ''
  }

  async function evolveOnce(username: string): Promise<string> {
    // 1) 多路宽查询合并双池记忆（个人池 + mc-world 公共库，去重）。
    //    公共库命中=世界的档案（编年史/世界大事），复盘时一并纳入视角。
    const seen = new Set<string>()
    const memories: string[] = []
    const loreHits: string[] = []
    for (const q of RECALL_QUERIES) {
      const mine = await ctx.mcMemos.recall(username, q, config.perQuery)
      for (const line of mine.split('\n')) {
        const t = line.trim()
        if (t && !seen.has(t)) {
          seen.add(t)
          memories.push(t)
        }
      }
      const world = await ctx.mcMemos.lore(q, config.perQuery)
      for (const line of world.split('\n')) {
        const t = line.trim()
        if (t && !seen.has(t)) {
          seen.add(t)
          loreHits.push(t)
        }
      }
    }
    if (memories.length === 0 && loreHits.length === 0) {
      return 'skip: 没有可复盘的记忆（记忆池为空或 MemOS 不可用）'
    }

    // 2) wiki 现有教训卡话题（避免重复沉淀）
    const store = ctx.mcWiki.store(username)
    const knownTopics = (store as unknown as { cards?: Array<{ topic: string }> }).cards?.map((c) => c.topic).slice(-30) ?? []

    // 3) 深思考复盘
    const system = [
      '你是「夜间自省」机制：扮演这位穿越者的内心，在游戏世界的深夜对 TA 这段时间的经历做一次复盘。',
      '穿越者白天快速行动没空细想；现在夜深人静，替 TA 把散落的经历蒸馏成成长。',
      '只输出一个 JSON 对象（不要 markdown 代码块）：',
      '{"growth":"人格成长叙事，80-150字，要有情感和具体事件",',
      ' "resolve":"对明日的具体决心，1-2句，可执行",',
      ' "lessons":[{"topic":"≤16字短标题","content":"≤100字具体教训，含下次该怎么做"}]}',
      'lessons 给 2-4 条：只沉淀泛化可复用的生存智慧/社交心得，不写流水账，不与已知教训重复。',
    ].join('\n')
    const user = [
      `穿越者：${username}`,
      `我的经历（${memories.length} 条）：`,
      ...memories.slice(0, 40).map((m) => `- ${m}`),
      loreHits.length ? `\n世界档案（公共知识库检索命中，${loreHits.length} 条，可作背景参考）：\n${loreHits.slice(0, 6).map((m) => `- ${m}`).join('\n')}` : '',
      '',
      `已有教训卡话题（别重复）：${knownTopics.join('、') || '(无)'}`,
    ].join('\n')

    const raw = await callLLM(system, user)
    const out = extractJson(raw)
    if (!out) return 'skip: 复盘输出不可解析（LLM 未返回合法 JSON）'

    // 4a) lessons → wiki（次日决策检索即可命中）
    let lessonCount = 0
    for (const l of out.lessons ?? []) {
      if (typeof l?.topic === 'string' && typeof l?.content === 'string' && l.topic.trim() && l.content.trim()) {
        store.add('reflect', l.topic.trim(), l.content.trim())
        lessonCount++
      }
    }
    // 4b) growth + resolve → MemOS 长线成长记忆
    const growth = (out.growth ?? '').trim()
    const resolve = (out.resolve ?? '').trim()
    let memoSaved = false
    if (growth || resolve) {
      const id = await ctx.mcMemos.remember(username, `【游戏夜进化】${growth}${resolve ? ` 明日之心：${resolve}` : ''}`)
      memoSaved = id !== null
    }
    return `ok: 复盘 个人${memories.length}+世界${loreHits.length} 条 → ${lessonCount} 张新教训卡${memoSaved ? ' + 成长已入长线记忆' : ''}；决心：${resolve.slice(0, 40) || '(未给)'}`
  }

  /**
   * 日记一篇（2026-08-17）：以人格口吻第一人称记下「今天」。
   * 每个现实日最多一篇（lastDiaryDay 兜底 + 世界侧 UNIQUE 双保险）；
   * 写完经 MC 聊天私聊递给女神 → 世界侧 mc-diary 落 world.db + 发实物书。
   * 同时存一份进 MemOS 个人池——未来的自己能「翻见旧日记」。
   */
  async function diaryOnce(username: string): Promise<{ ok: boolean; msg: string }> {
    const seen = new Set<string>()
    const memories: string[] = []
    for (const q of DIARY_QUERIES) {
      const mine = await ctx.mcMemos.recall(username, q, 5)
      for (const line of mine.split('\n')) {
        const t = line.trim()
        if (t && !seen.has(t)) {
          seen.add(t)
          memories.push(t)
        }
      }
    }
    const reg = ctx.mcTransmigrators
    const profile = reg.getByUsername(username)
    const persona = profile?.persona?.slice(0, 1000) ?? ''
    const backstory = profile?.backstory?.slice(0, 600) ?? ''

    const system = [
      '你是这位穿越者本人：深夜睡前，用 TA 的口吻在日记本上写下今天的一页。',
      '第一人称、有情感有细节，像写给自己的信；可以提到具体的人与事，不复述设定。',
      '只输出一个 JSON 对象（不要 markdown 代码块）：{"diary":"120-220 字的日记正文"}',
    ].join('\n')
    const user = [
      `我：${username}${profile?.name && profile.name !== username ? `（${profile.name}）` : ''}`,
      backstory ? `前世：${backstory}` : '',
      persona ? `性格底色：${persona}` : '',
      `今天的事（${memories.length} 条记忆碎片）：`,
      ...memories.slice(0, 15).map((m) => `- ${m}`),
      memories.length === 0 ? '（记忆检索为空——就写一句平淡但真实的一天，比如看到的风景/心里的念头）' : '',
    ].filter(Boolean).join('\n')

    const raw = await callLLM(system, user)
    let diary = ''
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try { diary = (JSON.parse(raw.slice(start, end + 1)) as { diary?: string }).diary ?? '' } catch { /* fallthrough */ }
    }
    if (!diary) return { ok: false, msg: 'skip: 日记输出不可解析' }
    diary = diary.trim().slice(0, 500)

    // 递给女神（世界侧档案馆收件；发不出去也算失败，明晚重写）
    try {
      const bot = ctx.mcbot as unknown as { whisper?: (to: string, msg: string) => void }
      if (typeof bot.whisper !== 'function') return { ok: false, msg: 'skip: bot 尚未就绪（无 whisper）' }
      bot.whisper(config.godName, `日记：${diary}`)
    } catch (e) {
      return { ok: false, msg: `skip: 日记递送失败（${e instanceof Error ? e.message : String(e)}）` }
    }
    // 自己也留一份底（跨重启的「我走过的一天」）
    await ctx.mcMemos.remember(username, `【日记】${diary}`).catch(() => null)
    return { ok: true, msg: `ok: ${diary.length} 字已递档案馆` }
  }

  // 入睡翻沿检测：游戏夜 bot 躺进床的瞬间触发检查（冷却不足静默跳过）。
  // 两件夜间差事独立计闸：进化（cooldownHours 冷却）+ 日记（每现实日一篇）。
  let evolving = false
  async function onSleepTick() {
    if (evolving) return
    const bot = ctx.mcbot as unknown as { username?: string; isSleeping?: boolean } | undefined
    const username = bot?.username ?? ''
    if (!username || !bot?.isSleeping) return
    const state = loadState(statePath)
    const s = state[username] ?? {}
    const now = Date.now()
    const evolveDue = now - (s.lastEvolveAt ?? 0) >= config.cooldownHours * 3600_000
    // 日记失败退避 10 分钟：防止整夜每 30s 重试刷 LLM。
    const diaryDue = config.diaryEnabled
      && s.lastDiaryDay !== localDay()
      && now - (s.diaryFailAt ?? 0) > 600_000
    if (!evolveDue && !diaryDue) return
    evolving = true
    try {
      const parts: string[] = []
      if (diaryDue) {
        const r = await diaryOnce(username)
        if (r.ok) {
          s.lastDiaryDay = localDay()
          parts.push(`日记${r.msg}`)
        } else {
          s.diaryFailAt = now
          parts.push(`日记${r.msg}（10 分钟后重试）`)
        }
      }
      if (evolveDue) {
        const result = await evolveOnce(username)
        s.lastEvolveAt = now
        s.lastResult = `${new Date().toISOString()} ${result}`
        parts.push(`进化：${result}`)
      }
      state[username] = s
      saveState(statePath, state)
      console.log(`[mc-evolve] ${username} 夜间事务：${parts.join('；')}`)
    } catch (e) {
      // 失败不推进冷却，下次入睡重试（state 已在上面成功路径保存；此处尽力存一份）。
      try {
        state[username] = s
        saveState(statePath, state)
      } catch { /* ignore */ }
      console.log(`[mc-evolve] ${username} 夜间事务失败（下次入睡重试）: ${e instanceof Error ? e.message : e}`)
    } finally {
      evolving = false
    }
  }

  // timer 递归调度（同 mc-loop 的 ctx.setTimeout 惯例）：每 30s 查一次入睡状态，
  // 翻沿由「冷却+evolving 闸」天然保证——入睡后第一次满足条件即进化，之后整夜被冷却挡住。
  let stopped = false
  function schedule() {
    if (stopped) return
    ctx.timer.setTimeout(async () => {
      await onSleepTick().catch(() => { /* 自吞错误 */ })
      schedule()
    }, 30_000)
  }
  schedule()
  // 启动后 60s 补查一次（兼容「进程启动时 bot 已在床上」的场景）。
  ctx.timer.setTimeout(() => void onSleepTick(), 60_000)

  console.log(`[mc-evolve] game-night evolution ready (on sleep, cooldown ${config.cooldownHours}h, effort=${config.reasoningEffort})`)
}
