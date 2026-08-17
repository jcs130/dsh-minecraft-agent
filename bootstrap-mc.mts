// 穿越者 bootstrap —— 每个 AI 玩家一个进程。
//
// ⛔ 零 RCON、零服务器命令、零魔法 ID：本进程不 import rcon.ts、不读 rcon-secret。
// 与世界（天神进程）的全部交互走 MC 聊天文字：
//   公屏咏唱（快路径施法）/ 私聊祈愿（慢路径神谕）/ 公屏选天赋（降临仪式）。
// 启动：start-bot.bat <username> <viewerPort>
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as mcBot from './src/mc-bot.ts'
import * as mcTools from './src/mc-tools.ts'
import * as mcMemory from './src/mc-memory.ts'
import * as mcMemos from './src/mc-memos.ts'
import * as mcEvolve from './src/mc-evolve.ts'
import * as mcTransmigrator from './src/mc-transmigrator.ts'
import * as mcIdentity from './src/mc-identity.ts'
import * as mcMystic from './src/mc-mystic.ts'
import * as mcWiki from './src/mc-wiki.ts'
import * as mcLoop from './src/mc-loop.ts'
import * as mcPanel from './src/mc-panel.ts'

const RUN_MS = Number(process.env.RUN_MS ?? 0)
// 进程级兜底：mineflayer/prismarine 内部 promise（如 villager 窗口超时）拒绝时没有
// 调用方可 catch——Node 默认把 unhandledRejection 升级为崩溃（08-17 #221 实锤，bot 凌晨暴毙）。
// 记日志保进程：7×24 挂机 bot 韧性优先，宁留带伤存活，不留完美尸体。
process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
  console.error(`[bootstrap] UNHANDLED REJECTION (suppressed): ${detail}`)
})
process.on('uncaughtException', (err) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error(`[bootstrap] UNCAUGHT EXCEPTION (suppressed): ${detail}`)
})
// 每个穿越者一个独立 viewer 端口（多 bot 并存时用 MC_VIEWER_PORT 区分）。
const viewerPort = Number(process.env.MC_VIEWER_PORT ?? 3001)
// 女神化身名（世界进程 mc-bot 的 username），须与世界侧配置一致。
const godName = process.env.MC_GOD_NAME ?? 'Goddess'

const ctx = new Context()
await ctx.plugin(Timer)
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)

await ctx.plugin(mcBot, {
  host: process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_PORT ?? 25565),
  username: process.env.MC_USERNAME ?? 'HarnessBot',
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
// 长期语义记忆（MemOS，user_id=mc-<username> 独立记忆池；服务挂了自动降级跳过）。
await ctx.plugin(mcMemos, {
  enabled: process.env.MC_MEMOS !== '0',
  baseUrl: process.env.MC_MEMOS_URL ?? 'http://127.0.0.1:8002',
  timeoutMs: 8_000,
  maxRecall: 5,
})

// 夜间自我进化（游戏夜入睡触发：MemOS 双池记忆蒸馏成 wiki 教训卡 + 长线成长记忆）。
await ctx.plugin(mcEvolve, {
  enabled: process.env.MC_EVOLVE !== '0',
  baseUrl: process.env.MC_LLM_URL ?? 'http://localhost:8890/v1',
  apiKey: process.env.MC_LLM_KEY ?? 'sk-local',
  model: process.env.MC_LLM_MODEL ?? 'qwen3.8',
  cooldownHours: 12,
  reasoningEffort: 'xhigh', // 慢路径深思考（Qwen3.8 模板档位：xhigh/medium/low），与白天行动档 none 分层
  maxTokens: 2048,
  statePath: './data/evolve-state.json',
  perQuery: 8,
  diaryEnabled: process.env.MC_DIARY !== '0',
  godName: process.env.MC_GOD_NAME ?? 'Goddess',
})
await ctx.plugin(mcTransmigrator, {
  registryPath: './data/transmigrators.json',
})
// 身份之锚：persona+backstory 常驻 system prompt 防失忆 + 前世记忆切片种子进 MemOS（幂等）。
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
// 可视化面板：只读观察本进程 agent（status/wiki/mystic/defects/screenshots 全在盘上），
// 多 bot 并存时用 MC_PANEL_PORT 区分（如桐人 3200 / 鸣人 3202）。
await ctx.plugin(mcPanel, {
  enabled: true,
  host: process.env.MC_PANEL_HOST ?? '127.0.0.1',
  port: Number(process.env.MC_PANEL_PORT ?? 3200),
  dataDir: './data',
  username: process.env.MC_USERNAME ?? '',
})
await ctx.plugin(mcLoop, {
  enabled: true,
  intervalMs: 5000,
  baseUrl: process.env.MC_LLM_BASE_URL ?? 'http://127.0.0.1:8890/v1',
  apiKey: process.env.MC_LLM_API_KEY ?? 'sk-local',
  model: process.env.MC_LLM_MODEL ?? 'qwen3.8',
  goal: '你刚从现代穿越到这个方块世界，一无所有。按优先级行动：先保证活下去（吃饱、血量安全、天黑前回基地），再收集木材/石头/煤/铁等基础物资，最后在基地附近建立并经营你的根据地。',
  persona: '',
  historyDepth: 6,
  maxTokens: 1024,
  // 思考深度分层：穿越者白天主打快速反应（none）；想加深可改 low/medium。
  reasoningEffort: process.env.MC_REASONING_EFFORT ?? 'none',
  brainLogPath: './data/mc-brain.log',
  statusPath: './data/status.json',
  viewerPort,
  defectThreshold: 5,
  defectDir: './data/defects',
  defectNotifyUrl: process.env.QWENPAW_CONSOLE_URL ?? 'http://127.0.0.1:8088/api/console/chat',
  defectNotifyAgent: process.env.QWENPAW_DEFECT_AGENT ?? 'default',
})

console.log(`[bootstrap] transmigrator plugins loaded (zero-RCON, goddess="${godName}"), running ${RUN_MS > 0 ? RUN_MS + 'ms' : 'indefinitely'} ...`)
if (RUN_MS > 0) {
  await new Promise((resolve) => setTimeout(resolve, RUN_MS))
  console.log('[bootstrap] done, exiting')
  process.exit(0)
} else {
  // Stay alive indefinitely so the bot keeps playing in the world.
  await new Promise(() => {})
}
