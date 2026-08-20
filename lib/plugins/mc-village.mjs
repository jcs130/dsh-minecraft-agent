// src/mc-village.ts
import Schema from "@deepseek-ai/schemastery";
var name = "mc-village";
var inject = ["mcbot", "timer"];
var Config = Schema.object({
  nearbyRadius: Schema.number().default(28).description("\u6751\u6C11\u5B9E\u4F53\u89C6\u4E3A\u300C\u9644\u8FD1\u300D\u7684\u8DDD\u79BB\uFF08\u683C\uFF09"),
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
    const bot = getBot();
    const entities = bot?.entities;
    if (!entities) return "";
    let n = 0;
    let nearest = Number.POSITIVE_INFINITY;
    for (const e of Object.values(entities)) {
      const ent = e;
      const isVillager = ent.name === "villager" || (ent.displayName ?? "").toLowerCase().includes("villager");
      if (!isVillager || !ent.position) continue;
      const dx = pos.x - ent.position.x;
      const dy = pos.y - ent.position.y;
      const dz = pos.z - ent.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > config.nearbyRadius) continue;
      n++;
      if (dist < nearest) nearest = dist;
    }
    if (!n) return "";
    return `\u9644\u8FD1\u6709\u6751\u6C11 \xD7${n}\uFF0C\u6700\u8FD1 @${Math.round(nearest)}m\u2014\u2014\u4ED6\u4EEC\u662F\u8C01\u3001\u6709\u4EC0\u4E48\u59D4\u6258\uFF0C\u51D1\u8FD1\u6253\u62DB\u547C\u6216\u95EE\u5973\u795E\u4FBF\u77E5`;
  }
  function snapshot() {
    const bot = getBot();
    const p = bot?.entity?.position;
    return {
      nearby: p ? nearbyLines(p) : "",
      recentWords: npcMsgs.slice(-8).map((m) => `[${m.who}] ${m.text}`),
      note: "\u5BA2\u6237\u7AEF\u96F6\u670D\u52A1\u5668\u6570\u636E\uFF1A\u6751\u5E84/\u59D4\u6258/\u5386\u53F2\u4FE1\u606F\u4E00\u5F8B\u7ECF\u6E38\u620F\u5185\u804A\u5929\u6E20\u9053\u83B7\u5F97"
    };
  }
  ctx.provide("mcVillage", { nearbyLines, drainMessages, snapshot });
  ctx.setInterval(() => {
    const bot = getBot();
    if (bot) ensureMessageListener(bot);
  }, 2e3);
  log("up: entity perception + tellraw perception armed (zero server-side data)");
}
export {
  Config,
  apply,
  inject,
  name
};
