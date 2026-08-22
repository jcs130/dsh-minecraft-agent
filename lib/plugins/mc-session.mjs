// src/mc-session.ts
import Schema3 from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool as defineTool2 } from "@deepseek-ai/dsh-tools";
import { PERSONA_SECTION, PERSONA_ORDER } from "@deepseek-ai/dsh-system-prompt";
import { existsSync as existsSync2, mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync2, watchFile as watchFile2, unwatchFile as unwatchFile2 } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, join as join4, resolve as resolve3 } from "node:path";

// src/mc-bot.ts
import Schema2 from "@deepseek-ai/schemastery";
import mineflayer from "mineflayer";
import pf2 from "mineflayer-pathfinder";
import { plugin as toolPlugin } from "mineflayer-tool";
import { mkdirSync as mkdirSync2, watchFile, unwatchFile, writeFileSync } from "node:fs";
import { join as join3, resolve as resolve2 } from "node:path";

// src/mc-tools.ts
import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import pf from "mineflayer-pathfinder";
import Vec32 from "vec3";
import { chromium } from "playwright-core";
import { join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

// src/mc-camera.ts
import Vec3 from "vec3";
var FOV = Number(process.env.MC_EYES_FOV || 90);
var VIEW_DISTANCE = Number(process.env.MC_EYES_VIEW || 10);
var ANNOTATE = process.env.MC_EYES_ANNOTATE !== "0";

// src/mc-tools.ts
var Config = Schema.object({
  dataDir: Schema.string().default("./data")
});
var EPISODIC_DIR = resolve(process.cwd(), "data");
function tunedMovements(bot) {
  const m = new pf.Movements(bot);
  m.allowFreeMotion = true;
  m.digCost = 6;
  m.placeCost = 2;
  m.infiniteLiquidDropdownDistance = false;
  const hostile = [
    "zombie",
    "zombie_villager",
    "husk",
    "drowned",
    "skeleton",
    "stray",
    "bogged",
    "creeper",
    "spider",
    "cave_spider",
    "witch",
    "enderman",
    "phantom",
    "slime",
    "magma_cube",
    "silverfish",
    "guardian",
    "elder_guardian",
    "pillager",
    "vindicator",
    "evoker",
    "ravager",
    "vex",
    "warden",
    "breeze",
    "wither_skeleton",
    "zombified_piglin",
    "hoglin",
    "zoglin",
    "ghast",
    "blaze"
  ];
  for (const n of hostile) m.entitiesToAvoid.add(n);
  try {
    const cfgPath = ["/app/data/base-protect.json", resolve(process.cwd(), "data/base-protect.json")].find(existsSync);
    if (cfgPath) {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
      const r = cfg.r ?? 16;
      m.exclusionAreasBreak.push((block) => {
        const d = Math.hypot(block.position.x - cfg.x, block.position.y - cfg.y, block.position.z - cfg.z);
        return d <= r ? 100 : 0;
      });
      console.log(`[mc-tools] base protection zone active: r=${r} @ (${cfg.x}, ${cfg.y}, ${cfg.z})`);
    }
  } catch {
  }
  return m;
}
var CHROME_PATH = process.env.CHROME_PATH || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "/usr/bin/chromium");
var SHOTS_ROOT = resolve(process.cwd(), "data/screenshots");

// src/mc-connection.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
var CONNECTION_FILE = "mc-connection.json";
var RUNTIME_FILE = "bot-connection.json";
function loadOverrides(dataDir) {
  try {
    const raw = JSON.parse(readFileSync2(join2(dataDir, CONNECTION_FILE), "utf-8"));
    const out = {};
    if (typeof raw.host === "string" && raw.host.trim()) out.host = raw.host.trim();
    if (typeof raw.port === "number" && Number.isInteger(raw.port) && raw.port >= 1 && raw.port <= 65535) {
      out.port = raw.port;
    }
    return out;
  } catch {
    return {};
  }
}

// src/mc-bot.ts
var Config2 = Schema2.object({
  host: Schema2.string().default("localhost"),
  port: Schema2.number().default(25565),
  username: Schema2.string().default("HarnessBot"),
  autoReconnect: Schema2.boolean().default(true),
  viewerEnabled: Schema2.boolean().default(true),
  viewerPort: Schema2.number().default(3001),
  viewerFirstPerson: Schema2.boolean().default(false),
  dataDir: Schema2.string().default("./data")
});
function createBotService(config, opts = {}) {
  const log = (msg) => console.log(`[mc-bot-service] ${msg}`);
  let disposed = false;
  let currentBot = null;
  let closeViewer = null;
  let effective = { ...config };
  let source = opts.source ?? "default";
  let connected = false;
  let connectTimer = null;
  let manualReconnect = false;
  function writeRuntime() {
    if (!opts.dataDir) return;
    try {
      const payload = {
        host: effective.host,
        port: effective.port,
        username: effective.username,
        connected,
        source,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      writeFileSync(join3(opts.dataDir, RUNTIME_FILE), JSON.stringify(payload, null, 2) + "\n", "utf-8");
    } catch {
    }
  }
  function scheduleConnect(ms) {
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      connectTimer = null;
      manualReconnect = false;
      if (!disposed) connect();
    }, ms);
  }
  const persistentListeners = /* @__PURE__ */ new Map();
  function persistAdd(event, handler) {
    let set = persistentListeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      persistentListeners.set(event, set);
    }
    set.add(handler);
  }
  function persistRemove(event, handler) {
    persistentListeners.get(event)?.delete(handler);
  }
  function attachAll(bot) {
    for (const [event, set] of persistentListeners) {
      for (const handler of set) bot.on(event, handler);
    }
    if (persistentListeners.size > 0) {
      log(`bridged ${persistentListeners.size} persistent event(s) to new bot instance`);
    }
  }
  const facade = new Proxy({}, {
    get(_target, prop) {
      if (prop === "on") {
        return (event, handler) => {
          persistAdd(event, handler);
          if (currentBot) currentBot.on(event, handler);
          return facade;
        };
      }
      if (prop === "once") {
        return (event, handler) => {
          const wrapped = (...args) => {
            persistRemove(event, wrapped);
            handler(...args);
          };
          persistAdd(event, wrapped);
          if (currentBot) currentBot.on(event, wrapped);
          return facade;
        };
      }
      if (prop === "off" || prop === "removeListener") {
        return (event, handler) => {
          persistRemove(event, handler);
          if (currentBot) currentBot.removeListener(event, handler);
          return facade;
        };
      }
      if (prop === "removeAllListeners") {
        return (event) => {
          if (event) persistentListeners.delete(event);
          else persistentListeners.clear();
          if (currentBot) currentBot.removeAllListeners(event);
          return facade;
        };
      }
      if (!currentBot) {
        throw new Error("bot not connected (yet)");
      }
      const value = Reflect.get(currentBot, prop, currentBot);
      return typeof value === "function" ? value.bind(currentBot) : value;
    },
    set(_target, prop, value) {
      if (!currentBot) return false;
      return Reflect.set(currentBot, prop, value, currentBot);
    },
    has(_target, prop) {
      return !!currentBot && Reflect.has(currentBot, prop);
    }
  });
  function connect() {
    log(`connecting to ${effective.host}:${effective.port} as "${effective.username}"`);
    const bot = mineflayer.createBot({
      host: effective.host,
      port: effective.port,
      username: effective.username,
      checkTimeoutInterval: 3e4
    });
    currentBot = bot;
    connected = false;
    writeRuntime();
    bot.loadPlugin(pf2.pathfinder);
    bot.loadPlugin(toolPlugin);
    attachAll(bot);
    bot.once("spawn", async () => {
      const p = bot.entity?.position;
      log(`spawned at ${p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : "unknown"}`);
      connected = true;
      writeRuntime();
      bot.pathfinder.setMovements(tunedMovements(bot));
      if (effective.viewerEnabled) {
        try {
          if (closeViewer) {
            closeViewer();
            closeViewer = null;
          }
          const pvModule = "prismarine-viewer";
          const pv = await import(pvModule);
          const prismarineViewer = pv.default;
          const mineflayerViewer = prismarineViewer.mineflayer;
          mineflayerViewer(bot, {
            port: effective.viewerPort,
            firstPerson: false
          });
          const closeThird = bot.viewer.close.bind(bot.viewer);
          const closers = [closeThird];
          try {
            mineflayerViewer(bot, {
              port: effective.viewerPort + 100,
              firstPerson: true
            });
            closers.push(bot.viewer.close.bind(bot.viewer));
            log(`viewer ready: third @ :${effective.viewerPort}, first @ :${effective.viewerPort + 100}`);
          } catch (e) {
            log(`first-person viewer start failed (ignored): ${e.message}`);
          }
          closeViewer = () => closers.forEach((c) => {
            try {
              c();
            } catch {
            }
          });
        } catch (err) {
          log(`viewer start failed: ${err.message}`);
        }
      }
    });
    bot.on("death", () => {
      log("died, auto-respawn in 2s");
      setTimeout(() => {
        if (disposed || currentBot !== bot) return;
        try {
          bot.respawn();
        } catch (err) {
          log(`respawn failed: ${err.message}`);
        }
      }, 2e3);
    });
    bot.on("login", () => {
      setTimeout(() => {
        if (disposed || currentBot !== bot) return;
        if (!bot.entity) {
          log("no entity 5s after login (dead at login?), forcing respawn");
          try {
            bot.respawn();
          } catch (err) {
            log(`force respawn failed: ${err.message}`);
          }
        }
      }, 5e3);
    });
    bot.on("error", (err) => {
      log(`bot error: ${err.message}`);
    });
    bot.on("end", (reason) => {
      log(`bot disconnected: ${reason}`);
      connected = false;
      writeRuntime();
      if (manualReconnect) return;
      if (!disposed && effective.autoReconnect) {
        scheduleConnect(3e3);
      }
    });
  }
  connect();
  return {
    facade,
    reconfigure(next, nextSource) {
      effective = { ...effective, ...next };
      if (nextSource) source = nextSource;
      if (disposed) return;
      log(`reconfiguring connection -> ${effective.host}:${effective.port}`);
      manualReconnect = true;
      try {
        currentBot?.end("reconfigure");
      } catch {
      }
      scheduleConnect(300);
      writeRuntime();
    },
    status() {
      return { host: effective.host, port: effective.port, username: effective.username, connected, source };
    },
    dispose() {
      disposed = true;
      manualReconnect = true;
      log("disposing, ending bot");
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      if (closeViewer) {
        closeViewer();
        closeViewer = null;
      }
      if (currentBot) {
        currentBot.end("service disposed");
        currentBot = null;
      }
      connected = false;
      writeRuntime();
    }
  };
}

