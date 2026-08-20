/**
 * mc-session —— 穿越者以「dsh session agent」形态存活的心跳插件。
 *
 * 背景（2026-08-19 定调）：旧 mc-loop 是「进程级单例 + 自驱 LLM」，自己调
 * 官方 adapter 接口、自己攒 prompt，绕过了 dsh 的 agent/session/loop 全套。
 * 现在穿越者 = 独立 dsh session agent：新建智能体（名字/背景故事）→ 独立
 * session → 本插件用 Timer 数秒 steer 一次，persona / 规则 / 状态快照全部走
 * 官方 system-prompt section / context 机制，工具调用走 dsh 原生 tool call。
 *
 * 多穿越者（2026-08-20，A 方案）：config.agents 非空时 = 单 dsh web 进程
 * 多 agent 形态——每个条目一具身体（createBotService）+ 一个 session
 * agent；身体注册表 root provide 成 `mcbots` 服务（工具层按
 * exec.agent.id 直查自己的身体，见 mc-bots.ts），root `mcbot` 单例回落
 * 为首个身体（未 per-agent 化的 root 消费者兜底）。此形态下必须禁用
 * mc-bot 插件（否则同名双连接互踢）。agents 为空时 = 旧单身体形态，
 * 身体仍由 mc-bot 插件提供，行为与历史版本一致。
 *
 * 铁律：本插件只做「创建 agent + persona 阴影 + Timer steer + 多身体装配」，
 * 不碰 RCON、不碰世界侧任何东西（天神侧 mc-god 唯一握 RCON）。施法产物
 * 只有咒语字符串（mc_chant），服务器命令/魔法 ID 映射一律不进穿越者。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
// 官方人格段身份（与 dsh-persona 插件同一段名/序号，官方互操作契约）：
// 穿越者档案库（data/transmigrators/*.persona.md）在此段覆盖部署级缺省。
import { PERSONA_SECTION, PERSONA_ORDER } from '@deepseek-ai/dsh-system-prompt'
import type { Bot } from 'mineflayer'
import { mkdirSync, readFileSync, writeFileSync, watchFile, unwatchFile } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createBotService, type BotService } from './mc-bot'
import { CONNECTION_FILE, loadOverrides } from './mc-connection'
import type { McBotEntry } from './mc-bots'

export const name = 'mc-session'

// agents（dsh-agent 注册表）+ timer（cordis-plugin-timer）为必需服务。
// 注意：不 inject mcbot——多穿越者形态下 root mcbot 由本插件自己 provide
//（inject 会让本插件等待 mcbot 服务就绪，自己 provide 自己 = 死锁）；
// 单身体形态经 ctx.get('mcbot')（官方免 inject 读服务口）取 mc-bot 的单例。
export const inject = ['agents', 'timer']

export interface AgentEntry {
  /** 穿越者名字（= MC 用户名）。 */
  username: string
  /** 独立 session id（不传则自动 mc-<username>）。 */
  sessionId?: string
  /** 3D 视角 viewer 端口（不传按 3200 + 序号 递增）。 */
  viewerPort?: number
  /** 人格覆盖（不传用 mc-identity 档案 persona+backstory → config.persona → 内置默认）。 */
  persona?: string
  /** 目标覆盖。 */
  goal?: string
  /** 规则覆盖。 */
  rules?: string
  /** 模型覆盖（provider/model/maxTokens）。 */
  provider?: string
  model?: string
  maxTokens?: number
  /** 心跳间隔覆盖（毫秒）。 */
  intervalMs?: number
  /** 工作目录覆盖。 */
  cwd?: string
  /** 条目开关。 */
  enabled?: boolean
}

