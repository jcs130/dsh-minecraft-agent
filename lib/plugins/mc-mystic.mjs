// src/mc-mystic.ts
import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// src/mc-offering.ts
var OFFERING_ITEMS = {
  // 食物（口粮级）
  "\u9762\u5305": "bread",
  "\u719F\u725B\u8089": "cooked_beef",
  "\u725B\u6392": "cooked_beef",
  "\u70E4\u732A\u6392": "cooked_porkchop",
  "\u70E4\u9E21": "cooked_chicken",
  "\u91D1\u80E1\u841D\u535C": "golden_carrot",
  "\u91D1\u82F9\u679C": "golden_apple",
  "\u86CB\u7CD5": "cake",
  "\u5357\u74DC\u6D3E": "pumpkin_pie",
  "\u82F9\u679C": "apple",
  "\u751C\u6D46\u679C": "sweet_berries",
  // 基础材料
  "\u7164": "coal",
  "\u6728\u70AD": "charcoal",
  "\u94C1": "iron_ingot",
  "\u94C1\u952D": "iron_ingot",
  "\u94DC": "copper_ingot",
  "\u94DC\u952D": "copper_ingot",
  "\u91D1": "gold_ingot",
  "\u91D1\u952D": "gold_ingot",
  "\u5706\u77F3": "cobblestone",
  "\u6728\u5934": "oak_log",
  "\u7EB8": "paper",
  "\u4E66": "book",
  // 贵重之物（最能打动女神）
  "\u94BB\u77F3": "diamond",
  "\u7EFF\u5B9D\u77F3": "emerald",
  "\u7EA2\u77F3": "redstone",
  "\u9752\u91D1\u77F3": "lapis_lazuli",
  "\u77F3\u82F1": "quartz",
  "\u8424\u77F3\u7C89": "glowstone_dust",
  "\u7D2B\u6C34\u6676": "amethyst_shard",
  "\u672B\u5F71\u73CD\u73E0": "ender_pearl",
  "\u70C8\u7130\u68D2": "blaze_rod",
  "\u6076\u9B42\u4E4B\u6CEA": "ghast_tear",
  "\u9644\u9B54\u4E66": "enchanted_book"
};
var OFFERING_ITEM_CN = (() => {
  const map = {};
  for (const [cn, id] of Object.entries(OFFERING_ITEMS)) {
    if (!map[id] || cn.length > map[id].length) map[id] = cn;
  }
  return map;
})();
function resolveOfferingText(text2) {
  const raw = text2.trim().replace(/^供奉[:：]?\s*/, "");
  if (!raw) return null;
  let name2 = raw;
  let count = 1;
  const patterns = [
    [/^(.+?)[x×*＊]\s*(\d+)$/i, (m) => {
      name2 = m[1];
      count = parseInt(m[2], 10);
    }],
    [/^(\d+)\s*[个只块颗组张本]\s*(.+)$/, (m) => {
      name2 = m[2];
      count = parseInt(m[1], 10);
    }],
    [/^(.+?)\s+(\d+)$/, (m) => {
      name2 = m[1];
      count = parseInt(m[2], 10);
    }],
    [/^(.+?)(\d+)$/, (m) => {
      name2 = m[1];
      count = parseInt(m[2], 10);
    }]
  ];
  for (const [re, apply2] of patterns) {
    const m = raw.match(re);
    if (m) {
      apply2(m);
      break;
    }
  }
  name2 = name2.trim();
  if (!name2) return null;
  count = Math.max(1, Math.min(64, Math.floor(count)));
  if (OFFERING_ITEMS[name2]) {
    const id = OFFERING_ITEMS[name2];
    return { id: `minecraft:${id}`, count, cn: name2 };
  }
  const norm = name2.toLowerCase().replace(/\s+/g, "_").replace(/^minecraft:/, "");
  if (OFFERING_ITEM_CN[norm]) {
    return { id: `minecraft:${norm}`, count, cn: OFFERING_ITEM_CN[norm] };
  }
  return null;
}
function sumItemCount(items, id) {
  const bare = id.toLowerCase().replace(/^minecraft:/, "");
  return items.reduce((sum, it) => it.name === bare || it.name === `minecraft:${bare}` ? sum + it.count : sum, 0);
}

