/**
 * mc-memos —— 穿越者的长期语义记忆（可插拔后端，MemOS 优先、本地零依赖兜底）。
 *
 * 与 mc-memory（坐标/目标的程序化硬状态）互补：本插件把"经历"存进长期记忆，
 * 语义检索跨重启可用——"我上次在哪见过钻石""我跟谁交易过什么"这类模糊回忆。
 *
 * 后端路由（2026-08-19 解耦）：
 *   - backend='memos'：直连 MemOS（家里/有服务的人用）
 *   - backend='local' ：零依赖本地 JSONL + 关键词检索（别人开箱即用）
 *   - backend='auto'（默认）：启动时探测 MemOS 端口，可达用 MemOS，不可达降级本地
 *
 * 铁律：
 *  - 记忆不可用不炸 bot：后端内部所有调用 try-catch，失败返回友好提示。
 *  - REST /product/add 必须用 messages 格式（role+content）——
 *    旧 memory_content 字段会被 SimpleStruct reader 静默丢弃（2026-08-17 实测）。
 *  - fast 模式检索是同步入库的（qdrant 向量层），不依赖 scheduler/Redis。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MemoryProvider, LocalMemoryBackend, LORE_POOL, poolNameOf } from './memory-provider'

export const name = 'mc-memos'
export const inject = ['tools', 'mcbot']

export interface Config {
  enabled: boolean
  /** 后端选择：auto=探测 MemOS 失败自动降级本地；memos=强制 MemOS；local=强制本地。 */
  backend: string
  /** MemOS REST API 地址（穿越者进程与世界进程同机，默认本机）。 */
  baseUrl: string
  timeoutMs: number
  /** mc_recall 最多返回的记忆条数。 */
  maxRecall: number
  /** 本地后端的记忆目录（backend=local 或 auto 降级时用）。 */
  localDir: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  // 用 string 而非 union：非法值在 resolveProvider 里宽容回退 auto 探测，绝不因配置值抛错。
  backend: Schema.string().default('auto'),
  baseUrl: Schema.string().default('http://127.0.0.1:8002'),
  timeoutMs: Schema.number().default(8_000),
  maxRecall: Schema.number().default(5),
  localDir: Schema.string().default('./data/memory'),
})

/** 下游插件（mc-adapt/mc-evolve/mc-identity/mc-loop）依赖的类型别名，签名保持不变。 */
export type MemosService = MemoryProvider

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcMemos: MemosService
  }
}

