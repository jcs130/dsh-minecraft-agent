/**
 * mc-memos —— 穿越者的长期语义记忆（MemOS 接入，每人独立记忆池）。
 *
 * 与 mc-memory（坐标/目标的程序化硬状态）互补：本插件把"经历"存进
 * 本机 MemOS（user_id = mc-<username>），语义检索跨重启可用——
 * "我上次在哪见过钻石""我跟谁交易过什么"这类模糊回忆。
 *
 * 铁律：
 *  - MemOS 挂了不炸 bot：所有调用 try-catch，失败返回友好提示。
 *  - REST /product/add 必须用 messages 格式（role+content）——
 *    旧 memory_content 字段会被 SimpleStruct reader 静默丢弃（2026-08-17 实测）。
 *  - fast 模式检索是同步入库的（qdrant 向量层），不依赖 scheduler/Redis。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'mc-memos'
export const inject = ['tools', 'mcbot']

export interface Config {
  enabled: boolean
  /** MemOS REST API 地址（穿越者进程与世界进程同机，默认本机）。 */
  baseUrl: string
  timeoutMs: number
  /** mc_recall 最多返回的记忆条数。 */
  maxRecall: number
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  baseUrl: Schema.string().default('http://127.0.0.1:8002'),
  timeoutMs: Schema.number().default(8_000),
  maxRecall: Schema.number().default(5),
})

export interface MemosService {
  /** 把一条经历写入某穿越者的独立记忆池。失败返回 null（不抛）。 */
  remember(username: string, content: string): Promise<string | null>
  /** 语义检索某穿越者的长期记忆，返回格式化文本；无命中/失败返回 ''。 */
  recall(username: string, query: string, topK?: number): Promise<string>
  /** 检索公共知识库（世界设定/编年史/NPC 志等），返回格式化文本；无命中/失败返回 ''。 */
  lore(query: string, topK?: number): Promise<string>
  /** 跨池检索（个人记忆 + 公共知识库），用于进化复盘等需要全量视角的场景。 */
  recallAll(username: string, query: string, topK?: number): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcMemos: MemosService
  }
}

function text(value: unknown) {
  return [{ type: 'text' as const, text: String(value) }]
}

function userIdOf(username: string): string {
  return 'mc-' + (username || 'unknown').toLowerCase()
}

interface AddResponse {
  code?: number
  message?: string
  data?: Array<{ memory_id?: string }>
}

interface SearchHit {
  id?: string
  memory?: string
}