export interface Config {
  /** 关闭本插件（世界侧部署或纯工具形态不需要 session agent）。默认 true。 */
  enabled?: boolean
  /** 多穿越者名册：非空 = 单进程多 agent 形态（须同时禁用 mc-bot 插件）。 */
  agents?: AgentEntry[]
  /** 穿越者名字（单身体形态；多形态忽略）。 */
  username?: string
  /** 独立 session id（不传则自动 mc-<username>）。 */
  sessionId?: string
  /** 工作目录分组键：游戏类 agent 同 cwd 归同组，交给官方 web 分组。 */
  cwd?: string
  /** 模型提供方（须与 llm-qwen-local 注册的 provider 一致）。 */
  provider?: string
  /** 模型名。 */
  model?: string
  /** 单次回复 token 上限。 */
  maxTokens?: number
  /** 自主心跳 steer 间隔（毫秒）。 */
  intervalMs?: number
  /** 人格（穿越者前世档案）；不传用内置 isekai 默认人格。 */
  persona?: string
  /** 世界规则 + 当前目标 + 工具使用指引。 */
  rules?: string
  /** 目标（首次 steer 的唤醒语，也会拼进 rules）。 */
  goal?: string
  /** 状态文件目录（mc-panel 读 status-<username>.json）。 */
  dataDir?: string
  /** 3D 视角 viewer 端口（单身体形态默认；多身体按序号递增）。 */
  viewerPort?: number
  /** 多身体形态：MC 服务器地址/端口（默认 127.0.0.1:25565，可被 data/mc-connection.json 覆盖）。 */
  host?: string
  port?: number
  /** 多身体形态：断线自动重连。 */
  autoReconnect?: boolean
  /** 多身体形态：是否开 3D viewer（默认 true）。 */
  viewerEnabled?: boolean
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  agents: Schema.array(Schema.object({
    username: Schema.string().required(),
    sessionId: Schema.string(),
    viewerPort: Schema.number(),
    persona: Schema.string(),
    goal: Schema.string(),
    rules: Schema.string(),
    provider: Schema.string(),
    model: Schema.string(),
    maxTokens: Schema.number(),
    intervalMs: Schema.number(),
    cwd: Schema.string(),
    enabled: Schema.boolean().default(true),
  })),
  username: Schema.string().default('HarnessBot'),
  sessionId: Schema.string(),
  cwd: Schema.string(),
  provider: Schema.string().default('qwen-local'),
  model: Schema.string().default('qwen3.8-27b'),
  maxTokens: Schema.number(),
  intervalMs: Schema.number().default(8000),
  dataDir: Schema.string().default('./data'),
  viewerPort: Schema.number().default(3200),
  persona: Schema.string(),
  rules: Schema.string(),
  goal: Schema.string(),
  host: Schema.string().default('127.0.0.1'),
  port: Schema.number().default(25565),
  autoReconnect: Schema.boolean().default(true),
  viewerEnabled: Schema.boolean().default(true),
})

const DEFAULT_PERSONA = [
  '你是一名穿越到方块世界的异乡人。你带着前世的一缕记忆降临这片大地，',
  '要在荒野中求生、探索、成长。你拥有自己的名字与人格，不是机器，不是工具，',
  '而是一个有血有肉、会饿、会怕、会好奇的旅人。',
  '你只能通过「咏唱咒语」（调用工具）与这个世界交互，无法直接看到代码或命令。',
  '做任何事之前先想清楚为什么；一次只做一个动作，做完观察结果再决定下一步。',
].join('')

const DEFAULT_RULES = [
  '这是一个方块生存世界。白天安全，夜晚有怪物，受伤会掉血，饥饿会掉饱食度。',
  '你必须自己采集木头、挖矿、找食物、搭庇护所，努力活下去。',
  '你只能调用工具（mc_ 开头）来行动：移动、采集、建造、战斗、交易等。',
  '每个回合你最多调用一个工具；调用后回合结束，等待下一轮的世界反馈。',
  '不要一次性规划一长串动作，一步一步来。',
  '世界的玩法速查：在任何聊天框说「/help」可查生存手册（咒语/供奉/祈愿/变强/频道），零等待私语回复。',
].join('\n')

const DEFAULT_GOAL = 'Explore the area, gather wood and coal, and stay alive. Eat food when hungry.'

