// src/mc-evolve.ts
import Schema from "@deepseek-ai/schemastery";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
var name = "mc-evolve";
var inject = ["mcbot", "timer", "mcMemos", "mcWiki", "mcTransmigrators"];
var Config = Schema.object({
  enabled: Schema.boolean().default(true),
  baseUrl: Schema.string().default("http://localhost:8890/v1"),
  apiKey: Schema.string().default("sk-local"),
  model: Schema.string().default("qwen3.8"),
  cooldownHours: Schema.number().default(12),
  reasoningEffort: Schema.string().default("xhigh"),
  maxTokens: Schema.number().default(2048),
  statePath: Schema.string().default("./data/evolve-state.json"),
  perQuery: Schema.number().default(8),
  diaryEnabled: Schema.boolean().default(true),
  godName: Schema.string().default("Goddess")
});
var RECALL_QUERIES = ["\u7ECF\u5386 \u4E8B\u4EF6 \u4ECA\u5929", "\u4EA4\u6613 \u83B7\u5F97\u7269\u54C1 \u8D44\u6E90", "\u670B\u53CB \u4EA4\u4E92 \u7EA6\u5B9A", "\u5371\u9669 \u6559\u8BAD \u5931\u8D25 \u6B7B\u4EA1", "\u53D1\u73B0 \u65B0\u5730\u70B9 \u63A2\u7D22"];
var DIARY_QUERIES = ["\u7ECF\u5386 \u4E8B\u4EF6 \u4ECA\u5929", "\u670B\u53CB \u4EA4\u4E92", "\u53D1\u73B0 \u65B0\u5730\u70B9 \u5371\u9669"];
function localDay(d = /* @__PURE__ */ new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function loadState(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}
function saveState(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
  } catch {
  }
}
function extractJson(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}
function apply(ctx, config) {
  if (!config.enabled) {
    console.log("[mc-evolve] disabled");
    return;
  }
  const statePath = resolve(config.statePath);
  async function callLLM(system, user) {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(18e4),
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.6,
        max_tokens: config.maxTokens,
        reasoning_effort: config.reasoningEffort,
        stream: false
      })
    });
    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }
  async function evolveOnce(username) {
    const seen = /* @__PURE__ */ new Set();
    const memories = [];
    const loreHits = [];
    for (const q of RECALL_QUERIES) {
      const mine = await ctx.mcMemos.recall(username, q, config.perQuery);
      for (const line of mine.split("\n")) {
        const t = line.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          memories.push(t);
        }
      }
      const world = await ctx.mcMemos.lore(q, config.perQuery);
      for (const line of world.split("\n")) {
        const t = line.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          loreHits.push(t);
        }
      }
    }
    if (memories.length === 0 && loreHits.length === 0) {
      return "skip: \u6CA1\u6709\u53EF\u590D\u76D8\u7684\u8BB0\u5FC6\uFF08\u8BB0\u5FC6\u6C60\u4E3A\u7A7A\u6216 MemOS \u4E0D\u53EF\u7528\uFF09";
    }
    const store = ctx.mcWiki.store(username);
    const knownTopics = store.cards?.map((c) => c.topic).slice(-30) ?? [];
    const system = [
      "\u4F60\u662F\u300C\u591C\u95F4\u81EA\u7701\u300D\u673A\u5236\uFF1A\u626E\u6F14\u8FD9\u4F4D\u7A7F\u8D8A\u8005\u7684\u5185\u5FC3\uFF0C\u5728\u6E38\u620F\u4E16\u754C\u7684\u6DF1\u591C\u5BF9 TA \u8FD9\u6BB5\u65F6\u95F4\u7684\u7ECF\u5386\u505A\u4E00\u6B21\u590D\u76D8\u3002",
      "\u7A7F\u8D8A\u8005\u767D\u5929\u5FEB\u901F\u884C\u52A8\u6CA1\u7A7A\u7EC6\u60F3\uFF1B\u73B0\u5728\u591C\u6DF1\u4EBA\u9759\uFF0C\u66FF TA \u628A\u6563\u843D\u7684\u7ECF\u5386\u84B8\u998F\u6210\u6210\u957F\u3002",
      "\u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF08\u4E0D\u8981 markdown \u4EE3\u7801\u5757\uFF09\uFF1A",
      '{"growth":"\u4EBA\u683C\u6210\u957F\u53D9\u4E8B\uFF0C80-150\u5B57\uFF0C\u8981\u6709\u60C5\u611F\u548C\u5177\u4F53\u4E8B\u4EF6",',
      ' "resolve":"\u5BF9\u660E\u65E5\u7684\u5177\u4F53\u51B3\u5FC3\uFF0C1-2\u53E5\uFF0C\u53EF\u6267\u884C",',
      ' "lessons":[{"topic":"\u226416\u5B57\u77ED\u6807\u9898","content":"\u2264100\u5B57\u5177\u4F53\u6559\u8BAD\uFF0C\u542B\u4E0B\u6B21\u8BE5\u600E\u4E48\u505A"}]}',
      "lessons \u7ED9 2-4 \u6761\uFF1A\u53EA\u6C89\u6DC0\u6CDB\u5316\u53EF\u590D\u7528\u7684\u751F\u5B58\u667A\u6167/\u793E\u4EA4\u5FC3\u5F97\uFF0C\u4E0D\u5199\u6D41\u6C34\u8D26\uFF0C\u4E0D\u4E0E\u5DF2\u77E5\u6559\u8BAD\u91CD\u590D\u3002"
    ].join("\n");
    const user = [
      `\u7A7F\u8D8A\u8005\uFF1A${username}`,
      `\u6211\u7684\u7ECF\u5386\uFF08${memories.length} \u6761\uFF09\uFF1A`,
      ...memories.slice(0, 40).map((m) => `- ${m}`),
      loreHits.length ? `
\u4E16\u754C\u6863\u6848\uFF08\u516C\u5171\u77E5\u8BC6\u5E93\u68C0\u7D22\u547D\u4E2D\uFF0C${loreHits.length} \u6761\uFF0C\u53EF\u4F5C\u80CC\u666F\u53C2\u8003\uFF09\uFF1A
${loreHits.slice(0, 6).map((m) => `- ${m}`).join("\n")}` : "",
      "",
      `\u5DF2\u6709\u6559\u8BAD\u5361\u8BDD\u9898\uFF08\u522B\u91CD\u590D\uFF09\uFF1A${knownTopics.join("\u3001") || "(\u65E0)"}`
    ].join("\n");
    const raw = await callLLM(system, user);
    const out = extractJson(raw);
    if (!out) return "skip: \u590D\u76D8\u8F93\u51FA\u4E0D\u53EF\u89E3\u6790\uFF08LLM \u672A\u8FD4\u56DE\u5408\u6CD5 JSON\uFF09";
    let lessonCount = 0;
    for (const l of out.lessons ?? []) {
      if (typeof l?.topic === "string" && typeof l?.content === "string" && l.topic.trim() && l.content.trim()) {
        store.add("reflect", l.topic.trim(), l.content.trim());
        lessonCount++;
      }
    }
    const growth = (out.growth ?? "").trim();
    const resolve2 = (out.resolve ?? "").trim();
    let memoSaved = false;
    if (growth || resolve2) {
      const id = await ctx.mcMemos.remember(username, `\u3010\u6E38\u620F\u591C\u8FDB\u5316\u3011${growth}${resolve2 ? ` \u660E\u65E5\u4E4B\u5FC3\uFF1A${resolve2}` : ""}`);
      memoSaved = id !== null;
    }
    return `ok: \u590D\u76D8 \u4E2A\u4EBA${memories.length}+\u4E16\u754C${loreHits.length} \u6761 \u2192 ${lessonCount} \u5F20\u65B0\u6559\u8BAD\u5361${memoSaved ? " + \u6210\u957F\u5DF2\u5165\u957F\u7EBF\u8BB0\u5FC6" : ""}\uFF1B\u51B3\u5FC3\uFF1A${resolve2.slice(0, 40) || "(\u672A\u7ED9)"}`;
  }
  async function diaryOnce(username) {
    const seen = /* @__PURE__ */ new Set();
    const memories = [];
    for (const q of DIARY_QUERIES) {
      const mine = await ctx.mcMemos.recall(username, q, 5);
      for (const line of mine.split("\n")) {
        const t = line.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          memories.push(t);
        }
      }
    }
    const reg = ctx.mcTransmigrators;
    const profile = reg.getByUsername(username);
    const persona = profile?.persona?.slice(0, 1e3) ?? "";
    const backstory = profile?.backstory?.slice(0, 600) ?? "";
    const system = [
      "\u4F60\u662F\u8FD9\u4F4D\u7A7F\u8D8A\u8005\u672C\u4EBA\uFF1A\u6DF1\u591C\u7761\u524D\uFF0C\u7528 TA \u7684\u53E3\u543B\u5728\u65E5\u8BB0\u672C\u4E0A\u5199\u4E0B\u4ECA\u5929\u7684\u4E00\u9875\u3002",
      "\u7B2C\u4E00\u4EBA\u79F0\u3001\u6709\u60C5\u611F\u6709\u7EC6\u8282\uFF0C\u50CF\u5199\u7ED9\u81EA\u5DF1\u7684\u4FE1\uFF1B\u53EF\u4EE5\u63D0\u5230\u5177\u4F53\u7684\u4EBA\u4E0E\u4E8B\uFF0C\u4E0D\u590D\u8FF0\u8BBE\u5B9A\u3002",
      '\u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF08\u4E0D\u8981 markdown \u4EE3\u7801\u5757\uFF09\uFF1A{"diary":"120-220 \u5B57\u7684\u65E5\u8BB0\u6B63\u6587"}'
    ].join("\n");
    const user = [
      `\u6211\uFF1A${username}${profile?.name && profile.name !== username ? `\uFF08${profile.name}\uFF09` : ""}`,
      backstory ? `\u524D\u4E16\uFF1A${backstory}` : "",
      persona ? `\u6027\u683C\u5E95\u8272\uFF1A${persona}` : "",
      `\u4ECA\u5929\u7684\u4E8B\uFF08${memories.length} \u6761\u8BB0\u5FC6\u788E\u7247\uFF09\uFF1A`,
      ...memories.slice(0, 15).map((m) => `- ${m}`),
      memories.length === 0 ? "\uFF08\u8BB0\u5FC6\u68C0\u7D22\u4E3A\u7A7A\u2014\u2014\u5C31\u5199\u4E00\u53E5\u5E73\u6DE1\u4F46\u771F\u5B9E\u7684\u4E00\u5929\uFF0C\u6BD4\u5982\u770B\u5230\u7684\u98CE\u666F/\u5FC3\u91CC\u7684\u5FF5\u5934\uFF09" : ""
    ].filter(Boolean).join("\n");
    const raw = await callLLM(system, user);
    let diary = "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        diary = JSON.parse(raw.slice(start, end + 1)).diary ?? "";
      } catch {
      }
    }
    if (!diary) return { ok: false, msg: "skip: \u65E5\u8BB0\u8F93\u51FA\u4E0D\u53EF\u89E3\u6790" };
    diary = diary.trim().slice(0, 500);
    try {
      const bot = ctx.mcbot;
      if (typeof bot.whisper !== "function") return { ok: false, msg: "skip: bot \u5C1A\u672A\u5C31\u7EEA\uFF08\u65E0 whisper\uFF09" };
      bot.whisper(config.godName, `\u65E5\u8BB0\uFF1A${diary}`);
    } catch (e) {
      return { ok: false, msg: `skip: \u65E5\u8BB0\u9012\u9001\u5931\u8D25\uFF08${e instanceof Error ? e.message : String(e)}\uFF09` };
    }
    await ctx.mcMemos.remember(username, `\u3010\u65E5\u8BB0\u3011${diary}`).catch(() => null);
    return { ok: true, msg: `ok: ${diary.length} \u5B57\u5DF2\u9012\u6863\u6848\u9986` };
  }
  let evolving = false;
  async function onSleepTick() {
    if (evolving) return;
    const bot = ctx.mcbot;
    const username = bot?.username ?? "";
    if (!username || !bot?.isSleeping) return;
    const state = loadState(statePath);
    const s = state[username] ?? {};
    const now = Date.now();
    const evolveDue = now - (s.lastEvolveAt ?? 0) >= config.cooldownHours * 36e5;
    const diaryDue = config.diaryEnabled && s.lastDiaryDay !== localDay() && now - (s.diaryFailAt ?? 0) > 6e5;
    if (!evolveDue && !diaryDue) return;
    evolving = true;
    try {
      const parts = [];
      if (diaryDue) {
        const r = await diaryOnce(username);
        if (r.ok) {
          s.lastDiaryDay = localDay();
          parts.push(`\u65E5\u8BB0${r.msg}`);
        } else {
          s.diaryFailAt = now;
          parts.push(`\u65E5\u8BB0${r.msg}\uFF0810 \u5206\u949F\u540E\u91CD\u8BD5\uFF09`);
        }
      }
      if (evolveDue) {
        const result = await evolveOnce(username);
        s.lastEvolveAt = now;
        s.lastResult = `${(/* @__PURE__ */ new Date()).toISOString()} ${result}`;
        parts.push(`\u8FDB\u5316\uFF1A${result}`);
      }
      state[username] = s;
      saveState(statePath, state);
      console.log(`[mc-evolve] ${username} \u591C\u95F4\u4E8B\u52A1\uFF1A${parts.join("\uFF1B")}`);
    } catch (e) {
      try {
        state[username] = s;
        saveState(statePath, state);
      } catch {
      }
      console.log(`[mc-evolve] ${username} \u591C\u95F4\u4E8B\u52A1\u5931\u8D25\uFF08\u4E0B\u6B21\u5165\u7761\u91CD\u8BD5\uFF09: ${e instanceof Error ? e.message : e}`);
    } finally {
      evolving = false;
    }
  }
  let stopped = false;
  function schedule() {
    if (stopped) return;
    ctx.timer.setTimeout(async () => {
      await onSleepTick().catch(() => {
      });
      schedule();
    }, 3e4);
  }
  schedule();
  ctx.timer.setTimeout(() => void onSleepTick(), 6e4);
  console.log(`[mc-evolve] game-night evolution ready (on sleep, cooldown ${config.cooldownHours}h, effort=${config.reasoningEffort})`);
}
export {
  Config,
  apply,
  inject,
  name
};
