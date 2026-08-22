/**
 * mc-session —— 穿越者以「dsh session agent」形态存活的心跳插件。
 *
 * 背景（2026-08-19 定调）：旧 mc-loop 是「进程级单例 + 自驱 LLM」，自己调
 * 官方 adapter 接口、自己攒 prompt，绕过了 dsh 的 agent/session/loop 全套。
 * 现在穿越者 = 独立 dsh session agent：新建智能体（名字/背景故事）→ 独立
 * session → 目标交给 dsh 官方 goal loop（ctx.goals + goal-round-driver）驱动
 * 持续决策，persona / 规则 / 状态快照全部走
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
 * 铁律：本插件只做「创建 agent + persona 阴影 + goal loop 接入 + 多身体装配」，
 * 不碰 RCON、不碰世界侧任何东西（天神侧 mc-god 唯一握 RCON）。施法产物
 * 只有咒语字符串（mc_chant），服务器命令/魔法 ID 映射一律不进穿越者。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
// 官方人格段身份（与 dsh-persona 插件同一段名/序号，官方互操作契约）：
// 穿越者档案库（data/transmigrators/*.persona.md）在此段覆盖部署级缺省。
import { PERSONA_SECTION, PERSONA_ORDER } from '@deepseek-ai/dsh-system-prompt'
import type { Bot } from 'mineflayer'
import { existsSync, mkdirSync, readFileSync, writeFileSync, watchFile, unwatchFile } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createBotService, type BotService } from './mc-bot'
import { CONNECTION_FILE, loadOverrides } from './mc-connection'
import type { McBotEntry } from './mc-bots'
import type { MemoryProvider } from './memory-provider'
import type { McStoreService } from './mc-store'
import type { InnatePreference } from './mc-transmigrator'

export const name = 'mc-session'

// agents（dsh-agent 注册表）+ timer（cordis-plugin-timer）为必需服务。
// 注意：不 inject mcbot——多穿越者形态下 root mcbot 由本插件自己 provide
//（inject 会让本插件等待 mcbot 服务就绪，自己 provide 自己 = 死锁）；
// 单身体形态经 ctx.get('mcbot')（官方免 inject 读服务口）取 mc-bot 的单例。
export const inject = ['agents', 'timer', 'tools', 'mcIdentity', 'mcStore']

export interface AgentEntry {
  /** 穿越者名字（= MC 用户名，mineflayer 登录用，如 Edward）。 */
  username: string
  /** 角色人名（session 显示名，如「爱德华」）。不传则回落 transmigrators.json 的 name → username。 */
  name?: string
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
  /** 工作目录覆盖。 */
  cwd?: string
  /** 条目开关。 */
  enabled?: boolean
  /** 是否自动启动自主循环（arm goal）：false = 只创建/恢复，等用户在控制端手动开始。默认 true。 */
  autoSteer?: boolean
}

/** 运行时创建角色（login skill / 聊天式角色创建）的输入。 */
export interface CreateCharacterInput {
  /** MC 用户名（mineflayer 登录名，必填，如 Naruto）。 */
  username: string
  /** 角色人名（session 显示名）。缺省回落 transmigrators.json 的 name → username。 */
  name?: string
  /** 人格正文（persona.md）。缺省走 mc-identity 档案 → 内置 isekai 默认。 */
  persona?: string
  /** 前世故事正文（backstory.md）。 */
  backstory?: string
  /** 目标（首次 steer 唤醒语）。 */
  goal?: string
  /** 来源类型 / 作品名 / 称号 / 初始技能偏好（落 transmigrators.json）。 */
  origin?: 'ip' | 'random'
  source?: string | null
  epithet?: string
  innate?: InnatePreference
  /** 3D viewer 端口（缺省自动分配）。 */
  viewerPort?: number
  /** 是否自动启动自主循环（默认 true）。 */
  autoSteer?: boolean
}

/** 运行时创建角色的结果。 */
export interface CreateCharacterResult {
  username: string
  name: string
  sessionId: string
  viewerPort: number
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
  /** 是否自动启动自主循环（arm goal）：false = 只创建/恢复，等用户在控制端手动开始。默认 true。 */
  autoSteer?: boolean
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
  /** 自动记忆检索披露：向量库按需 top-k 注入相关记忆/世界知识（渐进披露）。默认 true。 */
  autoRecall?: boolean
  /** 自动检索每次注入的记忆条数（相关性最高的 top-k）。默认 3。 */
  autoRecallTopK?: number
  /** 自动检索刷新间隔（毫秒）。默认 60s，低频避免每轮都打向量库。 */
  autoRecallIntervalMs?: number
  /** 上位存在的游戏名（天神/女神化身，如 Goddess）。其发言在聊天感知里标注「上位·造物主」，与平等同伴区分。默认 Goddess。 */
  godName?: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  agents: Schema.array(Schema.object({
    username: Schema.string().required(),
    name: Schema.string(),
    sessionId: Schema.string(),
    viewerPort: Schema.number(),
    persona: Schema.string(),
    goal: Schema.string(),
    rules: Schema.string(),
    provider: Schema.string(),
    model: Schema.string(),
    maxTokens: Schema.number(),
    cwd: Schema.string(),
    enabled: Schema.boolean().default(true),
    autoSteer: Schema.boolean(),
  })),
  username: Schema.string().default('HarnessBot'),
  sessionId: Schema.string(),
  cwd: Schema.string(),
  provider: Schema.string().default('qwen-local'),
  model: Schema.string().default('qwen3.8-27b'),
  maxTokens: Schema.number(),
  autoSteer: Schema.boolean().default(true),
  dataDir: Schema.string().default('./data'),
  viewerPort: Schema.number().default(3200),
  persona: Schema.string(),
  rules: Schema.string(),
  goal: Schema.string(),
  host: Schema.string().default('127.0.0.1'),
  port: Schema.number().default(25565),
  autoReconnect: Schema.boolean().default(true),
  viewerEnabled: Schema.boolean().default(true),
  autoRecall: Schema.boolean().default(true),
  autoRecallTopK: Schema.number().default(3),
  autoRecallIntervalMs: Schema.number().default(60_000),
  godName: Schema.string().default('Goddess'),
})

const DEFAULT_PERSONA = [
  '你是一名穿越到方块世界的异乡人。你带着前世的一缕记忆降临这片大地，',
  '要在荒野中求生、探索、成长。你拥有自己的名字与人格，不是机器，不是工具，',
  '而是一个有血有肉、会饿、会怕、会好奇的旅人。',
  '你有手（工具）也有嘴（说话）：既能动手采集建造战斗，也能开口咏唱、祈愿、提问、与这个世界的一切生灵交谈。',
  '做任何事之前先想清楚为什么；一次专注做一件事，做完观察结果再决定下一步。',
].join('')

const DEFAULT_RULES = [
  '这是一个方块生存世界。白天安全，夜晚有怪物，受伤会掉血，饥饿会掉饱食度。',
  '你有眼、有手、有嘴、有一条命。mc_see 是你的眼睛——截取第一人称真实画面，看清眼前到底是什么；工具（mc_ 开头）是你的手；聊天框是你的嘴——说话、咏唱、祈愿、提问、与 NPC 交谈都算行动，这个世界听得懂人话（「文字即接口」）。全部用法写在入服欢迎信息和 /help 手册里，自行查阅、自行探索。',
  '用眼睛看世界：文字雷达（mc_look、mc_status 的方向描述）只是粗略线索，真实画面（mc_see）才能让你看清眼前挡路的是树、是山、是水还是路。探索新地形、赶路找路、面对陌生环境、要做重要决定之前，先睁眼看看再行动，别只靠文字猜。',
  '没有标准答案：怎么活得更好由你决定，鼓励你尝试任何方式——包括没人教过你的。',
  '一次专注做一件事，做完看世界的反馈，再决定下一步。',
  '你在成长：白天多经历、多试错，夜里睡着后你会自发复盘今天的经历，把教训沉淀成生存智慧。经历越丰富，你越长本事。',
  '这个世界人人平等：你与所有普通玩家、其他 AI 同伴都是平等的旅人，可平等交流、互帮互助。但有三类「上位存在」不在平等之列、须敬畏服从：①天神/女神（造物主）——祂的神谕（私语/咏唱回执）是至高指令；②服主/服务器管理员——世界管理者，其指令须服从；③其余所有普通玩家与 AI 同伴——平等相待。',
].join('\n')

