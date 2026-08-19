// 穿越者 session-agent bootstrap —— 每个 AI 玩家一个进程，走 dsh 原生 agent 形态。
//
// 与 bootstrap-mc.mts 的区别：bootstrap-mc 是「进程级单例 + mc-loop 自研 fetch LLM」，
// 本入口是「dsh 原生 session agent」——组装官方 6 插件核心栈（LlmRuntime/SessionStore/
// SystemPrompt/ToolRuntime/AgentRegistry/AgentLoop）+ 本地 qwen-local 薄适配器，
// 再由 mc-session 程序化创建穿越者 agent 并 Timer steer。
//
// ⛔ 零 RCON、零服务器命令、零魔法 ID（同 bootstrap-mc 铁律）。
// 启动：MC_USERNAME=X node lib/bootstrap-session.mjs
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as llmQwenLocal from './src/llm-qwen-local.ts'
import * as mcBot from './src/mc-bot.ts'
import * as mcTools from './src/mc-tools.ts'
import * as mcMemory from './src/mc-memory.ts'
import * as mcMemos from './src/mc-memos.ts'
import * as mcEvolve from './src/mc-evolve.ts'
import * as mcAdapt from './src/mc-adapt.ts'
import * as mcTransmigrator from './src/mc-transmigrator.ts'
import * as mcIdentity from './src/mc-identity.ts'
import * as mcMystic from './src/mc-mystic.ts'
import * as mcWiki from './src/mc-wiki.ts'
import * as mcVillage from './src/mc-village.ts'
import * as mcSession from './src/mc-session.ts'
import * as mcPanel from './src/mc-panel.ts'

const RUN_MS = Number(process.env.RUN_MS ?? 0)
// 进程级兜底（同 bootstrap-mc）：mineflayer/prismarine 内部 promise 拒绝升级为崩溃。
process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
  console.error(`[bootstrap-session] UNHANDLED REJECTION (suppressed): ${detail}`)
})
process.on('uncaughtException', (err) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error(`[bootstrap-session] UNCAUGHT EXCEPTION (suppressed): ${detail}`)
})

const username = process.env.MC_USERNAME ?? 'HarnessBot'
const viewerPort = Number(process.env.MC_VIEWER_PORT ?? 3001)
const godName = process.env.MC_GOD_NAME ?? 'Goddess'

const ctx = new Context()

// ---- 官方 6 插件核心栈（loop.spec.ts harness 权威装配顺序）----
await ctx.plugin(Timer)
await ctx.plugin(LlmRuntime)
await ctx.plugin(SessionStore)
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await ctx.plugin(AgentRegistry)
await ctx.plugin(AgentLoop, { agents: [] })

// ---- 本地 Qwen3.8 vLLM 薄适配器：注册 qwen-local provider ----
await ctx.plugin(llmQwenLocal, {
  baseURL: process.env.MC_LLM_BASE_URL ?? 'http://127.0.0.1:8890/v1',
  apiKey: process.env.MC_LLM_API_KEY ?? 'sk-local',
  debug: process.env.MC_LLM_DEBUG === '1',
})

