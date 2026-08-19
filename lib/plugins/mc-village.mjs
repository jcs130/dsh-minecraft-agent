// src/mc-village.ts
import Schema from "@deepseek-ai/schemastery";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
var name = "mc-village";
var inject = ["mcbot", "timer"];
var Config = Schema.object({
  dataDir: Schema.string().default("./data").description("\u5171\u4EAB\u4E16\u754C\u6570\u636E\u5377\uFF08\u4E0E\u4E16\u754C\u8FDB\u7A0B\u540C\u6E90\uFF09"),
  nearbyRadius: Schema.number().default(28).description("NPC \u89C6\u4E3A\u300C\u9644\u8FD1\u300D\u7684\u8DDD\u79BB\uFF08\u683C\uFF09"),
  cacheTtlMs: Schema.number().default(3e4).description("\u6751\u5E84\u6587\u4EF6\u7F13\u5B58 TTL"),
  maxMsgBuffer: Schema.number().default(24).description("NPC \u8BDD\u8BED\u7F13\u51B2\u4E0A\u9650")
});
function flattenText(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (node && typeof node === "object") {
    const o = node;
    let out = "";
    if (typeof o.text === "string") out += o.text;
    if (Array.isArray(o.extra)) out += o.extra.map(flattenText).join("");
    return out;
  }
  return "";
}
function apply(ctx, config) {
  const log = (msg) => console.log(`[mc-village] ${msg}`);
  const getBot = () => ctx.mcbot ?? null;
  const villageDir = resolve(config.dataDir, "village");
  let villagers = [];
  let quests = [];
  let cacheAt = 0;
  function refresh() {
    if (Date.now() - cacheAt < config.cacheTtlMs) return;
    cacheAt = Date.now();
    try {
      const raw = JSON.parse(readFileSync(resolve(villageDir, "villagers.json"), "utf-8"));
      const list = Array.isArray(raw) ? raw : raw?.villagers;
      villagers = Array.isArray(list) ? list : [];
    } catch {
      villagers = [];
    }
    try {
      const d = /* @__PURE__ */ new Date();
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const p = resolve(villageDir, `quests-${day}.json`);
      if (existsSync(p)) {
        const raw = JSON.parse(readFileSync(p, "utf-8"));
        quests = Array.isArray(raw?.quests) ? raw.quests : [];
      } else {
        quests = [];
      }
    } catch {
      quests = [];
    }
  }
  const npcMsgs = [];
  let watchedBot = null;
  function ensureMessageListener(bot) {
    if (watchedBot === bot) return;
    watchedBot = bot;
    bot.on("message", (jsonMsg) => {
      const text = flattenText(jsonMsg).trim();
      if (!text) return;
      const npcMatch = text.match(/^<([^>]{1,24})>\s*(.+)$/);
      const sysMatch = text.match(/^\[(女神|信使)\]\s*(.+)$/);
      const who = npcMatch ? npcMatch[1] : sysMatch ? sysMatch[1] : null;
      if (!who) return;
      const body = npcMatch ? npcMatch[2] : sysMatch[2];
      npcMsgs.push({ who, text: body, ts: Date.now() });
      if (npcMsgs.length > config.maxMsgBuffer) npcMsgs.splice(0, npcMsgs.length - config.maxMsgBuffer);
    });
    log("message listener armed (NPC/goddess tellraw \u2192 perception)");
  }
  function drainMessages() {
    if (npcMsgs.length === 0) return "";
    const out = npcMsgs.map((m) => `[${m.who}] ${m.text}`).join("\n");
    npcMsgs.length = 0;
    return out;
  }
  function nearbyLines(pos) {
    refresh();
    const out = [];
    for (const v of villagers) {
      if (!v.spawn) continue;
      const dx = pos.x - v.spawn[0];
      const dy = pos.y - v.spawn[1];
      const dz = pos.z - v.spawn[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > config.nearbyRadius) continue;
      const q = quests.find((x) => x.villager === v.key);
      const qs = !q ? "\u4ECA\u65E5\u65E0\u59D4\u6258" : q.done ? `\u59D4\u6258\u5DF2\u5B8C\u6210` : `\u59D4\u6258\uFF1A${q.zh ?? ""}\xD7${q.count ?? "?"} \u2192 ${q.emerald ?? 0}\u7EFF\u5B9D\u77F3`;
      out.push(`${v.display} @${Math.round(dist)}m\uFF08${qs}\uFF09`);
    }
    return out.join("; ");
  }
  function snapshot() {
    refresh();
    return {
      npcs: villagers.map((v) => {
        const q = quests.find((x) => x.villager === v.key);
        return {
          key: v.key,
          display: v.display,
          spawn: v.spawn,
          quest: q ? { zh: q.zh, count: q.count, emerald: q.emerald, done: q.done, doneBy: q.done_by } : null
        };
      })
    };
  }
  ctx.provide("mcVillage", { nearbyLines, drainMessages, snapshot });
  ctx.setInterval(() => {
    const bot = getBot();
    if (bot) ensureMessageListener(bot);
  }, 2e3);
  log("up: villagers+quests polled from shared volume, tellraw \u2192 perception armed");
}
export {
  Config,
  apply,
  inject,
  name
};