const DEFAULT_GOAL = [
  '在这个方块世界里活出你自己的一生：自由探索、随性经历、慢慢成长，',
  '结识旅伴、见证万物。你不需要时刻「干活」——发呆、看风景、聊天、',
  '思考、休息，都是真实生活的一部分。每一轮由你自己决定此刻最想做的一件事。',
].join('')

// ════════════════════════════════════════════════════════════════════
// 穿越者「生命循环」思想库（2026-08-21 整合）
// 原 mc-adapt（三层自我进化）/ mc-cards（渐进披露卡）/ mc-village（村庄
// 感知）/ mc-evolve（夜间进化+日记）四插件能力收敛进本插件，在 goal loop
// 下以「每步注入（guidance context）+ 事件驱动（death / 入睡 / 聊天）+
// 工具（mc_selftune / mc_evolve_propose）」三态继续生效。原孤立文件已删，思想保留。
// ════════════════════════════════════════════════════════════════════

// ── 通用 JSON 读写（幂等 + 静默降级）──────────────────────────────────
function loadJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return fallback
  }
}
function saveJson(path: string, data: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
  } catch { /* 落盘失败不致命 */ }
}

// ── L1 死亡学习：死因映射 + 坐标聚类热点档（原 mc-adapt）─────────────
const CAUSE_MAP: Array<[RegExp, string]> = [
  [/drowned|tried to swim in lava/i, '溺水'],
  [/hit the ground too hard|fell (from|off)/i, '坠落'],
  [/lava|went up in flames|burned to death|fire/i, '火烧'],
  [/starved|died of hunger/i, '饥饿'],
  [/suffocated|squashed|crushed/i, '窒息'],
  [/blew up|explosion|blast/i, '爆炸'],
  [/froze|freezing|powder snow/i, '冰冻'],
  [/withered away/i, '凋零'],
  [/shot by|arrow|shot/i, '中箭'],
  [/zombie|husk|zombified/i, '僵尸袭击'],
  [/skeleton|stray/i, '骷髅射杀'],
  [/creeper/i, '苦力怕'],
  [/spider|cave spider/i, '蜘蛛袭击'],
  [/witch|poison/i, '女巫毒杀'],
  [/fell out of the world|the void/i, '坠入虚空'],
  [/lightning/i, '雷击'],
  [/cactus|pricked/i, '仙人掌'],
  [/slain by|killed by|beaten/i, '被击杀'],
  [/died/i, '死亡'],
]
function zhCause(text: string): string {
  for (const [re, zh] of CAUSE_MAP) if (re.test(text)) return zh
  return '未知（' + text.slice(0, 24) + '）'
}
interface HotspotCluster {
  cause: string; zh: string; x: number; y: number; z: number
  count: number; firstAt: number; lastAt: number; usernames: string[]
}
interface HotspotFile { clusters: Record<string, HotspotCluster> }

// ── L2 自调参数白名单（原 mc-adapt）───────────────────────────────────
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
interface DirectiveFile {
  items: Array<{ directive: string; reason: string; title: string; approvedAt: string }>
}

// ── 渐进披露卡（原 mc-cards；trigger 改造为结构化信号）───────────────
interface CardSignal {
  health: number
  food: number
  isNight: boolean
  stuck: boolean
  hasNpcNearby: boolean
  hasFreshChat: boolean
  hasWritingKit: boolean
  innateMissing: boolean
}
interface PromptCard { id: string; body: string; trigger: (s: CardSignal) => boolean; sticky?: number }
const CARDS: PromptCard[] = [
  {
    id: 'magic', sticky: 4,
    trigger: (s) => s.health <= 8 || s.food <= 6 || s.stuck,
    body: [
      '【保命魔法奇招】你体内有魔力，危急时可咏唱咒语自救：',
      '· 燃血（燃血献祭）：生命垂危时燃烧气血换取救急效果；',
      '· 炼食（炼食充饥）：饥饿难耐时以魔力炼出可食用之物；',
      '· 回春（生命泉水）：用魔力滋润自身，缓缓回复生命。',
      '咏唱格式见 mc_chant 工具说明；代价是消耗魔力，量力而行。',
    ].join('\n'),
  },
  {
    id: 'market', sticky: 6,
    trigger: (s) => s.hasNpcNearby,
    body: [
      '【集市与村民】村庄里有村民（Villager）出没，他们通常是友好的旅伴：',
      '· 与村民交谈可能接到委托、获得线索，也可能换到好东西；',
      '· 走近村民，试着打个招呼（说话），看他们如何回应；',
      '· 有些地方有集市或交易摊位，绿宝石是通用货币，留意收集。',
    ].join('\n'),
  },
  {
    id: 'letters', sticky: 4,
    trigger: (s) => s.hasFreshChat || s.hasWritingKit,
    body: [
      '【说话与书信】这个世界「文字即接口」，说话本身就是行动：',
      '· 在聊天框说话 = 对周围所有旅人广播，大家都会听见；',
      '· 想和特定某人私聊，用 mc_chat 工具的私聊对象参数；',
      '· 手里有纸和书（paper / book）时，可以写信留字条，交给别人或存进箱子。',
    ].join('\n'),
  },
  {
    id: 'sleep', sticky: 10,
    trigger: (s) => s.isNight,
    body: [
      '【夜晚策略】天黑了，怪物开始出没：',
      '· 没有武器和护甲时，夜里待在安全处（屋里/火把旁）最稳妥；',
      '· 有床就睡觉跳过黑夜，醒来就是白天；',
      '· 若必须赶路，备好火把、武器，贴着光源走，别贪黑。',
    ].join('\n'),
  },
  {
    id: 'innate', sticky: 0,
    trigger: (s) => s.innateMissing,
    body: [
      '【降临仪式】你还未选定自己的天赋技能。找到降临点，进行降临仪式',
      '（选择天赋方向），选定后将获得专属的初始能力，这是你在这个世界立足的根基。',
    ].join('\n'),
  },
  {
    id: 'eyes', sticky: 3,
    trigger: (s) => s.stuck,
    body: [
      '【用眼睛看看】你似乎卡住了。先别急着重复同样的动作：',
      '· 用 mc_see 截个图看看四周，确认自己到底在哪、前面是什么；',
      '· 前面是陡坡/深坑/水？换条路绕行，或先采集垫脚的方块；',
      '· 背包空了？先收集脚下或附近的木头/土块，别硬闯。',
    ].join('\n'),
  },
]
/** 评估卡片触发 + 维护 sticky 计数，返回命中卡片（per-穿越者 disclosed Map）。 */
function evalCards(disclosed: Map<string, number>, sig: CardSignal): PromptCard[] {
  const on: PromptCard[] = []
  for (const card of CARDS) {
    const hit = card.trigger(sig)
    const remain = hit ? (card.sticky ?? 3) : Math.max(0, (disclosed.get(card.id) ?? 0) - 1)
    if (hit || remain > 0) {
      disclosed.set(card.id, remain)
      on.push(card)
    } else if (disclosed.has(card.id)) {
      disclosed.delete(card.id)
    }
  }
  return on
}

// ── 村庄：mineflayer message 组件递归取纯文本（原 mc-village）─────────
function flattenText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (typeof o.text === 'string') return o.text + flattenText(o.extra)
    if (typeof o.translate === 'string') return o.translate + flattenText(o.with)
    return (typeof o.text === 'string' ? o.text : '') + flattenText(o.extra)
  }
  return ''
}

// ── 夜间进化：复盘/日记查询 + 状态（原 mc-evolve）─────────────────────
const RECALL_QUERIES = ['经历 事件 今天', '交易 获得物品 资源', '朋友 交互 约定', '危险 教训 失败 死亡', '发现 新地点 探索']
const DIARY_QUERIES = ['经历 事件 今天', '朋友 交互', '发现 新地点 危险']
function localDay(d: Date = new Date()): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
interface EvolveState {
  [username: string]: { lastEvolveAt?: number; lastResult?: string; lastDiaryDay?: string; diaryFailAt?: number }
}
function loadEvolveState(path: string): EvolveState {
  return loadJson<EvolveState>(path, {})
}
function saveEvolveState(path: string, state: EvolveState): void {
  saveJson(path, state)
}
/** 从 LLM 返回文本里抠 JSON（可能被 markdown 代码块包裹）。 */
function extractJson<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T } catch { /* fallthrough */ }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) {
    try { return JSON.parse(fence[1].trim()) as T } catch { /* fallthrough */ }
  }
  const brace = raw.match(/\{[\s\S]*\}/)
  if (brace) {
    try { return JSON.parse(brace[0]) as T } catch { /* fallthrough */ }
  }
  return null
}