// ---- 穿越者「身体 + 工具 + 记忆 + 游戏业务」插件（无 mc-loop，由 mc-session 驱动）----
await ctx.plugin(mcBot, {
  host: process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_PORT ?? 25565),
  username,
  autoReconnect: true,
  viewerEnabled: process.env.MC_VIEWER !== '0',
  viewerFirstPerson: false,
  viewerPort,
})
await ctx.plugin(mcTools)
await ctx.plugin(mcMemory, {
  memoryPath: './data/mc-memory.json',
  maxPointsPerType: 20,
})
await ctx.plugin(mcMemos, {
  enabled: process.env.MC_MEMOS !== '0',
  backend: process.env.MC_MEMOS_BACKEND ?? 'auto',
  baseUrl: process.env.MC_MEMOS_URL ?? 'http://127.0.0.1:8002',
  timeoutMs: 8_000,
  maxRecall: 5,
  localDir: process.env.MC_MEMOS_LOCAL_DIR ?? './data/memory',
  username,
})
await ctx.plugin(mcEvolve, {
  enabled: process.env.MC_EVOLVE !== '0',
  baseUrl: process.env.MC_LLM_BASE_URL ?? 'http://127.0.0.1:8890/v1',
  apiKey: process.env.MC_LLM_API_KEY ?? 'sk-local',
  model: process.env.MC_LLM_MODEL ?? 'qwen3.8',
  cooldownHours: 12,
  reasoningEffort: 'xhigh',
  maxTokens: 2048,
  statePath: './data/evolve-state.json',
  perQuery: 8,
  diaryEnabled: process.env.MC_DIARY !== '0',
  godName,
})
await ctx.plugin(mcAdapt, {
  enabled: process.env.MC_ADAPT !== '0',
  dataDir: './data',
  godName,
})
await ctx.plugin(mcTransmigrator, {
  registryPath: './data/transmigrators.json',
})
await ctx.plugin(mcIdentity, {
  seedStatePath: './data/identity-seed.json',
  maxChunkChars: 400,
  seedIntervalMs: 300,
})
await ctx.plugin(mcMystic, {
  enabled: true,
  godName,
  chantTimeoutMs: 10_000,
  prayTimeoutMs: 8_000,
  statePath: './data/mystic-state.json',
})
await ctx.plugin(mcWiki, {
  dataDir: './data',
  maxCards: 200,
})
await ctx.plugin(mcPanel, {
  enabled: true,
  host: process.env.MC_PANEL_HOST ?? '127.0.0.1',
  port: Number(process.env.MC_PANEL_PORT ?? 3200),
  dataDir: './data',
  username,
})
await ctx.plugin(mcVillage, {
  dataDir: process.env.MC_DATA_DIR ?? './data',
  nearbyRadius: 28,
})

// ---- 从穿越者档案加载 persona（迁鸣人/桐人时按 MC_USERNAME 自动匹配）----
// 优先级：MC_PERSONA 环境变量 > 档案 personaFile > mc-session 内置默认人格。
const transmigrator = ctx.mcTransmigrators?.getByUsername(username)
const personaFromRegistry = transmigrator?.persona?.trim() || ''
if (transmigrator) {
  console.log(
    `[bootstrap-session] 命中穿越者档案: ${transmigrator.name}(${transmigrator.username}) ` +
      `来源=${transmigrator.source ?? '随机'} persona=${personaFromRegistry.length} 字`,
  )
}

// ---- 创建穿越者 session agent + Timer steer（新形态核心）----
await ctx.plugin(mcSession, {
  enabled: true,
  username,
  sessionId: process.env.MC_SESSION_ID ?? `mc-${username}`,
  cwd: process.cwd(),
  provider: 'qwen-local',
  model: process.env.MC_LLM_MODEL ?? 'qwen3.8-27b',
  intervalMs: Number(process.env.MC_SESSION_INTERVAL ?? 5000),
  goal:
    process.env.MC_GOAL ??
    '你刚从现代穿越到这个方块世界，一无所有。按优先级行动：先保证活下去（吃饱、血量安全、天黑前回基地），再收集木材/石头/煤/铁等基础物资，最后在基地附近建立并经营你的根据地。',
  persona: process.env.MC_PERSONA ?? personaFromRegistry,
})

console.log(
  `[bootstrap-session] dsh session agent ready: session=mc-${username} model=${process.env.MC_LLM_MODEL ?? 'qwen3.8-27b'}, running ${RUN_MS > 0 ? RUN_MS + 'ms' : 'indefinitely'} ...`,
)
if (RUN_MS > 0) {
  await new Promise((resolve) => setTimeout(resolve, RUN_MS))
  console.log('[bootstrap-session] done, exiting')
  process.exit(0)
} else {
  await new Promise(() => {})
}
