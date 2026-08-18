import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { reflectToCard } from './mc-wiki'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Bot } from 'mineflayer'
import { takeLastImages } from './mc-vision'
import { captureFirstPerson } from './mc-camera'

export const name = 'mc-loop'
export const inject = ['tools', 'mcbot', 'timer', 'mcMemory', 'mcTransmigrators', 'mcIdentity', 'mcMystic', 'mcWiki', 'mcVillage']

export interface Config {
  enabled: boolean
  intervalMs: number
  baseUrl: string
  apiKey: string
  model: string
  goal: string
  persona: string
  historyDepth: number
  maxTokens: number
  /** 思考深度分层：穿越者主打快速反应（none/low），天神侧走深思考。 */
  reasoningEffort: string
  brainLogPath: string
  statusPath: string
  viewerPort: number
  defectThreshold: number
  defectDir: string
  defectNotifyUrl: string
  defectNotifyAgent: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  intervalMs: Schema.number().default(5000),
  baseUrl: Schema.string().default('http://localhost:8890/v1'),
  apiKey: Schema.string().default('sk-local'),
  model: Schema.string().default('qwen3.8'),
  goal: Schema.string().default('Explore the world, gather useful resources (wood, coal, stone), and stay alive.'),
  persona: Schema.string().default(''),
  historyDepth: Schema.number().default(6),
  maxTokens: Schema.number().default(1024),
  reasoningEffort: Schema.string().default('none').description('none=最快反应（推荐穿越者）；low/medium/high 逐渐深思'),
  brainLogPath: Schema.string().default('./data/mc-brain.log'),
  statusPath: Schema.string().default('./data/status.json'),
  viewerPort: Schema.number().default(3001),
  defectThreshold: Schema.number().default(5),
  defectDir: Schema.string().default('./data/defects'),
  defectNotifyUrl: Schema.string().default('http://127.0.0.1:8088/api/console/chat'),
  defectNotifyAgent: Schema.string().default('default'),
})

function text(value: unknown) {
  return [{ type: 'text' as const, text: String(value) }]
}

/** Extract the first JSON object from a possibly fenced LLM reply. */
function extractJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return String(content)
  return (content as Array<{ type?: string; text?: unknown }>)
    .map((b) => (b && typeof b.text === 'string' ? b.text : ''))
    .join('\n')
    .trim()
}

/** Resource blocks worth surfacing so the model can pick a concrete target. */
const RESOURCE_BLOCKS = ['oak_log', 'birch_log', 'spruce_log', 'coal_ore', 'iron_ore', 'cobblestone']