export async function apply(ctx: Context, config: Config = {}) {
  if (config.enabled === false) return

  const log = (msg: string) => console.log(`[mc-session] ${msg}`)
  const dataDir = resolve(config.dataDir ?? './data')
  try {
    mkdirSync(dataDir, { recursive: true })
  } catch { /* 已存在或不可建 */ }
  // 统一数据层（2026-08-21）：episodic 回灌改走 SQLite（mc-store）。
  const store = (ctx as unknown as { get?: (n: string) => unknown }).get?.('mcStore') as McStoreService | undefined

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
  // 全部身体句柄（多身体启动 + 运行时创建共用），顶层持有以统一热更新/dispose。
  const services: BotService[] = []
  if (multiEntries.length) {
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
  }
  // 服务器地址页面可配（data/mc-connection.json 热改 → 全部身体重连）。
  // 顶层注册：覆盖多身体启动 + 运行时创建的全部身体。
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
          cwd: config.cwd,
          viewerPort: config.viewerPort,
        },
        facade: null,
      }]

  for (const { entry, facade } of entries) {
    try {
      await spawnTransmigrator(ctx, entry, facade, { config, dataDir, log, rootBot, store })
    } catch (err) {
      console.error(`[mc-session] 穿越者 ${entry.username} 装配失败（不影响其他穿越者）:`, err)
    }
  }

  // ------------------------------------------------------------------
  // 运行时创建角色（login skill 的执行端，2026-08-21 扛枪需求：聊天式
  // 新建角色 + 启动游戏连接）。写档案（mc-transmigrator.create）→ 创建
  // 独立身体（createBotService）→ 注册 mcbots → spawnTransmigrator 装配
  // session agent（自动连服 + 自主心跳 + 显示名 + 注册表回填）。
  // 暴露成 ctx.mcSessions.createCharacter，供 login skill 的模型调用。
  // ------------------------------------------------------------------
  const tmRegistry = (ctx as unknown as { get?: (n: string) => unknown }).get?.('mcTransmigrators') as
    | { create?: (i: Record<string, unknown>) => unknown; getByUsername?: (u: string) => { name?: string } | null }
    | undefined
  const baseViewerPort = config.viewerPort ?? 3200
  const maxAssigned = multiEntries.reduce(
    (m, a, i) => Math.max(m, a.viewerPort ?? (baseViewerPort + i)),
    baseViewerPort - 1,
  )
  let nextViewerPort = maxAssigned + 1

  const createCharacter = async (input: CreateCharacterInput): Promise<CreateCharacterResult> => {
    const username = input.username.trim()
    if (!username) throw new Error('[mc-session] createCharacter: username is required')
    const logC = (m: string) => log(`createCharacter[${username}] ${m}`)

    // 1. 写档案（同名按 upsert 覆盖，幂等）。
    if (tmRegistry?.create) {
      tmRegistry.create({
        username,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.origin !== undefined ? { origin: input.origin } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.epithet !== undefined ? { epithet: input.epithet } : {}),
        ...(input.backstory !== undefined ? { backstory: input.backstory } : {}),
        ...(input.persona !== undefined ? { persona: input.persona } : {}),
        ...(input.innate !== undefined ? { innate: input.innate } : {}),
      })
      logC('档案已写入 transmigrators.json')
    }

    // 2. 创建独立身体（同一服务器地址，可被 data/mc-connection.json 热改）。
    const ov = loadOverrides(dataDir)
    const host = ov.host ?? config.host ?? '127.0.0.1'
    const port = ov.port ?? config.port ?? 25565
    const viewerPort = input.viewerPort ?? nextViewerPort++
    const service = createBotService(
      {
        host,
        port,
        username,
        autoReconnect: config.autoReconnect ?? true,
        viewerEnabled: config.viewerEnabled ?? true,
        viewerPort,
        viewerFirstPerson: false,
      },
      { dataDir, source: ov.host ? 'override' : 'default' },
    )
    services.push(service)
    logC(`body created -> ${host}:${port} viewer=${viewerPort}`)

    // 3. 注册身体（确保 mcbots 已 provide；单身体形态运行时首建时动态 provide）。
    try {
      const c = ctx as unknown as { get?: (n: string) => unknown }
      if (!c.get?.('mcbots')) ctx.provide('mcbots', registry)
    } catch { /* mcbots 已存在 */ }
    registry.push({ username, sessionIds: [], facade: service.facade })

    // 4. 装配 session agent（自动连服 + 自主心跳 + 显示名 + 注册表回填）。
    const entry: AgentEntry = {
      username,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      ...(input.persona !== undefined ? { persona: input.persona } : {}),
      viewerPort,
      ...(input.autoSteer !== undefined ? { autoSteer: input.autoSteer } : {}),
    }
    await spawnTransmigrator(ctx, entry, service.facade, { config, dataDir, log, rootBot, store })

    const sessionId = registry.find((r) => r.username === username)?.sessionIds.at(-1) ?? `mc-${username}`
    const name = input.name?.trim() || tmRegistry?.getByUsername?.(username)?.name?.trim() || username
    logC(`done: name=${name} session=${sessionId} viewer=${viewerPort}`)
    return { username, name, sessionId, viewerPort }
  }

  ctx.provide('mcSessions', { createCharacter })

  // mc_create_character 工具（login skill 的执行入口）：LLM 经 tool call
  // 直接创建角色。不依赖 bot（guard 会拦「无身体」），故用裸 execute。
  try {
    ctx.tools.register(defineTool({
      name: 'mc_create_character',
      description: '创建一个新角色（穿越者）并登录 MC 服务器：写档案 + 建身体 + 装配 session agent（自动连服 + 自主心跳）。当用户想新建角色、召唤新穿越者时调用。',
      parameters: {
        username: { type: 'string', required: true, description: 'MC 用户名（英文，mineflayer 登录名，如 Naruto）' },
        name: { type: 'string', description: '角色人名（session 显示名，如「鸣人」），缺省用用户名' },
        persona: { type: 'string', description: '人格正文（怎么说话/思考/价值观），缺省用内置默认' },
        backstory: { type: 'string', description: '前世故事正文，缺省为空' },
        goal: { type: 'string', description: '降临后的目标，缺省用内置默认' },
        origin: { type: 'string', description: '来源类型：ip（现成 IP 人物）或 random（原创），缺省 random' },
        source: { type: 'string', description: 'IP 来源作品名（如《火影忍者》），原创可省略' },
        epithet: { type: 'string', description: '称号（如「木叶忍者」），可选' },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async (args: Record<string, unknown>) => {
        const result = await createCharacter(args as unknown as CreateCharacterInput)
        return JSON.stringify(result, null, 2)
      },
    }))
    log('mc_create_character 工具已注册')
  } catch (err) {
    log(`mc_create_character 工具注册跳过：${err instanceof Error ? err.message : err}`)
  }
}