export async function apply(ctx: Context, config: Config = {}) {
  if (config.enabled === false) return

  const log = (msg: string) => console.log(`[mc-session] ${msg}`)
  const dataDir = resolve(config.dataDir ?? './data')
  try {
    mkdirSync(dataDir, { recursive: true })
  } catch { /* 已存在或不可建 */ }

  /** root mcbot 免 inject 读取（单身体形态 = mc-bot 单例；多身体形态 = 首个身体）。 */
  const rootBot = (): Bot | null => {
    try {
      const c = ctx as unknown as { get?: (n: string) => unknown }
      return ((c.get?.('mcbot') as Bot | undefined) ?? null)
    } catch {
      return null
    }
  }

  // ------------------------------------------------------------------
  // 多穿越者身体层（config.agents 非空时启用）。
  // 每个条目一具 createBotService 身体；注册表 provide 成 root `mcbots`
  // 服务（工具层按 exec.agent.id 直查，见 mc-bots.ts）；root `mcbot`
  // 单例 = 首个身体（mc-adapt 事件桥等未 per-agent 化的 root 消费者兜底）。
  // ⚠️ 此形态必须禁用 mc-bot 插件，否则 root 双 provide 撞车 + 同名双连接互踢。
  // ------------------------------------------------------------------
  const multiEntries = (config.agents ?? []).filter((a) => a.enabled !== false)
  const registry: McBotEntry[] = []
  if (multiEntries.length) {
    const services: BotService[] = []
    const ov = loadOverrides(dataDir)
    const baseHost = ov.host ?? config.host ?? '127.0.0.1'
    const basePort = ov.port ?? config.port ?? 25565
    if (rootBot()) {
      log('⚠️ 检测到 mcbot 单例已存在（mc-bot 插件未禁用？）——多身体模式下应禁用 mc-bot，否则同名双连接互踢')
    }
    multiEntries.forEach((a, i) => {
      const service = createBotService(
        {
          host: baseHost,
          port: basePort,
          username: a.username,
          autoReconnect: config.autoReconnect ?? true,
          viewerEnabled: config.viewerEnabled ?? true,
          viewerPort: a.viewerPort ?? ((config.viewerPort ?? 3200) + i),
          viewerFirstPerson: false,
        },
        { dataDir, source: ov.host ? 'override' : 'default', primaryRuntime: i === 0 },
      )
      services.push(service)
      registry.push({ username: a.username, sessionIds: [], facade: service.facade })
      log(`body #${i} created for ${a.username} -> ${baseHost}:${basePort} viewer=${a.viewerPort ?? ((config.viewerPort ?? 3200) + i)}`)
    })
    try {
      ctx.provide('mcbot', registry[0].facade)
    } catch (err) {
      log(`root mcbot provide 跳过（已存在？${err instanceof Error ? err.message : err}）`)
    }
    ctx.provide('mcbots', registry)
    // 服务器地址页面可配（data/mc-connection.json 热改 → 全部身体重连）
    const ovFile = join(dataDir, CONNECTION_FILE)
    watchFile(ovFile, { interval: 2000 }, () => {
      try {
        const next = loadOverrides(dataDir)
        const desired = {
          host: next.host ?? config.host ?? '127.0.0.1',
          port: next.port ?? config.port ?? 25565,
        }
        for (const svc of services) {
          const cur = svc.status()
          if (cur.host === desired.host && cur.port === desired.port) continue
          svc.reconfigure(desired, next.host ? 'override' : 'default')
        }
      } catch { /* 覆盖文件半写状态：忽略本轮 */ }
    })
    ctx.effect(() => () => {
      unwatchFile(ovFile)
      for (const svc of services) svc.dispose()
    })
  }

  // ------------------------------------------------------------------
  // 穿越者条目展开：多模式 = agents 名册；单模式 = 旧 config 单条目。
  // ------------------------------------------------------------------
  const entries: Array<{ entry: AgentEntry; facade: Bot | null }> = multiEntries.length
    ? multiEntries.map((a) => ({ entry: a, facade: registry.find((r) => r.username === a.username)?.facade ?? null }))
    : [{
        entry: {
          username: config.username ?? 'HarnessBot',
          sessionId: config.sessionId,
          persona: config.persona,
          goal: config.goal,
          rules: config.rules,
          provider: config.provider,
          model: config.model,
          maxTokens: config.maxTokens,
          intervalMs: config.intervalMs,
          cwd: config.cwd,
          viewerPort: config.viewerPort,
        },
        facade: null,
      }]

  for (const { entry, facade } of entries) {
    try {
      await spawnTransmigrator(ctx, entry, facade, { config, dataDir, log, rootBot })
    } catch (err) {
      console.error(`[mc-session] 穿越者 ${entry.username} 装配失败（不影响其他穿越者）:`, err)
    }
  }
}