function text(value: unknown) {
  return [{ type: 'text' as const, text: String(value) }]
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

/** MemOS 后端：全功能向量 RAG。REST 调用逻辑与旧版逐行一致（生产行为不变）。 */
class MemOSBackend implements MemoryProvider {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxRecall: number

  constructor(config: Config) {
    this.baseUrl = config.baseUrl
    this.timeoutMs = config.timeoutMs
    this.maxRecall = config.maxRecall
  }

  private async call(path: string, body: unknown): Promise<unknown> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await fetch(this.baseUrl + path, {
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

  private async searchRaw(userId: string, query: string, topK: number, cubes?: string[]): Promise<string[]> {
    const r = (await this.call('/product/search', {
      user_id: userId,
      query: query.slice(0, 500),
      mode: 'fast',
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

  async remember(username: string, content: string): Promise<string | null> {
    const c = content.trim()
    if (!c) return null
    try {
      const r = (await this.call('/product/add', {
        user_id: poolNameOf(username),
        // 必须用 messages 结构化格式；memory_content 旧字段会被 reader 静默丢弃。
        messages: [{ role: 'assistant', content: c.slice(0, 2000) }],
      })) as AddResponse
      return r?.code === 200 ? (r.data?.[0]?.memory_id ?? 'ok') : null
    } catch {
      return null
    }
  }

  async recall(username: string, query: string, topK = this.maxRecall): Promise<string> {
    const q = query.trim()
    if (!q) return ''
    try {
      return (await this.searchRaw(poolNameOf(username), q, topK)).join('\n')
    } catch {
      return ''
    }
  }

  async lore(query: string, topK = this.maxRecall): Promise<string> {
    const q = query.trim()
    if (!q) return ''
    try {
      return (await this.searchRaw(LORE_POOL, q, topK)).join('\n')
    } catch {
      return ''
    }
  }

  async recallAll(username: string, query: string, topK = this.maxRecall): Promise<string> {
    const q = query.trim()
    if (!q) return ''
    try {
      return (await this.searchRaw(poolNameOf(username), q, topK, [poolNameOf(username), LORE_POOL])).join('\n')
    } catch {
      return ''
    }
  }
}

/** 探测 MemOS 是否可达（GET /docs，2s 内收到 HTTP 响应即视为在）。 */
async function memosReachable(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, 2000))
  try {
    const res = await fetch(baseUrl + '/docs', { method: 'GET', signal: ctrl.signal })
    return res.status < 500 // 200/401/404 都说明服务在监听
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function resolveProvider(config: Config): Promise<MemoryProvider> {
  if (config.backend === 'local') return new LocalMemoryBackend(config.localDir)
  if (config.backend === 'memos') return new MemOSBackend(config)
  // auto：探测 MemOS，可达用 MemOS，不可达降级本地。
  if (await memosReachable(config.baseUrl, config.timeoutMs)) return new MemOSBackend(config)
  return new LocalMemoryBackend(config.localDir)
}

/**
 * auto 模式的路由器：同步 provide 一个稳定的 MemoryProvider 引用，
 * 后台异步探测 MemOS，不可达就把 active 热切到本地后端。
 *
 * ⚠️ 之所以不直接 async apply + await 探测后再 provide：cordis 的 ctx.provide
 * 走 fiber.effect→assertActive，必须在 apply 同步执行期间调用；await 之后再
 * provide 会因 fiber 已 inactive 而静默不注册（实测 reflect.store 为空）。
 * 所以用「同步 provide 路由器 + 后台切换 active」绕开这个硬约束。
 */
class RoutingProvider implements MemoryProvider {
  active: MemoryProvider
  constructor(initial: MemoryProvider) {
    this.active = initial
  }
  remember(username: string, content: string): Promise<string | null> {
    return this.active.remember(username, content)
  }
  recall(username: string, query: string, topK?: number): Promise<string> {
    return this.active.recall(username, query, topK)
  }
  lore(query: string, topK?: number): Promise<string> {
    return this.active.lore(query, topK)
  }
  recallAll(username: string, query: string, topK?: number): Promise<string> {
    return this.active.recallAll(username, query, topK)
  }
}

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) {
    console.log('[mc-memos] disabled')
    return
  }

  let provider: MemoryProvider
  let kind: string
  if (config.backend === 'local') {
    provider = new LocalMemoryBackend(config.localDir)
    kind = `Local(${config.localDir})`
  } else if (config.backend === 'memos') {
    provider = new MemOSBackend(config)
    kind = `MemOS(${config.baseUrl})`
  } else {
    // auto：默认 MemOS（家里/有服务者行为不变），后台探测不可达则切本地。
    const router = new RoutingProvider(new MemOSBackend(config))
    provider = router
    kind = `auto(MemOS ${config.baseUrl} → local fallback)`
    void (async () => {
      if (!(await memosReachable(config.baseUrl, config.timeoutMs))) {
        router.active = new LocalMemoryBackend(config.localDir)
        console.log(`[mc-memos] MemOS(${config.baseUrl}) 不可达，已降级到本地记忆后端(${config.localDir})`)
      }
    })()
  }
  ctx.provide('mcMemos', provider)

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
      const id = await provider.remember(username, content)
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
      const hits = await provider.recall(username, query)
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
      const hits = await provider.lore(query)
      if (!hits) return '（典籍暂不可查——知识之塔的门关着，稍后再试。）'
      return '你所查的世界知识：\n' + hits
    },
  }))

  console.log(`[mc-memos] long-term semantic memory ready via ${kind}, user=mc-<name>, lore cube=${LORE_POOL}`)
}