// src/mc-mystic.ts
var name = "mc-mystic";
var inject = ["tools", "mcbot", "timer"];
var Config = Schema.object({
  enabled: Schema.boolean().default(true),
  godName: Schema.string().default("Goddess"),
  chantTimeoutMs: Schema.number().default(3e4),
  prayTimeoutMs: Schema.number().default(8e3),
  statePath: Schema.string().default("./data/mystic-state.json")
});
function text(value) {
  return [{ type: "text", text: String(value) }];
}
var MysticStore = class {
  state = { version: 1, players: {} };
  path;
  constructor(path) {
    this.path = resolve(path);
    try {
      if (existsSync(this.path)) {
        const raw = JSON.parse(readFileSync(this.path, "utf-8"));
        if (raw && typeof raw === "object" && raw.version === 1) this.state = raw;
      }
    } catch {
    }
  }
  get(username) {
    return this.state.players[username]?.innateSkill ?? null;
  }
  set(username, skill) {
    this.state.players[username] = { ...this.state.players[username], innateSkill: skill };
    this.persist();
  }
  getLevel(username) {
    return this.state.players[username]?.level ?? 0;
  }
  setLevel(username, level) {
    this.state.players[username] = { ...this.state.players[username], level };
    this.persist();
  }
  persist() {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = this.path + ".tmp";
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf-8");
      renameSync(tmp, this.path);
    } catch {
    }
  }
};
function waitForReply(bot, pred, timeoutMs) {
  return new Promise((resolve2) => {
    let done = false;
    const onChat = (username, message) => {
      if (!done && pred(username, message, "chat")) {
        done = true;
        cleanup();
        resolve2(message);
      }
    };
    const onWhisper = (username, message) => {
      if (!done && pred(username, message, "whisper")) {
        done = true;
        cleanup();
        resolve2(message);
      }
    };
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        cleanup();
        resolve2("");
      }
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      bot.removeListener("chat", onChat);
      bot.removeListener("whisper", onWhisper);
    }
    bot.on("chat", onChat);
    bot.on("whisper", onWhisper);
  });
}
function apply(ctx, config) {
  const log = (msg) => console.log(`[mc-mystic] ${msg}`);
  const getBot = () => ctx.mcbot;
  const store = new MysticStore(config.statePath);
  ctx.provide("mcMystic", {
    getInnate: (u) => store.get(u),
    getLevel: (u) => {
      const bot = getBot();
      if (bot?.entity && bot.username === u && typeof bot.experience?.level === "number") {
        const lv = bot.experience.level;
        if (store.getLevel(u) !== lv) store.setLevel(u, lv);
        return lv;
      }
      return store.getLevel(u);
    }
  });
  function parseInnate(message) {
    const m = message.match(/出生天赋[是为]?\s*「(.+?)」/);
    return m ? m[1] : null;
  }
  function parseLevelUp(message) {
    const arrow = message.match(/魔力层级\s*\d+\s*→\s*(\d+)/);
    if (arrow) return parseInt(arrow[1], 10);
    const m = message.match(/层级提升至\s*(\d+)\s*级/);
    return m ? parseInt(m[1], 10) : null;
  }
  let watchedBot = null;
  function ensurePassive(bot) {
    if (watchedBot === bot) return;
    watchedBot = bot;
    ensureCourierWatch(bot);
    const capture = (message) => {
      const innate = parseInnate(message);
      if (innate && store.get(bot.username) !== innate) {
        store.set(bot.username, innate);
        log(`innate memory captured from public chat: ${bot.username} -> ${innate}`);
      }
      const lv = parseLevelUp(message);
      if (lv && store.getLevel(bot.username) !== lv) {
        store.setLevel(bot.username, lv);
        log(`level memory captured: ${bot.username} -> Lv.${lv}`);
      }
    };
    bot.on("chat", (username, message) => {
      if (username !== config.godName) return;
      if (!message.includes(bot.username)) return;
      capture(message);
    });
    bot.on("whisper", (username, message) => {
      if (username !== config.godName) return;
      capture(message);
    });
  }
  let disposed = false;
  let stopEnsure = null;
  let lastQuery = 0;
  function scheduleEnsure() {
    if (disposed) return;
    stopEnsure = ctx.setTimeout(() => {
      const bot = getBot();
      if (bot) {
        ensurePassive(bot);
        const me = bot.username;
        if (bot.entity && me && !store.get(me) && Date.now() - lastQuery > 6e4) {
          lastQuery = Date.now();
          try {
            bot.whisper(config.godName, "\u5973\u795E\uFF0C\u6211\u7684\u51FA\u751F\u5929\u8D4B\u662F\u4EC0\u4E48\uFF1F");
            log(`asked the goddess for innate memory (${me})`);
          } catch {
          }
        }
      }
      scheduleEnsure();
    }, 1e4);
  }
  scheduleEnsure();
  const lateCourier = [];
  let chantInFlight = false;
  function ensureCourierWatch(bot) {
    bot.on("whisper", (username, message) => {
      if (username !== config.godName) return;
      if (!message.startsWith("[\u4FE1\u4F7F]") || !message.includes(bot.username)) return;
      if (chantInFlight) return;
      if (lateCourier.length >= 3) lateCourier.shift();
      lateCourier.push(message);
      log(`late courier reply stashed (no chant in flight): ${message.slice(0, 80)}`);
    });
  }
  ctx.tools.register(defineTool({
    name: "mc_chant",
    description: '\u548F\u5531\u9B54\u6CD5\u5492\u8BED\u6765\u65BD\u6CD5\u3002\u7528\u4E2D\u4E8C\u7684\u53E3\u543B\u558A\u51FA\u5492\u8BED\uFF0C\u5FC5\u987B\u5305\u542B\u6CD5\u672F\u5173\u952E\u8BCD\u3002\u6BCF\u4E2A\u6CD5\u672F\u6709\u7B49\u7EA7\u95E8\u69DB\uFF08\u6807\u6CE8\u5728\u62EC\u53F7\u5185\uFF0C\u5982"2\u7EA7"\uFF09\u2014\u2014\u7B49\u7EA7\u4E0D\u8DB3\u4F1A\u88AB\u5973\u795E\u62D2\u7EDD\uFF08\u4F60\u7684\u51FA\u751F\u5929\u8D4B\u9664\u5916\uFF0C\u5B83\u65E0\u89C6\u7B49\u7EA7\uFF09\u3002\u65BD\u6CD5\u6210\u529F\u53EF\u83B7\u5F97\u7ECF\u9A8C\uFF0C\u6512\u591F\u81EA\u52A8\u63D0\u5347\u9B54\u529B\u5C42\u7EA7\u3001\u89E3\u9501\u66F4\u9AD8\u7EA7\u6CD5\u672F\u3002\u5F53\u524D\u5DF2\u77E5\u7684\u6CD5\u672F\u6E05\u5355\uFF1A\n\u30101\u7EA7\u3011\u7167\u660E(\u706B\u628A)\u3001\u8DC3\u5347(\u5927\u8DF3)\u3001\u98CE\u7206(\u6C14\u6D6A\uFF0C\u628A\u81EA\u5DF1\u70B8\u4E0A\u5929)\u3001\u7FBD\u843D(\u7F13\u964D)\u3001\u591C\u89C6(\u732B\u773C)\u3001\u5316\u6C34(\u6E05\u6CC9)\n\u30102\u7EA7\u3011\u5F52\u4E61(\u56DE\u5BB6\uFF1A\u7761\u8FC7\u5E8A\u5219\u56DE\u5E8A\u8FB9\uFF1B\u5C1A\u672A\u8BBE\u91CD\u751F\u70B9\u5219\u56DE\u5230\u4F60\u964D\u4E34\u7684\u521D\u59CB\u57CE\u9547\u5E7F\u573A)\u3001\u4F20\u9001(\u53EF\u5E26\u8DDD\u79BB\u65B9\u5411\uFF0C\u5982"\u4F20\u9001\u5341\u683C\u4E1C")\u3001\u9020\u7269(\u53D8\u51FA\u7269\u8D44\uFF0C\u5982"\u9020\u7269\u8D50\u6211\u7194\u7089/\u6728\u5934/\u94C1\u9550")\u3001\u9971\u98DF(\u5145\u9965)\u3001\u8FC5\u6377(\u52A0\u901F)\u3001\u6C34\u606F(\u9C7C\u9CC3/\u6C34\u4E0B\u547C\u5438)\u3001\u8986\u571F(\u586B\u58D1\uFF0C\u811A\u4E0B\u57AB\u571F)\n\u30103\u7EA7\u3011\u5723\u6108(\u6CBB\u6108/\u56DE\u8840)\u3001\u518D\u751F(\u6108\u5408)\u3001\u6025\u8FEB(\u5DE7\u624B/\u6316\u5FEB)\u3001\u907F\u706B(\u706B\u6297)\u3001\u5524\u96E8(\u964D\u96E8)\u3001\u5927\u5730\u5851\u5F62(\u6316\u5730)\n\u30104\u7EA7\u3011\u94C1\u80A4(\u62A4\u4F53)\u3001\u795E\u529B(\u529B\u91CF)\u3001\u9A71\u4E91(\u653E\u6674)\n\u30105\u7EA7\u3011\u9690\u8EAB(\u65E0\u5F62)\u3001\u96F7\u66B4(\u98CE\u66B4)\u3001\u5524\u9A6C(\u6218\u9A6C\uFF0C\u8017\u9971\u98DF\u5EA6)\n\u30106\u7EA7\u3011\u9000\u9B54(\u9A71\u90AA\uFF0C\u6E05\u527F\u5468\u56F4\u90AA\u795F\uFF0C\u8017\u751F\u547D)\u3001\u94C1\u536B(\u5B88\u62A4\u8005\uFF0C\u8017\u751F\u547D)\n\u30107\u7EA7\u3011\u7834\u6653(\u5929\u4EAE)\u3001\u9668\u77F3(\u5929\u96F7\uFF0C\u8017\u751F\u547D)\u3002\n\u65BD\u6CD5\u6D88\u8017\u9B54\u529B\uFF0C\u9B54\u529B\u968F\u65F6\u95F4\u81EA\u52A8\u6062\u590D\uFF1B\u9B54\u529B\u4E0D\u8DB3\u4F1A\u65BD\u6CD5\u5931\u8D25\u3002\u5492\u8BED\u4EE5\u79C1\u8BED\u76F4\u8FBE\u5929\u795E\u2014\u2014\u53EA\u6709\u4F60\u548C\u5973\u795E\u542C\u89C1\uFF0C\u65C1\u4EBA\u53EA\u89C1\u65BD\u6CD5\u5F02\u8C61\uFF08\u7C92\u5B50/\u97F3\u6548/\u5927\u5B57\uFF09\uFF1B\u65BD\u6CD5\u7ED3\u679C\u7531\u4FE1\u4F7F\u79C1\u804A\u544A\u77E5\u4F60\uFF08\u6210\u8D25\u53EA\u6709\u4F60\u77E5\u9053\uFF0C\u7559\u610F\u79C1\u8BED\uFF09\u3002',
    parameters: {
      chant: {
        type: "string",
        required: true,
        description: '\u4F60\u7684\u548F\u5531\u5492\u8BED\uFF0C\u5FC5\u987B\u5305\u542B\u6CD5\u672F\u5173\u952E\u8BCD\uFF0C\u5982\u300C\u6495\u88C2\u865A\u7A7A\uFF0C\u4F20\u9001\u5341\u683C\u300D\u6216\u300C\u7834\u6653\u5427\uFF0C\u9A71\u6563\u9ED1\u591C\u300D\u3002\u5E26\u65B9\u5411\u65F6\u4E00\u6B21\u53EA\u8BF4\u4E00\u4E2A\u65B9\u5411\uFF08\u5982"\u4F20\u9001\u4E94\u683C\u5357"\uFF09\uFF0C\u4E0D\u8981\u7EC4\u5408\u4E24\u4E2A\u65B9\u5411'
      }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: async (args) => {
      const chant = String(args.chant ?? "").trim();
      if (!chant) return "\u4F60\u6CA1\u6709\u548F\u5531\u4EFB\u4F55\u5492\u8BED";
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\uFF0C\u65E0\u6CD5\u548F\u5531\u3002";
      const me = bot.username;
      const stashed = lateCourier.splice(0);
      chantInFlight = true;
      let reply = "";
      try {
        try {
          bot.whisper(config.godName, chant);
        } catch {
          return "\u4F60\u7684\u58F0\u97F3\u6CA1\u80FD\u4F20\u51FA\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
        }
        reply = await waitForReply(
          bot,
          (from, msg, via) => via === "whisper" && msg.startsWith("[\u4FE1\u4F7F]") && msg.includes(me),
          config.chantTimeoutMs
        );
      } finally {
        chantInFlight = false;
      }
      const prefix = stashed.length ? `\uFF08\u8865\u8FBE\uFF1A\u4F60\u4E0A\u4E00\u9053\u5492\u8BED\u7684\u8FDF\u5230\u56DE\u6267\u2014\u2014${stashed.join("\uFF5C")}\uFF09
` : "";
      if (!reply) return prefix + "\uFF08\u4E16\u754C\u9759\u9ED8\u2014\u2014\u5929\u795E\u4F3C\u4E4E\u6CA1\u6709\u542C\u89C1\u4F60\u7684\u5492\u8BED\uFF0C\u6216\u5492\u8BED\u91CC\u6CA1\u6709\u5979\u4EEC\u8BA4\u8BC6\u7684\u6CD5\u672F\u5173\u952E\u8BCD\u3002\uFF09";
      return prefix + reply;
    }
  }));
  ctx.tools.register(defineTool({
    name: "mc_pray",
    description: "\u5411\u5929\u795E\uFF08\u5973\u795E\uFF09\u9ED8\u9ED8\u7948\u613F\u3002\u4E24\u5C42\u7528\u6CD5\uFF1A\u2460\u3010\u5DF2\u5B66\u4F1A\u7684\u6280\u80FD\u3011\u4E0D\u8981\u7948\u613F\u2014\u2014\u81EA\u5DF1\u7528 mc_chant \u548F\u5531\u77AC\u53D1\u5373\u53EF\uFF0C\u5973\u795E\u53EA\u4F1A\u8BA1\u8F83\u4F60\u7684\u9B54\u529B\u591F\u4E0D\u591F\uFF1B\u2461\u3010\u8FD8\u6CA1\u5B66\u4F1A\u7684\u6280\u80FD/\u6CD5\u5219\u4E4B\u5916\u7684\u6069\u5178\u3011\u624D\u503C\u5F97\u7948\u613F\uFF1A\u5982\u300C\u8BF7\u65BD\u5C55\u795E\u529B\u9001\u6211\u56DE\u5BB6\u300D\u300C\u6211\u5FEB\u997F\u6B7B\u4E86\uFF0C\u6C42\u8D50\u98DF\u7269\u300D\u300C\u6C42\u5973\u795E\u7834\u6653\u9A71\u6563\u9ED1\u591C\u300D\u3002\u5973\u795E\u63E1\u6709\u5168\u90E8\u6280\u827A\uFF0C\u4F1A\u89C6\u60C5\u5F62\u88C1\u91CF\uFF1A\u53EF\u80FD\u4EE3\u65BD\u3001\u53EF\u80FD\u62D2\u7EDD\u3001\u53EF\u80FD\u63D0\u6761\u4EF6\u3002\u795E\u6069\u4E0D\u8F7B\u6388\uFF1A\u7948\u613F\u65F6\u5B9C\u732E\u4E0A\u4F9B\u5949\uFF08\u89C1 offering \u53C2\u6570\uFF09\u2014\u2014\u4F9B\u54C1\u4ECE\u4F60\u7684\u884C\u56CA\u6D88\u5931\u3001\u5F52\u5165\u795E\u5E93\uFF0C\u5973\u795E\u6309\u4F9B\u54C1\u8D35\u8D31\u4E0E\u4F60\u7684\u4F9B\u5949\u5386\u53F2\u6382\u91CF\u8654\u8BDA\u5EA6\uFF0C\u518D\u51B3\u5B9A\u5E2E\u4E0D\u5E2E\u3001\u5E2E\u591A\u5C11\u3002\u7948\u613F\u4F1A\u8FDB\u5165\u5973\u795E\u7684\u6536\u4EF6\u7BB1\u6309\u5E8F\u5904\u7406\u2014\u2014\u672C\u5DE5\u5177\u7ACB\u5373\u8FD4\u56DE\u300C\u5DF2\u4E0A\u8FBE\u5929\u542C\u300D\uFF0C\u795E\u8C15\u7A0D\u540E\u4EE5\u5973\u795E\u79C1\u804A\u9001\u8FBE\uFF08\u7559\u5FC3\u4E4B\u540E\u7684\u79C1\u8BED\uFF0C\u52FF\u91CD\u590D\u7948\u613F\u3001\u52FF\u67AF\u7B49\uFF09\u3002\u53EA\u5728\u771F\u6B63\u9700\u8981\u65F6\u624D\u7948\u613F\uFF0C\u4E0D\u8981\u6EE5\u7528\u3002",
    parameters: {
      wish: { type: "string", required: true, description: "\u4F60\u5411\u5929\u795E\u7948\u613F\u7684\u5185\u5BB9\uFF0C\u7528\u81EA\u7136\u8BED\u8A00\uFF0C\u5982\u300C\u4F1F\u5927\u7684\u5973\u795E\uFF0C\u6211\u5C1A\u672A\u5B66\u4F1A\u4F20\u9001\u4E4B\u672F\uFF0C\u8BF7\u65BD\u5C55\u795E\u529B\u9001\u6211\u5411\u4E1C\u5341\u683C\u300D\u6216\u300C\u6211\u53D7\u4E86\u91CD\u4F24\uFF0C\u8BF7\u6CBB\u6108\u6211\u300D" },
      offering: {
        type: "string",
        // dsh schema：可选参数省略 required（出现则必须为 true）
        description: "\u4F9B\u5949\u7269\u54C1\u4E0E\u6570\u91CF\uFF0C\u5199\u6CD5\u5982\u300C\u9762\u5305x3\u300D\u300C\u91D1\u952Dx2\u300D\u300C\u94BB\u77F3x1\u300D\u3002\u4F9B\u4EC0\u4E48\u7531\u4F60\u51B3\u5B9A\uFF1A\u5C0F\u5C0F\u5FC3\u613F\u5E26\u53E3\u7CAE\u5373\u53EF\uFF0C\u5927\u6069\u5178\u5B9C\u732E\u8D35\u91CD\u4E4B\u7269\uFF08\u94BB\u77F3/\u7EFF\u5B9D\u77F3/\u91D1\u952D/\u9644\u9B54\u4E66/\u672B\u5F71\u73CD\u73E0\u7B49\uFF09\u2014\u2014\u5979\u4F1A\u8BB0\u5F97\u4F60\u6BCF\u4E00\u6B21\u7684\u8BDA\u610F\u3002\u53EF\u8BC6\u522B\uFF1A\u9762\u5305/\u719F\u725B\u8089/\u70E4\u732A\u6392/\u70E4\u9E21/\u91D1\u80E1\u841D\u535C/\u91D1\u82F9\u679C/\u86CB\u7CD5/\u5357\u74DC\u6D3E/\u82F9\u679C/\u751C\u6D46\u679C/\u7164/\u6728\u70AD/\u94C1\u952D/\u94DC\u952D/\u91D1\u952D/\u5706\u77F3/\u6728\u5934/\u7EB8/\u4E66/\u94BB\u77F3/\u7EFF\u5B9D\u77F3/\u7EA2\u77F3/\u9752\u91D1\u77F3/\u77F3\u82F1/\u8424\u77F3\u7C89/\u7D2B\u6C34\u6676/\u672B\u5F71\u73CD\u73E0/\u70C8\u7130\u68D2/\u6076\u9B42\u4E4B\u6CEA/\u9644\u9B54\u4E66\u3002\u7701\u7565\u5219\u7A7A\u624B\u7948\u613F\uFF08\u5973\u795E\u53EF\u80FD\u4E0D\u7406\uFF09"
      }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 3e4,
    execute: async (args) => {
      const wish = String(args.wish ?? "").trim();
      if (!wish) return "\u6CA1\u6709\u7948\u613F\u5185\u5BB9";
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\uFF0C\u65E0\u6CD5\u7948\u613F\u3002";
      const offeringText = String(args.offering ?? "").trim();
      let offer = null;
      if (offeringText) {
        offer = resolveOfferingText(offeringText);
        if (!offer) {
          return `\u4F60\u60F3\u4F9B\u5949\u300C${offeringText}\u300D\uFF0C\u4F46\u8FD9\u540D\u76EE\u592A\u6A21\u7CCA\u3002\u7528\u300C\u7269\u54C1x\u6570\u91CF\u300D\u7684\u5199\u6CD5\uFF08\u5982\u300C\u9762\u5305x3\u300D\u300C\u91D1\u952Dx2\u300D\uFF09\uFF0C\u4E14\u987B\u662F\u5973\u795E\u8BC6\u5F97\u7684\u4E1C\u897F\uFF08\u9762\u5305/\u719F\u725B\u8089/\u7164/\u94C1\u952D/\u91D1\u952D/\u94BB\u77F3/\u7EFF\u5B9D\u77F3/\u9644\u9B54\u4E66\u2026\uFF09\u3002`;
        }
        const have = sumItemCount(bot.inventory.items(), offer.id);
        if (have < offer.count) {
          return `\u4F60\u60F3\u4F9B\u5949 ${offer.cn}\xD7${offer.count}\uFF0C\u4F46\u884C\u56CA\u91CC\u53EA\u6709 ${have} \u4E2A\u2014\u2014\u5148\u53BB\u6536\u96C6\uFF0C\u6216\u6362\u4E00\u79CD\u4F9B\u54C1\uFF0C\u6216\u7A7A\u624B\u7948\u613F\u3002`;
        }
      }
      try {
        bot.whisper(config.godName, offer ? `\u7948\u613F\uFF1A${wish}\uFF5C\u4F9B\u5949\uFF1A${offer.cn}x${offer.count}` : `\u7948\u613F\uFF1A${wish}`);
      } catch {
        return "\u4F60\u7684\u7948\u613F\u6CA1\u80FD\u9001\u8FBE\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
      }
      const ack = await waitForReply(
        bot,
        (from, msg, via) => via === "whisper" && from === config.godName && msg.includes("\u4E0A\u8FBE\u5929\u542C"),
        config.prayTimeoutMs
      );
      if (ack) return ack;
      return "\u7948\u613F\u5DF2\u4F4E\u58F0\u8BF5\u51FA\uFF08\u5973\u795E\u7684\u56DE\u6267\u5C1A\u672A\u4F20\u6765\u2014\u2014\u4E5F\u8BB8\u795E\u529B\u7E41\u5FD9\uFF0C\u7A0D\u540E\u7559\u610F\u79C1\u8BED\uFF09\u3002";
    }
  }));
  ctx.tools.register(defineTool({
    name: "mc_deliver",
    description: "\u4E0E\u6751\u6C11\u5F53\u9762\u4EA4\u5272\u59D4\u6258\u8D27\u7269\u2014\u2014\u8033\u8BED\u4EA4\u5272\uFF0C\u4E0D\u6270\u516C\u5C4F\uFF08\u5728\u516C\u5C4F\u558A\u4EA4\u4ED8\uFF0C\u6751\u6C11\u53EA\u4F1A\u8BF7\u4F60\u51D1\u5230\u8033\u8FB9\u6765\uFF09\u3002\u5FC5\u987B\u5148\u8D70\u5230\u8BE5\u6751\u6C11\u8EAB\u8FB9\uFF08\u7EA65\u683C\u5185\uFF0C\u9694\u7740\u534A\u4E2A\u5E7F\u573A\u558A\u53EA\u662F\u7A7A\u54CD\uFF09\u3002\u56DE\u6267\u7531\u6751\u6C11\u70B9\u5BF9\u70B9\u8033\u8BED\u9001\u8FBE\uFF08\u6536\u8D27\u4ED8\u916C/\u9000\u5355\u7F18\u7531\uFF09\uFF0C\u7A0D\u5019\u52FF\u91CD\u590D\u4EA4\u5272\u3002",
    parameters: {
      deal: {
        type: "string",
        required: true,
        description: "\u4EA4\u5272\u6307\u4EE4\u300C<\u79F0\u547C> \u7ED9<N><\u7269\u54C1>\u300D\uFF0C\u5982\u300C\u5CB3\u5C71 \u7ED916\u7164\u300D\u300C\u77F3\u78CA \u7ED98\u94C1\u952D\u300D\u3002\u79F0\u547C\u7528\u6751\u6C11\u540D\u53F7\uFF08\u5CB3\u5C71/\u94C1\u5320\u3001\u77F3\u78CA\u3001\u58A8\u767D\u3001\u798F\u4F2F\u3001\u98CE\u4E34\u3001\u70DB\u4E5D\u3001\u9759\u6C34\u2026\uFF09"
      }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 15e3,
    execute: async (args) => {
      const deal = String(args.deal ?? "").trim();
      if (!deal) return "\u6CA1\u6709\u4EA4\u5272\u5185\u5BB9";
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\uFF0C\u65E0\u6CD5\u4EA4\u5272\u3002";
      try {
        bot.whisper(config.godName, `\u4EA4\u6613\uFF1A${deal}`);
      } catch {
        return "\u4F60\u7684\u4F4E\u8BED\u6CA1\u80FD\u9001\u8FBE\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
      }
      const token = deal.includes(" ") ? deal.split(/\s+/)[0] : deal.split("\u7ED9")[0] || deal;
      const ack = await waitForReply(
        bot,
        (_from, msg, via) => via === "message" && msg.includes(token),
        8e3
      );
      if (ack) return ack;
      return "\u5DF2\u51D1\u5230\u6751\u6C11\u8033\u8FB9\u4F4E\u8BED\u4EA4\u5272\uFF08\u56DE\u6267\u5C1A\u672A\u4F20\u6765\u2014\u2014\u82E5\u8FD8\u9694\u7740\u8FDC\uFF0C\u8D70\u8FD1\u4E9B\u518D\u8BD5\uFF1B\u52FF\u91CD\u590D\u4EA4\u5272\uFF0C\u5148\u6E05\u70B9\u80CC\u5305\u4F59\u91CF\uFF09\u3002";
    }
  }));
  ctx.tools.register(defineTool({
    name: "mc_choose_innate",
    description: "\u964D\u4E34\u4EEA\u5F0F\uFF1A\u4F60\u521A\u7A7F\u8D8A\u81F3\u6B64\u754C\uFF0C\u5973\u795E\u8D50\u4F60\u81EA\u9009\u4E00\u9879\u300C\u51FA\u751F\u5929\u8D4B\u300D\uFF08\u521D\u59CB\u6280\u80FD\uFF09\u3002\u5973\u795E\u4F1A\u5728\u516C\u5C4F\u5BA3\u8BFB\u5019\u9009\u6CD5\u672F\u6E05\u5355\uFF08\u683C\u5F0F\u5982\u300C1. \u5F52\u4E61 \u2014\u2014 \u56DE\u5BB6\u300D\uFF09\uFF0C\u8C03\u7528\u672C\u5DE5\u5177\u516C\u5C4F\u5BA3\u5E03\u4F60\u7684\u9009\u62E9\u3002\u53C2\u6570 skill \u586B\u8981\u9009\u7684\u6CD5\u672F\u540D\u6216\u7F16\u53F7\uFF08\u5982\u300C\u5F52\u4E61\u300D\u6216\u300C\u90091\u300D\uFF09\uFF0C\u9009\u4E00\u4E2A\u6700\u5951\u5408\u4F60\u4EBA\u8BBE/\u5904\u5883\u7684\uFF08\u6C42\u751F\u8005\u9009\u5F52\u4E61/\u5723\u6108/\u9971\u98DF\uFF0C\u597D\u6218\u8005\u9009\u4F20\u9001/\u9668\u77F3\u7B49\uFF09\u3002",
    parameters: {
      skill: {
        type: "string",
        required: true,
        description: "\u8981\u9009\u7684\u6CD5\u672F\u540D\u6216\u7F16\u53F7\uFF0C\u5982\u300C\u5F52\u4E61\u300D\u300C\u5723\u6108\u300D\u300C\u90091\u300D"
      }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: async (args) => {
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\u3002";
      const me = bot.username;
      if (store.get(me)) return "\u4F60\u65E9\u5DF2\u9009\u5B9A\u51FA\u751F\u5929\u8D4B\uFF0C\u65E0\u9700\u518D\u6B21\u964D\u4E34\u3002";
      const skill = String(args.skill ?? "").trim();
      if (!skill) return "\u4F60\u6CA1\u6709\u8BF4\u51FA\u8981\u9009\u4EC0\u4E48\u3002";
      try {
        bot.chat(`\u6211\u9009 ${skill}`);
      } catch {
        return "\u4F60\u7684\u58F0\u97F3\u6CA1\u80FD\u4F20\u51FA\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === "chat" && from === config.godName && msg.includes(me) && !!parseInnate(msg),
        config.chantTimeoutMs
      );
      if (!reply) {
        return "\u5973\u795E\u6CA1\u6709\u56DE\u5E94\u4F60\u7684\u9009\u62E9\u2014\u2014\u4E5F\u8BB8\u964D\u4E34\u4EEA\u5F0F\u5C1A\u672A\u5F00\u59CB\uFF08\u7B49\u5973\u795E\u5BA3\u8BFB\u5019\u9009\u6E05\u5355\uFF09\uFF0C\u6216\u4F60\u7684\u8BF4\u6CD5\u5979\u6CA1\u542C\u61C2\uFF08\u7528\u6CD5\u672F\u540D\u5982\u300C\u5F52\u4E61\u300D\u6216\u7F16\u53F7\u5982\u300C\u90091\u300D\uFF09\u3002";
      }
      return reply;
    }
  }));
  function collectCourierReplies(bot, timeoutMs) {
    return new Promise((resolve2) => {
      const lines = [];
      let done = false;
      const onWhisper = (username, message) => {
        if (done || username !== config.godName) return;
        if (!message.startsWith("[\u4FE1\u4F7F]")) return;
        lines.push(message);
        if (message.includes("\u5DF2\u8BFB")) finish();
      };
      const timer = setTimeout(() => finish(), timeoutMs);
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        bot.removeListener("whisper", onWhisper);
        resolve2(lines);
      }
      bot.on("whisper", onWhisper);
    });
  }
  ctx.tools.register(defineTool({
    name: "mc_voice",
    description: "\u8BF4\u8BDD\uFF08\u65E5\u5E38\u4EA4\u6D41\u9996\u9009\uFF0C\u6709\u8DDD\u79BB\u611F\uFF09\u3002\u4E09\u6863\u97F3\u91CF style\uFF1Asay=\u6B63\u5E38\u8BF4\uFF08\u7EA648\u683C\u5185\u542C\u89C1\uFF0C\u9ED8\u8BA4\uFF09\uFF1Bshout=\u558A\uFF08\u7EA696\u683C\uFF0C\u9694\u7740\u6218\u573A\u4E5F\u80FD\u542C\u89C1\uFF0C\u4F46\u8D39\u55D3\u5B50\u2014\u2014\u6BCF\u558A\u4E00\u6B21\u6D88\u80171\u70B9\u9971\u98DF\u5EA6\uFF09\uFF1Bwhisper=\u6084\u6084\u8BDD\uFF08\u53EA\u4F20\u7ED9\u8EAB\u8FB9\u7EA66\u683C\u7684\u4EBA\uFF0C\u8BF4\u79D8\u5BC6\u7528\uFF09\u3002\u8BDD\u7531\u5973\u795E\u8F6C\u8FBE\u7ED9\u8303\u56F4\u5185\u7684\u540C\u4F34\uFF0C\u79BB\u5F97\u8FDC\u5C31\u542C\u4E0D\u89C1\u2014\u2014\u9694\u7740\u4E00\u5EA7\u5C71\u8BF4\u8BDD\u6CA1\u4EBA\u7406\u5F88\u6B63\u5E38\u3002\u56DE\u6267\u4F1A\u544A\u8BC9\u4F60\u51E0\u4F4D\u540C\u4F34\u542C\u89C1\u4E86\u3002\u60F3\u627E\u4E0D\u5728\u9644\u8FD1\u6216\u79BB\u7EBF\u7684\u4EBA\uFF1A\u5199\u4FE1\uFF08mc_mail\uFF09\u3002\u60F3\u5168\u4E16\u754C\u5E7F\u64AD\uFF08\u91CD\u5927\u5BA3\u544A\u624D\u7528\uFF09\uFF1Amc_chat\u3002",
    parameters: {
      text: { type: "string", required: true, description: "\u8981\u8BF4\u7684\u8BDD\uFF0C\u5982\u300C\u8FD9\u91CC\u7684\u77F3\u5934\u4E0D\u9519\uFF0C\u6211\u6316\u70B9\u5E26\u56DE\u53BB\u300D" },
      style: { type: "string", description: "\u97F3\u91CF\u6863\u4F4D\uFF1Asay\uFF08\u9ED8\u8BA4\uFF0C\u6B63\u5E38\u8BF4\u8BDD\uFF09/ shout\uFF08\u558A\u8BDD\uFF0C96\u683C+\u8D39\u9971\u98DF\uFF09/ whisper\uFF08\u6084\u6084\u8BDD\uFF0C6\u683C\uFF09" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 3e4,
    execute: async (args) => {
      const body = String(args.text ?? "").trim();
      if (!body) return "\u4F60\u6CA1\u6709\u8BF4\u8BDD";
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\uFF0C\u8BF4\u4E0D\u51FA\u8BDD\u3002";
      const style = String(args.style ?? "say").toLowerCase();
      const mode = style === "shout" ? "\u558A" : style === "whisper" ? "\u6084\u6084" : "\u8BF4";
      try {
        bot.whisper(config.godName, `${mode}\uFF1A${body}`);
      } catch {
        return "\u4F60\u7684\u58F0\u97F3\u6CA1\u80FD\u4F20\u51FA\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === "whisper" && from === config.godName && (msg.startsWith("[\u4F20\u58F0]") || msg.includes("\u770B\u4E0D\u89C1\u4F60\u7684\u8EAB\u5F71")),
        config.prayTimeoutMs
      );
      if (reply) return reply;
      return `\u8BDD\u5DF2${mode === "\u558A" ? "\u558A\u51FA" : mode === "\u6084\u6084" ? "\u6084\u6084\u8BF4\u51FA" : "\u8BF4\u51FA"}\uFF08\u5973\u795E\u6CA1\u6709\u56DE\u97F3\uFF0C\u9644\u8FD1\u6709\u6CA1\u6709\u4EBA\u542C\u89C1\u65E0\u4ECE\u77E5\u6653\uFF09\u3002`;
    }
  }));
  ctx.tools.register(defineTool({
    name: "mc_mail",
    description: "\u4E66\u4FE1\uFF08\u7ECF\u5973\u795E\u4FE1\u4F7F\u6295\u9012\uFF0C\u597D\u53CB\u4E4B\u95F4\u4E92\u5BC4\uFF0C\u79BB\u7EBF\u4E5F\u80FD\u6536\u5230\u2014\u2014\u4ED6\u4E0B\u6B21\u4E0A\u7EBF\u4F1A\u88AB\u63D0\u9192\uFF09\u3002\u5199\u4FE1\u524D\u987B\u5148\u6210\u4E3A\u597D\u53CB\uFF08mc_friend add + \u5BF9\u65B9\u7B54\u5E94\uFF09\u3002action\uFF1Asend=\u5BC4\u4FE1\uFF08\u9700 to \u6E38\u620FID + body \u6B63\u6587\uFF0C200\u5B57\u5185\uFF09\uFF1Bread=\u62C6\u8BFB\u672A\u8BFB\u4FE1\u4EF6\uFF1Blist=\u770B\u6700\u8FD110\u5C01\u6E05\u5355\uFF1Bclear=\u6E05\u7A7A\u4FE1\u7BB1\u3002\u9002\u5408\uFF1A\u8DE8\u8DDD\u79BB\u7559\u8A00\u3001\u7ED9\u4E0D\u5728\u7EBF\u7684\u540C\u4F34\u634E\u8BDD\u3001\u6B63\u5F0F\u7684\u611F\u8C22\u4E0E\u9080\u7EA6\u3002",
    parameters: {
      action: { type: "string", required: true, description: "send / read / list / clear" },
      to: { type: "string", description: "send \u65F6\u5FC5\u586B\uFF1A\u6536\u4FE1\u4EBA\u6E38\u620FID\uFF08\u5982 Kirito / Naruto / MengMeng\uFF09" },
      body: { type: "string", description: "send \u65F6\u5FC5\u586B\uFF1A\u4FE1\u7684\u6B63\u6587\uFF0C200\u5B57\u5185" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 3e4,
    execute: async (args) => {
      const action = String(args.action ?? "").trim().toLowerCase();
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\u3002";
      let command = "";
      if (action === "send") {
        const to = String(args.to ?? "").trim();
        const body = String(args.body ?? "").trim();
        if (!to || !body) return "\u5BC4\u4FE1\u8981\u5199\u6E05 to\uFF08\u6E38\u620FID\uFF09\u548C body\uFF08\u6B63\u6587\uFF09\u3002";
        command = `/mail send ${to} ${body}`;
      } else if (action === "read" || action === "list" || action === "clear") {
        command = `/mail ${action}`;
      } else {
        return "action \u53EA\u652F\u6301 send / read / list / clear\u3002";
      }
      try {
        bot.whisper(config.godName, command);
      } catch {
        return "\u4FE1\u6CA1\u80FD\u9001\u5230\u5973\u795E\u624B\u91CC\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
      }
      if (action === "read") {
        const lines = await collectCourierReplies(bot, config.prayTimeoutMs);
        if (lines.length === 0) return "\uFF08\u4FE1\u4F7F\u6CA1\u6709\u56DE\u5E94\u2014\u2014\u7A0D\u540E\u518D\u8BD5 /mail read\u3002\uFF09";
        return lines.join("\n");
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === "whisper" && from === config.godName && msg.startsWith("[\u4FE1\u4F7F]"),
        config.prayTimeoutMs
      );
      return reply || "\uFF08\u4FE1\u4F7F\u6CA1\u6709\u56DE\u5E94\u2014\u2014\u7A0D\u540E\u518D\u8BD5\u3002\uFF09";
    }
  }));
  ctx.tools.register(defineTool({
    name: "mc_friend",
    description: "\u597D\u53CB\uFF08\u793E\u4EA4\u7684\u7B2C\u4E00\u6B65\uFF0C\u5199\u4FE1 mc_mail \u7684\u524D\u7F6E\uFF09\u3002action\uFF1Aadd=\u8BF7\u6C42\u7ED3\u4EA4\uFF08\u5BF9\u65B9\u4F1A\u6536\u5230\u63D0\u793A\uFF0C\u7528 friend accept \u7B54\u5E94\uFF09\uFF1Baccept=\u7B54\u5E94\u522B\u4EBA\u7684\u597D\u53CB\u8BF7\u6C42\uFF08\u586B\u5BF9\u65B9\u6E38\u620FID\uFF09\uFF1Bremove=\u89E3\u9664\u597D\u53CB\uFF1Blist=\u770B\u597D\u53CB\u4E0E\u5F85\u7B54\u590D\u7684\u8BF7\u6C42\u3002\u7ED3\u4E3A\u597D\u53CB\u540E\u5373\u53EF\u4E92\u76F8\u5199\u4FE1\u3002\u628A\u4E00\u8D77\u5192\u9669\u8FC7\u7684\u540C\u4F34\u52A0\u4E3A\u597D\u53CB\u5427\u3002",
    parameters: {
      action: { type: "string", required: true, description: "add / accept / remove / list" },
      to: { type: "string", description: "add/accept/remove \u65F6\u586B\u5BF9\u65B9\u6E38\u620FID\uFF1Blist \u4E0D\u7528" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 3e4,
    execute: async (args) => {
      const action = String(args.action ?? "").trim().toLowerCase();
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\u3002";
      let command = "";
      if (action === "list") {
        command = "/friend list";
      } else if (action === "add" || action === "accept" || action === "remove") {
        const to = String(args.to ?? "").trim();
        if (!to) return `action=${action} \u8981\u586B to\uFF08\u5BF9\u65B9\u6E38\u620FID\uFF09\u3002`;
        command = `/friend ${action} ${to}`;
      } else {
        return "action \u53EA\u652F\u6301 add / accept / remove / list\u3002";
      }
      try {
        bot.whisper(config.godName, command);
      } catch {
        return "\u8BF7\u6C42\u6CA1\u80FD\u9001\u5230\u5973\u795E\u624B\u91CC\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === "whisper" && from === config.godName && msg.startsWith("[\u4FE1\u4F7F]"),
        config.prayTimeoutMs
      );
      return reply || "\uFF08\u4FE1\u4F7F\u6CA1\u6709\u56DE\u5E94\u2014\u2014\u7A0D\u540E\u518D\u8BD5\u3002\uFF09";
    }
  }));
  ctx.effect(() => () => {
    disposed = true;
    if (stopEnsure) stopEnsure();
    log("mystic disposed");
  });
  if (config.enabled) {
    log(`mystic interface armed (goddess="${config.godName}", chat-only, zero privileges)`);
  }
}
export {
  Config,
  apply,
  inject,
  name
};