interface SearchResponse {
  code?: number
  data?: {
    text_mem?: Array<{ memories?: SearchHit[] }>
    act_mem?: Array<{ memories?: SearchHit[] }>
    para_mem?: Array<{ memories?: SearchHit[] }>
    pref_mem?: Array<{ memories?: SearchHit[] }>
  }
}

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) {
    console.log('[mc-memos] disabled')
    return
  }

  async function call(path: string, body: unknown): Promise<unknown> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), config.timeoutMs)
    try {
      const res = await fetch(config.baseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }

  const LORE_CUBE = 'mc-world'

  async function searchRaw(userId: string, query: string, topK: number, cubes?: string[]): Promise<string[]> {
    const r = (await call('/product/search', {
      user_id: userId,
      query: query.slice(0, 500),
      mode: 'fast',
      // 传入 cubes 时即跨池检索（如 ["mc-kirito", "mc-world"]）。
      ...(cubes ? { readable_cube_ids: cubes } : {}),
    })) as SearchResponse
    const d = r?.data
    if (!d || r?.code !== 200) return []
    const hits: string[] = []
    for (const layer of [d.text_mem, d.act_mem, d.para_mem, d.pref_mem]) {
      for (const cube of layer ?? []) {
        for (const m of cube.memories ?? []) {
          const mem = String(m.memory ?? '').trim()
          if (mem) hits.push(mem.replace(/\s+/g, ' ').slice(0, 200))
        }
      }
    }
    return hits.slice(0, topK)
  }

  const service: MemosService = {
    async remember(username: string, content: string): Promise<string | null> {
      const c = content.trim()
      if (!c) return null
      try {
        const r = (await call('/product/add', {
          user_id: userIdOf(username),
          // 必须用 messages 结构化格式；memory_content 旧字段会被 reader 静默丢弃。
          messages: [{ role: 'assistant', content: c.slice(0, 2000) }],
        })) as AddResponse
        return r?.code === 200 ? (r.data?.[0]?.memory_id ?? 'ok') : null
      } catch {
        return null
      }
    },
    async recall(username: string, query: string, topK = config.maxRecall): Promise<string> {
      const q = query.trim()
      if (!q) return ''
      try {
        return (await searchRaw(userIdOf(username), q, topK)).join('\n')
      } catch {
        return ''
      }
    },
    async lore(query: string, topK = config.maxRecall): Promise<string> {
      const q = query.trim()
      if (!q) return ''
      try {
        return (await searchRaw(LORE_CUBE, q, topK)).join('\n')
      } catch {
        return ''
      }
    },
    async recallAll(username: string, query: string, topK = config.maxRecall): Promise<string> {
      const q = query.trim()
      if (!q) return ''
      try {
        return (await searchRaw(userIdOf(username), q, topK, [userIdOf(username), LORE_CUBE])).join('\n')
      } catch {
        return ''
      }
    },
  }
  ctx.provide('mcMemos', service)

  const currentUsername = (): string => (ctx.mcbot?.username as string) ?? ''

  // ── mc_remember：把重要经历写进自己的长期记忆 ─────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_remember',
    description:
      '把重要经历写入你的长期记忆（跨重启持久、可语义检索）。值得记的：新发现（"在(-200,64,180)发现裸露钻石"）、重要交易（"和岳山用32铁锭换11绿宝石"）、与人交往（"MengMeng 送我一张床，很感激"）、教训（"夜晚沼泽边被苦力怕炸过，别再去"）、计划与承诺（"答应风临明天送他小麦"）。写自然语言完整句子（含关键细节：坐标/人名/物品/数量），别写流水账，一次一件事。',
    parameters: {
      content: {
        type: 'string',
        required: true,
        description: '要记住的经历，一句自然语言，如「在(-200,64,180)的峡谷壁上发现了裸露钻石，记住这个位置」',
      },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => text(v) },
    timeoutMs: config.timeoutMs + 2_000,
    execute: async (args: Record<string, unknown>) => {
      const content = String(args.content ?? '').trim()
      if (!content) return '没有要记的内容。'
      const username = currentUsername()
      const id = await service.remember(username, content)
      return id ? `已铭记：${content.slice(0, 60)}${content.length > 60 ? '…' : ''}` : '（记忆之河暂不可渡——没记上，稍后可再试。这不影响你继续行动。）'
    },
  }))

  // ── mc_recall：语义检索自己的长期记忆 ──────────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_recall',
    description:
      '检索你的长期记忆（模糊语义匹配，跨重启）。想不起某事时用：「我上次在哪见过钻石」「我和风临有什么约定」「之前谁给过我东西」「沼泽那边出过什么事」。查询用自然语言关键词即可，不必精确。',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: '想回忆的内容，如「钻石在哪见过」或「和村民的交易」',
      },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => text(v) },
    timeoutMs: config.timeoutMs + 2_000,
    execute: async (args: Record<string, unknown>) => {
      const query = String(args.query ?? '').trim()
      if (!query) return '想回忆什么？'
      const username = currentUsername()
      const hits = await service.recall(username, query)
      if (!hits) return '（记忆一片空白——要么确实没经历过，要么记忆之河暂不可渡。）'
      return '你的回忆：\n' + hits
    },
  }))

  // ── mc_lore：检索世界公共知识库（RAG 文档）────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_lore',
    description:
      '检索这个世界人人都可读的公共知识库（世界设定、编年史大事记、NPC 人物志、魔法与供奉规则等）。初来乍到、想了解世界背景/历史事件/某位 NPC 的传闻时用，如「这个世界的来历」「最近发生过什么大事」「风临是谁」「供奉规则是什么」。',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: '想了解的世界知识，如「女神和魔法体系的规则」或「初始之地城镇的历史」',
      },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => text(v) },
    timeoutMs: config.timeoutMs + 2_000,
    execute: async (args: Record<string, unknown>) => {
      const query = String(args.query ?? '').trim()
      if (!query) return '想了解什么？'
      const hits = await service.lore(query)
      if (!hits) return '（典籍暂不可查——知识之塔的门关着，稍后再试。）'
      return '你所查的世界知识：\n' + hits
    },
  }))

  console.log(`[mc-memos] long-term semantic memory ready (${config.baseUrl}, user=mc-<name>, lore cube=${LORE_CUBE})`)
}
