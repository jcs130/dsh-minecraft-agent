// src/mc-wiki.ts
import Schema from "@deepseek-ai/schemastery";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
var name = "mc-wiki";
var inject = [];
var Config = Schema.object({
  dataDir: Schema.string().default("./data"),
  maxCards: Schema.number().default(200)
});
function nowId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
function keywords(text) {
  const out = /* @__PURE__ */ new Set();
  for (const w of text.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []) out.add(w);
  const cjk = text.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seg of cjk) {
    for (let i = 0; i + 1 <= seg.length - 1; i++) out.add(seg.slice(i, i + 2));
    if (seg.length === 1) out.add(seg);
  }
  return [...out];
}
var WikiStore = class {
  path;
  cards = [];
  maxCards;
  constructor(dataDir, username, maxCards) {
    mkdirSync(dirname(join(dataDir, "x")), { recursive: true });
    this.path = join(dataDir, `wiki-${username}.jsonl`);
    this.maxCards = maxCards;
    if (existsSync(this.path)) {
      for (const line of readFileSync(this.path, "utf-8").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const c = JSON.parse(t);
          if (c && typeof c.topic === "string" && typeof c.content === "string") this.cards.push(c);
        } catch {
        }
      }
      if (this.cards.length > this.maxCards) this.cards = this.cards.slice(-this.maxCards);
    }
  }
  get size() {
    return this.cards.length;
  }
  add(source, topic, content) {
    const card = { id: nowId(), ts: Date.now(), source, topic: topic.slice(0, 60), content: content.slice(0, 500), uses: 0 };
    this.cards.push(card);
    if (this.cards.length > this.maxCards) this.cards = this.cards.slice(-this.maxCards);
    appendFileSync(this.path, JSON.stringify(card) + "\n", "utf-8");
    return card;
  }
  /** rank cards by keyword overlap with the query; returns top-k with use bumps */
  search(query, topK = 3) {
    const qk = new Set(keywords(query));
    if (qk.size === 0) return [];
    const scored = this.cards.map((c) => {
      let score = 0;
      for (const k of keywords(`${c.topic} ${c.content}`)) if (qk.has(k)) score++;
      return { c, score };
    }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score || b.c.ts - a.c.ts).slice(0, topK).map((s) => s.c);
    for (const c of scored) c.uses++;
    return scored;
  }
  /** dedupe by topic similarity before adding (simple exact-topic guard) */
  hasTopicLike(topic) {
    const t = topic.trim().toLowerCase();
    return this.cards.some((c) => c.topic.trim().toLowerCase() === t);
  }
};
async function reflectToCard(baseUrl, model, prompt) {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: '\u4F60\u662F\u6211\u7684\u4E16\u754C\u751F\u5B58\u6559\u7EC3\u3002\u628A\u73A9\u5BB6\u7ECF\u5386\u84B8\u998F\u6210\u4E00\u6761\u53EF\u64CD\u4F5C\u7684\u751F\u5B58\u6559\u8BAD\u3002\u53EA\u8F93\u51FA JSON\uFF1A{"topic":"\u4E0D\u8D85\u8FC720\u5B57\u7684\u77ED\u6807\u9898","content":"\u4E0D\u8D85\u8FC7120\u5B57\u7684\u5177\u4F53\u6559\u8BAD\uFF0C\u5305\u542B\u4E0B\u6B21\u8BE5\u600E\u4E48\u505A\u7684\u52A8\u4F5C\u6307\u4EE4"}'
          },
          { role: "user", content: prompt.slice(0, 2500) }
        ]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (typeof parsed.topic !== "string" || typeof parsed.content !== "string") return null;
    if (!parsed.topic.trim() || !parsed.content.trim()) return null;
    return { topic: parsed.topic.trim(), content: parsed.content.trim() };
  } catch {
    return null;
  }
}
function apply(ctx, config) {
  const dir = resolve(config.dataDir);
  const stores = /* @__PURE__ */ new Map();
  const service = {
    store(username) {
      let s = stores.get(username);
      if (!s) {
        s = new WikiStore(dir, username, config.maxCards);
        stores.set(username, s);
      }
      return s;
    },
    reflectToCard
  };
  ctx.provide("mcWiki", service);
  console.log(`[mc-wiki] survival knowledge base ready (${dir})`);
}
export {
  Config,
  WikiStore,
  apply,
  inject,
  name,
  reflectToCard
};
