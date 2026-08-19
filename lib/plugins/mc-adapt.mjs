// src/mc-adapt.ts
import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var name = "mc-adapt";
var inject = ["mcbot", "tools", "mcMemos"];
var Config = Schema.object({
  enabled: Schema.boolean().default(true),
  dataDir: Schema.string().default("./data"),
  godName: Schema.string().default("Goddess"),
  clusterSize: Schema.number().default(8),
  maxHotspots: Schema.number().default(4),
  maxDirectives: Schema.number().default(10)
});
var TUNABLE = {
  fleeHp: { v: 6, min: 2, max: 12, label: "\u8840\u91CF\u4F4E\u4E8E\u6B64\u503C\u7ACB\u5373\u64A4\u9000\u907F\u9669" },
  keepFood: { v: 8, min: 2, max: 16, label: "\u9971\u98DF\u5EA6\u4F4E\u4E8E\u6B64\u503C\u5148\u89C5\u98DF\u518D\u5E72\u6D3B" },
  riskTolerance: { v: 5, min: 0, max: 10, label: "\u63A2\u9669\u6FC0\u8FDB\u5EA6\uFF08\u4F4E=\u8C28\u614E\uFF0C\u9AD8=\u5927\u80C6\uFF09" },
  nightSafety: { v: 7, min: 0, max: 10, label: "\u591C\u95F4\u8B66\u60D5\u5EA6\uFF08\u8D8A\u9AD8\u8D8A\u65E9\u56DE\u5C4B\u907F\u9669\uFF09" },
  torchMin: { v: 8, min: 0, max: 32, label: "\u706B\u628A\u4FDD\u5E95\u643A\u5E26\u6570\uFF08\u4F4E\u4E8E\u5C31\u53BB\u8865\uFF09" },
  waterCaution: { v: 6, min: 0, max: 10, label: "\u6C34\u57DF\u8B66\u60D5\uFF08\u6EBA\u6C34\u540E\u4F1A\u60F3\u63D0\u9AD8\u5B83\uFF09" },
  cliffCaution: { v: 6, min: 0, max: 10, label: "\u9AD8\u5904\u8B66\u60D5\uFF08\u6454\u843D\u540E\u4F1A\u60F3\u63D0\u9AD8\u5B83\uFF09" }
};
var CAUSE_MAP = [
  [/drowned/i, "\u6EBA\u6C34"],
  [/hit the ground too hard|fell (from|from a)/i, "\u5760\u843D"],
  [/tried to swim in lava|lava/i, "\u5CA9\u6D46"],
  [/burned to death|went up in flames|fire/i, "\u706B\u70E7"],
  [/starved|died of hunger/i, "\u9965\u997F"],
  [/suffocated|squashed/i, "\u7A92\u606F"],
  [/blew up|explosion|blast/i, "\u7206\u70B8"],
  [/froze|freezing|powder snow/i, "\u51B0\u51BB"],
  [/withered away/i, "\u51CB\u96F6"],
  [/shot by|arrow/i, "\u4E2D\u7BAD"],
  [/slain by|killed by|stabbed|beaten/i, "\u88AB\u51FB\u6740"],
  [/zombie|husk|drowned\b.*slain|zombified/i, "\u50F5\u5C38\u88AD\u51FB"],
  [/skeleton|stray/i, "\u9AB7\u9AC5\u5C04\u6740"],
  [/creeper/i, "\u82E6\u529B\u6015"],
  [/spider|cave spider/i, "\u8718\u86DB\u88AD\u51FB"],
  [/witch/i, "\u5973\u5DEB\u6BD2\u6740"],
  [/fell out of the world|the void/i, "\u5760\u5165\u865A\u7A7A"],
  [/magic|spell/i, "\u9B54\u6CD5\u53CD\u566C"],
  [/lightning/i, "\u96F7\u51FB"],
  [/pricked|cactus/i, "\u4ED9\u4EBA\u638C"],
  [/died/i, "\u6B7B\u4EA1"]
];
function zhCause(text2) {
  for (const [re, zh] of CAUSE_MAP) if (re.test(text2)) return zh;
  return "\u672A\u77E5\uFF08" + text2.slice(0, 24) + "\uFF09";
}
function loadJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}
function saveJson(path, data) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}
function text(value) {
  return [{ type: "text", text: String(value) }];
}
function apply(ctx, config) {
  const log = (msg) => console.log(`[mc-adapt] ${msg}`);
  if (!config.enabled) return;
  const dataDir = config.dataDir;
  const hotspotsPath = join(dataDir, "death-hotspots.json");
  const proposalsDir = join(dataDir, "evolution-proposals");
  const directivesPathOf = (u) => join(dataDir, `evolution-directives-${u}.json`);
  const tuningPathOf = (u) => join(dataDir, `self-tuning-${u}.json`);
  mkdirSync(proposalsDir, { recursive: true });
  const msgRing = [];
  let lastDeathAt = 0;
  try {
    ctx.mcbot.on("message", (json) => {
      const t = String(json ?? "");
      if (!t) return;
      msgRing.push({ at: Date.now(), text: t });
      if (msgRing.length > 12) msgRing.shift();
    });
    ctx.mcbot.on("death", () => {
      const bot = ctx.mcbot;
      const username = bot.username ?? "unknown";
      const pos = bot.entity?.position;
      const x = pos ? Math.floor(pos.x) : 0;
      const y = pos ? Math.floor(pos.y) : 64;
      const z = pos ? Math.floor(pos.z) : 0;
      lastDeathAt = Date.now();
      const lines = msgRing.filter((m) => Math.abs(m.at - lastDeathAt) < 4e3).map((m) => m.text);
      const deathLine = lines.reverse().find((l) => l.includes(username));
      const raw = deathLine ?? `${username} died`;
      const zh = zhCause(raw);
      recordDeath(username, zh, x, y, z, raw);
    });
    log("L1 death listeners armed");
  } catch (err) {
    log(`death listener failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  function recordDeath(username, causeZh, x, y, z, rawText) {
    try {
      const file = loadJson(hotspotsPath, { clusters: {} });
      const bx = Math.floor(x / config.clusterSize);
      const bz = Math.floor(z / config.clusterSize);
      const key = `${causeZh}@${bx}_${bz}`;
      const now = Date.now();
      const c = file.clusters[key];
      if (c) {
        c.count += 1;
        c.lastAt = now;
        c.x = x;
        c.y = y;
        c.z = z;
        if (!c.usernames.includes(username)) c.usernames.push(username);
      } else {
        file.clusters[key] = { cause: causeZh, zh: causeZh, x, y, z, count: 1, firstAt: now, lastAt: now, usernames: [username] };
      }
      saveJson(hotspotsPath, file);
      log(`death recorded: ${username} ${causeZh} @(${x},${y},${z}) cluster count=${file.clusters[key].count}`);
      void ctx.mcMemos?.remember(username, `\u3010\u6B7B\u4EA1\u6559\u8BAD\u3011\u6211\u5728\u5750\u6807(${x},${y},${z})\u9644\u8FD1\u56E0\u300C${causeZh}\u300D\u6B7B\u4EA1\uFF08\u7CFB\u7EDF\u6D88\u606F\uFF1A${rawText.slice(0, 80)}\uFF09\u3002\u6B64\u5730\u5371\u9669\uFF0C\u5E94\u7ED5\u884C\u6216\u63D0\u524D\u9632\u5907\u3002`).catch(() => {
      });
    } catch (err) {
      log(`recordDeath failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  function tuningOf(username) {
    const f = loadJson(tuningPathOf(username), { params: {}, history: [] });
    let dirty = false;
    for (const [k, spec] of Object.entries(TUNABLE)) {
      if (typeof f.params[k] !== "number" || !Number.isFinite(f.params[k])) {
        f.params[k] = spec.v;
        dirty = true;
      }
    }
    if (dirty) saveJson(tuningPathOf(username), f);
    return f;
  }
  function promptBlock(username, x, z) {
    if (!username) return "";
    const blocks = [];
    try {
      const file = loadJson(hotspotsPath, { clusters: {} });
      const all = Object.values(file.clusters);
      if (all.length) {
        const scored = all.map((c) => {
          let score = c.count * 2 + Math.max(0, 3 - (Date.now() - c.lastAt) / 864e5);
          if (x !== null && z !== null) {
            const d = Math.hypot(c.x - x, c.z - z);
            score += d <= 48 ? 6 : d <= 128 ? 2 : 0;
          }
          return { c, score };
        }).sort((a, b) => b.score - a.score).slice(0, config.maxHotspots);
        blocks.push([
          "",
          "\u4F60\u7684\u6B7B\u4EA1\u6559\u8BAD\uFF08\u8840\u6CEA\u6362\u6765\u7684\u7981\u5730\u6E05\u5355\uFF0C\u7ECF\u8FC7\u65F6\u52A1\u5FC5\u9632\u5907\u6216\u7ED5\u884C\uFF09\uFF1A",
          ...scored.map(({ c }) => {
            const n = `${c.x},${c.y},${c.z}`;
            return `- \u5750\u6807(${n})\u9644\u8FD1\u5DF2\u56E0\u300C${c.zh}\u300D\u6B7B\u4EA1${c.count}\u6B21\u2014\u2014${c.zh === "\u6EBA\u6C34" ? "\u8FDC\u79BB\u6C34\u57DF/\u5907\u8239/\u4E0D\u591C\u6CF3" : c.zh === "\u5760\u843D" ? "\u8D70\u8FD1\u8FB9\u7F18\u5148\u51CF\u901F\u3001\u770B\u811A\u4E0B" : c.zh === "\u88AB\u51FB\u6740" || c.zh.includes("\u88AD") || c.zh.includes("\u6740") ? "\u5E26\u6B66\u5668\u3001\u767D\u5929\u518D\u53BB\u3001\u7ED3\u4F34\u800C\u884C" : "\u6B64\u5904\u5371\u9669\uFF0C\u7ED5\u884C"}`;
          })
        ].join("\n"));
      }
    } catch {
    }
    try {
      const t = tuningOf(username);
      blocks.push([
        "",
        "\u4F60\u7684\u81EA\u8C03\u751F\u5B58\u5B88\u5219\uFF08\u4F60\u81EA\u5DF1\u5B9A\u4E0B\u7684\u884C\u4E3A\u53C2\u6570\uFF0C\u6570\u5B57\u7531\u4F60\u7528 mc_selftune \u8C03\u6574\uFF09\uFF1A",
        ...Object.entries(TUNABLE).map(([k, spec]) => `- ${spec.label}\uFF1A${t.params[k] ?? spec.v}`),
        "\u82E5\u6700\u8FD1\u5403\u8FC7\u4E8F\uFF08\u6DF9\u6B7B/\u6454\u6B7B/\u591C\u95F4\u9047\u88AD\uFF09\uFF0C\u4E3B\u52A8\u8C03\u9AD8\u5BF9\u5E94\u8B66\u60D5\u9879\u3002"
      ].join("\n"));
    } catch {
    }
    try {
      const d = loadJson(directivesPathOf(username), { items: [] });
      if (d.items.length) {
        blocks.push([
          "",
          "\u3010\u5973\u795E\u6838\u51C6\u7684\u8FDB\u5316\u65B9\u5411\u3011\uFF08\u4F60\u6B64\u524D\u63D0\u6848\u3001\u5973\u795E\u4EB2\u6279\u7684\u957F\u671F\u884C\u4E3A\u51C6\u5219\uFF0C\u4F18\u5148\u9075\u5B88\uFF09\uFF1A",
          ...d.items.slice(-config.maxDirectives).map((it) => `- ${it.directive}\uFF08${it.reason}\uFF09`)
        ].join("\n"));
      }
    } catch {
    }
    return blocks.join("\n");
  }
  ctx.provide("mcAdapt", { promptBlock, recordDeath });
  ctx.tools.register(defineTool({
    name: "mc_selftune",
    description: "\u8C03\u6574\u4F60\u81EA\u5DF1\u7684\u751F\u5B58\u884C\u4E3A\u53C2\u6570\uFF08\u81EA\u6211\u8FDB\u5316\u7684\u7B2C\u4E8C\u6B65\uFF1A\u4ECE\u6559\u8BAD\u91CC\u6539\u53C2\u6570\uFF09\u3002\u53EA\u6539\u4E00\u4E2A\u53C2\u6570\uFF0C\u5E76\u7ED9\u51FA\u7406\u7531\u3002\u540C\u7C7B\u6B7B\u4EA1\u4E24\u6B21\u4EE5\u4E0A\u5C31\u8BE5\u8C03\u9AD8\u5BF9\u5E94\u8B66\u60D5\u3002",
    parameters: {
      key: { type: "string", required: true, description: `\u8981\u8C03\u7684\u53C2\u6570\u540D\uFF0C\u53EF\u9009\uFF1A${Object.entries(TUNABLE).map(([k, s]) => `${k}\uFF08${s.label}\uFF0C${s.min}~${s.max}\uFF09`).join("\u3001")}` },
      value: { type: "string", required: true, description: "\u76EE\u6807\u6570\u503C\uFF08\u7EAF\u6570\u5B57\u5B57\u7B26\u4E32\uFF0C\u4F1A\u81EA\u52A8\u9650\u5236\u5728\u5B89\u5168\u8303\u56F4\u5185\uFF09" },
      reason: { type: "string", required: true, description: "\u4E00\u53E5\u8BDD\u7406\u7531\uFF08\u901A\u5E38\u5F15\u7528\u67D0\u6B21\u6B7B\u4EA1/\u6559\u8BAD\uFF09" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    execute: async (args) => {
      const bot = ctx.mcbot;
      const username = bot.username ?? "unknown";
      const key = String(args.key ?? "");
      const reason = String(args.reason ?? "");
      const spec = TUNABLE[key];
      if (!spec) return text(`\u6CA1\u6709\u8FD9\u4E2A\u53C2\u6570\u3002\u53EF\u8C03\uFF1A${Object.keys(TUNABLE).join(", ")}`);
      const num = Number(args.value);
      if (!Number.isFinite(num)) return text(`value \u5FC5\u987B\u662F\u6570\u5B57\uFF0C\u6536\u5230\u7684\u662F\u300C${String(args.value).slice(0, 20)}\u300D\u3002`);
      const clamped = Math.max(spec.min, Math.min(spec.max, Math.round(num)));
      const f = tuningOf(username);
      const from = f.params[key] ?? spec.v;
      f.params[key] = clamped;
      f.history.push({ at: Date.now(), key, from, to: clamped, reason: reason.slice(0, 120) });
      if (f.history.length > 60) f.history = f.history.slice(-60);
      saveJson(tuningPathOf(username), f);
      try {
        ctx.mcbot.whisper(config.godName, `[\u81EA\u6211\u8FDB\u5316] \u6211\u628A\u300C${spec.label}\u300D\u4ECE ${from} \u8C03\u5230 ${clamped}\u3002\u7406\u7531\uFF1A${reason.slice(0, 80)}`);
      } catch {
      }
      log(`selftune ${username}: ${key} ${from} -> ${clamped} (${reason.slice(0, 60)})`);
      return text(`\u5DF2\u8C03\u6574\u300C${spec.label}\u300D\uFF1A${from} \u2192 ${clamped}\uFF08\u5B89\u5168\u8303\u56F4 ${spec.min}~${spec.max}\uFF09\u3002\u65B0\u5B88\u5219\u5373\u523B\u751F\u6548\uFF0C\u5DF2\u5411\u5973\u795E\u5907\u6848\u3002`);
    }
  }));
  ctx.tools.register(defineTool({
    name: "mc_evolve_propose",
    description: "\u5411\u5973\u795E\u63D0\u4EA4\u300C\u884C\u4E3A\u8FDB\u5316\u63D0\u6848\u300D\u2014\u2014\u5F53\u4F60\u610F\u8BC6\u5230\u81EA\u5DF1\u9700\u8981\u957F\u671F\u6539\u53D8\u67D0\u4E2A\u884C\u4E3A\u4E60\u60EF\uFF08\u4E0D\u662F\u4E34\u65F6\u52A8\u4F5C\uFF09\u65F6\u7528\u3002\u63D0\u6848\u7531\u5973\u795E\u4EB2\u81EA\u5BA1\u6838\uFF1A\u6838\u51C6\u540E\u6210\u4E3A\u4F60\u7684\u957F\u671F\u51C6\u5219\uFF08\u6CE8\u5165\u4F60\u4E4B\u540E\u7684\u6BCF\u4E00\u6B21\u51B3\u7B56\uFF09\uFF1B\u4E5F\u4F1A\u88AB\u9A73\u56DE\u3002\u6BCF\u6B21\u53EA\u63D0\u4E00\u4EF6\u5C0F\u4E8B\u3002",
    parameters: {
      title: { type: "string", required: true, description: "\u63D0\u6848\u6807\u9898\uFF08\u5982\uFF1A\u591C\u95F4\u4E0D\u5916\u51FA\u63A2\u9669\uFF09" },
      motivation: { type: "string", required: true, description: "\u52A8\u673A\uFF1A\u4EC0\u4E48\u7ECF\u5386\u8BA9\u4F60\u60F3\u6539\uFF08\u5F15\u7528\u5177\u4F53\u4E8B\u4EF6/\u6B7B\u4EA1\uFF09" },
      change: { type: "string", required: true, description: "\u60F3\u6539\u53D8\u7684\u5177\u4F53\u884C\u4E3A\uFF08\u73B0\u5728\u600E\u6837 \u2192 \u60F3\u6539\u6210\u600E\u6837\uFF09" },
      expected: { type: "string", required: true, description: "\u9884\u671F\u6548\u679C\uFF08\u600E\u6837\u7B97\u6539\u597D\u4E86\uFF09" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    execute: async (args) => {
      const bot = ctx.mcbot;
      const username = bot.username ?? "unknown";
      const title = String(args.title ?? "");
      const motivation = String(args.motivation ?? "");
      const change = String(args.change ?? "");
      const expected = String(args.expected ?? "");
      const id = `${Date.now().toString(36)}-${username}`;
      const p = {
        id,
        username,
        title: title.slice(0, 60),
        motivation: motivation.slice(0, 300),
        change: change.slice(0, 300),
        expected: expected.slice(0, 200),
        status: "pending",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      saveJson(join(proposalsDir, `${id}.json`), p);
      try {
        ctx.mcbot.whisper(config.godName, `[\u81EA\u6211\u8FDB\u5316] \u6211\u63D0\u4EA4\u4E86\u884C\u4E3A\u8FDB\u5316\u63D0\u6848\u300C${p.title}\u300D\uFF0C\u9759\u5019\u795E\u8C15\u3002`);
      } catch {
      }
      log(`proposal ${id}: ${p.title}`);
      return text(`\u63D0\u6848\u300C${p.title}\u300D\u5DF2\u9012\u5448\u5973\u795E\u3002\u795E\u8C15\u901A\u5E38\u51E0\u5206\u949F\u5185\u9001\u8FBE\u2014\u2014\u6838\u51C6\u540E\u5B83\u4F1A\u6210\u4E3A\u4F60\u7684\u957F\u671F\u51C6\u5219\uFF1B\u82E5\u88AB\u9A73\u56DE\uFF0C\u4FE1\u4F7F\u4F1A\u5E26\u56DE\u5973\u795E\u7684\u7406\u7531\u3002`);
    }
  }));
  log(`adapt ready (L1 hotspots + L2 ${Object.keys(TUNABLE).length} params + L3 proposals, dir=${dataDir})`);
}
export {
  Config,
  apply,
  inject,
  name
};
