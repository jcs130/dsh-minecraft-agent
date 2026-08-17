/**
 * mc-wiki: survival knowledge base for transmigrators.
 *
 * A framework-agnostic asset: every transmigrator keeps a personal wiki
 * (data/wiki-<username>.jsonl) distilled from deaths, failures, reflections
 * and web guides. The decision loop retrieves relevant cards and injects
 * them as "survival lessons" so the agent learns instead of repeating.
 */
import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const name = 'mc-wiki'
export const inject: string[] = []

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcWiki: {
      store(username: string): WikiStore
      reflectToCard: typeof reflectToCard
    }
  }
}

export const Config: Schema<{ dataDir: string; maxCards: number }> = Schema.object({
  dataDir: Schema.string().default('./data'),
  maxCards: Schema.number().default(200),
})

export type WikiSource = 'death' | 'fail' | 'reflect' | 'web' | 'manual'

export interface WikiCard {
  id: string
  ts: number
  source: WikiSource
  topic: string
  content: string
  uses: number
}

function nowId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** tokenize mixed CJK/latin text into coarse keywords */
function keywords(text: string): string[] {
  const out = new Set<string>()
  // latin / snake_case words
  for (const w of text.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []) out.add(w)
  // CJK bigrams
  const cjk = text.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const seg of cjk) {
    for (let i = 0; i + 1 <= seg.length - 1; i++) out.add(seg.slice(i, i + 2))
    if (seg.length === 1) out.add(seg)
  }
  return [...out]
}

export class WikiStore {
  private path: string
  private cards: WikiCard[] = []
  private maxCards: number

  constructor(dataDir: string, username: string, maxCards: number) {
    mkdirSync(dirname(join(dataDir, 'x')), { recursive: true })
    this.path = join(dataDir, `wiki-${username}.jsonl`)
    this.maxCards = maxCards
    if (existsSync(this.path)) {
      for (const line of readFileSync(this.path, 'utf-8').split('\n')) {
        const t = line.trim()
        if (!t) continue
        try {
          const c = JSON.parse(t) as WikiCard
          if (c && typeof c.topic === 'string' && typeof c.content === 'string') this.cards.push(c)
        } catch {
          /* skip broken line */
        }
      }
      // reload keeps only the newest N cards (same trim semantics as add())
      if (this.cards.length > this.maxCards) this.cards = this.cards.slice(-this.maxCards)
    }
  }

  get size(): number {
    return this.cards.length
  }

  add(source: WikiSource, topic: string, content: string): WikiCard {
    const card: WikiCard = { id: nowId(), ts: Date.now(), source, topic: topic.slice(0, 60), content: content.slice(0, 500), uses: 0 }
    this.cards.push(card)
    // keep newest N cards; drop oldest
    if (this.cards.length > this.maxCards) this.cards = this.cards.slice(-this.maxCards)
    appendFileSync(this.path, JSON.stringify(card) + '\n', 'utf-8')
    return card
  }

  /** rank cards by keyword overlap with the query; returns top-k with use bumps */
  search(query: string, topK = 3): WikiCard[] {
    const qk = new Set(keywords(query))
    if (qk.size === 0) return []
    const scored = this.cards
      .map((c) => {
        let score = 0
        for (const k of keywords(`${c.topic} ${c.content}`)) if (qk.has(k)) score++
        return { c, score }
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.c.ts - a.c.ts)
      .slice(0, topK)
      .map((s) => s.c)
    for (const c of scored) c.uses++
    return scored
  }

  /** dedupe by topic similarity before adding (simple exact-topic guard) */
  hasTopicLike(topic: string): boolean {
    const t = topic.trim().toLowerCase()
    return this.cards.some((c) => c.topic.trim().toLowerCase() === t)
  }
}

/**
 * Ask the LLM to distill a lesson card from raw experience text.
 * Pure helper: caller provides baseUrl/model. Returns null on any failure.
 */
export async function reflectToCard(
  baseUrl: string,
  model: string,
  prompt: string,
): Promise<{ topic: string; content: string } | null> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content:
              '你是我的世界生存教练。把玩家经历蒸馏成一条可操作的生存教训。只输出 JSON：{"topic":"不超过20字的短标题","content":"不超过120字的具体教训，包含下次该怎么做的动作指令"}',
          },
          { role: 'user', content: prompt.slice(0, 2500) },
        ],
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const raw = data?.choices?.[0]?.message?.content ?? ''
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { topic?: string; content?: string }
    if (typeof parsed.topic !== 'string' || typeof parsed.content !== 'string') return null
    if (!parsed.topic.trim() || !parsed.content.trim()) return null
    return { topic: parsed.topic.trim(), content: parsed.content.trim() }
  } catch {
    return null
  }
}

export function apply(ctx: Context, config: { dataDir: string; maxCards: number }) {
  const dir = resolve(config.dataDir)
  const stores = new Map<string, WikiStore>()
  const service = {
    store(username: string): WikiStore {
      let s = stores.get(username)
      if (!s) {
        s = new WikiStore(dir, username, config.maxCards)
        stores.set(username, s)
      }
      return s
    },
    reflectToCard,
  }
  ctx.provide('mcWiki', service)
  console.log(`[mc-wiki] survival knowledge base ready (${dir})`)
}
