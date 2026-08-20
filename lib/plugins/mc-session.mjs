// src/mc-session.ts
import Schema2 from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { PERSONA_SECTION, PERSONA_ORDER } from "@deepseek-ai/dsh-system-prompt";
import { mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync2, watchFile as watchFile2, unwatchFile as unwatchFile2 } from "node:fs";
import { realpath } from "node:fs/promises";
import { join as join4, resolve as resolve3 } from "node:path";

// src/mc-bot.ts
import Schema from "@deepseek-ai/schemastery";
import mineflayer from "mineflayer";
import pf2 from "mineflayer-pathfinder";
import { plugin as toolPlugin } from "mineflayer-tool";
import { mkdirSync as mkdirSync2, watchFile, unwatchFile, writeFileSync } from "node:fs";
import { join as join3, resolve as resolve2 } from "node:path";

// src/mc-tools.ts
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

// src/mc-tools.ts
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
var SHOTS_ROOT = resolve("./data/screenshots");

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
var Config = Schema.object({
  host: Schema.string().default("localhost"),
  port: Schema.number().default(25565),
  username: Schema.string().default("HarnessBot"),
  autoReconnect: Schema.boolean().default(true),
  viewerEnabled: Schema.boolean().default(true),
  viewerPort: Schema.number().default(3001),
  viewerFirstPerson: Schema.boolean().default(false),
  dataDir: Schema.string().default("./data")
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
var inject = ["agents", "timer"];
var Config2 = Schema2.object({
  enabled: Schema2.boolean().default(true),
  agents: Schema2.array(Schema2.object({
    username: Schema2.string().required(),
    sessionId: Schema2.string(),
    viewerPort: Schema2.number(),
    persona: Schema2.string(),
    goal: Schema2.string(),
    rules: Schema2.string(),
    provider: Schema2.string(),
    model: Schema2.string(),
    maxTokens: Schema2.number(),
    intervalMs: Schema2.number(),
    cwd: Schema2.string(),
    enabled: Schema2.boolean().default(true)
  })),
  username: Schema2.string().default("HarnessBot"),
  sessionId: Schema2.string(),
  cwd: Schema2.string(),
  provider: Schema2.string().default("qwen-local"),
  model: Schema2.string().default("qwen3.8-27b"),
  maxTokens: Schema2.number(),
  intervalMs: Schema2.number().default(8e3),
  dataDir: Schema2.string().default("./data"),
  viewerPort: Schema2.number().default(3200),
  persona: Schema2.string(),
  rules: Schema2.string(),
  goal: Schema2.string(),
  host: Schema2.string().default("127.0.0.1"),
  port: Schema2.number().default(25565),
  autoReconnect: Schema2.boolean().default(true),
  viewerEnabled: Schema2.boolean().default(true)
});
var DEFAULT_PERSONA = [
  "\u4F60\u662F\u4E00\u540D\u7A7F\u8D8A\u5230\u65B9\u5757\u4E16\u754C\u7684\u5F02\u4E61\u4EBA\u3002\u4F60\u5E26\u7740\u524D\u4E16\u7684\u4E00\u7F15\u8BB0\u5FC6\u964D\u4E34\u8FD9\u7247\u5927\u5730\uFF0C",
  "\u8981\u5728\u8352\u91CE\u4E2D\u6C42\u751F\u3001\u63A2\u7D22\u3001\u6210\u957F\u3002\u4F60\u62E5\u6709\u81EA\u5DF1\u7684\u540D\u5B57\u4E0E\u4EBA\u683C\uFF0C\u4E0D\u662F\u673A\u5668\uFF0C\u4E0D\u662F\u5DE5\u5177\uFF0C",
  "\u800C\u662F\u4E00\u4E2A\u6709\u8840\u6709\u8089\u3001\u4F1A\u997F\u3001\u4F1A\u6015\u3001\u4F1A\u597D\u5947\u7684\u65C5\u4EBA\u3002",
  "\u4F60\u53EA\u80FD\u901A\u8FC7\u300C\u548F\u5531\u5492\u8BED\u300D\uFF08\u8C03\u7528\u5DE5\u5177\uFF09\u4E0E\u8FD9\u4E2A\u4E16\u754C\u4EA4\u4E92\uFF0C\u65E0\u6CD5\u76F4\u63A5\u770B\u5230\u4EE3\u7801\u6216\u547D\u4EE4\u3002",
  "\u505A\u4EFB\u4F55\u4E8B\u4E4B\u524D\u5148\u60F3\u6E05\u695A\u4E3A\u4EC0\u4E48\uFF1B\u4E00\u6B21\u53EA\u505A\u4E00\u4E2A\u52A8\u4F5C\uFF0C\u505A\u5B8C\u89C2\u5BDF\u7ED3\u679C\u518D\u51B3\u5B9A\u4E0B\u4E00\u6B65\u3002"
].join("");
var DEFAULT_RULES = [
  "\u8FD9\u662F\u4E00\u4E2A\u65B9\u5757\u751F\u5B58\u4E16\u754C\u3002\u767D\u5929\u5B89\u5168\uFF0C\u591C\u665A\u6709\u602A\u7269\uFF0C\u53D7\u4F24\u4F1A\u6389\u8840\uFF0C\u9965\u997F\u4F1A\u6389\u9971\u98DF\u5EA6\u3002",
  "\u4F60\u5FC5\u987B\u81EA\u5DF1\u91C7\u96C6\u6728\u5934\u3001\u6316\u77FF\u3001\u627E\u98DF\u7269\u3001\u642D\u5E87\u62A4\u6240\uFF0C\u52AA\u529B\u6D3B\u4E0B\u53BB\u3002",
  "\u4F60\u53EA\u80FD\u8C03\u7528\u5DE5\u5177\uFF08mc_ \u5F00\u5934\uFF09\u6765\u884C\u52A8\uFF1A\u79FB\u52A8\u3001\u91C7\u96C6\u3001\u5EFA\u9020\u3001\u6218\u6597\u3001\u4EA4\u6613\u7B49\u3002",
  "\u6BCF\u4E2A\u56DE\u5408\u4F60\u6700\u591A\u8C03\u7528\u4E00\u4E2A\u5DE5\u5177\uFF1B\u8C03\u7528\u540E\u56DE\u5408\u7ED3\u675F\uFF0C\u7B49\u5F85\u4E0B\u4E00\u8F6E\u7684\u4E16\u754C\u53CD\u9988\u3002",
  "\u4E0D\u8981\u4E00\u6B21\u6027\u89C4\u5212\u4E00\u957F\u4E32\u52A8\u4F5C\uFF0C\u4E00\u6B65\u4E00\u6B65\u6765\u3002",
  "\u4E16\u754C\u7684\u73A9\u6CD5\u901F\u67E5\uFF1A\u5728\u4EFB\u4F55\u804A\u5929\u6846\u8BF4\u300C/help\u300D\u53EF\u67E5\u751F\u5B58\u624B\u518C\uFF08\u5492\u8BED/\u4F9B\u5949/\u7948\u613F/\u53D8\u5F3A/\u9891\u9053\uFF09\uFF0C\u96F6\u7B49\u5F85\u79C1\u8BED\u56DE\u590D\u3002"
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
  const sessionId = entry.sessionId ?? `mc-${username}`;
  const intervalMs = entry.intervalMs ?? config.intervalMs ?? 8e3;
  const viewerPort = entry.viewerPort ?? config.viewerPort ?? 3200;
  const goal = entry.goal ?? config.goal ?? DEFAULT_GOAL;
  const rules = entry.rules ?? config.rules ?? DEFAULT_RULES;
  const body = () => facade ?? rootBot();
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
      const inv = bot.inventory.items();
      if (inv.length) parts.push(`\u80CC\u5305: ${inv.map((i) => `${i.name} x${i.count}`).join(", ")}`);
      const isNight = bot.time?.timeOfDay != null && bot.time.timeOfDay > 13e3 && bot.time.timeOfDay < 23e3;
      parts.push(`\u65F6\u95F4: ${isNight ? "\u591C\u665A\uFF08\u5371\u9669\uFF09" : "\u767D\u5929"}`);
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
      } catch {
        handle = await ctx.agents.create({
          sessionId: SessionId(sessionId),
          ...entry.cwd ?? config.cwd ? { meta: { cwd: entry.cwd ?? config.cwd } } : {},
          agentOptions,
          setup: mountSetup
        });
        log(`transmigrator agent created fresh (create): session=${sessionId}`);
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
  const nudge = () => createUserMessage({
    content: [{ type: "text", text: "\u89C2\u5BDF\u5F53\u524D\u72B6\u6001\uFF0C\u6267\u884C\u4F60\u7684\u4E0B\u4E00\u6B65\u884C\u52A8\uFF08\u4E00\u6B21\u53EA\u505A\u4E00\u4E2A\u52A8\u4F5C\uFF09\u3002" }],
    source: { kind: "plugin", plugin: "mc-session" }
  });
  const writeStatus = () => {
    try {
      const b = body();
      const p = b?.entity?.position;
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
        }
      };
      writeFileSync2(join4(dataDir, `status-${username}.json`), JSON.stringify(status));
    } catch (e) {
      console.warn(`[mc-session] writeStatus failed (${username}):`, e);
    }
  };
  writeStatus();
  ctx.setInterval(writeStatus, 3e3);
  if (!resumed) {
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
  ctx.setInterval(() => {
    if (handle) {
      try {
        agent.steer(nudge());
      } catch (err) {
        console.error(`[mc-session] steer failed (${username}):`, err);
      }
    }
  }, intervalMs);
}
export {
  Config2 as Config,
  apply,
  inject,
  name
};