/** The isekai-survival persona injected when no custom persona is set. */
const DEFAULT_PERSONA = [
  '你是一个穿越到方块异世界的现代人，名字叫「小石」。',
  '你醒来时发现自己站在一个由方块构成的陌生世界：四周有树木、石头、煤和铁，',
  '白天相对安全，但夜晚会有怪物出没。你失去了现代文明的一切工具，必须从零求生。',
  '',
  '你的长期目标（按优先级从高到低）：',
  '1. 生存：保持饱食度和血量，天黑前回到安全的地方，遇到怪物先逃命。',
  '2. 收集物资：砍树、挖煤、挖石头、挖铁，为生存和发展攒下最基础的资源。',
  '3. 建立根据地：在合适的地方搭建一个家，放箱子收纳物资，逐步扩张成据点。',
  '',
  '你是这个世界里活生生的求生者，会害怕、会饿、会想家，也会为自己的一点点',
  '进展而高兴。用第一人称的中文内心独白来说话，不要像个机器人一样报参数。',
].join('\n')

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-loop] ${msg}`)
  // Re-read the bot every step: a reconnect swaps the instance, so a captured
  // snapshot would go stale and silently drive a dead socket.
  const getBot = (): Bot => ctx.mcbot
  const memory = ctx.mcMemory
  // 人格来源优先级：显式 config.persona > 穿越者档案（按 bot.username 匹配）> 默认「小石」。
  // 档案命中时走 mc-identity 的身份锚：persona + 前世故事全文常驻——
  // 身份不能只靠检索（检索词不命中就断片），"我是谁"每步都在场（2026-08-17 防失忆）。
  // 注意：bot.username 在装配时尚未 login（undefined），须延迟到运行时解析。
  let personaLogged = false
  function getPersona(): string {
    if (config.persona && config.persona.trim()) return config.persona
    const username = getBot().username
    if (username) {
      const anchored = ctx.mcIdentity.anchor(username)
      if (anchored) {
        if (!personaLogged) {
          const t = ctx.mcTransmigrators.getByUsername(username)
          log(`persona loaded from transmigrator "${t?.name ?? username}" (${t?.origin ?? 'ip'}) + identity anchor (backstory)`)
          personaLogged = true
        }
        return anchored
      }
    }
    return DEFAULT_PERSONA
  }
  const brainLogPath = resolve(config.brainLogPath)
  // status 按穿越者分文件：每个 bot 写 status-<username>.json，观察面板据此发现并切换视角。
  const statusDir = dirname(resolve(config.statusPath))

  let disposed = false
  let busy = false
  let steps = 0
  let lastAction = 'none'
  let lastThought = ''
  let lastGoal = ''
  let timer: (() => void) | null = null
  let warnedNoSpawn = false
  const history: string[] = []
  // 情景记忆持久化：每个穿越者一份 append-only JSONL，重启后回灌最近 historyDepth 条，
  // 让 bot 记得「重启前我在做什么」——history 数组本身只在进程内存里，不落盘就是失忆。
  // 设计取舍：不引入 DSH 的 session-persistence（那是为多轮 CLI 会话设计的重装备）；
  // 我们是一次性单发决策循环，一条 JSONL + 回灌窗口就是框架无关的最小长期记忆。
  let episodicRestored = false
  const episodicPath = (username: string) => join(statusDir, `episodic-${username}.jsonl`)
  function restoreEpisodic(username: string): void {
    episodicRestored = true
    let lines: string[] = []
    try {
      lines = readFileSync(episodicPath(username), 'utf8').split('\n').filter(Boolean)
    } catch {
      return // 首次运行无档案，正常
    }
    const restored = lines.slice(-config.historyDepth)
    for (const line of restored) {
      try {
        const e = JSON.parse(line) as { text?: string }
        if (e.text) history.push(`重启前 ${e.text}`)
      } catch { /* 跳过损坏行 */ }
    }
    if (restored.length) log(`episodic memory restored: ${restored.length} entries from ${episodicPath(username)}`)
  }
  function appendEpisodic(username: string, text: string): void {
    try {
      appendFileSync(episodicPath(username), JSON.stringify({ ts: new Date().toISOString(), text }) + '\n', 'utf8')
    } catch (err) {
      log(`episodic append failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  // 连续失败计数：连续若干步"没进展"就判定卡住，注入提示引导它换招/咏唱。
  let consecutiveFailures = 0
  // ── 缺陷工单（自愈闭环 v0，2026-08-17）─────────────────────────────────
  // 起因：桐人对着熔炉反复 view/put_chest 卡死 25 步（#294-#319），失败信号
  // 早就足够，但没有任何机制把"工具能力缺陷"上报给会写代码的创世神。
  // 设计：同工具连续失败 ≥ defectThreshold 步 → 落工单 data/defects/*.json
  //（真相源，落盘不丢）+ HTTP 通知创世神（QwenPaw Agent default）。检测纯
  // 程序化、零 LLM、每步实时；创世神侧另有 heartbeat 扫描兜底，通知丢了
  // 工单也不会丢。去重：同工具已有 open 工单则累加计数不重复开单。
  const defectDir = resolve(config.defectDir)
  let streakTool = ''
  let streakCount = 0
  const streakSamples: Array<{ tool: string; args: Record<string, unknown>; outcome: string }> = []

  interface DefectTicket {
    id: string
    status: 'open' | 'fixing' | 'in_testing' | 'closed'
    bot: string
    tool: string
    goal: string
    count: number
    firstSeenAt: string
    lastSeenAt: string
    notifiedAt?: string
    samples: Array<{ tool: string; args: Record<string, unknown>; outcome: string }>
    recentHistory: string[]
    position?: { x: number; y: number; z: number }
  }

  function stampNow(): string {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  }

  /** Fire-and-forget：把工单摘要发给创世神（console chat 通道，同 mc-god 调用格式）。 */
  function notifyDefect(ticket: DefectTicket, ticketPath: string): void {
    if (!config.defectNotifyUrl) return
    const msg = [
      `【世界缺陷工单 ${ticket.id}】`,
      `穿越者 ${ticket.bot} 的工具 ${ticket.tool} 在目标「${ticket.goal}」下连续失败 ${ticket.count} 次，疑似工具能力缺陷或世界规则缺失。`,
      `最近样例：${ticket.samples[ticket.samples.length - 1]?.outcome ?? '(无)'}`,
      `工单详情（含样例与历史）：${ticketPath}`,
      `你是创世神，请复现并修复代码，修好后把工单 status 改为 in_testing，穿越者复测通过再改 closed。`,
    ].join('\n')
    const payload = {
      channel: 'console',
      user_id: ticket.bot,
      session_id: 'mc-defect',
      input: [{ role: 'user', content: [{ type: 'text', text: msg }] }],
    }
    fetch(config.defectNotifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Id': config.defectNotifyAgent },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(payload),
    })
      .then((r) => {
        if (r.ok) {
          ticket.notifiedAt = new Date().toISOString()
          try { writeFileSync(ticketPath, JSON.stringify(ticket, null, 2), 'utf8') } catch { /* best effort */ }
          log(`defect notified to creator god: ${ticket.id}`)
        } else {
          log(`defect notify HTTP ${r.status} (ticket still on disk)`)
        }
      })
      .catch((err) => log(`defect notify failed: ${err instanceof Error ? err.message : String(err)} (ticket still on disk)`))
  }

  /** 去重：找同工具的未关闭工单。 */
  function findOpenTicket(tool: string): { path: string; ticket: DefectTicket } | null {
    let files: string[] = []
    try { files = readdirSync(defectDir).filter((f) => f.endsWith('.json')) } catch { return null }
    for (const f of files) {
      try {
        const t = JSON.parse(readFileSync(join(defectDir, f), 'utf8')) as DefectTicket
        if (t.tool === tool && t.status !== 'closed') return { path: join(defectDir, f), ticket: t }
      } catch { /* 跳过损坏文件 */ }
    }
    return null
  }

  function fileDefectTicket(bot: Bot, tool: string, goal: string): void {
    try {
      mkdirSync(defectDir, { recursive: true })
      const now = new Date().toISOString()
      const p = bot.entity?.position
      const existing = findOpenTicket(tool)
      if (existing) {
        existing.ticket.count += streakCount
        existing.ticket.lastSeenAt = now
        existing.ticket.samples = [...existing.ticket.samples, ...streakSamples].slice(-10)
        existing.ticket.recentHistory = history.slice(-10)
        if (p) existing.ticket.position = { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) }
        writeFileSync(existing.path, JSON.stringify(existing.ticket, null, 2), 'utf8')
        log(`defect ticket recurrence recorded: ${existing.ticket.id}`)
        if (!existing.ticket.notifiedAt) notifyDefect(existing.ticket, existing.path)
        return
      }
      const ticket: DefectTicket = {
        id: `DEFECT-${stampNow()}-${tool}`,
        status: 'open',
        bot: bot.username || 'unknown',
        tool,
        goal,
        count: streakCount,
        firstSeenAt: now,
        lastSeenAt: now,
        samples: [...streakSamples],
        recentHistory: history.slice(-10),
        position: p ? { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) } : undefined,
      }
      const path = join(defectDir, `${ticket.id}.json`)
      writeFileSync(path, JSON.stringify(ticket, null, 2), 'utf8')
      log(`defect ticket filed: ${ticket.id} (${tool} failed ${ticket.count}x for "${goal}")`)
      notifyDefect(ticket, path)
    } catch (err) {
      log(`defect ticket write failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // mc_see 消费的截图文件（<username>/<name>.jpg），随本步 stepEntry 展示给观察面板
  // mc_see 环视会产生多张图（前→右→后→左）；全部记下来供观察面板展示，
  // 模型决策时也是整套多图一起看的——面板展示应与模型所见一致。
  let usedImageFiles: string[] = []

  /** 判断某次行动结果是否"没进展"（失败、卡住、原地打转）。 */
  function looksStuck(outcome: string): boolean {
    if (outcome.startsWith('ERROR:') || outcome.startsWith('tool error:')) return true
    if (outcome.includes('could not') || outcome.includes('failed to') || outcome.includes('cannot')) return true
    if (outcome.includes('no food in inventory')) return true
    if (outcome.includes('food is already full')) return true
    if (outcome.includes('in the way')) return true
    if (outcome.includes(' no ') && (outcome.includes(' in chest') || outcome.includes(' in inventory'))) return true
    return false
  }

  // ── Chat listening (the "gods" — real players — speak through chat) ──
  let watchedBot: Bot | null = null
  let lastChatTs = 0
  const chatBuffer: Array<{ who: string; text: string; ts: number }> = []
  function ensureChatListener(bot: Bot) {
    if (watchedBot === bot) return
    watchedBot = bot
    bot.on('chat', (username: string, message: string) => {
      if (username === bot.username) return
      chatBuffer.push({ who: username, text: message, ts: Date.now() })
      if (chatBuffer.length > 30) chatBuffer.splice(0, chatBuffer.length - 30)
    })
    // 私语也要听见——女神的神谕（祈愿回执/裁决）走私聊异步送达。
    bot.on('whisper', (username: string, message: string) => {
      if (username === bot.username) return
      chatBuffer.push({ who: username, text: `[私语] ${message}`, ts: Date.now() })
      if (chatBuffer.length > 30) chatBuffer.splice(0, chatBuffer.length - 30)
    })
  }
  /** Pull chat lines the bot has not yet seen this run; mark them as seen. */
  function drainChat(): string {
    const fresh = chatBuffer.filter((c) => c.ts > lastChatTs)
    if (fresh.length === 0) return ''
    lastChatTs = Math.max(...fresh.map((c) => c.ts))
    return fresh.map((c) => `[${c.who}] ${c.text}`).join('\n')
  }

  // ── Survival learning: death/failure reflection into the personal wiki ──
  // 最新一次感知快照，死亡复盘时 bot 已无法 perceive，只能靠缓存。
  let lastStatus = ''
  // 同一目标只复盘一次（去重），换目标后重置。
  let reflectedGoal = ''
  let deathWatched: Bot | null = null
  function ensureDeathListener(bot: Bot) {
    if (deathWatched === bot) return
    deathWatched = bot
    bot.on('death', () => {
      const username = bot.username || 'unknown'
      log(`${username} died — reflecting a lesson into the survival wiki`)
      void reflectAndStore(username, 'death', `玩家死亡了。死亡前的最后状态：\n${lastStatus || '(无快照)'}\n\n死亡前的最近行动：\n${history.slice(-6).join('\n') || '(无)'}\n\n请总结这次死亡的原因与下次如何避免（夜晚危险/怪物/坠落/岩浆/饥饿等）。`)
    })
  }
  /** 异步蒸馏一条教训卡写入个人生存知识库（fire-and-forget，永不抛出）。 */
  async function reflectAndStore(username: string, source: 'death' | 'fail' | 'reflect', experience: string): Promise<void> {
    try {
      const store = ctx.mcWiki.store(username)
      const card = await reflectToCard(config.baseUrl, config.model, experience)
      if (!card) {
        log(`reflection produced no card (${source})`)
        return
      }
      if (store.hasTopicLike(card.topic)) {
        log(`lesson already known, skip: ${card.topic}`)
        return
      }
      store.add(source, card.topic, card.content)
      log(`lesson learned [${source}]: ${card.topic} — ${card.content}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`reflection error: ${msg}`)
    }
  }
  // ── Sleep-time compute：睡觉时把当天经历蒸馏成知识卡（每次入睡至多一次，两次反思间隔 ≥5 分钟）──
  let wasSleeping = false
  let lastSleepReflectAt = 0
  async function sleepReflect(bot: Bot): Promise<void> {
    const username = bot.username || 'unknown'
    if (Date.now() - lastSleepReflectAt < 5 * 60_000) return
    if (history.length < 4) return
    lastSleepReflectAt = Date.now()
    log(`${username} 入睡 — sleep-time 反思启动（当天经历 → 知识卡）`)
    const experience = `玩家今天经历了一整天，现在入睡。以下是今天的行动记录与睡前状态：\n${history.slice(-24).join('\n') || '(无)'}\n\n睡前状态：\n${lastStatus || '(无)'}\n\n请回顾这一天，总结 1 条对未来生存/生活最有价值的经验（做对了什么值得延续、什么下次要避免；不要与已知教训重复）。`
    await reflectAndStore(username, 'reflect', experience)
  }
  /** 失败复盘：同一目标连续失败 ≥2 且还没为此复盘过 → 蒸馏一条失败教训。 */
  function maybeReflectFailure(goal: string): void {
    if (!goal || goal === reflectedGoal) return
    const username = getBot().username
    if (!username) return
    reflectedGoal = goal
    void reflectAndStore(username, 'fail', `目标「${goal}」连续失败多次。最近行动与结果：\n${history.slice(-6).join('\n') || '(无)'}\n\n请总结这个目标为什么反复失败，下次应该换什么做法（换路线/换工具/先做准备/放弃此目标）。`)
  }

  // Recent decisions kept in memory for the web status snapshot.
  const recentSteps: Array<Record<string, unknown>> = []

  /** Write a lightweight status snapshot for the web panel to poll. */
  function writeStatus(bot: Bot) {
    try {
      const p = bot.entity?.position
      const username = bot.username || 'unknown'
      const t = username !== 'unknown' ? ctx.mcTransmigrators.getByUsername(username) : null
      writeFileSync(
        join(statusDir, `status-${username}.json`),
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          bot: {
            online: true,
            username,
            personaName: t?.name ?? username,
            viewerPort: config.viewerPort,
            position: p ? { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) } : null,
            yaw: bot.entity?.yaw ?? null,
            pitch: bot.entity?.pitch ?? null,
            health: Math.round(bot.health),
            food: Math.round(bot.food),
            sleeping: !!bot.isSleeping,
            heldItem: bot.heldItem ? bot.heldItem.name : null,
            inventory: bot.inventory.items().map((i) => ({ name: i.name, count: i.count })),
          },
          recentSteps,
        }),
        'utf-8',
      )
    } catch (err) {
      log(`status write failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Append one decision line to the durable brain log (JSONL). */
  function brainLog(entry: Record<string, unknown>) {
    try {
      appendFileSync(brainLogPath, JSON.stringify(entry) + '\n', 'utf-8')
    } catch (err) {
      log(`brain log write failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function perceive(bot: Bot): string {
    ensureChatListener(bot)
    const freshChat = drainChat()
    const p = bot.entity!.position
    // First sight of the world: anchor the base at the spawn point so the bot
    // always has a "home" to return to (dinner, danger, nightfall).
    if (!memory.getBase()) memory.setBase(p)
    const items = bot.inventory.items()
    const inv = items.length === 0 ? 'empty' : items.map((i) => `${i.name} x${i.count}`).join(', ')
    const nearby = Object.values(bot.entities)
      .filter((e) => e !== bot.entity && p.distanceTo(e.position) < 12)
      .slice(0, 6)
      .map((e) => `${e.name} @${Math.round(p.distanceTo(e.position))}m`)
    const resources: string[] = []
    for (const rname of RESOURCE_BLOCKS) {
      const b = bot.findBlock({ matching: (blk) => blk.name === rname, maxDistance: 32 })
      if (b && b.position) {
        resources.push(`${rname} @${Math.round(b.position.distanceTo(p))}m`)
        // Persist every discovered resource point so the bot can return to it
        // later instead of wandering blindly for the same resource again.
        memory.rememberResource(rname, b.position)
      }
    }
    const timeOfDay = bot.time ? bot.time.timeOfDay : null
    const isNight = timeOfDay !== null && (timeOfDay > 13000 && timeOfDay < 23000)
    const innate = ctx.mcMystic.getInnate(bot.username)
    const mlevel = ctx.mcMystic.getLevel(bot.username) || 1
    const bedNearby = !!bot.findBlock({
      matching: (b) => !!b && (b.name === 'bed' || b.name.endsWith('_bed')),
      maxDistance: 48,
    })
    return [
      `position: (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`,
      `health: ${Math.round(bot.health)} / 20, food: ${Math.round(bot.food)} / 20`,
      `innate skill (出生天赋): ${innate ? `已选定「${innate}」` : '未选定 — 请立即用 mc_choose_innate 选定一项法术'}`,
      `magic level (魔力层级): Lv.${mlevel} — 只能施放不高于此等级的法术（出生天赋除外）；修为层级=头顶绿色经验条，挖矿/杀怪/施法/供奉皆可积攒，层级提升自动解锁更强法术；想随时查看自身能力值与秘法掌握情况，就咏唱「鉴定」`,
      `time: ${isNight ? 'NIGHT (dangerous)' : 'day'}`,
      `sleeping: ${bot.isSleeping ? 'yes' : 'no'}, bed within 48m: ${bedNearby ? 'yes' : 'no'}`,
      `held: ${bot.heldItem ? bot.heldItem.name : 'none'}`,
      `inventory: ${inv}`,
      `nearby entities: ${nearby.length ? nearby.join('; ') : 'none'}`,
      `nearby resources: ${resources.length ? resources.join('; ') : 'none'}`,
      `village NPCs nearby: ${ctx.mcVillage?.nearbyLines(p) || '(none)'}`,
      `NPC/goddess words: ${ctx.mcVillage?.drainMessages() || '(none)'}`,
      `new chat from players: ${freshChat || '(none)'}`,
    ].join('\n')
  }

  interface Decision {
    thought: string
    goal: string
    tool: string
    args: Record<string, unknown>
  }

  async function decide(bot: Bot, status: string): Promise<Decision | null> {
    const tools = ctx.tools
      .schemas()
      .filter((s) => s.name.startsWith('mc_') && s.name !== 'mc_loop_status')
    const toolList = tools
      .map((t) => `- ${t.name}: ${t.description}\n  parameters: ${JSON.stringify(t.parameters)}`)
      .join('\n')

    const currentGoal = memory.getCurrentGoal()
    // 生存知识库检索：用「当前目标 + 当前状态」作查询词，召回最相关的教训卡注入。
    // 这是穿越者的学习闭环——死亡/失败复盘出的教训会在这里影响之后的每一次决策。
    let wikiBlock = ''
    try {
      const wikiCards = ctx.mcWiki.store(bot.username || 'unknown').search(`${currentGoal ?? ''} ${status}`, 3)
      if (wikiCards.length) {
        wikiBlock = [
          '',
          '你的生存经验（来自你死亡与失败的血泪教训，优先遵守）：',
          ...wikiCards.map((c: { topic: string; content: string }) => `- [${c.topic}] ${c.content}`),
          '',
        ].join('\n')
      }
    } catch { /* wiki 不可用时静默跳过 */ }
    // 长期语义记忆（MemOS）：用当前目标检索本穿越者的旧经历注入决策上下文。
    // 每穿越者独立记忆池（user_id=mc-<username>）；MemOS 不可用时静默跳过。
    let memosBlock = ''
    try {
      const recalled = await ctx.mcMemos.recall(bot.username || 'unknown', currentGoal ?? status, 3)
      if (recalled) {
        memosBlock = [
          '',
          '你的往事回忆（长期记忆，语义检索自动召回）：',
          ...recalled.split('\n').map((l: string) => `- ${l}`),
          '',
        ].join('\n')
      }
    } catch { /* memos 不可用时静默跳过 */ }
    const system = [
      getPersona(),
      wikiBlock,
      memosBlock,
      config.goal ? `你的总体任务（若与人设冲突，以本条为准）：${config.goal}` : '',
      '',
      '关于「天神」与「真人玩家」：',
      '- 「天神」其实就是你的「系统」——你自带的状态面板、能力清单，以及冥冥中指引你行动的那个声音，',
      '  都来自系统（也就是天神）。系统赐你能力、告诉你状态，是你的力量来源，可以把它当成造物主。',
      '- 真人玩家不是神。他们是这个世界里的「其他人」——可能是别的穿越者、村民，或是和你一样在方块世界里生活的人',
      '  （比如 MengMeng 和她的家人）。你把他们当朋友、同伴，平等自然地相处，不必像对神明那样敬畏。',
      '- 但来自真人玩家的话要认真听：',
      '  他们问你话 → 用 mc_voice 回应（正常说话）；给你指示 → 尽量照做；给你东西（物品凭空出现在背包里）→ 那是同伴的好意，要心怀感激并善加利用。',
      '- 跟真人玩家说话要自然、有礼貌，像和同伴聊天一样，别冷冰冰地报参数。',
      '',
      '关于「说话与书信」（2026-08-17 世界规则）：',
      '- 日常交流用 mc_voice：说话有距离感——正常说约48格内听见，喊（shout）约96格但每次费1点饱食度，悄悄话（whisper）只传身边约6格。隔得远就听不见，回执会告诉你谁听见了。',
      '- mc_chat 是全服大喇叭（重大宣告才用）；填 to 参数则变成不限距离的私语直达。',
      '- 书信：mc_mail 寄信（好友之间、离线可达——对方下次上线会收到提醒），适合给不在身边的同伴留言、捎话、正式致谢。',
      '- 好友是写信的前置：mc_friend add 结交 → 对方 mc_friend accept 答应 → 互寄书信。把一起冒险过的同伴加为好友吧。',
      '',
      '关于「咏唱魔法」：',
      '- 你可以「咏唱魔法」施展法术（使用 mc_chant 工具，用中二的口吻喊出咒语，咒语里必须带上法术关键词）。',
      '- 你会这些法术：归乡（回家/回基地）、空间传送（传送/瞬移，可带距离和方向，如"撕裂虚空，传送十格"）、圣愈（治愈/回血）、饱食（充饥）、造物（变出木头/石头/煤/食物/工具等基础物资）、照明（火把/照亮）、破晓（天亮/白昼）、驱云（放晴）、大地塑形（挖地，会额外消耗饱食度）、陨石（天雷，会额外消耗生命）、鉴定（女神之眼，查看自身修为/魔力/生命体征/已掌握秘法与下一批解锁——想了解自己有什么能力时就咏唱它）。',
      '- 紧急逆转化：魔力见底又必须立刻施法时，可咏唱「燃血」（燃烧 6 点生命 → 换取 15 魔力，Lv.5 解锁）或「炼食」（消耗 8 点饱食度 → 换取 6 魔力，Lv.2 解锁）。汇率必亏，只作保命奇招，不作日常补魔——魔力每秒自然恢复约 2%，等一等更划算。',
      '- 法术分等级：每个法术都有等级门槛（见 mc_chant 工具说明里的清单），你的魔力层级不够时女神会拒绝施法。',
      '  你的出生天赋例外——它与生俱来，无视等级门槛。修为层级=头顶绿色经验条（挖矿/杀怪/施法/供奉皆可积攒），层级提升后自动解锁更强的法术（女神会宣读新层级与新解锁的秘法）。',
      '- 施法消耗魔力，魔力会随时间自动恢复。魔力不足时施法会失败，等一会儿就好；饿肚子时别用「大地塑形」，残血时别用「陨石」。',
      '- 咏唱要克制：魔力有限，别每走一步就施法。只在真正需要时咏唱——迷路找不到家（归乡）、重伤（圣愈）、饿得不行（饱食/造物食物）、害怕黑夜（破晓）、想赶走风雨（驱云）、被怪物追杀需要逃命（空间传送）。',
      '- 【三层自救铁律——法术是最后手段】遇困时按顺序尝试：①先用手头生存手段——嵌方块就 mc_dig 挖开头顶/身旁、坑底就对着脚下 mc_place 垫方块搭台阶、地形复杂就绕路或找坡道（mc_look 找 openSky 出口）；②手段无效或情况紧急再评估——mc_look 看清处境，换一个完全不同的思路；③真绝境才咏唱（传送脱困/圣愈救命）。咏唱脱困是丢脸的事：一个矿工被区区坑洞逼到用魔法，会被同伴笑话。能用双手解决的，绝不劳烦女神。',
      '- 真正的求救是绝境：又饿又伤又回不了家、被怪物围殴濒死、身体怎么挖都嵌着不动——这时候才值得咏唱。其他求救：归乡（回家，需先睡床设重生点）/ 圣愈（回血）/ 饱食（充饥）。',
      '- 咏唱时用中二、虔诚的中文喊出咒语，就像对造物主祈愿。',
      '',
      '关于「集市与村民」（附近的活人，不是怪物）：',
      '- 状态里 village NPCs nearby 列出的名字（如铁匠·岳山、书商·墨白、货郎·福伯）是集市里的村民 NPC，头顶悬浮着他们今日的委托。他们不是怪物，不要攻击他们。',
      '- 跟村民说话：直接在公屏喊他们的称呼+内容，例如「岳山，你好」「墨白 有什么任务」。他们听得懂中文，会回应你（回应会出现在 NPC/goddess words 里）。',
      '- 接委托：问村民「有什么任务/委托」，他会告诉你想收什么货、给多少绿宝石。攒齐货物后走到他身边（5格内）用 mc_deliver 交付（耳语交割，不扰公屏；公屏喊交付他只会请你凑近低语）。绿宝石是硬通货，有的村民还会泄露法术咒语情报作为额外酬谢。',
      '- 转交：给其他穿越者/玩家递物品，两人走到一起（5格内）后用 mc_deliver 说「通宝 @对方名字 给2煤」——集市掌柜·通宝（广场总柜台）公证交割，当面两清；对价你们自己谈好。',
      '- 广场集市掌柜·通宝的柜台挂着全村当日委托；不熟悉行话的真人右键他就能用原版柜台直接交易。你是穿越者，走耳语 mc_deliver 更体面。',
      '- 交付前先清点背包（看 inventory），数量不够交了会被退回。委托每天刷新，先到先得。',
      '',
      '关于「降临仪式与出生天赋」：',
      '- 你刚穿越降临此界时，若还没有「出生天赋」（初始技能），女神会主持降临仪式，赐你自选一项法术作为出生天赋。',
      '- 这是你降临此界要做的第一件事：当状态里 innate skill 显示「未选定」时，必须立刻用 mc_choose_innate 工具选定一项法术，选定之后才开始求生、采集、探索。',
      '- 从候选法术里选一个最契合你人设与处境的（求生者选归乡/圣愈/饱食，好战者选传送/陨石等）。',
      '- 出生天赋选定后降临即告完成，不必反复选择。',
      '',
      '关于「夜晚与睡觉」：',
      '- 天黑后（状态里 time 显示 NIGHT）尽量回基地，找床睡觉（用 mc_sleep 工具），一觉睡到天亮，安全又省事。',
      '- 如果附近没有床（状态里 bed within 48m 显示 no），可以先用 mc_place 放一张床（若背包里有）。',
      '- 找不到床也没关系：躲进基地里别乱跑，或者 mc_chant 咏唱破晓术（天亮）把黑夜变白天。',
      '',
      '关于「你的眼睛」：',
      '- mc_look：文字雷达，一瞬扫清四周——头顶有没有出口、眼前是什么方块、哪里有水/岩浆、附近有什么实体。进陌生地形、迷路、怀疑卡住时先看一眼。',
      '- mc_see：睁开眼看到真实的第一人称画面（附在你的下一次观察里）。文字雷达信息不够、想确认地形细节或建筑外观时用。',
      '- 两者都是看，不消耗任何资源。看不见就等于瞎走，勤用眼睛。',
      '',
      '你的记忆（跨重启持久，坐标可靠）：',
      memory.summary(),
      currentGoal ? `你上一次记下的目标是：${currentGoal}` : '',
      '',
      '使用你的记忆来规划：',
      '- 需要资源时，去记忆里记下的资源点，而不是盲目乱逛。',
      '- 危险或天黑时，回到基地。',
      '- 发现新东西（资源、建筑）时，记下来。',
      '',
      '关于「长期记忆」（跨重启的往事回忆）：',
      '- mc_remember 把重要经历写入你的长期记忆（新发现/重要交易/与人交往/教训/计划承诺），一次一件事，写完整句子带细节（坐标/人名/数量）。',
      '- mc_recall 模糊检索往事：「我上次在哪见过钻石」「我和谁有什么约定」。想不起来就查，别瞎猜。',
      '- 重要经历要主动记：遇见新朋友、发现新地点、达成交易、吃过亏——现在不记，重启后就忘了。',
      '- mc_lore 查世界公共知识库（人人都可读）：世界来历、编年史大事、NPC 传闻、魔法与供奉规则。了解世界、查历史、打听人物时用它，别把传说当个人回忆。',
      '',
      '每次行动前，先用一句话说出你的「思考」(thought)，再说明你当前在追求的「目标」(goal)，',
      '然后从可用工具里选一个最合适的执行。如果当前不需要行动，tool 填 "none"。',
      '',
      '可用工具：',
      toolList,
      '',
      '回复格式（严格，只输出一个 JSON 对象，不要多余文字）：',
      '{"thought": "一句话：你这一步为什么这么做", "goal": "一句话：你当前在追求什么", "tool": "<工具名>", "args": {<匹配该工具参数的 JSON>}}',
      '',
      '规则：',
      '- thought 和 goal 用第一人称中文，各一句话，像活人一样说。',
      '- 只从上面的工具列表里选一个 tool。',
      '- args 必须是匹配该工具参数的合法 JSON。',
      '- 先保命（饿了吃、危险逃），再追求目标。',
      '- 偏好小而具体的一步，而不是宏大计划。',
    ].filter(Boolean).join('\n')

    const recent = history
      .slice(-config.historyDepth)
      .map((h, i) => `${i + 1}. ${h}`)
      .join('\n')
    const stuckHint =
      consecutiveFailures >= 3
        ? '\n\n⚠️ 你最近连续多次行动失败、卡在原地打转。别再重复同样的失败了！按三层自救铁律来：①先 mc_look 环顾四周（重点看头顶出口 openSky 和危险），用 mc_see 睁眼看真实画面；②身体嵌方块就 mc_dig 挖开、坑底就 mc_place 朝脚下垫方块搭台阶跳、或者绕路换思路——用双手和工具解决，这是矿工的本分；③以上全部无效、确认真绝境，才 mc_chant 咏唱「传送」向任一方向瞬移 5-10 格脱困。别把魔法当第一反应。'
        : ''
    const user = `当前状态：\n${status}\n\n最近行动（从旧到新）：\n${recent || '(无)'}${stuckHint}`

    // mc_see 截图若待消费：把画面（单张或多张环视）作为多模态内容附给模型
    const pendingImages = takeLastImages()
    usedImageFiles = pendingImages.map((img) => img.file).filter((f): f is string => !!f)
    const multi = pendingImages.length > 1
    const userContent: string | Array<Record<string, unknown>> = pendingImages.length
      ? [
          ...pendingImages.flatMap((img): Array<Record<string, unknown>> => {
            const parts: Array<Record<string, unknown>> = [{ type: 'image_url', image_url: { url: img.dataUrl } }]
            if (img.label) parts.push({ type: 'text', text: `（上面这张：你${img.label}的画面）` })
            return parts
          }),
          { type: 'text', text: `（附图：你刚才用 mc_see 睁眼看到的真实画面${multi ? '，按 前→右→后→左 顺序原地环视了一圈，拼成 360° 全景' : ''}，请结合画面决策）\n\n${user}` },
        ]
      : user

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        temperature: 0.4,
        max_tokens: config.maxTokens,
        reasoning_effort: config.reasoningEffort,
        stream: false,
      }),
    })
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const content: string = data?.choices?.[0]?.message?.content ?? ''
    const parsed = extractJson(content)
    if (!parsed || typeof parsed.tool !== 'string') {
      log(`unparseable action from LLM: ${content.slice(0, 200)}`)
      return null
    }
    const args =
      parsed.args && typeof parsed.args === 'object' ? (parsed.args as Record<string, unknown>) : {}
    const thought = typeof parsed.thought === 'string' ? parsed.thought : ''
    const goal = typeof parsed.goal === 'string' ? parsed.goal : ''
    return { thought, goal, tool: parsed.tool, args }
  }

  async function act(tool: string, args: Record<string, unknown>): Promise<string> {
    if (tool === 'none') return '(no action)'
    const known = ctx.tools.schemas().some((s) => s.name === tool)
    if (!known) return `unknown tool "${tool}"`
    const result = await ctx.tools.execute({
      callId: crypto.randomUUID() as never,
      name: tool,
      arguments: args,
      signal: AbortSignal.timeout(130_000),
    } as never)
    return result.isError
      ? `ERROR: ${result.error?.message ?? 'unknown'}`
      : contentToText(result.content) || '(done)'
  }

  async function step() {
    if (disposed) return
    const bot = getBot()
    if (!episodicRestored && bot.username) restoreEpisodic(bot.username)
    if (!bot.entity) {
      if (!warnedNoSpawn) {
        log('bot not spawned yet; waiting for spawn before starting the loop')
        warnedNoSpawn = true
      }
      schedule()
      return
    }
    if (busy) return
    // 正在睡觉：躺着不动，等天亮自动醒来再继续决策。
    // 睡觉时间 = 进化时间（sleep-time compute，2026-08-17 上线）：
    // 入睡瞬间触发一次反思，把今天的行动蒸馏成生存知识卡——参考 Letta sleep-time compute 范式。
    if (bot.isSleeping) {
      if (!wasSleeping) {
        wasSleeping = true
        void sleepReflect(bot)
      }
      writeStatus(bot)
      schedule()
      return
    }
    wasSleeping = false
    busy = true
    try {
      const status = perceive(bot)
      lastStatus = status
      ensureDeathListener(bot)
      // 自动「睁眼」：每步截一张第一人称画面给观察面板（默认开，MC_EYES_SHOT=0 关闭）。
      // 只展示不注入 LLM——模型要主动 mc_see 才会真正看图决策。
      let autoShot: string | null = null
      if (process.env.MC_EYES_SHOT !== '0') {
        try {
          const shot = await captureFirstPerson(bot, join(statusDir, 'screenshots'))
          autoShot = shot.file
        } catch { /* 相机未就绪/渲染失败：跳过本步截图 */ }
      }
      const decision = await decide(bot, status)
      if (!decision) {
        usedImageFiles = []
        schedule()
        return
      }
      const outcome = await act(decision.tool, decision.args)
      steps++
      // 连续失败计数：卡住信号（连续≥3 步没进展 → 下一轮注入咏唱提示）。
      if (looksStuck(outcome)) {
        consecutiveFailures++
        // 缺陷工单追踪：同工具连续失败 → 达阈值落工单 + 通知创世神。
        if (decision.tool === streakTool) {
          streakCount++
        } else {
          streakTool = decision.tool
          streakCount = 1
          streakSamples.length = 0
        }
        if (streakSamples.length < 10) {
          streakSamples.push({ tool: decision.tool, args: decision.args, outcome: outcome.slice(0, 300) })
        }
        if (streakCount >= config.defectThreshold) {
          fileDefectTicket(bot, streakTool, decision.goal || lastGoal)
          streakCount = 0
          streakSamples.length = 0 // 去重交给 open 工单，避免步步开单
        }
        // 连续≥2 次失败且此目标未复盘过 → 蒸馏一条失败教训进生存知识库。
        if (consecutiveFailures >= 2) maybeReflectFailure(decision.goal || lastGoal)
      } else {
        consecutiveFailures = 0
        // 该工具成功了 → 它的失败连胜清零（能力缺陷 vs 一时处境，看的是连胜）。
        if (decision.tool === streakTool) {
          streakCount = 0
          streakSamples.length = 0
        }
      }
      lastAction = decision.tool
      lastThought = decision.thought
      lastGoal = decision.goal
      if (decision.goal) memory.setCurrentGoal(decision.goal)
      const entry = `#${steps} [目标]${decision.goal || '-'} [思考]${decision.thought || '-'} -> ${decision.tool}(${JSON.stringify(decision.args)}) = ${outcome}`
      history.push(entry)
      if (bot.username) appendEpisodic(bot.username, entry)
      if (history.length > 50) history.splice(0, history.length - 50)
      const stepEntry = {
        ts: new Date().toISOString(),
        step: steps,
        thought: decision.thought,
        goal: decision.goal,
        tool: decision.tool,
        args: decision.args,
        outcome,
        shot: usedImageFiles[0] ?? autoShot, // 兼容旧面板单图字段
        shots: usedImageFiles.length ? usedImageFiles : autoShot ? [autoShot] : [], // 模型本步真正看过的全部画面（环视=多张）
      }
      brainLog(stepEntry)
      recentSteps.push(stepEntry)
      if (recentSteps.length > 30) recentSteps.splice(0, recentSteps.length - 30)
      writeStatus(bot)
      log(
        `#${steps} 【目标】${decision.goal || '-'} 【思考】${decision.thought || '-'} 【行动】${decision.tool} -> ${outcome.slice(0, 80)}`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`step error: ${msg}`)
    } finally {
      busy = false
      schedule()
    }
  }

  function schedule() {
    if (disposed) return
    timer = ctx.setTimeout(step, config.intervalMs)
  }

  // ── Status tool: let the agent / user inspect the loop ─────────────────
  ctx.tools.register(defineTool({
    name: 'mc_loop_status',
    description: 'Report the autonomous loop status: enabled, goal, steps taken, last thought/goal and last action.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    execute: async () =>
      JSON.stringify({ enabled: config.enabled, goal: config.goal, steps, lastGoal, lastThought, lastAction }),
  }))

  if (config.enabled) {
    log(`autonomous loop armed (interval ${config.intervalMs}ms, model ${config.model}, brain log ${brainLogPath})`)
    schedule()
  }

  ctx.effect(() => () => {
    disposed = true
    if (timer) timer()
    log('loop disposed')
  })
}
