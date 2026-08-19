/**
 * mc-session —— 穿越者以「dsh session agent」形态存活的心跳插件。
 *
 * 背景（2026-08-19 定调）：旧 mc-loop 是「进程级单例 + 自驱 LLM」，自己调
 * 官方 adapter 接口、自己攒 prompt，绕过了 dsh 的 agent/session/loop 全套。
 * 现在穿越者 = 独立 dsh session agent：新建智能体（名字/背景故事）→ 独立
 * session → 本插件用 Timer 数秒 steer 一次，persona / 规则 / 状态快照全部走
 * 官方 system-prompt section / context 机制，工具调用走 dsh 原生 tool call。
 *
 * 铁律：本插件只做「创建 agent + persona 阴影 + Timer steer」，不碰 RCON、
 * 不碰世界侧任何东西（天神侧 mc-god 唯一握 RCON）。施法产物只有咒语字符串
 * （mc_chant），服务器命令/魔法 ID 映射一律不进穿越者。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type { Bot } from 'mineflayer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const name = 'mc-session'

// agents（dsh-agent 注册表）+ timer（cordis-plugin-timer）为必需服务；
// mcbot 是穿越者的「身体」，状态写手（writeStatus）需要直接读它——
// cordis 铁律：未声明 inject 的服务属性访问直接抛错（writeStatus failed:
// cannot get property "mcbot" without inject 的教训，2026-08-20）。
export const inject = ['agents', 'timer', 'mcbot']

export interface Config {
  /** 关闭本插件（世界侧部署或纯工具形态不需要 session agent）。默认 true。 */
  enabled?: boolean
  /** 穿越者名字（= MC 用户名，也用作 session id 的后半段）。 */
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
  /** 3D 视角 viewer 端口（写进状态文件给面板 iframe 用）。 */
  viewerPort?: number
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
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
].join('\n')

export async function apply(ctx: Context, config: Config = {}) {
  if (config.enabled === false) return

  const intervalMs = config.intervalMs ?? 8000
  const username = config.username ?? 'HarnessBot'
  const sessionId = config.sessionId ?? `mc-${username}`
  // 空串（bootstrap 在无环境变量时传 ''）也回退默认人格，避免空 section。
  const persona = config.persona?.trim() ? config.persona : DEFAULT_PERSONA
  const goal = config.goal ?? 'Explore the area, gather wood and coal, and stay alive. Eat food when hungry.'
  const rules = config.rules ?? DEFAULT_RULES

  const log = (msg: string) => console.log(`[mc-session] ${msg}`)

  // ------------------------------------------------------------------
  // 状态快照（动态 section）：每次组装 system prompt 时实时读取 bot 状态。
  // bot 门面在未连接时对属性访问抛错，这里兜底成占位文案。
  // ------------------------------------------------------------------
  const perceive = (): string => {
    try {
      const bot = ctx.mcbot as unknown as Bot | null
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
    provider: config.provider ?? 'qwen-local',
    model: config.model ?? 'qwen3.8-27b',
    maxTokens: config.maxTokens,
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
        agentCtx.systemPrompt.section({
          name: 'deployment:persona',
          order: 0,
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
      } catch {
        handle = await ctx.agents.create({
          sessionId: SessionId(sessionId),
          ...(config.cwd ? { meta: { cwd: config.cwd } } : {}),
          agentOptions,
          setup: mountSetup,
        })
        log(`transmigrator agent created fresh (create): session=${sessionId}`)
      }
      break
    } catch (err) {
      if (attempt >= 10) {
        console.error(`[mc-session] 创建穿越者 agent 失败（已重试 ${attempt} 次，放弃）:`, err)
        return
      }
      console.warn(`[mc-session] agent 工厂未就绪（第 ${attempt} 次尝试），3 秒后重试…`)
      await new Promise<void>((resolve) => setTimeout(resolve, 3000))
    }
  }

  const agent = handle.agent
  log(`穿越者 agent ${resumed ? '已恢复(resume)' : '已创建(create)'}: session=${sessionId} model=${config.model ?? 'qwen3.8-27b'}`)

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
  // 2026-08-20 教训：旧版靠 mc-loop 写状态，session 形态没有 mc-loop，
  // 面板就瞎了（iframe 黑屏/数据停更）。这里直接补上：
  // 连接态/生命/饱食/位置/朝向/手持/背包/viewer 端口。
  // ------------------------------------------------------------------
  const statusDir = resolve(config.dataDir ?? './data')
  try {
    mkdirSync(statusDir, { recursive: true })
  } catch {}
  const writeStatus = () => {
    try {
      const b = ctx.mcbot as unknown as Bot | null
      const p = b?.entity?.position
      const status = {
        updatedAt: new Date().toISOString(),
        username,
        connected: !!p,
        viewerPort: config.viewerPort ?? 3200,
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
          viewerPort: config.viewerPort ?? 3200,
        },
      }
      writeFileSync(join(statusDir, `status-${username}.json`), JSON.stringify(status))
    } catch (e) {
      console.warn('[mc-session] writeStatus failed:', e)
    }
  }
  writeStatus()
  ctx.setInterval(writeStatus, 3000)

  // 唤醒首 tick：把目标作为第一条 steer 消息（resume 的老会话不再重复唤醒，
  // 它已有进行中的对话上下文）。
  if (!resumed) {
    agent.steer(
      createUserMessage({
        content: [{ type: 'text', text: `你降临到了方块世界。目标：${goal}` }],
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
        console.error(`[mc-session] steer failed:`, err)
      }
    }
  }, intervalMs)
}