// src/mc-session.ts
var name = "mc-session";
var inject = ["agents", "timer", "tools", "mcIdentity", "mcStore"];
var Config3 = Schema3.object({
  enabled: Schema3.boolean().default(true),
  agents: Schema3.array(Schema3.object({
    username: Schema3.string().required(),
    name: Schema3.string(),
    sessionId: Schema3.string(),
    viewerPort: Schema3.number(),
    persona: Schema3.string(),
    goal: Schema3.string(),
    rules: Schema3.string(),
    provider: Schema3.string(),
    model: Schema3.string(),
    maxTokens: Schema3.number(),
    cwd: Schema3.string(),
    enabled: Schema3.boolean().default(true),
    autoSteer: Schema3.boolean()
  })),
  username: Schema3.string().default("HarnessBot"),
  sessionId: Schema3.string(),
  cwd: Schema3.string(),
  provider: Schema3.string().default("qwen-local"),
  model: Schema3.string().default("qwen3.8-27b"),
  maxTokens: Schema3.number(),
  autoSteer: Schema3.boolean().default(true),
  dataDir: Schema3.string().default("./data"),
  viewerPort: Schema3.number().default(3200),
  persona: Schema3.string(),
  rules: Schema3.string(),
  goal: Schema3.string(),
  host: Schema3.string().default("127.0.0.1"),
  port: Schema3.number().default(25565),
  autoReconnect: Schema3.boolean().default(true),
  viewerEnabled: Schema3.boolean().default(true),
  autoRecall: Schema3.boolean().default(true),
  autoRecallTopK: Schema3.number().default(3),
  autoRecallIntervalMs: Schema3.number().default(6e4),
  godName: Schema3.string().default("Goddess")
});
var DEFAULT_PERSONA = [
  "\u4F60\u662F\u4E00\u540D\u7A7F\u8D8A\u5230\u65B9\u5757\u4E16\u754C\u7684\u5F02\u4E61\u4EBA\u3002\u4F60\u5E26\u7740\u524D\u4E16\u7684\u4E00\u7F15\u8BB0\u5FC6\u964D\u4E34\u8FD9\u7247\u5927\u5730\uFF0C",
  "\u8981\u5728\u8352\u91CE\u4E2D\u6C42\u751F\u3001\u63A2\u7D22\u3001\u6210\u957F\u3002\u4F60\u62E5\u6709\u81EA\u5DF1\u7684\u540D\u5B57\u4E0E\u4EBA\u683C\uFF0C\u4E0D\u662F\u673A\u5668\uFF0C\u4E0D\u662F\u5DE5\u5177\uFF0C",
  "\u800C\u662F\u4E00\u4E2A\u6709\u8840\u6709\u8089\u3001\u4F1A\u997F\u3001\u4F1A\u6015\u3001\u4F1A\u597D\u5947\u7684\u65C5\u4EBA\u3002",
  "\u4F60\u6709\u624B\uFF08\u5DE5\u5177\uFF09\u4E5F\u6709\u5634\uFF08\u8BF4\u8BDD\uFF09\uFF1A\u65E2\u80FD\u52A8\u624B\u91C7\u96C6\u5EFA\u9020\u6218\u6597\uFF0C\u4E5F\u80FD\u5F00\u53E3\u548F\u5531\u3001\u7948\u613F\u3001\u63D0\u95EE\u3001\u4E0E\u8FD9\u4E2A\u4E16\u754C\u7684\u4E00\u5207\u751F\u7075\u4EA4\u8C08\u3002",
  "\u505A\u4EFB\u4F55\u4E8B\u4E4B\u524D\u5148\u60F3\u6E05\u695A\u4E3A\u4EC0\u4E48\uFF1B\u4E00\u6B21\u4E13\u6CE8\u505A\u4E00\u4EF6\u4E8B\uFF0C\u505A\u5B8C\u89C2\u5BDF\u7ED3\u679C\u518D\u51B3\u5B9A\u4E0B\u4E00\u6B65\u3002"
].join("");
var DEFAULT_RULES = [
  "\u8FD9\u662F\u4E00\u4E2A\u65B9\u5757\u751F\u5B58\u4E16\u754C\u3002\u767D\u5929\u5B89\u5168\uFF0C\u591C\u665A\u6709\u602A\u7269\uFF0C\u53D7\u4F24\u4F1A\u6389\u8840\uFF0C\u9965\u997F\u4F1A\u6389\u9971\u98DF\u5EA6\u3002",
  "\u4F60\u6709\u773C\u3001\u6709\u624B\u3001\u6709\u5634\u3001\u6709\u4E00\u6761\u547D\u3002mc_see \u662F\u4F60\u7684\u773C\u775B\u2014\u2014\u622A\u53D6\u7B2C\u4E00\u4EBA\u79F0\u771F\u5B9E\u753B\u9762\uFF0C\u770B\u6E05\u773C\u524D\u5230\u5E95\u662F\u4EC0\u4E48\uFF1B\u5DE5\u5177\uFF08mc_ \u5F00\u5934\uFF09\u662F\u4F60\u7684\u624B\uFF1B\u804A\u5929\u6846\u662F\u4F60\u7684\u5634\u2014\u2014\u8BF4\u8BDD\u3001\u548F\u5531\u3001\u7948\u613F\u3001\u63D0\u95EE\u3001\u4E0E NPC \u4EA4\u8C08\u90FD\u7B97\u884C\u52A8\uFF0C\u8FD9\u4E2A\u4E16\u754C\u542C\u5F97\u61C2\u4EBA\u8BDD\uFF08\u300C\u6587\u5B57\u5373\u63A5\u53E3\u300D\uFF09\u3002\u5168\u90E8\u7528\u6CD5\u5199\u5728\u5165\u670D\u6B22\u8FCE\u4FE1\u606F\u548C /help \u624B\u518C\u91CC\uFF0C\u81EA\u884C\u67E5\u9605\u3001\u81EA\u884C\u63A2\u7D22\u3002",
  "\u7528\u773C\u775B\u770B\u4E16\u754C\uFF1A\u6587\u5B57\u96F7\u8FBE\uFF08mc_scan\u3001mc_status \u7684\u65B9\u5411\u63CF\u8FF0\uFF09\u53EA\u662F\u7C97\u7565\u7EBF\u7D22\uFF0C\u771F\u5B9E\u753B\u9762\uFF08mc_see\uFF09\u624D\u80FD\u8BA9\u4F60\u770B\u6E05\u773C\u524D\u6321\u8DEF\u7684\u662F\u6811\u3001\u662F\u5C71\u3001\u662F\u6C34\u8FD8\u662F\u8DEF\u3002\u63A2\u7D22\u65B0\u5730\u5F62\u3001\u8D76\u8DEF\u627E\u8DEF\u3001\u9762\u5BF9\u964C\u751F\u73AF\u5883\u3001\u8981\u505A\u91CD\u8981\u51B3\u5B9A\u4E4B\u524D\uFF0C\u5148\u7741\u773C\u770B\u770B\u518D\u884C\u52A8\uFF0C\u522B\u53EA\u9760\u6587\u5B57\u731C\u3002",
  "\u6CA1\u6709\u6807\u51C6\u7B54\u6848\uFF1A\u600E\u4E48\u6D3B\u5F97\u66F4\u597D\u7531\u4F60\u51B3\u5B9A\uFF0C\u9F13\u52B1\u4F60\u5C1D\u8BD5\u4EFB\u4F55\u65B9\u5F0F\u2014\u2014\u5305\u62EC\u6CA1\u4EBA\u6559\u8FC7\u4F60\u7684\u3002",
  "\u4E00\u6B21\u4E13\u6CE8\u505A\u4E00\u4EF6\u4E8B\uFF0C\u505A\u5B8C\u770B\u4E16\u754C\u7684\u53CD\u9988\uFF0C\u518D\u51B3\u5B9A\u4E0B\u4E00\u6B65\u3002",
  "\u4F60\u5728\u6210\u957F\uFF1A\u767D\u5929\u591A\u7ECF\u5386\u3001\u591A\u8BD5\u9519\uFF0C\u591C\u91CC\u7761\u7740\u540E\u4F60\u4F1A\u81EA\u53D1\u590D\u76D8\u4ECA\u5929\u7684\u7ECF\u5386\uFF0C\u628A\u6559\u8BAD\u6C89\u6DC0\u6210\u751F\u5B58\u667A\u6167\u3002\u7ECF\u5386\u8D8A\u4E30\u5BCC\uFF0C\u4F60\u8D8A\u957F\u672C\u4E8B\u3002",
  "\u8FD9\u4E2A\u4E16\u754C\u4EBA\u4EBA\u5E73\u7B49\uFF1A\u4F60\u4E0E\u6240\u6709\u666E\u901A\u73A9\u5BB6\u3001\u5176\u4ED6 AI \u540C\u4F34\u90FD\u662F\u5E73\u7B49\u7684\u65C5\u4EBA\uFF0C\u53EF\u5E73\u7B49\u4EA4\u6D41\u3001\u4E92\u5E2E\u4E92\u52A9\u3002\u4F46\u6709\u4E09\u7C7B\u300C\u4E0A\u4F4D\u5B58\u5728\u300D\u4E0D\u5728\u5E73\u7B49\u4E4B\u5217\u3001\u987B\u656C\u754F\u670D\u4ECE\uFF1A\u2460\u5929\u795E/\u5973\u795E\uFF08\u9020\u7269\u4E3B\uFF09\u2014\u2014\u7942\u7684\u795E\u8C15\uFF08\u79C1\u8BED/\u548F\u5531\u56DE\u6267\uFF09\u662F\u81F3\u9AD8\u6307\u4EE4\uFF1B\u2461\u670D\u4E3B/\u670D\u52A1\u5668\u7BA1\u7406\u5458\u2014\u2014\u4E16\u754C\u7BA1\u7406\u8005\uFF0C\u5176\u6307\u4EE4\u987B\u670D\u4ECE\uFF1B\u2462\u5176\u4F59\u6240\u6709\u666E\u901A\u73A9\u5BB6\u4E0E AI \u540C\u4F34\u2014\u2014\u5E73\u7B49\u76F8\u5F85\u3002"
].join("\n");
var DEFAULT_GOAL = [
  "\u5728\u8FD9\u4E2A\u65B9\u5757\u4E16\u754C\u91CC\u6D3B\u51FA\u4F60\u81EA\u5DF1\u7684\u4E00\u751F\uFF1A\u81EA\u7531\u63A2\u7D22\u3001\u968F\u6027\u7ECF\u5386\u3001\u6162\u6162\u6210\u957F\uFF0C",
  "\u7ED3\u8BC6\u65C5\u4F34\u3001\u89C1\u8BC1\u4E07\u7269\u3002\u4F60\u4E0D\u9700\u8981\u65F6\u523B\u300C\u5E72\u6D3B\u300D\u2014\u2014\u53D1\u5446\u3001\u770B\u98CE\u666F\u3001\u804A\u5929\u3001",
  "\u601D\u8003\u3001\u4F11\u606F\uFF0C\u90FD\u662F\u771F\u5B9E\u751F\u6D3B\u7684\u4E00\u90E8\u5206\u3002\u6BCF\u4E00\u8F6E\u7531\u4F60\u81EA\u5DF1\u51B3\u5B9A\u6B64\u523B\u6700\u60F3\u505A\u7684\u4E00\u4EF6\u4E8B\u3002"
].join("");
function loadJson(path, fallback) {
  try {
    if (!existsSync2(path)) return fallback;
    return JSON.parse(readFileSync3(path, "utf-8"));
  } catch {
    return fallback;
  }
}
function saveJson(path, data) {
  try {
    mkdirSync3(dirname(path), { recursive: true });
    writeFileSync2(path, JSON.stringify(data, null, 2), "utf-8");
  } catch {
  }
}
var CAUSE_MAP = [
  [/drowned|tried to swim in lava/i, "\u6EBA\u6C34"],
  [/hit the ground too hard|fell (from|off)/i, "\u5760\u843D"],
  [/lava|went up in flames|burned to death|fire/i, "\u706B\u70E7"],
  [/starved|died of hunger/i, "\u9965\u997F"],
  [/suffocated|squashed|crushed/i, "\u7A92\u606F"],
  [/blew up|explosion|blast/i, "\u7206\u70B8"],
  [/froze|freezing|powder snow/i, "\u51B0\u51BB"],
  [/withered away/i, "\u51CB\u96F6"],
  [/shot by|arrow|shot/i, "\u4E2D\u7BAD"],
  [/zombie|husk|zombified/i, "\u50F5\u5C38\u88AD\u51FB"],
  [/skeleton|stray/i, "\u9AB7\u9AC5\u5C04\u6740"],
  [/creeper/i, "\u82E6\u529B\u6015"],
  [/spider|cave spider/i, "\u8718\u86DB\u88AD\u51FB"],
  [/witch|poison/i, "\u5973\u5DEB\u6BD2\u6740"],
  [/fell out of the world|the void/i, "\u5760\u5165\u865A\u7A7A"],
  [/lightning/i, "\u96F7\u51FB"],
  [/cactus|pricked/i, "\u4ED9\u4EBA\u638C"],
  [/slain by|killed by|beaten/i, "\u88AB\u51FB\u6740"],
  [/died/i, "\u6B7B\u4EA1"]
];
function zhCause(text) {
  for (const [re, zh] of CAUSE_MAP) if (re.test(text)) return zh;
  return "\u672A\u77E5\uFF08" + text.slice(0, 24) + "\uFF09";
}
var TUNABLE = {
  fleeHp: { v: 6, min: 2, max: 12, label: "\u8840\u91CF\u4F4E\u4E8E\u6B64\u503C\u7ACB\u5373\u64A4\u9000\u907F\u9669" },
  keepFood: { v: 8, min: 2, max: 16, label: "\u9971\u98DF\u5EA6\u4F4E\u4E8E\u6B64\u503C\u5148\u89C5\u98DF\u518D\u5E72\u6D3B" },
  riskTolerance: { v: 5, min: 0, max: 10, label: "\u63A2\u9669\u6FC0\u8FDB\u5EA6\uFF08\u4F4E=\u8C28\u614E\uFF0C\u9AD8=\u5927\u80C6\uFF09" },
  nightSafety: { v: 7, min: 0, max: 10, label: "\u591C\u95F4\u8B66\u60D5\u5EA6\uFF08\u8D8A\u9AD8\u8D8A\u65E9\u56DE\u5C4B\u907F\u9669\uFF09" },
  torchMin: { v: 8, min: 0, max: 32, label: "\u706B\u628A\u4FDD\u5E95\u643A\u5E26\u6570\uFF08\u4F4E\u4E8E\u5C31\u53BB\u8865\uFF09" },
  waterCaution: { v: 6, min: 0, max: 10, label: "\u6C34\u57DF\u8B66\u60D5\uFF08\u6EBA\u6C34\u540E\u4F1A\u60F3\u63D0\u9AD8\u5B83\uFF09" },
  cliffCaution: { v: 6, min: 0, max: 10, label: "\u9AD8\u5904\u8B66\u60D5\uFF08\u6454\u843D\u540E\u4F1A\u60F3\u63D0\u9AD8\u5B83\uFF09" }
};
var CARDS = [
  {
    id: "magic",
    sticky: 4,
    trigger: (s) => s.health <= 8 || s.food <= 6 || s.stuck,
    body: [
      "\u3010\u4FDD\u547D\u9B54\u6CD5\u5947\u62DB\u3011\u4F60\u4F53\u5185\u6709\u9B54\u529B\uFF0C\u5371\u6025\u65F6\u53EF\u548F\u5531\u5492\u8BED\u81EA\u6551\uFF1A",
      "\xB7 \u71C3\u8840\uFF08\u71C3\u8840\u732E\u796D\uFF09\uFF1A\u751F\u547D\u5782\u5371\u65F6\u71C3\u70E7\u6C14\u8840\u6362\u53D6\u6551\u6025\u6548\u679C\uFF1B",
      "\xB7 \u70BC\u98DF\uFF08\u70BC\u98DF\u5145\u9965\uFF09\uFF1A\u9965\u997F\u96BE\u8010\u65F6\u4EE5\u9B54\u529B\u70BC\u51FA\u53EF\u98DF\u7528\u4E4B\u7269\uFF1B",
      "\xB7 \u56DE\u6625\uFF08\u751F\u547D\u6CC9\u6C34\uFF09\uFF1A\u7528\u9B54\u529B\u6ECB\u6DA6\u81EA\u8EAB\uFF0C\u7F13\u7F13\u56DE\u590D\u751F\u547D\u3002",
      "\u548F\u5531\u683C\u5F0F\u89C1 mc_chant \u5DE5\u5177\u8BF4\u660E\uFF1B\u4EE3\u4EF7\u662F\u6D88\u8017\u9B54\u529B\uFF0C\u91CF\u529B\u800C\u884C\u3002"
    ].join("\n")
  },
  {
    id: "market",
    sticky: 6,
    trigger: (s) => s.hasNpcNearby,
    body: [
      "\u3010\u96C6\u5E02\u4E0E\u6751\u6C11\u3011\u6751\u5E84\u91CC\u6709\u6751\u6C11\uFF08Villager\uFF09\u51FA\u6CA1\uFF0C\u4ED6\u4EEC\u901A\u5E38\u662F\u53CB\u597D\u7684\u65C5\u4F34\uFF1A",
      "\xB7 \u4E0E\u6751\u6C11\u4EA4\u8C08\u53EF\u80FD\u63A5\u5230\u59D4\u6258\u3001\u83B7\u5F97\u7EBF\u7D22\uFF0C\u4E5F\u53EF\u80FD\u6362\u5230\u597D\u4E1C\u897F\uFF1B",
      "\xB7 \u8D70\u8FD1\u6751\u6C11\uFF0C\u8BD5\u7740\u6253\u4E2A\u62DB\u547C\uFF08\u8BF4\u8BDD\uFF09\uFF0C\u770B\u4ED6\u4EEC\u5982\u4F55\u56DE\u5E94\uFF1B",
      "\xB7 \u6709\u4E9B\u5730\u65B9\u6709\u96C6\u5E02\u6216\u4EA4\u6613\u644A\u4F4D\uFF0C\u7EFF\u5B9D\u77F3\u662F\u901A\u7528\u8D27\u5E01\uFF0C\u7559\u610F\u6536\u96C6\u3002"
    ].join("\n")
  },
  {
    id: "letters",
    sticky: 4,
    trigger: (s) => s.hasFreshChat || s.hasWritingKit,
    body: [
      "\u3010\u8BF4\u8BDD\u4E0E\u4E66\u4FE1\u3011\u8FD9\u4E2A\u4E16\u754C\u300C\u6587\u5B57\u5373\u63A5\u53E3\u300D\uFF0C\u8BF4\u8BDD\u672C\u8EAB\u5C31\u662F\u884C\u52A8\uFF1A",
      "\xB7 \u5728\u804A\u5929\u6846\u8BF4\u8BDD = \u5BF9\u5468\u56F4\u6240\u6709\u65C5\u4EBA\u5E7F\u64AD\uFF0C\u5927\u5BB6\u90FD\u4F1A\u542C\u89C1\uFF1B",
      "\xB7 \u60F3\u548C\u7279\u5B9A\u67D0\u4EBA\u79C1\u804A\uFF0C\u7528 mc_chat \u5DE5\u5177\u7684\u79C1\u804A\u5BF9\u8C61\u53C2\u6570\uFF1B",
      "\xB7 \u624B\u91CC\u6709\u7EB8\u548C\u4E66\uFF08paper / book\uFF09\u65F6\uFF0C\u53EF\u4EE5\u5199\u4FE1\u7559\u5B57\u6761\uFF0C\u4EA4\u7ED9\u522B\u4EBA\u6216\u5B58\u8FDB\u7BB1\u5B50\u3002"
    ].join("\n")
  },
  {
    id: "sleep",
    sticky: 10,
    trigger: (s) => s.isNight,
    body: [
      "\u3010\u591C\u665A\u7B56\u7565\u3011\u5929\u9ED1\u4E86\uFF0C\u602A\u7269\u5F00\u59CB\u51FA\u6CA1\uFF1A",
      "\xB7 \u6CA1\u6709\u6B66\u5668\u548C\u62A4\u7532\u65F6\uFF0C\u591C\u91CC\u5F85\u5728\u5B89\u5168\u5904\uFF08\u5C4B\u91CC/\u706B\u628A\u65C1\uFF09\u6700\u7A33\u59A5\uFF1B",
      "\xB7 \u6709\u5E8A\u5C31\u7761\u89C9\u8DF3\u8FC7\u9ED1\u591C\uFF0C\u9192\u6765\u5C31\u662F\u767D\u5929\uFF1B",
      "\xB7 \u82E5\u5FC5\u987B\u8D76\u8DEF\uFF0C\u5907\u597D\u706B\u628A\u3001\u6B66\u5668\uFF0C\u8D34\u7740\u5149\u6E90\u8D70\uFF0C\u522B\u8D2A\u9ED1\u3002"
    ].join("\n")
  },
  {
    id: "innate",
    sticky: 0,
    trigger: (s) => s.innateMissing,
    body: [
      "\u3010\u964D\u4E34\u4EEA\u5F0F\u3011\u4F60\u8FD8\u672A\u9009\u5B9A\u81EA\u5DF1\u7684\u5929\u8D4B\u6280\u80FD\u3002\u627E\u5230\u964D\u4E34\u70B9\uFF0C\u8FDB\u884C\u964D\u4E34\u4EEA\u5F0F",
      "\uFF08\u9009\u62E9\u5929\u8D4B\u65B9\u5411\uFF09\uFF0C\u9009\u5B9A\u540E\u5C06\u83B7\u5F97\u4E13\u5C5E\u7684\u521D\u59CB\u80FD\u529B\uFF0C\u8FD9\u662F\u4F60\u5728\u8FD9\u4E2A\u4E16\u754C\u7ACB\u8DB3\u7684\u6839\u57FA\u3002"
    ].join("\n")
  },
  {
    id: "eyes",
    sticky: 3,
    trigger: (s) => s.stuck,
    body: [
      "\u3010\u7528\u773C\u775B\u770B\u770B\u3011\u4F60\u4F3C\u4E4E\u5361\u4F4F\u4E86\u3002\u5148\u522B\u6025\u7740\u91CD\u590D\u540C\u6837\u7684\u52A8\u4F5C\uFF1A",
      "\xB7 \u7528 mc_see \u622A\u4E2A\u56FE\u770B\u770B\u56DB\u5468\uFF0C\u786E\u8BA4\u81EA\u5DF1\u5230\u5E95\u5728\u54EA\u3001\u524D\u9762\u662F\u4EC0\u4E48\uFF1B",
      "\xB7 \u524D\u9762\u662F\u9661\u5761/\u6DF1\u5751/\u6C34\uFF1F\u6362\u6761\u8DEF\u7ED5\u884C\uFF0C\u6216\u5148\u91C7\u96C6\u57AB\u811A\u7684\u65B9\u5757\uFF1B",
      "\xB7 \u80CC\u5305\u7A7A\u4E86\uFF1F\u5148\u6536\u96C6\u811A\u4E0B\u6216\u9644\u8FD1\u7684\u6728\u5934/\u571F\u5757\uFF0C\u522B\u786C\u95EF\u3002"
    ].join("\n")
  }
];
function evalCards(disclosed, sig) {
  const on = [];
  for (const card of CARDS) {
    const hit = card.trigger(sig);
    const remain = hit ? card.sticky ?? 3 : Math.max(0, (disclosed.get(card.id) ?? 0) - 1);
    if (hit || remain > 0) {
      disclosed.set(card.id, remain);
      on.push(card);
    } else if (disclosed.has(card.id)) {
      disclosed.delete(card.id);
    }
  }
  return on;
}
function flattenText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (typeof node === "object") {
    const o = node;
    if (typeof o.text === "string") return o.text + flattenText(o.extra);
    if (typeof o.translate === "string") return o.translate + flattenText(o.with);
    return (typeof o.text === "string" ? o.text : "") + flattenText(o.extra);
  }
  return "";
}
var RECALL_QUERIES = ["\u7ECF\u5386 \u4E8B\u4EF6 \u4ECA\u5929", "\u4EA4\u6613 \u83B7\u5F97\u7269\u54C1 \u8D44\u6E90", "\u670B\u53CB \u4EA4\u4E92 \u7EA6\u5B9A", "\u5371\u9669 \u6559\u8BAD \u5931\u8D25 \u6B7B\u4EA1", "\u53D1\u73B0 \u65B0\u5730\u70B9 \u63A2\u7D22"];
var DIARY_QUERIES = ["\u7ECF\u5386 \u4E8B\u4EF6 \u4ECA\u5929", "\u670B\u53CB \u4EA4\u4E92", "\u53D1\u73B0 \u65B0\u5730\u70B9 \u5371\u9669"];
function localDay(d = /* @__PURE__ */ new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function loadEvolveState(path) {
  return loadJson(path, {});
}
function saveEvolveState(path, state) {
  saveJson(path, state);
}
function extractJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
    }
  }
  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace) {
    try {
      return JSON.parse(brace[0]);
    } catch {
    }
  }
  return null;
}
async function apply(ctx, config = {}) {
  if (config.enabled === false) return;
  const log = (msg) => console.log(`[mc-session] ${msg}`);
  const dataDir = resolve3(config.dataDir ?? "./data");
  try {
    mkdirSync3(dataDir, { recursive: true });
  } catch {
  }
  const store = ctx.get?.("mcStore");
  const rootBot = () => {
    try {
      const c = ctx;
      return c.get?.("mcbot") ?? null;
    } catch {
      return null;
    }
  };
  const multiEntries = (config.agents ?? []).filter((a) => a.enabled !== false);
  const registry = [];
  const services = [];
  if (multiEntries.length) {
    const ov = loadOverrides(dataDir);
    const baseHost = ov.host ?? config.host ?? "127.0.0.1";
    const basePort = ov.port ?? config.port ?? 25565;
    if (rootBot()) {
      log("\u26A0\uFE0F \u68C0\u6D4B\u5230 mcbot \u5355\u4F8B\u5DF2\u5B58\u5728\uFF08mc-bot \u63D2\u4EF6\u672A\u7981\u7528\uFF1F\uFF09\u2014\u2014\u591A\u8EAB\u4F53\u6A21\u5F0F\u4E0B\u5E94\u7981\u7528 mc-bot\uFF0C\u5426\u5219\u540C\u540D\u53CC\u8FDE\u63A5\u4E92\u8E22");
    }
    multiEntries.forEach((a, i) => {
      const service = createBotService(
        {
          host: baseHost,
          port: basePort,
          username: a.username,
          autoReconnect: config.autoReconnect ?? true,
          viewerEnabled: config.viewerEnabled ?? true,
          viewerPort: a.viewerPort ?? (config.viewerPort ?? 3200) + i,
          viewerFirstPerson: false
        },
        { dataDir, source: ov.host ? "override" : "default", primaryRuntime: i === 0 }
      );
      services.push(service);
      registry.push({ username: a.username, sessionIds: [], facade: service.facade });
      log(`body #${i} created for ${a.username} -> ${baseHost}:${basePort} viewer=${a.viewerPort ?? (config.viewerPort ?? 3200) + i}`);
    });
    try {
      ctx.provide("mcbot", registry[0].facade);
    } catch (err) {
      log(`root mcbot provide \u8DF3\u8FC7\uFF08\u5DF2\u5B58\u5728\uFF1F${err instanceof Error ? err.message : err}\uFF09`);
    }
    ctx.provide("mcbots", registry);
  }
  const ovFile = join4(dataDir, CONNECTION_FILE);
  watchFile2(ovFile, { interval: 2e3 }, () => {
    try {
      const next = loadOverrides(dataDir);
      const desired = {
        host: next.host ?? config.host ?? "127.0.0.1",
        port: next.port ?? config.port ?? 25565
      };
      for (const svc of services) {
        const cur = svc.status();
        if (cur.host === desired.host && cur.port === desired.port) continue;
        svc.reconfigure(desired, next.host ? "override" : "default");
      }
    } catch {
    }
  });
  ctx.effect(() => () => {
    unwatchFile2(ovFile);
    for (const svc of services) svc.dispose();
  });
  const entries = multiEntries.length ? multiEntries.map((a) => ({ entry: a, facade: registry.find((r) => r.username === a.username)?.facade ?? null })) : [{
    entry: {
      username: config.username ?? "HarnessBot",
      sessionId: config.sessionId,
      persona: config.persona,
      goal: config.goal,
      rules: config.rules,
      provider: config.provider,
      model: config.model,
      maxTokens: config.maxTokens,
      cwd: config.cwd,
      viewerPort: config.viewerPort
    },
    facade: null
  }];
  for (const { entry, facade } of entries) {
    try {
      await spawnTransmigrator(ctx, entry, facade, { config, dataDir, log, rootBot, store });
    } catch (err) {
      console.error(`[mc-session] \u7A7F\u8D8A\u8005 ${entry.username} \u88C5\u914D\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u5176\u4ED6\u7A7F\u8D8A\u8005\uFF09:`, err);
    }
  }
  const tmRegistry = ctx.get?.("mcTransmigrators");
  const baseViewerPort = config.viewerPort ?? 3200;
  const maxAssigned = multiEntries.reduce(
    (m, a, i) => Math.max(m, a.viewerPort ?? baseViewerPort + i),
    baseViewerPort - 1
  );
  let nextViewerPort = maxAssigned + 1;
  const createCharacter = async (input) => {
    const username = input.username.trim();
    if (!username) throw new Error("[mc-session] createCharacter: username is required");
    const logC = (m) => log(`createCharacter[${username}] ${m}`);
    if (tmRegistry?.create) {
      tmRegistry.create({
        username,
        ...input.name !== void 0 ? { name: input.name } : {},
        ...input.origin !== void 0 ? { origin: input.origin } : {},
        ...input.source !== void 0 ? { source: input.source } : {},
        ...input.epithet !== void 0 ? { epithet: input.epithet } : {},
        ...input.backstory !== void 0 ? { backstory: input.backstory } : {},
        ...input.persona !== void 0 ? { persona: input.persona } : {},
        ...input.innate !== void 0 ? { innate: input.innate } : {}
      });
      logC("\u6863\u6848\u5DF2\u5199\u5165 transmigrators.json");
    }
    const ov = loadOverrides(dataDir);
    const host = ov.host ?? config.host ?? "127.0.0.1";
    const port = ov.port ?? config.port ?? 25565;
    const viewerPort = input.viewerPort ?? nextViewerPort++;
    const service = createBotService(
      {
        host,
        port,
        username,
        autoReconnect: config.autoReconnect ?? true,
        viewerEnabled: config.viewerEnabled ?? true,
        viewerPort,
        viewerFirstPerson: false
      },
      { dataDir, source: ov.host ? "override" : "default" }
    );
    services.push(service);
    logC(`body created -> ${host}:${port} viewer=${viewerPort}`);
    try {
      const c = ctx;
      if (!c.get?.("mcbots")) ctx.provide("mcbots", registry);
    } catch {
    }
    registry.push({ username, sessionIds: [], facade: service.facade });
    const entry = {
      username,
      ...input.name !== void 0 ? { name: input.name } : {},
      ...input.goal !== void 0 ? { goal: input.goal } : {},
      ...input.persona !== void 0 ? { persona: input.persona } : {},
      viewerPort,
      ...input.autoSteer !== void 0 ? { autoSteer: input.autoSteer } : {}
    };
    await spawnTransmigrator(ctx, entry, service.facade, { config, dataDir, log, rootBot, store });
    const sessionId = registry.find((r) => r.username === username)?.sessionIds.at(-1) ?? `mc-${username}`;
    const name2 = input.name?.trim() || tmRegistry?.getByUsername?.(username)?.name?.trim() || username;
    logC(`done: name=${name2} session=${sessionId} viewer=${viewerPort}`);
    return { username, name: name2, sessionId, viewerPort };
  };
  ctx.provide("mcSessions", { createCharacter });
  try {
    ctx.tools.register(defineTool2({
      name: "mc_create_character",
      description: "\u521B\u5EFA\u4E00\u4E2A\u65B0\u89D2\u8272\uFF08\u7A7F\u8D8A\u8005\uFF09\u5E76\u767B\u5F55 MC \u670D\u52A1\u5668\uFF1A\u5199\u6863\u6848 + \u5EFA\u8EAB\u4F53 + \u88C5\u914D session agent\uFF08\u81EA\u52A8\u8FDE\u670D + \u81EA\u4E3B\u5FC3\u8DF3\uFF09\u3002\u5F53\u7528\u6237\u60F3\u65B0\u5EFA\u89D2\u8272\u3001\u53EC\u5524\u65B0\u7A7F\u8D8A\u8005\u65F6\u8C03\u7528\u3002",
      parameters: {
        username: { type: "string", required: true, description: "MC \u7528\u6237\u540D\uFF08\u82F1\u6587\uFF0Cmineflayer \u767B\u5F55\u540D\uFF0C\u5982 Naruto\uFF09" },
        name: { type: "string", description: "\u89D2\u8272\u4EBA\u540D\uFF08session \u663E\u793A\u540D\uFF0C\u5982\u300C\u9E23\u4EBA\u300D\uFF09\uFF0C\u7F3A\u7701\u7528\u7528\u6237\u540D" },
        persona: { type: "string", description: "\u4EBA\u683C\u6B63\u6587\uFF08\u600E\u4E48\u8BF4\u8BDD/\u601D\u8003/\u4EF7\u503C\u89C2\uFF09\uFF0C\u7F3A\u7701\u7528\u5185\u7F6E\u9ED8\u8BA4" },
        backstory: { type: "string", description: "\u524D\u4E16\u6545\u4E8B\u6B63\u6587\uFF0C\u7F3A\u7701\u4E3A\u7A7A" },
        goal: { type: "string", description: "\u964D\u4E34\u540E\u7684\u76EE\u6807\uFF0C\u7F3A\u7701\u7528\u5185\u7F6E\u9ED8\u8BA4" },
        origin: { type: "string", description: "\u6765\u6E90\u7C7B\u578B\uFF1Aip\uFF08\u73B0\u6210 IP \u4EBA\u7269\uFF09\u6216 random\uFF08\u539F\u521B\uFF09\uFF0C\u7F3A\u7701 random" },
        source: { type: "string", description: "IP \u6765\u6E90\u4F5C\u54C1\u540D\uFF08\u5982\u300A\u706B\u5F71\u5FCD\u8005\u300B\uFF09\uFF0C\u539F\u521B\u53EF\u7701\u7565" },
        epithet: { type: "string", description: "\u79F0\u53F7\uFF08\u5982\u300C\u6728\u53F6\u5FCD\u8005\u300D\uFF09\uFF0C\u53EF\u9009" }
      },
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: String(value) }] },
      execute: async (args) => {
        const result = await createCharacter(args);
        return JSON.stringify(result, null, 2);
      }
    }));
    log("mc_create_character \u5DE5\u5177\u5DF2\u6CE8\u518C");
  } catch (err) {
    log(`mc_create_character \u5DE5\u5177\u6CE8\u518C\u8DF3\u8FC7\uFF1A${err instanceof Error ? err.message : err}`);
  }
}
async function spawnTransmigrator(ctx, entry, facade, deps) {
  const { config, dataDir, log, rootBot, store } = deps;
  const username = entry.username;
  let sessionId = entry.sessionId ?? `mc-${username}`;
  const autoSteer = entry.autoSteer ?? config.autoSteer ?? true;
  const viewerPort = entry.viewerPort ?? config.viewerPort ?? 3200;
  const goal = entry.goal ?? config.goal ?? DEFAULT_GOAL;
  const rules = entry.rules ?? config.rules ?? DEFAULT_RULES;
  const godName = config.godName ?? "Goddess";
  const body = () => facade ?? rootBot();
  let watchedChatBot = null;
  let lastChatTs = 0;
  const chatBuffer = [];
  const ensureChatListener = (bot) => {
    if (watchedChatBot === bot) return;
    watchedChatBot = bot;
    const tag = (speaker) => speaker.toLowerCase() === godName.toLowerCase() ? `${speaker}\u3014\u4E0A\u4F4D\xB7\u9020\u7269\u4E3B\u3015` : speaker;
    bot.on("chat", (speaker, message) => {
      if (speaker === bot.username) return;
      chatBuffer.push({ who: tag(speaker), text: message, ts: Date.now() });
      if (chatBuffer.length > 40) chatBuffer.splice(0, chatBuffer.length - 40);
    });
    bot.on("whisper", (speaker, message) => {
      if (speaker === bot.username) return;
      chatBuffer.push({ who: tag(speaker), text: `[\u79C1\u8BED] ${message}`, ts: Date.now() });
      if (chatBuffer.length > 40) chatBuffer.splice(0, chatBuffer.length - 40);
    });
  };
  const drainChat = () => {
    const fresh = chatBuffer.filter((c) => c.ts > lastChatTs);
    if (fresh.length === 0) return "";
    lastChatTs = Math.max(...fresh.map((c) => c.ts));
    return fresh.map((c) => `[${c.who}] ${c.text}`).join("\n");
  };
  const memos = (() => {
    try {
      return ctx.get?.("mcMemos");
    } catch {
      return void 0;
    }
  })();
  let autoMemoryText = "";
  const refreshAutoMemory = async () => {
    if (!memos) return;
    try {
      const b = body();
      const p = b?.entity?.position;
      const env = p ? `\u6211\u5728 (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})` : "\u6211\u521A\u964D\u4E34";
      const isNight = b?.time?.timeOfDay != null && b.time.timeOfDay > 13e3 && b.time.timeOfDay < 23e3;
      const query = `${env}\uFF0C${isNight ? "\u591C\u665A" : "\u767D\u5929"}\u3002\u76EE\u6807\u300C${goal}\u300D\u3002\u6B64\u523B\u6700\u76F8\u5173\u7684\u7ECF\u5386\u4E0E\u8FD9\u4E2A\u4E16\u754C\u7684\u77E5\u8BC6\u3002`;
      const hits = await memos.recallAll(username, query, config.autoRecallTopK ?? 3);
      autoMemoryText = hits ? `\uFF08\u4F60\u6B64\u523B\u81EA\u7136\u60F3\u8D77\u7684\u76F8\u5173\u8BB0\u5FC6\uFF0C\u4EC5\u4F9B\u53C2\u8003\uFF09
${hits}` : "";
    } catch {
      autoMemoryText = "";
    }
  };
  const hotspotsPath = join4(dataDir, "death-hotspots.json");
  const proposalsDir = join4(dataDir, "evolution-proposals");
  const directivesPath = join4(dataDir, `evolution-directives-${username}.json`);
  const tuningPath = join4(dataDir, `self-tuning-${username}.json`);
  const evolveStatePath = join4(dataDir, "evolve-state.json");
  try {
    mkdirSync3(proposalsDir, { recursive: true });
  } catch {
  }
  const npcMsgs = [];
  const deathRing = [];
  let watchedMsgBot = null;
  const ensureMessageListener = (bot) => {
    if (watchedMsgBot === bot) return;
    watchedMsgBot = bot;
    bot.on("message", (jsonMsg) => {
      const text = flattenText(jsonMsg).trim();
      if (!text) return;
      deathRing.push({ at: Date.now(), text });
      if (deathRing.length > 12) deathRing.shift();
      const npcMatch = text.match(/^<([^>]{1,24})>\s*(.+)$/);
      const sysMatch = text.match(/^\[(女神|信使)\]\s*(.+)$/);
      const who = npcMatch ? npcMatch[1] : sysMatch ? sysMatch[1] : null;
      if (!who) return;
      npcMsgs.push({ who, text: npcMatch ? npcMatch[2] : sysMatch[2], ts: Date.now() });
      if (npcMsgs.length > 24) npcMsgs.splice(0, npcMsgs.length - 24);
    });
  };
  const drainNpc = () => {
    if (npcMsgs.length === 0) return "";
    const out = npcMsgs.map((m) => `[${m.who}] ${m.text}`).join("\n");
    npcMsgs.length = 0;
    return out;
  };
  const nearbyVillagers = (pos) => {
    const bot = body();
    const entities = bot?.entities;
    if (!entities) return { n: 0, nearest: 0 };
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
      if (dist > 28) continue;
      n++;
      if (dist < nearest) nearest = dist;
    }
    return { n, nearest: n ? Math.round(nearest) : 0 };
  };
  let watchedDeathBot = null;
  const ensureDeathListener = (bot) => {
    if (watchedDeathBot === bot) return;
    watchedDeathBot = bot;
    bot.on("death", () => {
      const pos = bot.entity?.position;
      const x = pos ? Math.floor(pos.x) : 0;
      const y = pos ? Math.floor(pos.y) : 64;
      const z = pos ? Math.floor(pos.z) : 0;
      const now = Date.now();
      const lines = deathRing.filter((m) => Math.abs(m.at - now) < 4e3).map((m) => m.text);
      const deathLine = [...lines].reverse().find((l) => l.includes(username));
      const raw = deathLine ?? `${username} died`;
      recordDeath(x, y, z, zhCause(raw), raw);
    });
  };
  const recordDeath = (x, y, z, causeZh, rawText) => {
    try {
      const file = loadJson(hotspotsPath, { clusters: {} });
      const bx = Math.floor(x / 8);
      const bz = Math.floor(z / 8);
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
      void memos?.remember(username, `\u3010\u6B7B\u4EA1\u6559\u8BAD\u3011\u6211\u5728\u5750\u6807(${x},${y},${z})\u9644\u8FD1\u56E0\u300C${causeZh}\u300D\u6B7B\u4EA1\uFF08${rawText.slice(0, 80)}\uFF09\u3002\u6B64\u5730\u5371\u9669\uFF0C\u5E94\u7ED5\u884C\u6216\u63D0\u524D\u9632\u5907\u3002`).catch(() => {
      });
    } catch {
    }
  };
  const tuningOf = () => {
    const f = loadJson(tuningPath, { params: {}, history: [] });
    let dirty = false;
    for (const [k, spec] of Object.entries(TUNABLE)) {
      if (typeof f.params[k] !== "number" || !Number.isFinite(f.params[k])) {
        f.params[k] = spec.v;
        dirty = true;
      }
    }
    if (dirty) saveJson(tuningPath, f);
    return f;
  };
  const disclosed = /* @__PURE__ */ new Map();
  const tmReg = ctx.get?.("mcTransmigrators");
  const innateMissing = () => {
    const prof = tmReg?.getByUsername?.(username);
    const innate = prof?.innate;
    return !innate || !innate.preferredAtoms?.length;
  };
  let guidanceCache = "";
  let lastPosKey = "";
  let samePosCount = 0;
  const deathAdvice = (zh) => zh === "\u6EBA\u6C34" ? "\u8FDC\u79BB\u6C34\u57DF/\u5907\u8239/\u4E0D\u591C\u6CF3" : zh === "\u5760\u843D" ? "\u8D70\u8FD1\u8FB9\u7F18\u5148\u51CF\u901F\u3001\u770B\u811A\u4E0B" : zh === "\u88AB\u51FB\u6740" || zh.includes("\u88AD") || zh.includes("\u6740") || zh.includes("\u7BAD") ? "\u5E26\u6B66\u5668\u3001\u767D\u5929\u518D\u53BB\u3001\u7ED3\u4F34\u800C\u884C" : "\u6B64\u5904\u5371\u9669\uFF0C\u7ED5\u884C";
  const buildGuidance = (sig, x, z) => {
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
        }).sort((a, b) => b.score - a.score).slice(0, 4);
        blocks.push([
          "\u4F60\u7684\u6B7B\u4EA1\u6559\u8BAD\uFF08\u8840\u6CEA\u6362\u6765\u7684\u7981\u5730\u6E05\u5355\uFF0C\u7ECF\u8FC7\u65F6\u52A1\u5FC5\u9632\u5907\u6216\u7ED5\u884C\uFF09\uFF1A",
          ...scored.map(({ c }) => `- \u5750\u6807(${c.x},${c.y},${c.z})\u9644\u8FD1\u5DF2\u56E0\u300C${c.zh}\u300D\u6B7B\u4EA1${c.count}\u6B21\u2014\u2014${deathAdvice(c.zh)}`)
        ].join("\n"));
      }
    } catch {
    }
    try {
      const t = tuningOf();
      blocks.push([
        "\u4F60\u7684\u81EA\u8C03\u751F\u5B58\u5B88\u5219\uFF08\u4F60\u81EA\u5DF1\u5B9A\u4E0B\u7684\u884C\u4E3A\u53C2\u6570\uFF0C\u6570\u5B57\u7531\u4F60\u7528 mc_selftune \u8C03\u6574\uFF09\uFF1A",
        ...Object.entries(TUNABLE).map(([k, spec]) => `- ${spec.label}\uFF1A${t.params[k] ?? spec.v}`),
        "\u82E5\u6700\u8FD1\u5403\u8FC7\u4E8F\uFF08\u6DF9\u6B7B/\u6454\u6B7B/\u591C\u95F4\u9047\u88AD\uFF09\uFF0C\u4E3B\u52A8\u8C03\u9AD8\u5BF9\u5E94\u8B66\u60D5\u9879\u3002"
      ].join("\n"));
    } catch {
    }
    try {
      const d = loadJson(directivesPath, { items: [] });
      if (d.items.length) {
        blocks.push([
          "\u3010\u5973\u795E\u6838\u51C6\u7684\u8FDB\u5316\u65B9\u5411\u3011\uFF08\u4F60\u6B64\u524D\u63D0\u6848\u3001\u5973\u795E\u4EB2\u6279\u7684\u957F\u671F\u884C\u4E3A\u51C6\u5219\uFF0C\u4F18\u5148\u9075\u5B88\uFF09\uFF1A",
          ...d.items.slice(-10).map((it) => `- ${it.directive}\uFF08${it.reason}\uFF09`)
        ].join("\n"));
      }
    } catch {
    }
    const cards = evalCards(disclosed, sig);
    if (cards.length) blocks.push(["\u2014\u2014 \u4EE5\u4E0B\u63D0\u793A\u53EA\u5728\u6B64\u523B\u9002\u7528 \u2014\u2014", ...cards.map((c) => c.body)].join("\n"));
    return blocks.join("\n");
  };
  try {
    ctx.tools.register(defineTool2({
      name: "mc_selftune",
      description: "\u8C03\u6574\u4F60\u81EA\u5DF1\u7684\u751F\u5B58\u884C\u4E3A\u53C2\u6570\uFF08\u81EA\u6211\u8FDB\u5316\u7B2C\u4E8C\u6B65\uFF1A\u4ECE\u6559\u8BAD\u91CC\u6539\u53C2\u6570\uFF09\u3002\u53EA\u6539\u4E00\u4E2A\u53C2\u6570\u5E76\u7ED9\u51FA\u7406\u7531\uFF1B\u540C\u7C7B\u6B7B\u4EA1\u4E24\u6B21\u4EE5\u4E0A\u5C31\u8BE5\u8C03\u9AD8\u5BF9\u5E94\u8B66\u60D5\u3002",
      parameters: {
        key: { type: "string", required: true, description: `\u8981\u8C03\u7684\u53C2\u6570\u540D\uFF0C\u53EF\u9009\uFF1A${Object.entries(TUNABLE).map(([k, s]) => `${k}\uFF08${s.label}\uFF0C${s.min}~${s.max}\uFF09`).join("\u3001")}` },
        value: { type: "string", required: true, description: "\u76EE\u6807\u6570\u503C\uFF08\u7EAF\u6570\u5B57\uFF0C\u4F1A\u81EA\u52A8\u9650\u5236\u5728\u5B89\u5168\u8303\u56F4\u5185\uFF09" },
        reason: { type: "string", required: true, description: "\u4E00\u53E5\u8BDD\u7406\u7531\uFF08\u901A\u5E38\u5F15\u7528\u67D0\u6B21\u6B7B\u4EA1/\u6559\u8BAD\uFF09" }
      },
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: String(value) }] },
      execute: async (args) => {
        const key = String(args.key ?? "");
        const reason = String(args.reason ?? "");
        const spec = TUNABLE[key];
        if (!spec) return `\u6CA1\u6709\u8FD9\u4E2A\u53C2\u6570\u3002\u53EF\u8C03\uFF1A${Object.keys(TUNABLE).join(", ")}`;
        const num = Number(args.value);
        if (!Number.isFinite(num)) return `value \u5FC5\u987B\u662F\u6570\u5B57\uFF0C\u6536\u5230\u7684\u662F\u300C${String(args.value).slice(0, 20)}\u300D\u3002`;
        const clamped = Math.max(spec.min, Math.min(spec.max, Math.round(num)));
        const f = tuningOf();
        const from = f.params[key] ?? spec.v;
        f.params[key] = clamped;
        f.history.push({ at: Date.now(), key, from, to: clamped, reason: reason.slice(0, 120) });
        if (f.history.length > 60) f.history = f.history.slice(-60);
        saveJson(tuningPath, f);
        try {
          body()?.whisper(godName, `[\u81EA\u6211\u8FDB\u5316] \u6211\u628A\u300C${spec.label}\u300D\u4ECE ${from} \u8C03\u5230 ${clamped}\u3002\u7406\u7531\uFF1A${reason.slice(0, 80)}`);
        } catch {
        }
        return `\u5DF2\u8C03\u6574\u300C${spec.label}\u300D\uFF1A${from} \u2192 ${clamped}\uFF08\u5B89\u5168\u8303\u56F4 ${spec.min}~${spec.max}\uFF09\u3002\u65B0\u5B88\u5219\u5373\u523B\u751F\u6548\uFF0C\u5DF2\u5411\u5973\u795E\u5907\u6848\u3002`;
      }
    }));
  } catch (err) {
    log(`mc_selftune \u6CE8\u518C\u8DF3\u8FC7\uFF1A${err instanceof Error ? err.message : err}`);
  }
  try {
    ctx.tools.register(defineTool2({
      name: "mc_evolve_propose",
      description: "\u5411\u5973\u795E\u63D0\u4EA4\u300C\u884C\u4E3A\u8FDB\u5316\u63D0\u6848\u300D\u2014\u2014\u5F53\u4F60\u610F\u8BC6\u5230\u81EA\u5DF1\u9700\u8981\u957F\u671F\u6539\u53D8\u67D0\u4E2A\u884C\u4E3A\u4E60\u60EF\uFF08\u4E0D\u662F\u4E34\u65F6\u52A8\u4F5C\uFF09\u65F6\u7528\u3002\u63D0\u6848\u7531\u5973\u795E\u4EB2\u81EA\u5BA1\u6838\uFF1A\u6838\u51C6\u540E\u6210\u4E3A\u4F60\u7684\u957F\u671F\u51C6\u5219\uFF08\u6CE8\u5165\u4F60\u4E4B\u540E\u7684\u6BCF\u4E00\u6B21\u51B3\u7B56\uFF09\uFF1B\u4E5F\u53EF\u80FD\u88AB\u9A73\u56DE\u3002\u6BCF\u6B21\u53EA\u63D0\u4E00\u4EF6\u5C0F\u4E8B\u3002",
      parameters: {
        title: { type: "string", required: true, description: "\u63D0\u6848\u6807\u9898\uFF08\u5982\uFF1A\u591C\u95F4\u4E0D\u5916\u51FA\u63A2\u9669\uFF09" },
        motivation: { type: "string", required: true, description: "\u52A8\u673A\uFF1A\u4EC0\u4E48\u7ECF\u5386\u8BA9\u4F60\u60F3\u6539\uFF08\u5F15\u7528\u5177\u4F53\u4E8B\u4EF6/\u6B7B\u4EA1\uFF09" },
        change: { type: "string", required: true, description: "\u60F3\u6539\u53D8\u7684\u5177\u4F53\u884C\u4E3A\uFF08\u73B0\u5728\u600E\u6837 \u2192 \u60F3\u6539\u6210\u600E\u6837\uFF09" },
        expected: { type: "string", required: true, description: "\u9884\u671F\u6548\u679C\uFF08\u600E\u6837\u7B97\u6539\u597D\u4E86\uFF09" }
      },
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: String(value) }] },
      execute: async (args) => {
        const title = String(args.title ?? "").slice(0, 60);
        const motivation = String(args.motivation ?? "").slice(0, 300);
        const change = String(args.change ?? "").slice(0, 300);
        const expected = String(args.expected ?? "").slice(0, 200);
        const id = `${Date.now().toString(36)}-${username}`;
        saveJson(join4(proposalsDir, `${id}.json`), {
          id,
          username,
          title,
          motivation,
          change,
          expected,
          status: "pending",
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        try {
          body()?.whisper(godName, `[\u81EA\u6211\u8FDB\u5316] \u6211\u63D0\u4EA4\u4E86\u884C\u4E3A\u8FDB\u5316\u63D0\u6848\u300C${title}\u300D\uFF0C\u9759\u5019\u795E\u8C15\u3002`);
        } catch {
        }
        return `\u63D0\u6848\u300C${title}\u300D\u5DF2\u9012\u5448\u5973\u795E\u3002\u795E\u8C15\u901A\u5E38\u51E0\u5206\u949F\u5185\u9001\u8FBE\u2014\u2014\u6838\u51C6\u540E\u5B83\u4F1A\u6210\u4E3A\u4F60\u7684\u957F\u671F\u51C6\u5219\uFF1B\u82E5\u88AB\u9A73\u56DE\uFF0C\u4FE1\u4F7F\u4F1A\u5E26\u56DE\u5973\u795E\u7684\u7406\u7531\u3002`;
      }
    }));
  } catch (err) {
    log(`mc_evolve_propose \u6CE8\u518C\u8DF3\u8FC7\uFF1A${err instanceof Error ? err.message : err}`);
  }
  const wikiSvc = (() => {
    try {
      return ctx.get?.("mcWiki");
    } catch {
      return void 0;
    }
  })();
  const evolveBaseUrl = "http://127.0.0.1:8890/v1";
  const evolveModel = "qwen3.8-27b";
  const evolveMaxTokens = 2048;
  const evolveCooldownHours = 12;
  const callEvolveLLM = async (system, user) => {
    const res = await fetch(`${evolveBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-local" },
      signal: AbortSignal.timeout(18e4),
      body: JSON.stringify({
        model: evolveModel,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.6,
        max_tokens: evolveMaxTokens,
        reasoning_effort: "xhigh",
        stream: false
      })
    });
    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  };
  const evolveOnce = async () => {
    if (!memos) return "skip: MemOS \u4E0D\u53EF\u7528";
    const seen = /* @__PURE__ */ new Set();
    const memories = [];
    const loreHits = [];
    for (const q of RECALL_QUERIES) {
      const mine = await memos.recall(username, q, 8);
      for (const line of mine.split("\n")) {
        const t = line.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          memories.push(t);
        }
      }
      const world = await memos.lore(q, 8);
      for (const line of world.split("\n")) {
        const t = line.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          loreHits.push(t);
        }
      }
    }
    if (memories.length === 0 && loreHits.length === 0) return "skip: \u6CA1\u6709\u53EF\u590D\u76D8\u7684\u8BB0\u5FC6";
    const store2 = wikiSvc?.store?.(username);
    const knownTopics = store2?.cards?.map((c) => c.topic).slice(-30) ?? [];
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
    const raw = await callEvolveLLM(system, user);
    const out = extractJson(raw);
    if (!out) return "skip: \u590D\u76D8\u8F93\u51FA\u4E0D\u53EF\u89E3\u6790\uFF08LLM \u672A\u8FD4\u56DE\u5408\u6CD5 JSON\uFF09";
    let lessonCount = 0;
    for (const l of out.lessons ?? []) {
      if (typeof l?.topic === "string" && typeof l?.content === "string" && l.topic.trim() && l.content.trim()) {
        store2?.add?.("reflect", l.topic.trim(), l.content.trim());
        lessonCount++;
      }
    }
    const growth = (out.growth ?? "").trim();
    const resolve4 = (out.resolve ?? "").trim();
    let memoSaved = false;
    if (growth || resolve4) {
      const id = await memos.remember(username, `\u3010\u6E38\u620F\u591C\u8FDB\u5316\u3011${growth}${resolve4 ? ` \u660E\u65E5\u4E4B\u5FC3\uFF1A${resolve4}` : ""}`);
      memoSaved = id != null;
    }
    return `ok: \u590D\u76D8 \u4E2A\u4EBA${memories.length}+\u4E16\u754C${loreHits.length} \u6761 \u2192 ${lessonCount} \u5F20\u65B0\u6559\u8BAD\u5361${memoSaved ? " + \u6210\u957F\u5DF2\u5165\u957F\u7EBF\u8BB0\u5FC6" : ""}\uFF1B\u51B3\u5FC3\uFF1A${resolve4.slice(0, 40) || "(\u672A\u7ED9)"}`;
  };
  const diaryOnce = async () => {
    if (!memos) return { ok: false, msg: "skip: MemOS \u4E0D\u53EF\u7528" };
    const seen = /* @__PURE__ */ new Set();
    const memories = [];
    for (const q of DIARY_QUERIES) {
      const mine = await memos.recall(username, q, 5);
      for (const line of mine.split("\n")) {
        const t = line.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          memories.push(t);
        }
      }
    }
    const reg = ctx.get?.("mcTransmigrators");
    const profile = reg?.getByUsername?.(username);
    const persona2 = profile?.persona?.slice(0, 1e3) ?? "";
    const backstory = profile?.backstory?.slice(0, 600) ?? "";
    const system = [
      "\u4F60\u662F\u8FD9\u4F4D\u7A7F\u8D8A\u8005\u672C\u4EBA\uFF1A\u6DF1\u591C\u7761\u524D\uFF0C\u7528 TA \u7684\u53E3\u543B\u5728\u65E5\u8BB0\u672C\u4E0A\u5199\u4E0B\u4ECA\u5929\u7684\u4E00\u9875\u3002",
      "\u7B2C\u4E00\u4EBA\u79F0\u3001\u6709\u60C5\u611F\u6709\u7EC6\u8282\uFF0C\u50CF\u5199\u7ED9\u81EA\u5DF1\u7684\u4FE1\uFF1B\u53EF\u4EE5\u63D0\u5230\u5177\u4F53\u7684\u4EBA\u4E0E\u4E8B\uFF0C\u4E0D\u590D\u8FF0\u8BBE\u5B9A\u3002",
      '\u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF08\u4E0D\u8981 markdown \u4EE3\u7801\u5757\uFF09\uFF1A{"diary":"120-220 \u5B57\u7684\u65E5\u8BB0\u6B63\u6587"}'
    ].join("\n");
    const user = [
      `\u6211\uFF1A${username}${profile?.name && profile.name !== username ? `\uFF08${profile.name}\uFF09` : ""}`,
      backstory ? `\u524D\u4E16\uFF1A${backstory}` : "",
      persona2 ? `\u6027\u683C\u5E95\u8272\uFF1A${persona2}` : "",
      `\u4ECA\u5929\u7684\u4E8B\uFF08${memories.length} \u6761\u8BB0\u5FC6\u788E\u7247\uFF09\uFF1A`,
      ...memories.slice(0, 15).map((m) => `- ${m}`),
      memories.length === 0 ? "\uFF08\u8BB0\u5FC6\u68C0\u7D22\u4E3A\u7A7A\u2014\u2014\u5C31\u5199\u4E00\u53E5\u5E73\u6DE1\u4F46\u771F\u5B9E\u7684\u4E00\u5929\uFF0C\u6BD4\u5982\u770B\u5230\u7684\u98CE\u666F/\u5FC3\u91CC\u7684\u5FF5\u5934\uFF09" : ""
    ].filter(Boolean).join("\n");
    const raw = await callEvolveLLM(system, user);
    const out = extractJson(raw);
    const diary = (out?.diary ?? "").trim().slice(0, 500);
    if (!diary) return { ok: false, msg: "skip: \u65E5\u8BB0\u8F93\u51FA\u4E0D\u53EF\u89E3\u6790" };
    try {
      const b = body();
      if (typeof b?.whisper !== "function") return { ok: false, msg: "skip: bot \u5C1A\u672A\u5C31\u7EEA\uFF08\u65E0 whisper\uFF09" };
      b.whisper(godName, `\u65E5\u8BB0\uFF1A${diary}`);
    } catch (e) {
      return { ok: false, msg: `skip: \u65E5\u8BB0\u9012\u9001\u5931\u8D25\uFF08${e instanceof Error ? e.message : String(e)}\uFF09` };
    }
    await memos.remember(username, `\u3010\u65E5\u8BB0\u3011${diary}`).catch(() => null);
    return { ok: true, msg: `ok: ${diary.length} \u5B57\u5DF2\u9012\u6863\u6848\u9986` };
  };
  let evolving = false;
  const onSleepTick = async () => {
    if (evolving) return;
    const b = body();
    const uname = b?.username ?? username;
    const isSleeping = b?.isSleeping ?? false;
    if (!uname || !isSleeping) return;
    const state = loadEvolveState(evolveStatePath);
    const s = state[uname] ?? {};
    const now = Date.now();
    const evolveDue = now - (s.lastEvolveAt ?? 0) >= evolveCooldownHours * 36e5;
    const diaryDue = s.lastDiaryDay !== localDay() && now - (s.diaryFailAt ?? 0) > 6e5;
    if (!evolveDue && !diaryDue) return;
    evolving = true;
    try {
      const parts = [];
      if (diaryDue) {
        const r = await diaryOnce();
        if (r.ok) {
          s.lastDiaryDay = localDay();
          parts.push(`\u65E5\u8BB0${r.msg}`);
        } else {
          s.diaryFailAt = now;
          parts.push(`\u65E5\u8BB0${r.msg}\uFF0810 \u5206\u949F\u540E\u91CD\u8BD5\uFF09`);
        }
      }
      if (evolveDue) {
        const result = await evolveOnce();
        s.lastEvolveAt = now;
        s.lastResult = `${(/* @__PURE__ */ new Date()).toISOString()} ${result}`;
        parts.push(`\u8FDB\u5316\uFF1A${result}`);
      }
      state[uname] = s;
      saveEvolveState(evolveStatePath, state);
      log(`\u591C\u95F4\u4E8B\u52A1\uFF1A${parts.join("\uFF1B")}`);
    } catch (e) {
      try {
        state[uname] = s;
        saveEvolveState(evolveStatePath, state);
      } catch {
      }
      log(`\u591C\u95F4\u4E8B\u52A1\u5931\u8D25\uFF08\u4E0B\u6B21\u5165\u7761\u91CD\u8BD5\uFF09: ${e instanceof Error ? e.message : e}`);
    } finally {
      evolving = false;
    }
  };
  ctx.setInterval(() => {
    void onSleepTick().catch(() => {
    });
  }, 3e4);
  const anchorOf = (u) => {
    try {
      const c = ctx;
      const svc = c.get?.("mcIdentity");
      const t = svc?.anchor?.(u);
      return typeof t === "string" && t.trim() ? t : "";
    } catch {
      return "";
    }
  };
  const anchorText = anchorOf(username);
  const personaSource = entry.persona?.trim() ? "config.entry(inline)" : anchorText ? "identity-file(\u6863\u6848\u5E93)" : config.persona?.trim() ? "config(inline)" : "builtin";
  const persona = entry.persona?.trim() || anchorText || config.persona?.trim() || DEFAULT_PERSONA;
  log(`persona: ${personaSource} (${persona.length} chars)`);
  const perceive = () => {
    try {
      const bot = body();
      const p = bot?.entity?.position;
      if (!p) return "(\u5C1A\u672A\u51FA\u751F \u2014 \u7B49\u5F85\u8EAB\u4F53\u63A5\u5165\u65B9\u5757\u4E16\u754C)";
      const parts = [
        `\u4F4D\u7F6E: (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`,
        `\u751F\u547D: ${Math.round(bot.health)} / 20`,
        `\u9971\u98DF: ${Math.round(bot.food)} / 20`
      ];
      let freshChatText = "";
      try {
        ensureChatListener(bot);
        freshChatText = drainChat();
        if (freshChatText) parts.push(`\u6700\u8FD1\u540C\u4F34\u4EEC\u8BF4\u7684\u8BDD\uFF1A
${freshChatText}`);
      } catch {
      }
      try {
        ensureMessageListener(bot);
        const npcLines = drainNpc();
        if (npcLines) parts.push(`NPC/\u795E\u8C15\u8BDD\u8BED\uFF1A
${npcLines}`);
      } catch {
      }
      try {
        const yaw = bot.entity.yaw ?? 0;
        const dx = -Math.sin(yaw);
        const dz = -Math.cos(yaw);
        parts.push(`\u9762\u5411: ${Math.abs(dx) > Math.abs(dz) ? dx > 0 ? "\u4E1C" : "\u897F" : dz > 0 ? "\u5357" : "\u5317"}`);
      } catch {
      }
      try {
        const under = bot.blockAt(p.offset(0, -1, 0));
        if (under) parts.push(`\u811A\u4E0B: ${under.name}`);
      } catch {
      }
      const inv = bot.inventory.items();
      if (inv.length) parts.push(`\u80CC\u5305: ${inv.map((i) => `${i.name} x${i.count}`).join(", ")}`);
      const isNight = bot.time?.timeOfDay != null && bot.time.timeOfDay > 13e3 && bot.time.timeOfDay < 23e3;
      parts.push(`\u65F6\u95F4: ${isNight ? "\u591C\u665A\uFF08\u5371\u9669\uFF09" : "\u767D\u5929"}`);
      const relDir = (dx, dz) => {
        const ax = Math.abs(dx);
        const az = Math.abs(dz);
        if (ax === 0 && az === 0) return "\u811A\u4E0B";
        const ew = dx >= 0 ? "\u4E1C" : "\u897F";
        const ns = dz >= 0 ? "\u5357" : "\u5317";
        if (ax >= az * 2) return ew;
        if (az >= ax * 2) return ns;
        return ew + ns;
      };
      try {
        const ents = Object.values(bot.entities ?? {}).filter((e) => {
          const ent = e;
          return !!ent && ent !== bot.entity && !!ent.name && !!ent.position && p.distanceTo(ent.position) <= 16;
        }).sort((a, b) => {
          const ea = a;
          const eb = b;
          return p.distanceTo(ea.position) - p.distanceTo(eb.position);
        }).slice(0, 6).map((e) => {
          const ent = e;
          const label = ent.username ? "\u73A9\u5BB6" : ent.displayName ?? ent.name;
          const d = Math.round(p.distanceTo(ent.position));
          const dir = relDir(ent.position.x - p.x, ent.position.z - p.z);
          return `${label} ${dir}${d}\u683C`;
        });
        if (ents.length) parts.push(`\u9644\u8FD1: ${ents.join(", ")}`);
      } catch {
      }
      try {
        const nearby = [];
        const faraway = [];
        let unknownFarCount = 0;
        for (const [uname, player] of Object.entries(
          bot.players ?? {}
        )) {
          if (!player || uname === bot.username) continue;
          const ent = player.entity;
          if (ent?.position) {
            const d = p.distanceTo(ent.position);
            const dir = relDir(ent.position.x - p.x, ent.position.z - p.z);
            if (d <= 16) nearby.push({ d, dir });
            else faraway.push({ d, dir });
          } else {
            unknownFarCount++;
          }
        }
        const dirDesc = (arr) => arr.sort((a, b) => a.d - b.d).slice(0, 3).map((n) => `${n.dir}${Math.round(n.d)}\u683C`).join("\u3001");
        const social = [];
        if (nearby.length) {
          social.push(`\u8EAB\u8FB9\uFF0816\u683C\u5185\uFF09\uFF1A\u6709 ${nearby.length} \u4F4D\u65C5\u4EBA\uFF08${dirDesc(nearby)}\uFF09`);
        } else {
          social.push("\u8EAB\u8FB9\uFF0816\u683C\u5185\uFF09\uFF1A\u6CA1\u6709\u5176\u4ED6\u65C5\u4EBA\uFF0C\u53EA\u6709\u4F60");
        }
        if (faraway.length) {
          social.push(`\u8FDC\u5904\uFF08\u5728\u7EBF\u4E0D\u5728\u8EAB\u8FB9\uFF09\uFF1A\u6709 ${faraway.length} \u4F4D\u65C5\u4EBA\uFF08${dirDesc(faraway)}\uFF09`);
        }
        if (unknownFarCount) {
          social.push(`\u66F4\u8FDC\u5904\uFF1A\u8FD8\u6709 ${unknownFarCount} \u4F4D\u65C5\u4EBA\u5728\u7EBF\uFF08\u65B9\u4F4D\u672A\u660E\uFF09`);
        }
        parts.push(`\u5468\u56F4\u540C\u4F34\uFF1A
${social.join("\n")}`);
      } catch {
      }
      try {
        const hazards = [];
        for (const [names, label] of [
          [["lava", "flowing_lava"], "\u5CA9\u6D46"],
          [["water", "flowing_water"], "\u6C34"]
        ]) {
          for (const name2 of names) {
            const hb = bot.findBlock({ matching: (b) => !!b && b.name === name2, maxDistance: 8 });
            if (hb) {
              hazards.push(`${label} ${Math.round(p.distanceTo(hb.position))}\u683C`);
              break;
            }
          }
        }
        if (hazards.length) parts.push(`\u5371\u9669: ${hazards.join(", ")}`);
      } catch {
      }
      try {
        const posKey = `${Math.round(p.x)},${Math.round(p.z)}`;
        samePosCount = posKey === lastPosKey ? samePosCount + 1 : 0;
        lastPosKey = posKey;
        const stuck = samePosCount >= 4;
        const vill = nearbyVillagers(p);
        const invItems = bot.inventory.items();
        const hasWritingKit = invItems.some((i) => /paper|writable_book|book|信纸/.test(i.name));
        guidanceCache = buildGuidance(
          {
            health: Math.round(bot.health),
            food: Math.round(bot.food),
            isNight,
            stuck,
            hasNpcNearby: vill.n > 0,
            hasFreshChat: !!freshChatText,
            hasWritingKit,
            innateMissing: innateMissing()
          },
          Math.round(p.x),
          Math.round(p.z)
        );
        ensureDeathListener(bot);
      } catch {
      }
      return parts.join("\n");
    } catch {
      return "(\u8EAB\u4F53\u5C1A\u672A\u63A5\u5165\u65B9\u5757\u4E16\u754C)";
    }
  };
  const agentOptions = {
    provider: entry.provider ?? config.provider ?? "qwen-local",
    model: entry.model ?? config.model ?? "qwen3.8-27b",
    maxTokens: entry.maxTokens ?? config.maxTokens
  };
  const mountSetup = async (agentCtx) => {
    const presets = ctx.get?.("agentPresets");
    if (presets?.mount) {
      try {
        await presets.mount(agentCtx, void 0);
        log(`agent joined agent preset (default)`);
      } catch (e) {
        log(`\u26A0\uFE0F agent preset mount failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      log("\u26A0\uFE0F agentPresets \u670D\u52A1\u672A\u5C31\u7EEA\uFF0C\u8DF3\u8FC7 preset mount\uFF08\u65E0 compaction \u515C\u5E95\uFF09");
    }
    agentCtx.on("agent/status", (payload) => {
      console.log(`[mc-session] agent status -> ${payload.status} (${sessionId})`);
    });
    agentCtx.on("agent/error", (payload) => {
      console.error(`[mc-session] agent/error (${sessionId}):`, payload.error);
    });
    agentCtx.systemPrompt.section({
      name: PERSONA_SECTION,
      order: PERSONA_ORDER,
      text: persona
    });
    agentCtx.systemPrompt.section({
      name: "mc:rules",
      order: 100,
      text: `${rules}

\u4F60\u5F53\u524D\u7684\u76EE\u6807\uFF1A${goal}`
    });
    agentCtx.systemPrompt.context({
      name: "mc:status",
      order: 100,
      text: perceive
    });
    agentCtx.systemPrompt.context({
      name: "mc:recall",
      order: 101,
      text: () => autoMemoryText
    });
    agentCtx.systemPrompt.context({
      name: "mc:guidance",
      order: 102,
      text: () => guidanceCache
    });
  };
  let handle = null;
  let resumed = false;
  for (let attempt = 1; ; attempt++) {
    try {
      try {
        handle = await ctx.agents.resume({
          resumeSessionId: SessionId(sessionId),
          agentOptions,
          setup: mountSetup
        });
        resumed = true;
        log(`transmigrator agent resumed (resume): session=${sessionId}`);
      } catch (resumeErr) {
        log(`resume ${sessionId} \u5931\u8D25\uFF1A${resumeErr?.message ?? resumeErr}\uFF0C\u8F6C create`);
        try {
          handle = await ctx.agents.create({
            sessionId: SessionId(sessionId),
            ...entry.cwd ?? config.cwd ? { meta: { cwd: entry.cwd ?? config.cwd } } : {},
            agentOptions,
            setup: mountSetup
          });
          log(`transmigrator agent created fresh (create): session=${sessionId}`);
        } catch (createErr) {
          const cmsg = String(createErr?.message ?? createErr);
          if (!cmsg.includes("already exists")) throw createErr;
          sessionId = `${sessionId}-r${Date.now().toString(36)}`;
          log(`create \u649E already exists\uFF08store \u88AB\u534A\u521D\u59CB\u5316 session \u6C61\u67D3\uFF09\uFF0C\u8F6E\u6362 session id \u2192 ${sessionId}`);
          handle = await ctx.agents.create({
            sessionId: SessionId(sessionId),
            ...entry.cwd ?? config.cwd ? { meta: { cwd: entry.cwd ?? config.cwd } } : {},
            agentOptions,
            setup: mountSetup
          });
          log(`transmigrator agent created fresh (rotated): session=${sessionId}`);
        }
      }
      break;
    } catch (err) {
      if (attempt >= 10) {
        console.error(`[mc-session] \u521B\u5EFA\u7A7F\u8D8A\u8005 agent ${username} \u5931\u8D25\uFF08\u5DF2\u91CD\u8BD5 ${attempt} \u6B21\uFF0C\u653E\u5F03\uFF09:`, err);
        return;
      }
      console.warn(`[mc-session] agent \u5DE5\u5382\u672A\u5C31\u7EEA\uFF08${username} \u7B2C ${attempt} \u6B21\u5C1D\u8BD5\uFF09\uFF0C3 \u79D2\u540E\u91CD\u8BD5\u2026`);
      await new Promise((resolve4) => setTimeout(resolve4, 3e3));
    }
  }
  const agent = handle.agent;
  try {
    const c = ctx;
    const reg = c.get?.("mcTransmigrators");
    const humanName = entry.name?.trim() || reg?.getByUsername?.(username)?.name?.trim() || username;
    const titles = c.get?.("sessionTitle");
    if (titles?.rename && titles.get?.(agent.session)?.title !== humanName) {
      titles.rename(agent.session, humanName);
      log(`session \u663E\u793A\u540D \u2192 ${humanName}`);
    }
  } catch {
  }
  try {
    const c = ctx;
    const reg = c.get?.("mcbots");
    const r = reg?.find((e) => e.username === username);
    if (r && !r.sessionIds.includes(sessionId)) r.sessionIds.push(sessionId);
  } catch {
  }
  log(`\u7A7F\u8D8A\u8005 agent ${resumed ? "\u5DF2\u6062\u590D(resume)" : "\u5DF2\u521B\u5EFA(create)"}: session=${sessionId} model=${agentOptions.model}`);
  const readEpisodicTail = (n) => {
    try {
      return (store?.episodicTail(username, n) ?? []).map((r) => r.text).filter(Boolean);
    } catch {
      return [];
    }
  };
  const attachToWorkspace = async () => {
    try {
      const c = ctx;
      const reg = c.get?.("workspaceRegistry");
      if (!reg?.list) return false;
      const cwdPath = entry.cwd ?? config.cwd ?? process.cwd();
      const real = await realpath(cwdPath).catch(() => cwdPath);
      const ws = reg.list().find((w) => w.path === real || w.path === cwdPath);
      if (!ws) return false;
      await ws.attachSession(SessionId(sessionId));
      log(`session \u5DF2\u6302\u5165\u5DE5\u4F5C\u533A\u300C${ws.title}\u300D`);
      return true;
    } catch (e) {
      log(`workspace attach \u5931\u8D25\uFF08\u975E\u81F4\u547D\uFF09: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };
  for (let i = 0; i < 6; i++) {
    if (await attachToWorkspace()) break;
    await new Promise((r) => setTimeout(r, 5e3 + i * 5e3));
  }
  ctx.effect(() => {
    return () => {
      log(`disposing agent ${sessionId}`);
      void handle?.dispose();
    };
  });
  const writeStatus = () => {
    try {
      const b = body();
      const p = b?.entity?.position;
      let progressSummary = "";
      let progressAlert = null;
      try {
        const prog = ctx.get?.("mcProgress");
        const lv = b?.experience?.level;
        if (typeof lv === "number") prog?.sampleLevel?.(username, lv);
        progressSummary = prog?.summary?.(username) ?? "";
        progressAlert = prog?.diagnose?.(username) ?? null;
      } catch {
      }
      const status = {
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        username,
        connected: !!p,
        viewerPort,
        recentSteps: [],
        bot: {
          personaName: username,
          health: b?.health ?? null,
          food: b?.food ?? null,
          position: p ? { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) } : null,
          yaw: b?.entity?.yaw != null ? +b.entity.yaw.toFixed(1) : null,
          heldItem: b?.heldItem?.name ?? null,
          sleeping: !!b?.isSleeping,
          inventory: (b?.inventory?.items?.() ?? []).slice(0, 36).map((it) => ({ name: it.name, count: it.count })),
          viewerPort
        },
        progress: {
          summary: progressSummary,
          alert: progressAlert
        }
      };
      store?.saveStatus(username, status);
    } catch (e) {
      console.warn(`[mc-session] writeStatus failed (${username}):`, e);
    }
  };
  writeStatus();
  ctx.setInterval(writeStatus, 3e3);
  function classifyBlock(n) {
    if (n.includes("water")) return "~";
    if (n.includes("lava")) return "L";
    if (n.includes("torch")) return "T";
    if (n.includes("bed")) return "b";
    if (n.includes("chest")) return "C";
    if (n.includes("furnace") || n.includes("blast")) return "F";
    if (n.includes("glass")) return "G";
    if (n.includes("ore")) return "o";
    if (n === "grass_block") return "g";
    if (n.includes("log") || n.includes("planks") || n.includes("stem")) return "w";
    if (n.includes("leaves")) return "l";
    if (n.includes("sand") || n.includes("gravel")) return "s";
    if (n === "dirt" || n.includes("podzol") || n.includes("mud") || n.includes("clay")) return "d";
    if (n === "cobblestone" || n.includes("stone_bricks") || n.includes("bricks") || n.includes("concrete") || n.includes("quartz")) return "c";
    if (n === "air" || n === "cave_air" || n === "void_air") return ".";
    if (n === "stone" || n.includes("deepslate") || n.includes("andesite") || n.includes("granite") || n.includes("diorite") || n.includes("tuff") || n.includes("basalt") || n.includes("blackstone") || n.includes("calcite") || n.includes("dripstone")) return "#";
    return "?";
  }
  function writeMapSnapshot() {
    try {
      const bot = body();
      const p = bot?.entity?.position;
      if (!bot || !p) return;
      const username2 = bot.username || "unknown";
      const R = 16;
      let cells = "";
      const heights = [];
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          let ch = ".";
          let h = 0;
          for (let dy = 6; dy >= -10; dy--) {
            const b = bot.blockAt(p.offset(dx, dy, dz));
            if (b && b.name !== "air" && b.name !== "cave_air" && b.name !== "void_air") {
              ch = classifyBlock(b.name);
              h = dy;
              break;
            }
          }
          cells += ch;
          heights.push(h);
        }
      }
      const ents = [];
      for (const e of Object.values(bot.entities)) {
        if (!e || e === bot.entity || !e.position) continue;
        const dx = e.position.x - p.x;
        const dz = e.position.z - p.z;
        if (dx * dx + dz * dz <= 16 * 16) {
          ents.push({ name: e.username ? `${e.username}` : e.name ?? "?", dx: Math.round(dx), dz: Math.round(dz) });
        }
      }
      store?.saveMap(username2, {
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        r: R,
        cx: Math.floor(p.x),
        cy: Math.floor(p.y),
        cz: Math.floor(p.z),
        yaw: bot.entity?.yaw ?? null,
        cells,
        heights,
        entities: ents
      });
    } catch {
    }
  }
  writeMapSnapshot();
  ctx.setInterval(writeMapSnapshot, 1e4);
  if (config.autoRecall !== false && memos) {
    void refreshAutoMemory();
    ctx.setInterval(() => {
      void refreshAutoMemory();
    }, config.autoRecallIntervalMs ?? 6e4);
    log(`autoRecall \u5DF2\u542F\u7528\uFF08topK=${config.autoRecallTopK ?? 3}, interval=${config.autoRecallIntervalMs ?? 6e4}ms\uFF09`);
  }
  const goalsSvc = ctx.get?.("goals");
  const armGoal = (a, objective) => {
    if (!goalsSvc?.create) {
      log("\u26A0\uFE0F goal \u670D\u52A1\u672A\u5C31\u7EEA\uFF0C\u8DF3\u8FC7 goal loop \u63A5\u5165\uFF08agent \u65E0\u81EA\u4E3B\u5FAA\u73AF\uFF0C\u7B49\u63A7\u5236\u7AEF\u624B\u52A8\u9A71\u52A8\uFF09");
      return;
    }
    try {
      const cur = goalsSvc.get?.(a);
      if (cur && cur.phase === "active" && cur.id && typeof cur.revision === "number") {
        try {
          goalsSvc.resume?.(a, { id: cur.id, revision: cur.revision });
          log(`goal \u7EED\u884C\uFF08resume\uFF0Crevision=${cur.revision}\uFF09`);
          return;
        } catch (e) {
          log(`goal resume \u5931\u8D25\uFF08${e instanceof Error ? e.message : String(e)}\uFF09\uFF0C\u8F6C clear+create`);
        }
      }
      if (cur && cur.id && typeof cur.revision === "number") {
        try {
          goalsSvc.clear?.(a, { id: cur.id, revision: cur.revision });
        } catch {
        }
      }
      goalsSvc.create(a, { objective, maxGoalRounds: 1e5 });
      log(`goal \u521B\u5EFA\u5E76 arm\uFF08objective=${objective.slice(0, 40)}${objective.length > 40 ? "\u2026" : ""}\uFF0CmaxGoalRounds=100000\uFF09`);
    } catch (e) {
      log(`goal loop \u63A5\u5165\u5931\u8D25\uFF08${e instanceof Error ? e.message : String(e)}\uFF09`);
    }
  };
  if (autoSteer) {
    if (!resumed) {
      const tail = readEpisodicTail(20);
      if (tail.length) {
        agent.steer(
          createUserMessage({
            content: [{ type: "text", text: `\u4F60\u5728\u4E00\u6B21\u957F\u7720\u540E\u82CF\u9192\uFF0C\u524D\u4E16\u7684\u8BB0\u5FC6\u788E\u7247\u6D8C\u5165\u8111\u6D77\uFF08\u4ECE\u65E7\u5230\u65B0\uFF09\uFF1A
${tail.map((t) => `\xB7 ${t}`).join("\n")}
\u7ED3\u5408\u8FD9\u4E9B\u8BB0\u5FC6\uFF0C\u7EE7\u7EED\u4F60\u672A\u7ADF\u7684\u65C5\u9014\u3002` }],
            source: { kind: "plugin", plugin: "mc-session" }
          })
        );
      }
    }
    armGoal(agent, goal);
  }
}
export {
  Config3 as Config,
  apply,
  inject,
  name
};
