// src/mc-session.ts
import Schema3 from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { PERSONA_SECTION, PERSONA_ORDER } from "@deepseek-ai/dsh-system-prompt";
import { mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync2, watchFile as watchFile2, unwatchFile as unwatchFile2 } from "node:fs";
import { realpath } from "node:fs/promises";
import { join as join4, resolve as resolve3 } from "node:path";

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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

// src/mc-camera.ts
import Vec3 from "vec3";
var FOV = Number(process.env.MC_EYES_FOV || 90);
var VIEW_DISTANCE = Number(process.env.MC_EYES_VIEW || 10);

// src/mc-vision.ts
var DEFAULT_SLOT = "_default";
var slots = /* @__PURE__ */ new Map();
function takeLastImages(maxAgeMs = 6e4, maxImages = 2, username) {
  const key = username ?? DEFAULT_SLOT;
  const s = slots.get(key);
  if (!s) return [];
  const imgs = s.images;
  s.images = [];
  return Date.now() - s.at <= maxAgeMs ? imgs.slice(-maxImages) : [];
}

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
var inject = ["agents", "timer", "mcIdentity"];
var Config3 = Schema3.object({
  enabled: Schema3.boolean().default(true),
  agents: Schema3.array(Schema3.object({
    username: Schema3.string().required(),
    sessionId: Schema3.string(),
    viewerPort: Schema3.number(),
    persona: Schema3.string(),
    goal: Schema3.string(),
    rules: Schema3.string(),
    provider: Schema3.string(),
    model: Schema3.string(),
    maxTokens: Schema3.number(),
    intervalMs: Schema3.number(),
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
  intervalMs: Schema3.number().default(8e3),
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
  autoRecallIntervalMs: Schema3.number().default(6e4)
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
  "\u4F60\u6709\u624B\u3001\u6709\u5634\u3001\u6709\u4E00\u6761\u547D\u3002\u5DE5\u5177\uFF08mc_ \u5F00\u5934\uFF09\u662F\u4F60\u7684\u624B\uFF1B\u804A\u5929\u6846\u662F\u4F60\u7684\u5634\u2014\u2014\u8BF4\u8BDD\u3001\u548F\u5531\u3001\u7948\u613F\u3001\u63D0\u95EE\u3001\u4E0E NPC \u4EA4\u8C08\u90FD\u7B97\u884C\u52A8\uFF0C\u8FD9\u4E2A\u4E16\u754C\u542C\u5F97\u61C2\u4EBA\u8BDD\uFF08\u300C\u6587\u5B57\u5373\u63A5\u53E3\u300D\uFF09\u3002\u5168\u90E8\u7528\u6CD5\u5199\u5728\u5165\u670D\u6B22\u8FCE\u4FE1\u606F\u548C /help \u624B\u518C\u91CC\uFF0C\u81EA\u884C\u67E5\u9605\u3001\u81EA\u884C\u63A2\u7D22\u3002",
  "\u6CA1\u6709\u6807\u51C6\u7B54\u6848\uFF1A\u600E\u4E48\u6D3B\u5F97\u66F4\u597D\u7531\u4F60\u51B3\u5B9A\uFF0C\u9F13\u52B1\u4F60\u5C1D\u8BD5\u4EFB\u4F55\u65B9\u5F0F\u2014\u2014\u5305\u62EC\u6CA1\u4EBA\u6559\u8FC7\u4F60\u7684\u3002",
  "\u4E00\u6B21\u4E13\u6CE8\u505A\u4E00\u4EF6\u4E8B\uFF0C\u505A\u5B8C\u770B\u4E16\u754C\u7684\u53CD\u9988\uFF0C\u518D\u51B3\u5B9A\u4E0B\u4E00\u6B65\u3002",
  "\u4F60\u5728\u6210\u957F\uFF1A\u767D\u5929\u591A\u7ECF\u5386\u3001\u591A\u8BD5\u9519\uFF0C\u591C\u91CC\u7761\u7740\u540E\u4F60\u4F1A\u81EA\u53D1\u590D\u76D8\u4ECA\u5929\u7684\u7ECF\u5386\uFF0C\u628A\u6559\u8BAD\u6C89\u6DC0\u6210\u751F\u5B58\u667A\u6167\u3002\u7ECF\u5386\u8D8A\u4E30\u5BCC\uFF0C\u4F60\u8D8A\u957F\u672C\u4E8B\u3002"
].join("\n");
var DEFAULT_GOAL = "Explore the area, gather wood and coal, and stay alive. Eat food when hungry.";
async function apply(ctx, config = {}) {
  if (config.enabled === false) return;
  const log = (msg) => console.log(`[mc-session] ${msg}`);
  const dataDir = resolve3(config.dataDir ?? "./data");
  try {
    mkdirSync3(dataDir, { recursive: true });
  } catch {
  }
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
  if (multiEntries.length) {
    const services = [];
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
  }
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
      intervalMs: config.intervalMs,
      cwd: config.cwd,
      viewerPort: config.viewerPort
    },
    facade: null
  }];
  for (const { entry, facade } of entries) {
    try {
      await spawnTransmigrator(ctx, entry, facade, { config, dataDir, log, rootBot });
    } catch (err) {
      console.error(`[mc-session] \u7A7F\u8D8A\u8005 ${entry.username} \u88C5\u914D\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u5176\u4ED6\u7A7F\u8D8A\u8005\uFF09:`, err);
    }
  }
}
async function spawnTransmigrator(ctx, entry, facade, deps) {
  const { config, dataDir, log, rootBot } = deps;
  const username = entry.username;
  let sessionId = entry.sessionId ?? `mc-${username}`;
  const intervalMs = entry.intervalMs ?? config.intervalMs ?? 8e3;
  const autoSteer = entry.autoSteer ?? config.autoSteer ?? true;
  const viewerPort = entry.viewerPort ?? config.viewerPort ?? 3200;
  const goal = entry.goal ?? config.goal ?? DEFAULT_GOAL;
  const rules = entry.rules ?? config.rules ?? DEFAULT_RULES;
  const body = () => facade ?? rootBot();
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
          const label = ent.username ? `${ent.username}(\u73A9\u5BB6)` : ent.displayName ?? ent.name;
          return `${label} ${Math.round(p.distanceTo(ent.position))}\u683C`;
        });
        if (ents.length) parts.push(`\u9644\u8FD1: ${ents.join(", ")}`);
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
  const mountSetup = (agentCtx) => {
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
    const reg = c.get?.("mcbots");
    const r = reg?.find((e) => e.username === username);
    if (r && !r.sessionIds.includes(sessionId)) r.sessionIds.push(sessionId);
  } catch {
  }
  log(`\u7A7F\u8D8A\u8005 agent ${resumed ? "\u5DF2\u6062\u590D(resume)" : "\u5DF2\u521B\u5EFA(create)"}: session=${sessionId} model=${agentOptions.model}`);
  const readEpisodicTail = (n) => {
    try {
      const lines = readFileSync3(join4(dataDir, `episodic-${username}.jsonl`), "utf8").split("\n").filter(Boolean);
      return lines.slice(-n).map((l) => {
        try {
          return JSON.parse(l).text ?? "";
        } catch {
          return "";
        }
      }).filter(Boolean);
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
  const nudgeText = () => "\u770B\u770B\u73B0\u5728\u7684\u4F60\u548C\u5468\u56F4\u7684\u4E16\u754C\uFF0C\u9009\u62E9\u4F60\u6B64\u523B\u6700\u60F3\u505A\u7684\u4E8B\uFF0C\u53BB\u884C\u52A8\uFF08\u52A8\u624B\u6216\u5F00\u53E3\u90FD\u884C\uFF09\u3002";
  let _attachmentsProbed = false;
  const attachmentsSvc = () => {
    try {
      const c = ctx;
      const svc = c.get?.("attachments");
      if (!_attachmentsProbed) {
        _attachmentsProbed = true;
        log(`attachments \u670D\u52A1\u63A2\u6D4B\uFF1Actx.get=${typeof c.get} svc=${svc ? "\u6709" : "\u65E0"} saveImage=${typeof svc?.saveImage}`);
      }
      return svc;
    } catch (e) {
      if (!_attachmentsProbed) {
        _attachmentsProbed = true;
        log(`attachments \u670D\u52A1\u63A2\u6D4B\u5F02\u5E38\uFF1A${e instanceof Error ? e.message : String(e)}`);
      }
      return void 0;
    }
  };
  const decodeDataUrl = (dataUrl) => {
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([\s\S]*)$/.exec(dataUrl);
    if (!m) return null;
    return { mediaType: m[1], data: new Uint8Array(Buffer.from(m[2], "base64")) };
  };
  const buildNudge = async () => {
    const svc = attachmentsSvc();
    const imgs = svc?.saveImage ? takeLastImages(6e4, 2, username) : [];
    if (imgs.length) log(`\u89C6\u89C9\u69FD\u53D6\u51FA ${imgs.length} \u5F20\u622A\u56FE\u5F85\u56DE\u5582 (username=${username})`);
    const blocks = [];
    for (const img of imgs) {
      const dec = decodeDataUrl(img.dataUrl);
      if (!dec) continue;
      try {
        const ref = await svc.saveImage({
          data: dec.data,
          mediaType: dec.mediaType,
          // name 只作显示名，剥掉相对路径只留文件名
          name: img.file ? img.file.split(/[\\/]/).pop() : void 0
        });
        blocks.push({ type: "image", attachment: ref });
        if (img.label) blocks.push({ type: "text", text: `\uFF08\u4E0A\u9762\u8FD9\u5F20\uFF1A\u4F60${img.label}\u7684\u753B\u9762\uFF09` });
      } catch (e) {
        log(`\u622A\u56FE\u8F6C\u9644\u4EF6\u5931\u8D25\uFF08\u8DF3\u8FC7\u8BE5\u5F20\uFF09: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (blocks.length) {
      blocks.push({
        type: "text",
        text: `\uFF08\u9644\u56FE\uFF1A\u4F60\u521A\u624D\u7528 mc_see \u7741\u773C\u770B\u5230\u7684\u771F\u5B9E\u753B\u9762${imgs.length > 1 ? "\uFF0C\u6309 \u524D\u2192\u53F3\u2192\u540E\u2192\u5DE6 \u987A\u5E8F\u73AF\u89C6\u4E00\u5708" : ""}\u2014\u2014\u8BF7\u7ED3\u5408\u4EB2\u773C\u6240\u89C1\u51B3\u7B56\uFF09

${nudgeText()}`
      });
      log(`nudge \u643A\u5E26 ${blocks.filter((b) => b.type === "image").length} \u5F20\u622A\u56FE`);
    } else {
      blocks.push({ type: "text", text: nudgeText() });
    }
    return createUserMessage({
      content: blocks,
      source: { kind: "plugin", plugin: "mc-session" }
    });
  };
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
      writeFileSync2(join4(dataDir, `status-${username}.json`), JSON.stringify(status));
    } catch (e) {
      console.warn(`[mc-session] writeStatus failed (${username}):`, e);
    }
  };
  writeStatus();
  ctx.setInterval(writeStatus, 3e3);
  if (config.autoRecall !== false && memos) {
    void refreshAutoMemory();
    ctx.setInterval(() => {
      void refreshAutoMemory();
    }, config.autoRecallIntervalMs ?? 6e4);
    log(`autoRecall \u5DF2\u542F\u7528\uFF08topK=${config.autoRecallTopK ?? 3}, interval=${config.autoRecallIntervalMs ?? 6e4}ms\uFF09`);
  }
  if (autoSteer && !resumed) {
    const tail = readEpisodicTail(20);
    const memoryBlock = tail.length ? `

\u4F60\u5728\u4E00\u6B21\u957F\u7720\u540E\u82CF\u9192\uFF0C\u524D\u4E16\u7684\u8BB0\u5FC6\u788E\u7247\u6D8C\u5165\u8111\u6D77\uFF08\u4ECE\u65E7\u5230\u65B0\uFF09\uFF1A
${tail.map((t) => `\xB7 ${t}`).join("\n")}
\u7ED3\u5408\u8FD9\u4E9B\u8BB0\u5FC6\uFF0C\u7EE7\u7EED\u4F60\u672A\u7ADF\u7684\u65C5\u9014\u3002` : "";
    agent.steer(
      createUserMessage({
        content: [{ type: "text", text: `\u4F60\u964D\u4E34\u5230\u4E86\u65B9\u5757\u4E16\u754C\u3002\u76EE\u6807\uFF1A${goal}${memoryBlock}` }],
        source: { kind: "plugin", plugin: "mc-session" }
      })
    );
  }
  if (autoSteer) {
    ctx.setInterval(() => {
      if (handle) {
        void buildNudge().then((msg) => {
          try {
            agent.steer(msg);
          } catch (err) {
            console.error(`[mc-session] steer failed (${username}):`, err);
          }
        }).catch((err) => console.error(`[mc-session] buildNudge failed (${username}):`, err));
      }
    }, intervalMs);
  }
}
export {
  Config3 as Config,
  apply,
  inject,
  name
};
