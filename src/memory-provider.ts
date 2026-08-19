/**
 * memory-provider —— 长期语义记忆的可插拔后端抽象。
 *
 * 背景（2026-08-19 扛枪定调）：语义记忆此前硬依赖 MemOS（外部 Docker 服务）。
 * 别人装 dsh-minecraft-agent 时没有 MemOS，mc_remember/mc_recall/mc_lore 直接失效。
 * 本模块把「记忆后端」抽象成统一接口，提供两级实现：
 *
 *   1. MemOSBackend（mc-memos.ts 内）—— 全功能向量 RAG，家里/有 MemOS 的人用。
 *   2. LocalMemoryBackend（本文件）—— 零依赖 JSONL + 关键词检索（BM25-lite），
 *      别人开箱即用：能存能查、跨重启持久，不依赖任何外部服务或原生模块。
 *
 * 路由在 mc-memos.ts 的 apply() 里做（启动时探测 MemOS 端口，失败自动降级本地）。
 * 下游四个插件（mc-adapt/mc-evolve/mc-identity/mc-loop）只依赖 MemoryProvider 接口，
 * 后端怎么换都不感知。
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** 记忆池命名约定：个人池 = mc-<username>，公共知识库 = mc-world（与 MemOS user_id/cube 对齐）。 */
export const LORE_POOL = 'mc-world'

export function poolNameOf(username: string): string {
  return 'mc-' + (username || 'unknown').toLowerCase()
}

/**
 * 长期语义记忆统一接口。三个下游插件 + 四个工具都只面向这个接口编程。
 * 语义约定（MemOS 与本地后端一致）：
 *  - 失败/无命中一律返回空串或 null，绝不抛异常（记忆不可用不得炸 bot）。
 *  - recall/lore/recallAll 返回 \n 拼接的格式化文本（可直接进 prompt）。
 */
export interface MemoryProvider {
  /** 把一条经历写入某穿越者的独立记忆池。失败返回 null（不抛）。 */
  remember(username: string, content: string): Promise<string | null>
  /** 语义/模糊检索某穿越者的长期记忆。无命中/失败返回 ''。 */
  recall(username: string, query: string, topK?: number): Promise<string>
  /** 检索公共知识库（世界设定/编年史/NPC 志等）。无命中/失败返回 ''。 */
  lore(query: string, topK?: number): Promise<string>
  /** 跨池检索（个人记忆 + 公共知识库），用于进化复盘等需要全量视角的场景。 */
  recallAll(username: string, query: string, topK?: number): Promise<string>
}

// ── 关键词检索（BM25-lite，零依赖，中文 bigram + 英文 token）────────────────

function normalizeForSearch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * 切词：英文/数字（≥2 字符）作为一个 token；连续中文段拆成单字 + 双字 bigram。
 * 中文无自然分词边界，bigram 是零依赖下最实用的折中（带坐标/人名/物品名的记忆命中率高）。
 */
function tokenize(s: string): string[] {
  const norm = normalizeForSearch(s)
  const tokens: string[] = []
  const latin = norm.match(/[a-z0-9_]{2,}/g) ?? []
  tokens.push(...latin)
  const cjkSegs = norm.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const seg of cjkSegs) {
    for (const ch of seg) tokens.push(ch)
    for (let i = 0; i < seg.length - 1; i++) tokens.push(seg[i] + seg[i + 1])
  }
  return tokens
}

function scoreDoc(queryTokens: string[], doc: string): number {
  const docFreq = new Map<string, number>()
  for (const t of tokenize(doc)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1)
  let s = 0
  for (const t of queryTokens) {
    const f = docFreq.get(t) ?? 0
    if (!f) continue
    // 多字词（bigram/英文）比单字更特异，权重更高；频率封顶防某词刷屏。
    const w = t.length >= 2 ? 2 : 1
    s += w * Math.min(f, 3)
  }
  return s
}

interface MemoryEntry {
  t: number
  content: string
}

/**
 * LocalMemoryBackend —— 零依赖本地记忆后端。
 *
 * 存储：每个记忆池一个 JSONL 文件（data/memory/<pool>.jsonl），每行一条
 * `{t, content}`。追加即写入（appendFileSync 同步追加，单进程无竞态），
 * 检索读全量打分取 topK。体量到几千条时线性扫描仍 <5ms，穿越者个人池够用；
 * 真要到数万条再换 sqlite-vec / LanceDB / MemOS。
 */
export class LocalMemoryBackend implements MemoryProvider {
  private readonly dir: string

  constructor(dir = './data/memory') {
    this.dir = resolve(dir)
    mkdirSync(this.dir, { recursive: true })
  }

  private fileOf(pool: string): string {
    return join(this.dir, `${pool}.jsonl`)
  }

  private readPool(pool: string): MemoryEntry[] {
    const f = this.fileOf(pool)
    if (!existsSync(f)) return []
    const out: MemoryEntry[] = []
    for (const line of readFileSync(f, 'utf-8').split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const o = JSON.parse(s) as { t?: number; content?: string }
        if (o && typeof o.content === 'string' && o.content.trim()) {
          out.push({ t: typeof o.t === 'number' ? o.t : 0, content: o.content.trim() })
        }
      } catch {
        // 单行损坏跳过，不影响其余记忆。
      }
    }
    return out
  }

  private search(pools: string[], query: string, topK: number): string[] {
    const q = query.trim()
    if (!q) return []
    const qt = [...new Set(tokenize(q))]
    if (qt.length === 0) return []
    const scored: Array<{ content: string; score: number }> = []
    for (const pool of pools) {
      for (const e of this.readPool(pool)) {
        const score = scoreDoc(qt, e.content)
        if (score > 0) scored.push({ content: e.content, score })
      }
    }
    scored.sort((a, b) => b.score - a.score || b.content.length - a.content.length)
    return scored.slice(0, topK).map((h) => h.content.replace(/\s+/g, ' ').slice(0, 200))
  }

  async remember(username: string, content: string): Promise<string | null> {
    const c = content.trim()
    if (!c) return null
    try {
      const pool = poolNameOf(username)
      const id = `${pool}:${Date.now()}`
      appendFileSync(this.fileOf(pool), JSON.stringify({ t: Date.now(), content: c.slice(0, 2000) }) + '\n', 'utf-8')
      return id
    } catch {
      return null
    }
  }

  async recall(username: string, query: string, topK = 5): Promise<string> {
    return this.search([poolNameOf(username)], query, topK).join('\n')
  }

  async lore(query: string, topK = 5): Promise<string> {
    return this.search([LORE_POOL], query, topK).join('\n')
  }

  async recallAll(username: string, query: string, topK = 5): Promise<string> {
    return this.search([poolNameOf(username), LORE_POOL], query, topK).join('\n')
  }
}

/** 列出当前本地后端已存在的记忆池（诊断用）。 */
export function listLocalPools(dir = './data/memory'): string[] {
  const d = resolve(dir)
  if (!existsSync(d)) return []
  return readdirSync(d)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.slice(0, -'.jsonl'.length))
}