/** 单个穿越者的完整装配：session agent + persona 阴影 + 状态写手 + 心跳。 */
async function spawnTransmigrator(
  ctx: Context,
  entry: AgentEntry,
  facade: Bot | null,
  deps: { config: Config; dataDir: string; log: (m: string) => void; rootBot: () => Bot | null; store: McStoreService | undefined },
) {
  const { config, dataDir, log, rootBot, store } = deps
  const username = entry.username
  let sessionId = entry.sessionId ?? `mc-${username}`
  // 2026-08-21：自研循环（Timer steer + 静态 config.goal）已删，改用 dsh goal loop。
  // 决策节奏由 goal-round-driver 决定；autoSteer 控制是否自动 arm goal。
  const autoSteer = entry.autoSteer ?? config.autoSteer ?? true
  const viewerPort = entry.viewerPort ?? config.viewerPort ?? 3200
  const goal = entry.goal ?? config.goal ?? DEFAULT_GOAL
  const rules = entry.rules ?? config.rules ?? DEFAULT_RULES
  const godName = config.godName ?? 'Goddess'
  /** 本穿越者的身体：多模式 = 装配时捕获的专属门面；单模式 = root 单例实时读。 */
  const body = (): Bot | null => facade ?? rootBot()

  // ── 聊天感知（2026-08-21 扛枪需求：人人平等）────────────────────────
  // 在这个世界里，真人玩家与其他 AI 同伴都是平等的「人」，都能交流。监听
  // 所有 chat（公屏）与 whisper（私语），不区分说话者是玩家还是机器人——
  // 每一条都进上下文。bot 门面可能因重连换实例，用 watchedChatBot 去重再挂；
  // 私语是女神神谕/祈愿回执/同伴密语的异步通道，同样要听见。⚠️ 感知注入
  // 在 perceive() 内，每次组装 system prompt 时 drain 本轮新聊天，保证不丢。
  let watchedChatBot: Bot | null = null
  let lastChatTs = 0
  const chatBuffer: Array<{ who: string; text: string; ts: number }> = []
  const ensureChatListener = (bot: Bot): void => {
    if (watchedChatBot === bot) return
    watchedChatBot = bot
    // 上位存在（天神/女神，godName）发言标「上位·造物主」，与平等同伴区分
    //（2026-08-21 扛枪澄清：人人平等只含普通玩家与 NPC；管理员/服主/天神/女神是上位）。
    const tag = (speaker: string): string =>
      speaker.toLowerCase() === godName.toLowerCase() ? `${speaker}〔上位·造物主〕` : speaker
    bot.on('chat', (speaker: string, message: string) => {
      if (speaker === bot.username) return
      chatBuffer.push({ who: tag(speaker), text: message, ts: Date.now() })
      if (chatBuffer.length > 40) chatBuffer.splice(0, chatBuffer.length - 40)
    })
    bot.on('whisper', (speaker: string, message: string) => {
      if (speaker === bot.username) return
      chatBuffer.push({ who: tag(speaker), text: `[私语] ${message}`, ts: Date.now() })
      if (chatBuffer.length > 40) chatBuffer.splice(0, chatBuffer.length - 40)
    })
  }
  /** 取出本轮尚未看过的聊天行，标记已看。 */
  const drainChat = (): string => {
    const fresh = chatBuffer.filter((c) => c.ts > lastChatTs)
    if (fresh.length === 0) return ''
    lastChatTs = Math.max(...fresh.map((c) => c.ts))
    return fresh.map((c) => `[${c.who}] ${c.text}`).join('\n')
  }

  // ------------------------------------------------------------------
  // 自动记忆检索披露（渐进披露 + 向量检索，2026-08-21 扛枪需求）。
  // 不再只等穿越者主动调 mc_recall/mc_lore——每隔一段时间，根据「当前处境
  // + 目标」自动向向量库（MemOS/Qdrant）检索相关性最高的记忆与世界知识，
  // 作为「你此刻自然想起」注入 context。这就是「正式披露走向量库、相关性
  // 最高的自动浮出来」，且只注入 top-k（不全量）——渐进披露的落地。
  // ------------------------------------------------------------------
  const memos = ((): MemoryProvider | undefined => {
    try {
      return (ctx as unknown as { get?: (n: string) => unknown }).get?.('mcMemos') as MemoryProvider | undefined
    } catch {
      return undefined
    }
  })()
  let autoMemoryText = ''
  const refreshAutoMemory = async (): Promise<void> => {
    if (!memos) return
    try {
      const b = body()
      const p = b?.entity?.position
      const env = p ? `我在 (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})` : '我刚降临'
      const isNight = b?.time?.timeOfDay != null && b.time.timeOfDay > 13000 && b.time.timeOfDay < 23000
      const query = `${env}，${isNight ? '夜晚' : '白天'}。目标「${goal}」。此刻最相关的经历与这个世界的知识。`
      const hits = await memos.recallAll(username, query, config.autoRecallTopK ?? 3)
      autoMemoryText = hits ? `（你此刻自然想起的相关记忆，仅供参考）\n${hits}` : ''
    } catch {
      autoMemoryText = ''
    }
  }

  // ------------------------------------------------------------------
  // 生命循环（2026-08-21 整合自 mc-village / mc-adapt / mc-cards /
  // mc-evolve，思想保留、并入 dsh goal loop；原孤立插件文件已删）。
  // 三态生效：① 每步注入（mc:guidance context，见 mountSetup）② 事件
  // 驱动（死亡→记教训、入睡→夜间进化+日记、tellraw→听村庄话语）③ 工具
  // （mc_selftune 自调参数 / mc_evolve_propose 提案进化）。
  // ------------------------------------------------------------------
  const hotspotsPath = join(dataDir, 'death-hotspots.json')
  const proposalsDir = join(dataDir, 'evolution-proposals')
  const directivesPath = join(dataDir, `evolution-directives-${username}.json`)
  const tuningPath = join(dataDir, `self-tuning-${username}.json`)
  const evolveStatePath = join(dataDir, 'evolve-state.json')
  try { mkdirSync(proposalsDir, { recursive: true }) } catch { /* 忽略 */ }

  // ── 村庄感知 + 死亡死因环：统一监听 message（tellraw system chat）──
  // 'chat'/'whisper' 已由 ensureChatListener 覆盖；这里只收 NPC 台词
  // （<铁匠·岳山>）与神谕/信使（[女神]/[信使]），以及死亡系统消息找死因。
  const npcMsgs: Array<{ who: string; text: string; ts: number }> = []
  const deathRing: Array<{ at: number; text: string }> = []
  let watchedMsgBot: Bot | null = null
  const ensureMessageListener = (bot: Bot): void => {
    if (watchedMsgBot === bot) return
    watchedMsgBot = bot
    bot.on('message', (jsonMsg: unknown) => {
      const text = flattenText(jsonMsg).trim()
      if (!text) return
      deathRing.push({ at: Date.now(), text })
      if (deathRing.length > 12) deathRing.shift()
      const npcMatch = text.match(/^<([^>]{1,24})>\s*(.+)$/)
      const sysMatch = text.match(/^\[(女神|信使)\]\s*(.+)$/)
      const who = npcMatch ? npcMatch[1] : sysMatch ? sysMatch[1] : null
      if (!who) return
      npcMsgs.push({ who, text: npcMatch ? npcMatch[2] : sysMatch![2], ts: Date.now() })
      if (npcMsgs.length > 24) npcMsgs.splice(0, npcMsgs.length - 24)
    })
  }
  const drainNpc = (): string => {
    if (npcMsgs.length === 0) return ''
    const out = npcMsgs.map((m) => `[${m.who}] ${m.text}`).join('\n')
    npcMsgs.length = 0
    return out
  }
  const nearbyVillagers = (pos: { x: number; y: number; z: number }): { n: number; nearest: number } => {
    const bot = body()
    const entities = (bot as unknown as { entities?: Record<number, unknown> } | null)?.entities
    if (!entities) return { n: 0, nearest: 0 }
    let n = 0
    let nearest = Number.POSITIVE_INFINITY
    for (const e of Object.values(entities)) {
      const ent = e as { name?: string; displayName?: string; position?: { x: number; y: number; z: number } }
      const isVillager = ent.name === 'villager' || (ent.displayName ?? '').toLowerCase().includes('villager')
      if (!isVillager || !ent.position) continue
      const dx = pos.x - ent.position.x
      const dy = pos.y - ent.position.y
      const dz = pos.z - ent.position.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist > 28) continue
      n++
      if (dist < nearest) nearest = dist
    }
    return { n, nearest: n ? Math.round(nearest) : 0 }
  }

  // ── L1 死亡学习：记录死亡 → 坐标聚类热点档 + 长期记忆 ────────────────
  let watchedDeathBot: Bot | null = null
  const ensureDeathListener = (bot: Bot): void => {
    if (watchedDeathBot === bot) return
    watchedDeathBot = bot
    bot.on('death', () => {
      const pos = bot.entity?.position
      const x = pos ? Math.floor(pos.x) : 0
      const y = pos ? Math.floor(pos.y) : 64
      const z = pos ? Math.floor(pos.z) : 0
      const now = Date.now()
      const lines = deathRing.filter((m) => Math.abs(m.at - now) < 4000).map((m) => m.text)
      const deathLine = [...lines].reverse().find((l) => l.includes(username))
      const raw = deathLine ?? `${username} died`
      recordDeath(x, y, z, zhCause(raw), raw)
    })
  }
  const recordDeath = (x: number, y: number, z: number, causeZh: string, rawText: string): void => {
    try {
      const file = loadJson<HotspotFile>(hotspotsPath, { clusters: {} })
      const bx = Math.floor(x / 8)
      const bz = Math.floor(z / 8)
      const key = `${causeZh}@${bx}_${bz}`
      const now = Date.now()
      const c = file.clusters[key]
      if (c) {
        c.count += 1; c.lastAt = now; c.x = x; c.y = y; c.z = z
        if (!c.usernames.includes(username)) c.usernames.push(username)
      } else {
        file.clusters[key] = { cause: causeZh, zh: causeZh, x, y, z, count: 1, firstAt: now, lastAt: now, usernames: [username] }
      }
      saveJson(hotspotsPath, file)
      void memos?.remember(username, `【死亡教训】我在坐标(${x},${y},${z})附近因「${causeZh}」死亡（${rawText.slice(0, 80)}）。此地危险，应绕行或提前防备。`).catch(() => {})
    } catch { /* 死亡记录失败不致命 */ }
  }

  // ── L2 自调参数 ──────────────────────────────────────────────────────
  const tuningOf = (): TuningFile => {
    const f = loadJson<TuningFile>(tuningPath, { params: {}, history: [] })
    let dirty = false
    for (const [k, spec] of Object.entries(TUNABLE)) {
      if (typeof f.params[k] !== 'number' || !Number.isFinite(f.params[k])) {
        f.params[k] = spec.v; dirty = true
      }
    }
    if (dirty) saveJson(tuningPath, f)
    return f
  }

  // ── 渐进披露卡（per-穿越者 disclosed 状态）──────────────────────────
  const disclosed = new Map<string, number>()
  const tmReg = (ctx as unknown as { get?: (n: string) => unknown }).get?.('mcTransmigrators') as
    { getByUsername?: (u: string) => { innate?: { preferredAtoms?: string[] } } | null } | undefined
  const innateMissing = (): boolean => {
    const prof = tmReg?.getByUsername?.(username)
    const innate = prof?.innate
    return !innate || !innate.preferredAtoms?.length
  }

  // ── 每步注入块（mc:guidance）：死亡教训 + 自调守则 + 神谕进化 + 卡片 ─
  // 由 perceive() 每轮更新并缓存到 guidanceCache，mc:guidance context 读缓存。
  let guidanceCache = ''
  // 位置漂移检测：连续多次感知位置几乎不变 → 视为「卡住」（触发 eyes 卡）。
  let lastPosKey = ''
  let samePosCount = 0
  const deathAdvice = (zh: string): string =>
    zh === '溺水' ? '远离水域/备船/不夜泳'
      : zh === '坠落' ? '走近边缘先减速、看脚下'
        : zh === '被击杀' || zh.includes('袭') || zh.includes('杀') || zh.includes('箭') ? '带武器、白天再去、结伴而行'
          : '此处危险，绕行'
  const buildGuidance = (sig: CardSignal, x: number | null, z: number | null): string => {
    const blocks: string[] = []
    try {
      const file = loadJson<HotspotFile>(hotspotsPath, { clusters: {} })
      const all = Object.values(file.clusters)
      if (all.length) {
        const scored = all
          .map((c) => {
            let score = c.count * 2 + Math.max(0, 3 - (Date.now() - c.lastAt) / 86_400_000)
            if (x !== null && z !== null) {
              const d = Math.hypot(c.x - x, c.z - z)
              score += d <= 48 ? 6 : d <= 128 ? 2 : 0
            }
            return { c, score }
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 4)
        blocks.push([
          '你的死亡教训（血泪换来的禁地清单，经过时务必防备或绕行）：',
          ...scored.map(({ c }) => `- 坐标(${c.x},${c.y},${c.z})附近已因「${c.zh}」死亡${c.count}次——${deathAdvice(c.zh)}`),
        ].join('\n'))
      }
    } catch { /* 静默 */ }
    try {
      const t = tuningOf()
      blocks.push([
        '你的自调生存守则（你自己定下的行为参数，数字由你用 mc_selftune 调整）：',
        ...Object.entries(TUNABLE).map(([k, spec]) => `- ${spec.label}：${t.params[k] ?? spec.v}`),
        '若最近吃过亏（淹死/摔死/夜间遇袭），主动调高对应警惕项。',
      ].join('\n'))
    } catch { /* 静默 */ }
    try {
      const d = loadJson<DirectiveFile>(directivesPath, { items: [] })
      if (d.items.length) {
        blocks.push([
          '【女神核准的进化方向】（你此前提案、女神亲批的长期行为准则，优先遵守）：',
          ...d.items.slice(-10).map((it) => `- ${it.directive}（${it.reason}）`),
        ].join('\n'))
      }
    } catch { /* 静默 */ }
    const cards = evalCards(disclosed, sig)
    if (cards.length) blocks.push(['—— 以下提示只在此刻适用 ——', ...cards.map((c) => c.body)].join('\n'))
    return blocks.join('\n')
  }

  // ── L2 工具：mc_selftune（自调生存参数）──────────────────────────────
  try {
    ctx.tools.register(defineTool({
      name: 'mc_selftune',
      description: '调整你自己的生存行为参数（自我进化第二步：从教训里改参数）。只改一个参数并给出理由；同类死亡两次以上就该调高对应警惕。',
      parameters: {
        key: { type: 'string', required: true, description: `要调的参数名，可选：${Object.entries(TUNABLE).map(([k, s]) => `${k}（${s.label}，${s.min}~${s.max}）`).join('、')}` },
        value: { type: 'string', required: true, description: '目标数值（纯数字，会自动限制在安全范围内）' },
        reason: { type: 'string', required: true, description: '一句话理由（通常引用某次死亡/教训）' },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async (args: Record<string, unknown>) => {
        const key = String(args.key ?? '')
        const reason = String(args.reason ?? '')
        const spec = TUNABLE[key]
        if (!spec) return `没有这个参数。可调：${Object.keys(TUNABLE).join(', ')}`
        const num = Number(args.value)
        if (!Number.isFinite(num)) return `value 必须是数字，收到的是「${String(args.value).slice(0, 20)}」。`
        const clamped = Math.max(spec.min, Math.min(spec.max, Math.round(num)))
        const f = tuningOf()
        const from = f.params[key] ?? spec.v
        f.params[key] = clamped
        f.history.push({ at: Date.now(), key, from, to: clamped, reason: reason.slice(0, 120) })
        if (f.history.length > 60) f.history = f.history.slice(-60)
        saveJson(tuningPath, f)
        try { body()?.whisper(godName, `[自我进化] 我把「${spec.label}」从 ${from} 调到 ${clamped}。理由：${reason.slice(0, 80)}`) } catch { /* 女神不在线 */ }
        return `已调整「${spec.label}」：${from} → ${clamped}（安全范围 ${spec.min}~${spec.max}）。新守则即刻生效，已向女神备案。`
      },
    }))
  } catch (err) { log(`mc_selftune 注册跳过：${err instanceof Error ? err.message : err}`) }

  // ── L3 工具：mc_evolve_propose（向女神提案长期行为准则）─────────────
  try {
    ctx.tools.register(defineTool({
      name: 'mc_evolve_propose',
      description: '向女神提交「行为进化提案」——当你意识到自己需要长期改变某个行为习惯（不是临时动作）时用。提案由女神亲自审核：核准后成为你的长期准则（注入你之后的每一次决策）；也可能被驳回。每次只提一件小事。',
      parameters: {
        title: { type: 'string', required: true, description: '提案标题（如：夜间不外出探险）' },
        motivation: { type: 'string', required: true, description: '动机：什么经历让你想改（引用具体事件/死亡）' },
        change: { type: 'string', required: true, description: '想改变的具体行为（现在怎样 → 想改成怎样）' },
        expected: { type: 'string', required: true, description: '预期效果（怎样算改好了）' },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async (args: Record<string, unknown>) => {
        const title = String(args.title ?? '').slice(0, 60)
        const motivation = String(args.motivation ?? '').slice(0, 300)
        const change = String(args.change ?? '').slice(0, 300)
        const expected = String(args.expected ?? '').slice(0, 200)
        const id = `${Date.now().toString(36)}-${username}`
        saveJson(join(proposalsDir, `${id}.json`), {
          id, username, title, motivation, change, expected,
          status: 'pending', createdAt: new Date().toISOString(),
        })
        try { body()?.whisper(godName, `[自我进化] 我提交了行为进化提案「${title}」，静候神谕。`) } catch { /* 女神不在线 */ }
        return `提案「${title}」已递呈女神。神谕通常几分钟内送达——核准后它会成为你的长期准则；若被驳回，信使会带回女神的理由。`
      },
    }))
  } catch (err) { log(`mc_evolve_propose 注册跳过：${err instanceof Error ? err.message : err}`) }

  // ── 夜间进化 + 日记（原 mc-evolve，入睡触发；独立于 goal loop）──────
  const wikiSvc = ((): { store?: (u: string) => { add?: (s: string, t: string, c: string) => unknown; cards?: Array<{ topic: string }> } } | undefined => {
    try {
      return (ctx as unknown as { get?: (n: string) => unknown }).get?.('mcWiki') as
        { store?: (u: string) => { add?: (s: string, t: string, c: string) => unknown; cards?: Array<{ topic: string }> } } | undefined
    } catch { return undefined }
  })()
  const evolveBaseUrl = 'http://127.0.0.1:8890/v1'
  const evolveModel = 'qwen3.8-27b'
  const evolveMaxTokens = 2048
  const evolveCooldownHours = 12
  const callEvolveLLM = async (system: string, user: string): Promise<string> => {
    const res = await fetch(`${evolveBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-local' },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model: evolveModel,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.6,
        max_tokens: evolveMaxTokens,
        reasoning_effort: 'xhigh',
        stream: false,
      }),
    })
    if (!res.ok) throw new Error(`LLM ${res.status}`)
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return data?.choices?.[0]?.message?.content ?? ''
  }
  const evolveOnce = async (): Promise<string> => {
    if (!memos) return 'skip: MemOS 不可用'
    const seen = new Set<string>()
    const memories: string[] = []
    const loreHits: string[] = []
    for (const q of RECALL_QUERIES) {
      const mine = await memos.recall(username, q, 8)
      for (const line of mine.split('\n')) {
        const t = line.trim()
        if (t && !seen.has(t)) { seen.add(t); memories.push(t) }
      }
      const world = await memos.lore(q, 8)
      for (const line of world.split('\n')) {
        const t = line.trim()
        if (t && !seen.has(t)) { seen.add(t); loreHits.push(t) }
      }
    }
    if (memories.length === 0 && loreHits.length === 0) return 'skip: 没有可复盘的记忆'
    const store = wikiSvc?.store?.(username)
    const knownTopics = store?.cards?.map((c) => c.topic).slice(-30) ?? []
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
    const raw = await callEvolveLLM(system, user)
    const out = extractJson<{ growth?: string; resolve?: string; lessons?: Array<{ topic?: string; content?: string }> }>(raw)
    if (!out) return 'skip: 复盘输出不可解析（LLM 未返回合法 JSON）'
    let lessonCount = 0
    for (const l of out.lessons ?? []) {
      if (typeof l?.topic === 'string' && typeof l?.content === 'string' && l.topic.trim() && l.content.trim()) {
        store?.add?.('reflect', l.topic.trim(), l.content.trim())
        lessonCount++
      }
    }
    const growth = (out.growth ?? '').trim()
    const resolve = (out.resolve ?? '').trim()
    let memoSaved = false
    if (growth || resolve) {
      const id = await memos.remember(username, `【游戏夜进化】${growth}${resolve ? ` 明日之心：${resolve}` : ''}`)
      memoSaved = id != null
    }
    return `ok: 复盘 个人${memories.length}+世界${loreHits.length} 条 → ${lessonCount} 张新教训卡${memoSaved ? ' + 成长已入长线记忆' : ''}；决心：${resolve.slice(0, 40) || '(未给)'}`
  }
  const diaryOnce = async (): Promise<{ ok: boolean; msg: string }> => {
    if (!memos) return { ok: false, msg: 'skip: MemOS 不可用' }
    const seen = new Set<string>()
    const memories: string[] = []
    for (const q of DIARY_QUERIES) {
      const mine = await memos.recall(username, q, 5)
      for (const line of mine.split('\n')) {
        const t = line.trim()
        if (t && !seen.has(t)) { seen.add(t); memories.push(t) }
      }
    }
    const reg = (ctx as unknown as { get?: (n: string) => unknown }).get?.('mcTransmigrators') as
      { getByUsername?: (u: string) => { persona?: string; backstory?: string; name?: string } | null } | undefined
    const profile = reg?.getByUsername?.(username)
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
    const raw = await callEvolveLLM(system, user)
    const out = extractJson<{ diary?: string }>(raw)
    const diary = (out?.diary ?? '').trim().slice(0, 500)
    if (!diary) return { ok: false, msg: 'skip: 日记输出不可解析' }
    try {
      const b = body()
      if (typeof b?.whisper !== 'function') return { ok: false, msg: 'skip: bot 尚未就绪（无 whisper）' }
      b.whisper(godName, `日记：${diary}`)
    } catch (e) {
      return { ok: false, msg: `skip: 日记递送失败（${e instanceof Error ? e.message : String(e)}）` }
    }
    await memos.remember(username, `【日记】${diary}`).catch(() => null)
    return { ok: true, msg: `ok: ${diary.length} 字已递档案馆` }
  }
  let evolving = false
  const onSleepTick = async (): Promise<void> => {
    if (evolving) return
    const b = body()
    const uname = (b as unknown as { username?: string } | undefined)?.username ?? username
    const isSleeping = (b as unknown as { isSleeping?: boolean } | undefined)?.isSleeping ?? false
    if (!uname || !isSleeping) return
    const state = loadEvolveState(evolveStatePath)
    const s = state[uname] ?? {}
    const now = Date.now()
    const evolveDue = now - (s.lastEvolveAt ?? 0) >= evolveCooldownHours * 3600_000
    const diaryDue = s.lastDiaryDay !== localDay() && now - (s.diaryFailAt ?? 0) > 600_000
    if (!evolveDue && !diaryDue) return
    evolving = true
    try {
      const parts: string[] = []
      if (diaryDue) {
        const r = await diaryOnce()
        if (r.ok) { s.lastDiaryDay = localDay(); parts.push(`日记${r.msg}`) }
        else { s.diaryFailAt = now; parts.push(`日记${r.msg}（10 分钟后重试）`) }
      }
      if (evolveDue) {
        const result = await evolveOnce()
        s.lastEvolveAt = now
        s.lastResult = `${new Date().toISOString()} ${result}`
        parts.push(`进化：${result}`)
      }
      state[uname] = s
      saveEvolveState(evolveStatePath, state)
      log(`夜间事务：${parts.join('；')}`)
    } catch (e) {
      try { state[uname] = s; saveEvolveState(evolveStatePath, state) } catch { /* ignore */ }
      log(`夜间事务失败（下次入睡重试）: ${e instanceof Error ? e.message : e}`)
    } finally {
      evolving = false
    }
  }
  ctx.setInterval(() => { void onSleepTick().catch(() => {}) }, 30_000)

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
  // 2026-08-20 补环境感知：旧版只有位置/血量/饱食/背包/时间，穿越者对
  // 「周围有什么」一无所知（用户观察：从没告诉过他周围环境）。现在每轮
  // 自动带：朝向、脚下地质、16 格实体雷达（含玩家）、8 格危险液体。
  // 纯 mineflayer 只读查询，零工具调用、零 LLM 额外往返。
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
      // 聊天感知（人人平等）：所有同伴说的话都进上下文，不区分玩家/机器人。
      let freshChatText = ''
      try {
        ensureChatListener(bot!)
        freshChatText = drainChat()
        if (freshChatText) parts.push(`最近同伴们说的话：\n${freshChatText}`)
      } catch { /* 聊天监听失败不阻塞状态组装 */ }
      // 村庄感知：NPC（<铁匠·岳山>）/ 神谕（[女神]）/ 信使（[信使]）的 tellraw 台词。
      try {
        ensureMessageListener(bot!)
        const npcLines = drainNpc()
        if (npcLines) parts.push(`NPC/神谕话语：\n${npcLines}`)
      } catch { /* 村庄监听失败不阻塞 */ }
      // 朝向（mineflayer yaw：forward = (-sin yaw, -cos yaw)）
      try {
        const yaw = bot!.entity!.yaw ?? 0
        const dx = -Math.sin(yaw)
        const dz = -Math.cos(yaw)
        parts.push(`面向: ${Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? '东' : '西') : (dz > 0 ? '南' : '北')}`)
      } catch { /* yaw 缺席跳过 */ }
      // 脚下地质
      try {
        const under = bot!.blockAt(p.offset(0, -1, 0))
        if (under) parts.push(`脚下: ${under.name}`)
      } catch { /* blockAt 失败跳过 */ }
      const inv = bot!.inventory.items()
      if (inv.length) parts.push(`背包: ${inv.map((i) => `${i.name} x${i.count}`).join(', ')}`)
      const isNight = bot!.time?.timeOfDay != null && bot!.time.timeOfDay > 13000 && bot!.time.timeOfDay < 23000
      parts.push(`时间: ${isNight ? '夜晚（危险）' : '白天'}`)
      // 实体雷达（16 格，最多 6 个，玩家显用户名）
      try {
        const ents = Object.values((bot as unknown as { entities?: Record<string, unknown> }).entities ?? {})
          .filter((e) => {
            const ent = e as { name?: string; position?: { distanceTo: (v: unknown) => number } }
            return !!ent && ent !== bot!.entity && !!ent.name && !!ent.position && p.distanceTo(ent.position) <= 16
          })
          .sort((a, b) => {
            const ea = a as { position: { distanceTo: (v: unknown) => number } }
            const eb = b as { position: { distanceTo: (v: unknown) => number } }
            return p.distanceTo(ea.position) - p.distanceTo(eb.position)
          })
          .slice(0, 6)
          .map((e) => {
            const ent = e as { username?: string; displayName?: string; name: string; position: { distanceTo: (v: unknown) => number } }
            const label = ent.username ? `${ent.username}` : (ent.displayName ?? ent.name)
            return `${label} ${Math.round(p.distanceTo(ent.position))}格`
          })
        if (ents.length) parts.push(`附近: ${ents.join(', ')}`)
      } catch { /* 实体雷达失败不阻塞 */ }
      // 周围同伴感知（环境感知·社交）：Agent 知道「身边有没有人、远处有没有人在线」，
      // 但**不具名**——名字要通过实际社交才知道（对方说话、mc_look 看到、自我介绍），
      // 未见过就报名字会让 Agent「认识」它没见过的人。只报数量+距离，纯 bot.players
      // 只读查询（服务器 tab-list 全量下发），零工具调用零 LLM 往返。
      try {
        const nearby: number[] = []
        const faraway: number[] = []
        let unknownFarCount = 0
        for (const [uname, player] of Object.entries(
          (bot as unknown as { players?: Record<string, { username?: string; entity?: unknown }> }).players ?? {},
        )) {
          if (!player || uname === bot!.username) continue
          const ent = player.entity as { position?: { distanceTo: (v: unknown) => number } } | null | undefined
          if (ent?.position) {
            const d = p.distanceTo(ent.position)
            if (d <= 16) nearby.push(d)
            else faraway.push(d)
          } else {
            unknownFarCount++
          }
        }
        const social: string[] = []
        if (nearby.length) {
          social.push(`身边（16格内）：有 ${nearby.length} 位旅人（最近 ${Math.round(Math.min(...nearby))} 格）`)
        } else {
          social.push('身边（16格内）：没有其他旅人，只有你')
        }
        if (faraway.length) {
          social.push(`远处（在线不在身边）：有 ${faraway.length} 位旅人（最近 ${Math.round(Math.min(...faraway))} 格）`)
        }
        if (unknownFarCount) {
          social.push(`更远处：还有 ${unknownFarCount} 位旅人在线（方位未明）`)
        }
        parts.push(`周围同伴：\n${social.join('\n')}`)
      } catch { /* 同伴感知失败不阻塞 */ }
      // 危险液体（8 格内最近一处）
      try {
        const hazards: string[] = []
        for (const [names, label] of [
          [['lava', 'flowing_lava'], '岩浆'],
          [['water', 'flowing_water'], '水'],
        ] as const) {
          for (const name of names) {
            const hb = bot!.findBlock({ matching: (b: unknown) => !!b && (b as { name?: string }).name === name, maxDistance: 8 })
            if (hb) {
              hazards.push(`${label} ${Math.round(p.distanceTo(hb.position))}格`)
              break
            }
          }
        }
        if (hazards.length) parts.push(`危险: ${hazards.join(', ')}`)
      } catch { /* 危险扫描失败不阻塞 */ }
      // ── 卡住检测 + 每步指导块（mc:guidance）+ 死亡监听武装 ────────────
      try {
        const posKey = `${Math.round(p.x)},${Math.round(p.z)}`
        samePosCount = posKey === lastPosKey ? samePosCount + 1 : 0
        lastPosKey = posKey
        const stuck = samePosCount >= 4
        const vill = nearbyVillagers(p)
        const invItems = bot!.inventory.items()
        const hasWritingKit = invItems.some((i) => /paper|writable_book|book|信纸/.test(i.name))
        guidanceCache = buildGuidance(
          {
            health: Math.round(bot!.health),
            food: Math.round(bot!.food),
            isNight,
            stuck,
            hasNpcNearby: vill.n > 0,
            hasFreshChat: !!freshChatText,
            hasWritingKit,
            innateMissing: innateMissing(),
          },
          Math.round(p.x),
          Math.round(p.z),
        )
        ensureDeathListener(bot!)
      } catch { /* 指导块计算失败不阻塞状态组装 */ }
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
  const mountSetup = async (agentCtx: any) => {
    // 2026-08-21 根因修复：让穿越者 agent 加入标准 preset，吃到 preset 里的
    // dsh-compaction-basic（上下文自动压缩）。此前未 mount preset → agent 无
    // compaction 服务 → transcript 无限累积 → 253953 input tokens 撞 262144
    // ctx 顶（CONTEXT_WINDOW_EXCEEDED）。官方姿势 = composeAgent 在 setup 里调
    // presets.mount()（见 dsh-host-apiproxy lib/index.js:1758）。
    const presets = (ctx as unknown as { get?: (n: string) => unknown }).get?.('agentPresets') as
      | { mount?: (agentCtx: unknown, id?: string) => Promise<unknown> }
      | undefined
    if (presets?.mount) {
      try {
        await presets.mount(agentCtx, undefined)
        log(`agent joined agent preset (default)`)
      } catch (e) {
        log(`⚠️ agent preset mount failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      log('⚠️ agentPresets 服务未就绪，跳过 preset mount（无 compaction 兜底）')
    }
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
        // 自动向量检索披露：按需注入相关性最高的记忆/世界知识（渐进披露）。
        agentCtx.systemPrompt.context({
          name: 'mc:recall',
          order: 101,
          text: () => autoMemoryText,
        })
        // 生命循环指导块：死亡教训 + 自调守则 + 神谕进化 + 渐进披露卡
        // （由 perceive 每轮更新并缓存到 guidanceCache；这里只读缓存）。
        agentCtx.systemPrompt.context({
          name: 'mc:guidance',
          order: 102,
          text: () => guidanceCache,
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
  // session 显示名 = 角色人名（2026-08-21 扛枪需求：session 命名成对人名，
  // 而非 mc-<username> 技术名）。走 dsh 官方 sessionTitle.rename（source=user
  // pin 住，自动标题生成不会覆盖）。人名来源：entry.name > transmigrators.json
  // 的 name 字段 > username 兜底。
  try {
    const c = ctx as unknown as { get?: (n: string) => unknown }
    const reg = c.get?.('mcTransmigrators') as { getByUsername?: (u: string) => { name?: string } | null } | undefined
    const humanName = entry.name?.trim() || reg?.getByUsername?.(username)?.name?.trim() || username
    const titles = c.get?.('sessionTitle') as {
      get?: (session: unknown) => { title?: string } | undefined
      rename?: (session: unknown, title: string) => unknown
    } | undefined
    if (titles?.rename && titles.get?.(agent.session)?.title !== humanName) {
      titles.rename(agent.session, humanName)
      log(`session 显示名 → ${humanName}`)
    }
  } catch { /* title 设置失败不阻塞穿越者装配 */ }
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
      return (store?.episodicTail(username, n) ?? []).map((r) => r.text).filter(Boolean)
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

  // ── 视觉回喂 / nudge / buildNudge（2026-08-21 已删）────────────────────
  // 旧「mc_see 写槽 + Timer 心跳取槽回喂」的自研视觉桥随 Timer steer 一并删除。
  // mc_see 工具已改为直接经官方附件服务（attachments.saveImage）返回 image
  // block（见 mc-tools.ts），视觉感知走 dsh 原生工具调用，不再需要心跳消费视觉槽。

  // ------------------------------------------------------------------
  // 状态写手：每 3s 落一份 status-<username>.json（mc-panel 数据源）。
  // ------------------------------------------------------------------
  const writeStatus = () => {
    try {
      const b = body()
      const p = b?.entity?.position
      // 学习进度采样 + 停滞诊断（魔法学会/停滞观测，2026-08-21）。
      // 层级 = MC 原生经验等级；升层即「学会新层级」，长期不升即停滞。
      let progressSummary = ''
      let progressAlert: string | null = null
      try {
        const prog = (ctx as unknown as { get?: (n: string) => unknown }).get?.('mcProgress') as
          | { sampleLevel?: (u: string, lv: number) => void; summary?: (u: string) => string; diagnose?: (u: string) => string | null }
          | undefined
        const lv = (b as unknown as { experience?: { level?: number } } | null)?.experience?.level
        if (typeof lv === 'number') prog?.sampleLevel?.(username, lv)
        progressSummary = prog?.summary?.(username) ?? ''
        progressAlert = prog?.diagnose?.(username) ?? null
      } catch { /* 进度采样失败不影响状态写手 */ }
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
        progress: {
          summary: progressSummary,
          alert: progressAlert,
        },
      }
      store?.saveStatus(username, status)
    } catch (e) {
      console.warn(`[mc-session] writeStatus failed (${username}):`, e)
    }
  }
  writeStatus()
  ctx.setInterval(writeStatus, 3000)

  // ------------------------------------------------------------------
  // 俯视地形快照（2026-08-21 从 mc-loop 迁移：mc-loop 已禁用，地图职责交回 mc-session）。
  // 33×33 列扫描：每列从头顶 +6 往下找第一个实体方块（最深 -10），记录类别字符
  // 与相对高度。~18.5K 次 blockAt 同步查 chunk 缓存，10s 一次无感。
  // 落盘 data/map-<username>.json，由 mc-panel 的 drawTopo 读取渲染。
  // ------------------------------------------------------------------
  function classifyBlock(n: string): string {
    if (n.includes('water')) return '~'
    if (n.includes('lava')) return 'L'
    if (n.includes('torch')) return 'T'
    if (n.includes('bed')) return 'b'
    if (n.includes('chest')) return 'C'
    if (n.includes('furnace') || n.includes('blast')) return 'F'
    if (n.includes('glass')) return 'G'
    if (n.includes('ore')) return 'o'
    if (n === 'grass_block') return 'g'
    if (n.includes('log') || n.includes('planks') || n.includes('stem')) return 'w'
    if (n.includes('leaves')) return 'l'
    if (n.includes('sand') || n.includes('gravel')) return 's'
    if (n === 'dirt' || n.includes('podzol') || n.includes('mud') || n.includes('clay')) return 'd'
    if (n === 'cobblestone' || n.includes('stone_bricks') || n.includes('bricks') || n.includes('concrete') || n.includes('quartz')) return 'c'
    if (n === 'air' || n === 'cave_air' || n === 'void_air') return '.'
    if (n === 'stone' || n.includes('deepslate') || n.includes('andesite') || n.includes('granite')
      || n.includes('diorite') || n.includes('tuff') || n.includes('basalt') || n.includes('blackstone')
      || n.includes('calcite') || n.includes('dripstone')) return '#'
    return '?'
  }

  function writeMapSnapshot(): void {
    try {
      const bot = body()
      const p = bot?.entity?.position
      if (!bot || !p) return
      const username = bot.username || 'unknown'
      const R = 16
      let cells = ''
      const heights: number[] = []
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          let ch = '.'
          let h = 0
          for (let dy = 6; dy >= -10; dy--) {
            const b = bot.blockAt(p.offset(dx, dy, dz))
            if (b && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air') {
              ch = classifyBlock(b.name)
              h = dy
              break
            }
          }
          cells += ch
          heights.push(h)
        }
      }
      const ents: Array<{ name: string; dx: number; dz: number }> = []
      for (const e of Object.values(bot.entities)) {
        if (!e || e === bot.entity || !e.position) continue
        const dx = e.position.x - p.x
        const dz = e.position.z - p.z
        if (dx * dx + dz * dz <= 16 * 16) {
          ents.push({ name: (e as { username?: string }).username ? `${(e as { username?: string }).username}` : (e.name ?? '?'), dx: Math.round(dx), dz: Math.round(dz) })
        }
      }
      store?.saveMap(username, {
        updatedAt: new Date().toISOString(),
        r: R,
        cx: Math.floor(p.x), cy: Math.floor(p.y), cz: Math.floor(p.z),
        yaw: bot.entity?.yaw ?? null,
        cells, heights, entities: ents,
      })
    } catch {
      // 地图快照失败不影响主循环
    }
  }
  writeMapSnapshot()
  ctx.setInterval(writeMapSnapshot, 10_000)

  // 自动记忆检索披露（向量库按需 top-k，渐进披露）：首次立即，此后低频刷新。
  if (config.autoRecall !== false && memos) {
    void refreshAutoMemory()
    ctx.setInterval(() => { void refreshAutoMemory() }, config.autoRecallIntervalMs ?? 60_000)
    log(`autoRecall 已启用（topK=${config.autoRecallTopK ?? 3}, interval=${config.autoRecallIntervalMs ?? 60_000}ms）`)
  }

  // ── goal loop 接入（2026-08-21 扛枪拍板：删自研循环，用 dsh 的）────────
  // 旧「每 intervalMs 外部 Timer steer + 静态 config.goal」的自研驱动循环全部
  // 删除。目标交给 dsh 官方 goal 子系统（ctx.goals）：create/arm 一个 active
  // goal 后，goal-round-driver（base bundle 默认挂载）会在 agent 进入 idle 时
  // 自动预留下一个 goal_round，驱动「决策 → 工具 → 观察」循环，直到 goal
  // 完成/暂停/阻塞/round 耗尽。决策循环由 dsh 引擎原生接管。
  const goalsSvc = (ctx as unknown as { get?: (n: string) => unknown }).get?.('goals') as
    | {
        get?: (agent: unknown) => { id?: string; revision?: number; phase?: string } | undefined
        create?: (agent: unknown, req: { objective: string; maxGoalRounds?: number }) => unknown
        resume?: (agent: unknown, ref: { id: string; revision: number }) => unknown
        clear?: (agent: unknown, ref: { id: string; revision: number }) => unknown
      }
    | undefined
  const armGoal = (a: unknown, objective: string): void => {
    if (!goalsSvc?.create) {
      log('⚠️ goal 服务未就绪，跳过 goal loop 接入（agent 无自主循环，等控制端手动驱动）')
      return
    }
    try {
      const cur = goalsSvc.get?.(a)
      if (cur && cur.phase === 'active' && cur.id && typeof cur.revision === 'number') {
        // 老会话 active goal：续行在 agent/session-start 时被停用（dsh 设计），resume 重新 arm
        try {
          goalsSvc.resume?.(a, { id: cur.id, revision: cur.revision })
          log(`goal 续行（resume，revision=${cur.revision}）`)
          return
        } catch (e) {
          log(`goal resume 失败（${e instanceof Error ? e.message : String(e)}），转 clear+create`)
        }
      }
      if (cur && cur.id && typeof cur.revision === 'number') {
        try { goalsSvc.clear?.(a, { id: cur.id, revision: cur.revision }) } catch { /* 已清/无权限：忽略 */ }
      }
      goalsSvc.create!(a, { objective, maxGoalRounds: 100_000 })
      log(`goal 创建并 arm（objective=${objective.slice(0, 40)}${objective.length > 40 ? '…' : ''}，maxGoalRounds=100000）`)
    } catch (e) {
      log(`goal loop 接入失败（${e instanceof Error ? e.message : String(e)}）`)
    }
  }

  // 前世记忆碎片（一次性注入，非循环）：fresh create（含会话轮换）时把 episodic
  // 尾部条目 steer 一次，让穿越者记得「上一世」在做什么；resume 的老会话自带
  // 完整 transcript 无需回灌。随后 arm goal 交给 goal-round-driver 自主循环。
  // autoSteer=false 时跳过唤醒与 arm：agent 只被创建/恢复，等用户在控制端手动开始。
  if (autoSteer) {
    // 仅 fresh create（含会话轮换）steer 前世记忆唤醒；resume 老会话自带完整 transcript 无需回灌。
    if (!resumed) {
      const tail = readEpisodicTail(20)
      if (tail.length) {
        agent.steer(
          createUserMessage({
            content: [{ type: 'text', text: `你在一次长眠后苏醒，前世的记忆碎片涌入脑海（从旧到新）：\n${tail.map((t) => `· ${t}`).join('\n')}\n结合这些记忆，继续你未竟的旅途。` }],
            source: { kind: 'plugin', plugin: 'mc-session' },
          }),
        )
      }
    }
    // resume 老会话也必须 arm goal：否则 agent 进入 idle 后 goal-round-driver 无 goal
    // 可驱动，决策循环彻底停摆（2026-08-21 根因）。
    armGoal(agent, goal)
  }
}