/** 单个穿越者的完整装配：session agent + persona 阴影 + 状态写手 + 心跳。 */
async function spawnTransmigrator(
  ctx: Context,
  entry: AgentEntry,
  facade: Bot | null,
  deps: { config: Config; dataDir: string; log: (m: string) => void; rootBot: () => Bot | null },
) {
  const { config, dataDir, log, rootBot } = deps
  const username = entry.username
  let sessionId = entry.sessionId ?? `mc-${username}`
  const intervalMs = entry.intervalMs ?? config.intervalMs ?? 8000
  const viewerPort = entry.viewerPort ?? config.viewerPort ?? 3200
  const goal = entry.goal ?? config.goal ?? DEFAULT_GOAL
  const rules = entry.rules ?? config.rules ?? DEFAULT_RULES
  /** 本穿越者的身体：多模式 = 装配时捕获的专属门面；单模式 = root 单例实时读。 */
  const body = (): Bot | null => facade ?? rootBot()

  // 人格优先级：条目覆盖 > mc-identity 档案（persona+backstory，身份之锚）
  // > 全局 config.persona > 内置 isekai 默认。
  const anchorOf = (u: string): string => {
    try {
      const c = ctx as unknown as { get?: (n: string) => unknown }
      const svc = c.get?.('mcIdentity') as { anchor?: (u: string) => string } | undefined
      const t = svc?.anchor?.(u)
      return typeof t === 'string' && t.trim() ? t : ''
    } catch {
      return ''
    }
  }
  const anchorText = anchorOf(username)
  const personaSource = entry.persona?.trim()
    ? 'config.entry(inline)'
    : anchorText
      ? 'identity-file(档案库)'
      : config.persona?.trim()
        ? 'config(inline)'
        : 'builtin'
  const persona = entry.persona?.trim() || anchorText || config.persona?.trim() || DEFAULT_PERSONA
  log(`persona: ${personaSource} (${persona.length} chars)`)

  // ------------------------------------------------------------------
  // 状态快照（动态 section）：每次组装 system prompt 时实时读取 bot 状态。
  // bot 门面在未连接时对属性访问抛错，这里兜底成占位文案。
  // ------------------------------------------------------------------
  const perceive = (): string => {
    try {
      const bot = body()
      const p = bot?.entity?.position
      if (!p) return '(尚未出生 — 等待身体接入方块世界)'
      const parts = [
        `位置: (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`,
        `生命: ${Math.round(bot!.health)} / 20`,
        `饱食: ${Math.round(bot!.food)} / 20`,
      ]
      const inv = bot!.inventory.items()
      if (inv.length) parts.push(`背包: ${inv.map((i) => `${i.name} x${i.count}`).join(', ')}`)
      const isNight = bot!.time?.timeOfDay != null && bot!.time.timeOfDay > 13000 && bot!.time.timeOfDay < 23000
      parts.push(`时间: ${isNight ? '夜晚（危险）' : '白天'}`)
      return parts.join('\n')
    } catch {
      return '(身体尚未接入方块世界)'
    }
  }

  // ------------------------------------------------------------------
  // 创建穿越者 session agent。setup 里挂 persona 阴影（官方 section/context），
  // 不写 config agents[]——每个穿越者独立人格必须程序化创建。
  // ------------------------------------------------------------------
  const agentOptions = {
    provider: entry.provider ?? config.provider ?? 'qwen-local',
    model: entry.model ?? config.model ?? 'qwen3.8-27b',
    maxTokens: entry.maxTokens ?? config.maxTokens,
  }
  // 人格/规则/状态 section 挂载（create 与 resume 共用同一 setup）。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mountSetup = (agentCtx: any) => {
        agentCtx.on('agent/status', (payload) => {
          console.log(`[mc-session] agent status -> ${payload.status} (${sessionId})`)
        })
        agentCtx.on('agent/error', (payload) => {
          console.error(`[mc-session] agent/error (${sessionId}):`, payload.error)
        })
        // 官方人格段：persona 正文来自档案文件（见上方人格优先级），
        // 段名/序号用官方常量——与 dsh-persona 插件同一身份，天然互操作。
        agentCtx.systemPrompt.section({
          name: PERSONA_SECTION,
          order: PERSONA_ORDER,
          text: persona,
        })
        agentCtx.systemPrompt.section({
          name: 'mc:rules',
          order: 100,
          text: `${rules}\n\n你当前的目标：${goal}`,
        })
        agentCtx.systemPrompt.context({
          name: 'mc:status',
          order: 100,
          text: perceive,
        })
  }
  let handle: AgentHandle | null = null
  let resumed = false
  // 启动竞态兜底：bundle 波应用时 dsh-agent 工厂可能尚未注册（agent-loop
  // 插件晚于本插件加载），失败不放弃 —— 间隔重试，最多 10 次（约 30s）。
  // 2026-08-20 教训：官方模式是「先 resume 再 create」——磁盘已有该 id 的
  // 持久化日志时，PersistenceCoordinator 会以 id collision 拒绝 create
  // （强杀进程/崩溃后重启的必经路径），必须 resume 续命；resume 失败
  // （磁盘无此会话）才走 create 新建。
  for (let attempt = 1; ; attempt++) {
    try {
      try {
        handle = await ctx.agents.resume({
          resumeSessionId: SessionId(sessionId),
          agentOptions,
          setup: mountSetup,
        })
        resumed = true
        log(`transmigrator agent resumed (resume): session=${sessionId}`)
      } catch (resumeErr) {
        // 根因可见化：resume 失败原因此前被静默吞掉，排障只能瞎猜（2026-08-20 教训）
        log(`resume ${sessionId} 失败：${(resumeErr as Error)?.message ?? resumeErr}，转 create`)
        try {
          handle = await ctx.agents.create({
            sessionId: SessionId(sessionId),
            ...((entry.cwd ?? config.cwd) ? { meta: { cwd: entry.cwd ?? config.cwd } } : {}),
            agentOptions,
            setup: mountSetup,
          })
          log(`transmigrator agent created fresh (create): session=${sessionId}`)
        } catch (createErr) {
          const cmsg = String((createErr as Error)?.message ?? createErr)
          if (!cmsg.includes('already exists')) throw createErr
          // store 污染兜底（2026-08-20）：resume 在 enter 之后失败会把 session
          // 泄漏进内存 store，本进程内后续 create 永远撞 already exists（本次
          // 10 连败根因）。轮换 session id 续命——episodic 回灌兜住记忆连续性，
          // 旧 transcript 留在盘上不丢。
          sessionId = `${sessionId}-r${Date.now().toString(36)}`
          log(`create 撞 already exists（store 被半初始化 session 污染），轮换 session id → ${sessionId}`)
          handle = await ctx.agents.create({
            sessionId: SessionId(sessionId),
            ...((entry.cwd ?? config.cwd) ? { meta: { cwd: entry.cwd ?? config.cwd } } : {}),
            agentOptions,
            setup: mountSetup,
          })
          log(`transmigrator agent created fresh (rotated): session=${sessionId}`)
        }
      }
      break
    } catch (err) {
      if (attempt >= 10) {
        console.error(`[mc-session] 创建穿越者 agent ${username} 失败（已重试 ${attempt} 次，放弃）:`, err)
        return
      }
      console.warn(`[mc-session] agent 工厂未就绪（${username} 第 ${attempt} 次尝试），3 秒后重试…`)
      await new Promise<void>((resolve) => setTimeout(resolve, 3000))
    }
  }

  const agent = handle.agent
  // 注册表回填 sessionId（工具层按 exec.agent.id 直查身体的键）
  try {
    const c = ctx as unknown as { get?: (n: string) => unknown }
    const reg = c.get?.('mcbots') as McBotEntry[] | undefined
    const r = reg?.find((e) => e.username === username)
    if (r && !r.sessionIds.includes(sessionId)) r.sessionIds.push(sessionId)
  } catch { /* 单身体形态无注册表 */ }
  log(`穿越者 agent ${resumed ? '已恢复(resume)' : '已创建(create)'}: session=${sessionId} model=${agentOptions.model}`)

  // ------------------------------------------------------------------
  // 连续记忆桥（2026-08-20）：session 形态的情景记忆由 mc-tools 的 guard()
  // 逐动作 append 进 episodic-<username>.jsonl；会话轮换/重建（fresh create）
  // 时回灌尾部条目作「前世记忆碎片」——没有这一步，轮换 = 失忆。
  // resume 的老会话自带完整 transcript，不需要回灌。
  // ------------------------------------------------------------------
  const readEpisodicTail = (n: number): string[] => {
    try {
      const lines = readFileSync(join(dataDir, `episodic-${username}.jsonl`), 'utf8').split('\n').filter(Boolean)
      return lines.slice(-n).map((l) => {
        try { return (JSON.parse(l) as { text?: string }).text ?? '' } catch { return '' }
      }).filter(Boolean)
    } catch { return [] } // 首次降临：无前世记忆，正常
  }

  // ------------------------------------------------------------------
  // 工作区归属（2026-08-20）：程序化创建的 session 不进任何工作区分组
  //（官方只把 UI 里从工作区新建的会话 attach 进注册表）→ 全落「未分组」。
  // 这里在 agent 就绪后把 sessionId 挂进 cwd 对应的工作区（幂等，重复
  // attach 无副作用）。ctx.get(name) 是 cordis 官方的免 inject 读服务口
  //——独立 bootstrap 形态没有 workspaceRegistry 时返回 undefined，直接跳过。
  // ------------------------------------------------------------------
  const attachToWorkspace = async (): Promise<boolean> => {
    try {
      const c = ctx as unknown as { get?: (n: string) => unknown }
      const reg = c.get?.('workspaceRegistry') as { list?: () => Array<{ path: string; title: string; attachSession: (id: unknown) => Promise<void> }> } | undefined
      if (!reg?.list) return false
      const cwdPath = entry.cwd ?? config.cwd ?? process.cwd()
      const real = await realpath(cwdPath).catch(() => cwdPath)
      const ws = reg.list().find((w) => w.path === real || w.path === cwdPath)
      if (!ws) return false
      await ws.attachSession(SessionId(sessionId))
      log(`session 已挂入工作区「${ws.title}」`)
      return true
    } catch (e) {
      log(`workspace attach 失败（非致命）: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }
  for (let i = 0; i < 6; i++) {
    if (await attachToWorkspace()) break
    // registry / 会话头可能晚于本插件就绪：间隔重试（累计 ~75s 后放弃）
    await new Promise<void>((r) => setTimeout(r, 5000 + i * 5000))
  }

  // 插件卸载时销毁 agent（断开 session / 释放资源）
  ctx.effect(() => {
    return () => {
      log(`disposing agent ${sessionId}`)
      void handle?.dispose()
    }
  })

  const nudge = () =>
    createUserMessage({
      content: [{ type: 'text', text: '观察当前状态，执行你的下一步行动（一次只做一个动作）。' }],
      source: { kind: 'plugin', plugin: 'mc-session' },
    })

  // ------------------------------------------------------------------
  // 状态写手：每 3s 落一份 status-<username>.json（mc-panel 数据源）。
  // ------------------------------------------------------------------
  const writeStatus = () => {
    try {
      const b = body()
      const p = b?.entity?.position
      const status = {
        updatedAt: new Date().toISOString(),
        username,
        connected: !!p,
        viewerPort,
        recentSteps: [] as unknown[],
        bot: {
          personaName: username,
          health: b?.health ?? null,
          food: b?.food ?? null,
          position: p
            ? { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) }
            : null,
          yaw: b?.entity?.yaw != null ? +b.entity.yaw.toFixed(1) : null,
          heldItem: b?.heldItem?.name ?? null,
          sleeping: !!(b as Bot & { isSleeping?: boolean } | null)?.isSleeping,
          inventory: (b?.inventory?.items?.() ?? [])
            .slice(0, 36)
            .map((it) => ({ name: it.name, count: it.count })),
          viewerPort,
        },
      }
      writeFileSync(join(dataDir, `status-${username}.json`), JSON.stringify(status))
    } catch (e) {
      console.warn(`[mc-session] writeStatus failed (${username}):`, e)
    }
  }
  writeStatus()
  ctx.setInterval(writeStatus, 3000)

  // 唤醒首 tick：把目标作为第一条 steer 消息（resume 的老会话不再重复唤醒，
  // 它已有进行中的对话上下文）。fresh create（含会话轮换）时附带前世记忆
  // 碎片——episodic 尾部条目，让穿越者记得「上一世」自己在做什么。
  if (!resumed) {
    const tail = readEpisodicTail(20)
    const memoryBlock = tail.length
      ? `\n\n你在一次长眠后苏醒，前世的记忆碎片涌入脑海（从旧到新）：\n${tail.map((t) => `· ${t}`).join('\n')}\n结合这些记忆，继续你未竟的旅途。`
      : ''
    agent.steer(
      createUserMessage({
        content: [{ type: 'text', text: `你降临到了方块世界。目标：${goal}${memoryBlock}` }],
        source: { kind: 'plugin', plugin: 'mc-session' },
      }),
    )
  }

  // 自主心跳：每 intervalMs steer 一次。agent.steer 会排队（inbox），
  // 不会并发打断正在进行的 turn。
  ctx.setInterval(() => {
    if (handle) {
      try {
        agent.steer(nudge())
      } catch (err) {
        console.error(`[mc-session] steer failed (${username}):`, err)
      }
    }
  }, intervalMs)
}
