// src/mc-memos.ts
import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
var name = "mc-memos";
var inject = ["tools", "mcbot"];
var Config = Schema.object({
  enabled: Schema.boolean().default(true),
  baseUrl: Schema.string().default("http://127.0.0.1:8002"),
  timeoutMs: Schema.number().default(8e3),
  maxRecall: Schema.number().default(5)
});
function text(value) {
  return [{ type: "text", text: String(value) }];
}
function userIdOf(username) {
  return "mc-" + (username || "unknown").toLowerCase();
}
function apply(ctx, config) {
  if (!config.enabled) {
    console.log("[mc-memos] disabled");
    return;
  }
  async function call(path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.timeoutMs);
    try {
      const res = await fetch(config.baseUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
  const LORE_CUBE = "mc-world";
  async function searchRaw(userId, query, topK, cubes) {
    const r = await call("/product/search", {
      user_id: userId,
      query: query.slice(0, 500),
      mode: "fast",
      // 传入 cubes 时即跨池检索（如 ["mc-kirito", "mc-world"]）。
      ...cubes ? { readable_cube_ids: cubes } : {}
    });
    const d = r?.data;
    if (!d || r?.code !== 200) return [];
    const hits = [];
    for (const layer of [d.text_mem, d.act_mem, d.para_mem, d.pref_mem]) {
      for (const cube of layer ?? []) {
        for (const m of cube.memories ?? []) {
          const mem = String(m.memory ?? "").trim();
          if (mem) hits.push(mem.replace(/\s+/g, " ").slice(0, 200));
        }
      }
    }
    return hits.slice(0, topK);
  }
  const service = {
    async remember(username, content) {
      const c = content.trim();
      if (!c) return null;
      try {
        const r = await call("/product/add", {
          user_id: userIdOf(username),
          // 必须用 messages 结构化格式；memory_content 旧字段会被 reader 静默丢弃。
          messages: [{ role: "assistant", content: c.slice(0, 2e3) }]
        });
        return r?.code === 200 ? r.data?.[0]?.memory_id ?? "ok" : null;
      } catch {
        return null;
      }
    },
    async recall(username, query, topK = config.maxRecall) {
      const q = query.trim();
      if (!q) return "";
      try {
        return (await searchRaw(userIdOf(username), q, topK)).join("\n");
      } catch {
        return "";
      }
    },
    async lore(query, topK = config.maxRecall) {
      const q = query.trim();
      if (!q) return "";
      try {
        return (await searchRaw(LORE_CUBE, q, topK)).join("\n");
      } catch {
        return "";
      }
    },
    async recallAll(username, query, topK = config.maxRecall) {
      const q = query.trim();
      if (!q) return "";
      try {
        return (await searchRaw(userIdOf(username), q, topK, [userIdOf(username), LORE_CUBE])).join("\n");
      } catch {
        return "";
      }
    }
  };
  ctx.provide("mcMemos", service);
  const currentUsername = () => ctx.mcbot?.username ?? "";
  ctx.tools.register(defineTool({
    name: "mc_remember",
    description: '\u628A\u91CD\u8981\u7ECF\u5386\u5199\u5165\u4F60\u7684\u957F\u671F\u8BB0\u5FC6\uFF08\u8DE8\u91CD\u542F\u6301\u4E45\u3001\u53EF\u8BED\u4E49\u68C0\u7D22\uFF09\u3002\u503C\u5F97\u8BB0\u7684\uFF1A\u65B0\u53D1\u73B0\uFF08"\u5728(-200,64,180)\u53D1\u73B0\u88F8\u9732\u94BB\u77F3"\uFF09\u3001\u91CD\u8981\u4EA4\u6613\uFF08"\u548C\u5CB3\u5C71\u752832\u94C1\u952D\u636211\u7EFF\u5B9D\u77F3"\uFF09\u3001\u4E0E\u4EBA\u4EA4\u5F80\uFF08"MengMeng \u9001\u6211\u4E00\u5F20\u5E8A\uFF0C\u5F88\u611F\u6FC0"\uFF09\u3001\u6559\u8BAD\uFF08"\u591C\u665A\u6CBC\u6CFD\u8FB9\u88AB\u82E6\u529B\u6015\u70B8\u8FC7\uFF0C\u522B\u518D\u53BB"\uFF09\u3001\u8BA1\u5212\u4E0E\u627F\u8BFA\uFF08"\u7B54\u5E94\u98CE\u4E34\u660E\u5929\u9001\u4ED6\u5C0F\u9EA6"\uFF09\u3002\u5199\u81EA\u7136\u8BED\u8A00\u5B8C\u6574\u53E5\u5B50\uFF08\u542B\u5173\u952E\u7EC6\u8282\uFF1A\u5750\u6807/\u4EBA\u540D/\u7269\u54C1/\u6570\u91CF\uFF09\uFF0C\u522B\u5199\u6D41\u6C34\u8D26\uFF0C\u4E00\u6B21\u4E00\u4EF6\u4E8B\u3002',
    parameters: {
      content: {
        type: "string",
        required: true,
        description: "\u8981\u8BB0\u4F4F\u7684\u7ECF\u5386\uFF0C\u4E00\u53E5\u81EA\u7136\u8BED\u8A00\uFF0C\u5982\u300C\u5728(-200,64,180)\u7684\u5CE1\u8C37\u58C1\u4E0A\u53D1\u73B0\u4E86\u88F8\u9732\u94BB\u77F3\uFF0C\u8BB0\u4F4F\u8FD9\u4E2A\u4F4D\u7F6E\u300D"
      }
    },
    output: { schema: { type: "string" }, render: (_a, v) => text(v) },
    timeoutMs: config.timeoutMs + 2e3,
    execute: async (args) => {
      const content = String(args.content ?? "").trim();
      if (!content) return "\u6CA1\u6709\u8981\u8BB0\u7684\u5185\u5BB9\u3002";
      const username = currentUsername();
      const id = await service.remember(username, content);
      return id ? `\u5DF2\u94ED\u8BB0\uFF1A${content.slice(0, 60)}${content.length > 60 ? "\u2026" : ""}` : "\uFF08\u8BB0\u5FC6\u4E4B\u6CB3\u6682\u4E0D\u53EF\u6E21\u2014\u2014\u6CA1\u8BB0\u4E0A\uFF0C\u7A0D\u540E\u53EF\u518D\u8BD5\u3002\u8FD9\u4E0D\u5F71\u54CD\u4F60\u7EE7\u7EED\u884C\u52A8\u3002\uFF09";
    }
  }));
  ctx.tools.register(defineTool({
    name: "mc_recall",
    description: "\u68C0\u7D22\u4F60\u7684\u957F\u671F\u8BB0\u5FC6\uFF08\u6A21\u7CCA\u8BED\u4E49\u5339\u914D\uFF0C\u8DE8\u91CD\u542F\uFF09\u3002\u60F3\u4E0D\u8D77\u67D0\u4E8B\u65F6\u7528\uFF1A\u300C\u6211\u4E0A\u6B21\u5728\u54EA\u89C1\u8FC7\u94BB\u77F3\u300D\u300C\u6211\u548C\u98CE\u4E34\u6709\u4EC0\u4E48\u7EA6\u5B9A\u300D\u300C\u4E4B\u524D\u8C01\u7ED9\u8FC7\u6211\u4E1C\u897F\u300D\u300C\u6CBC\u6CFD\u90A3\u8FB9\u51FA\u8FC7\u4EC0\u4E48\u4E8B\u300D\u3002\u67E5\u8BE2\u7528\u81EA\u7136\u8BED\u8A00\u5173\u952E\u8BCD\u5373\u53EF\uFF0C\u4E0D\u5FC5\u7CBE\u786E\u3002",
    parameters: {
      query: {
        type: "string",
        required: true,
        description: "\u60F3\u56DE\u5FC6\u7684\u5185\u5BB9\uFF0C\u5982\u300C\u94BB\u77F3\u5728\u54EA\u89C1\u8FC7\u300D\u6216\u300C\u548C\u6751\u6C11\u7684\u4EA4\u6613\u300D"
      }
    },
    output: { schema: { type: "string" }, render: (_a, v) => text(v) },
    timeoutMs: config.timeoutMs + 2e3,
    execute: async (args) => {
      const query = String(args.query ?? "").trim();
      if (!query) return "\u60F3\u56DE\u5FC6\u4EC0\u4E48\uFF1F";
      const username = currentUsername();
      const hits = await service.recall(username, query);
      if (!hits) return "\uFF08\u8BB0\u5FC6\u4E00\u7247\u7A7A\u767D\u2014\u2014\u8981\u4E48\u786E\u5B9E\u6CA1\u7ECF\u5386\u8FC7\uFF0C\u8981\u4E48\u8BB0\u5FC6\u4E4B\u6CB3\u6682\u4E0D\u53EF\u6E21\u3002\uFF09";
      return "\u4F60\u7684\u56DE\u5FC6\uFF1A\n" + hits;
    }
  }));
  ctx.tools.register(defineTool({
    name: "mc_lore",
    description: "\u68C0\u7D22\u8FD9\u4E2A\u4E16\u754C\u4EBA\u4EBA\u90FD\u53EF\u8BFB\u7684\u516C\u5171\u77E5\u8BC6\u5E93\uFF08\u4E16\u754C\u8BBE\u5B9A\u3001\u7F16\u5E74\u53F2\u5927\u4E8B\u8BB0\u3001NPC \u4EBA\u7269\u5FD7\u3001\u9B54\u6CD5\u4E0E\u4F9B\u5949\u89C4\u5219\u7B49\uFF09\u3002\u521D\u6765\u4E4D\u5230\u3001\u60F3\u4E86\u89E3\u4E16\u754C\u80CC\u666F/\u5386\u53F2\u4E8B\u4EF6/\u67D0\u4F4D NPC \u7684\u4F20\u95FB\u65F6\u7528\uFF0C\u5982\u300C\u8FD9\u4E2A\u4E16\u754C\u7684\u6765\u5386\u300D\u300C\u6700\u8FD1\u53D1\u751F\u8FC7\u4EC0\u4E48\u5927\u4E8B\u300D\u300C\u98CE\u4E34\u662F\u8C01\u300D\u300C\u4F9B\u5949\u89C4\u5219\u662F\u4EC0\u4E48\u300D\u3002",
    parameters: {
      query: {
        type: "string",
        required: true,
        description: "\u60F3\u4E86\u89E3\u7684\u4E16\u754C\u77E5\u8BC6\uFF0C\u5982\u300C\u5973\u795E\u548C\u9B54\u6CD5\u4F53\u7CFB\u7684\u89C4\u5219\u300D\u6216\u300C\u521D\u59CB\u4E4B\u5730\u57CE\u9547\u7684\u5386\u53F2\u300D"
      }
    },
    output: { schema: { type: "string" }, render: (_a, v) => text(v) },
    timeoutMs: config.timeoutMs + 2e3,
    execute: async (args) => {
      const query = String(args.query ?? "").trim();
      if (!query) return "\u60F3\u4E86\u89E3\u4EC0\u4E48\uFF1F";
      const hits = await service.lore(query);
      if (!hits) return "\uFF08\u5178\u7C4D\u6682\u4E0D\u53EF\u67E5\u2014\u2014\u77E5\u8BC6\u4E4B\u5854\u7684\u95E8\u5173\u7740\uFF0C\u7A0D\u540E\u518D\u8BD5\u3002\uFF09";
      return "\u4F60\u6240\u67E5\u7684\u4E16\u754C\u77E5\u8BC6\uFF1A\n" + hits;
    }
  }));
  console.log(`[mc-memos] long-term semantic memory ready (${config.baseUrl}, user=mc-<name>, lore cube=${LORE_CUBE})`);
}
export {
  Config,
  apply,
  inject,
  name
};
