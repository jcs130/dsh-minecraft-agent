// src/mc-bot.ts
import Schema2 from "@deepseek-ai/schemastery";
import mineflayer from "mineflayer";
import pf2 from "mineflayer-pathfinder";
import { plugin as toolPlugin } from "mineflayer-tool";
import { mkdirSync as mkdirSync3, watchFile, unwatchFile, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join4, resolve as resolve2 } from "node:path";

// src/mc-tools.ts
import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import pf from "mineflayer-pathfinder";
import Vec33 from "vec3";
import { chromium } from "playwright-core";
import { join as join2, resolve } from "node:path";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2 } from "node:fs";

// src/mc-camera.ts
import { writeFileSync, readFileSync, unlinkSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import Vec3 from "vec3";
var FOV = Number(process.env.MC_EYES_FOV || 90);
var VIEW_DISTANCE = Number(process.env.MC_EYES_VIEW || 10);
var ANNOTATE = process.env.MC_EYES_ANNOTATE !== "0";
function createVisionGuard(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15e3;
  const maxStreak = opts.maxStreak ?? 3;
  const cooldownMs = opts.cooldownMs ?? 30 * 6e4;
  const state = { failStreak: 0, breakerUntil: 0, lastError: "", lastOkMs: null };
  return {
    state,
    maxStreak,
    cooldownMs,
    tripped: (now = Date.now()) => now < state.breakerUntil,
    async run(label, fn, now = Date.now()) {
      if (now < state.breakerUntil) {
        throw new Error(
          `\u89C6\u89C9\u5DF2\u7194\u65AD\uFF08\u8FDE\u7EED ${state.failStreak} \u6B21\u5931\u8D25\uFF0C\u51B7\u5374\u81F3 ${new Date(state.breakerUntil).toLocaleTimeString()}\uFF09\u2014\u2014\u8FD9\u6BB5\u65F6\u95F4\u6539\u7528\u6587\u5B57\u611F\u77E5\uFF1Amc_scan \u770B\u56DB\u5468\u3001mc_map \u770B\u5730\u5F62\u3001mc_status \u770B\u5168\u8EAB\uFF0C\u522B\u622A\u56FE\u3002`
        );
      }
      const t0 = Date.now();
      let timer;
      try {
        const out = await Promise.race([
          fn(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`\u89C6\u89C9\u64CD\u4F5C\u8D85\u65F6\uFF08>${timeoutMs}ms\uFF09\uFF1A${label}`)), timeoutMs);
          })
        ]);
        state.failStreak = 0;
        state.lastOkMs = Date.now() - t0;
        return out;
      } catch (err) {
        state.failStreak += 1;
        state.lastError = err instanceof Error ? err.message : String(err);
        if (state.failStreak >= maxStreak) state.breakerUntil = now + cooldownMs;
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  };
}
function visionDir(shotsRoot) {
  return shotsRoot ? dirname(shotsRoot) : tmpdir();
}
function readVisionSentinel(shotsRoot) {
  try {
    const p = join(visionDir(shotsRoot), "vision-crash-sentinel.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}
var visionGuard = createVisionGuard();
function visionHealth() {
  return { ...visionGuard.state, tripped: visionGuard.tripped() };
}

// src/mc-perception.ts
import Vec32 from "vec3";
var STALL_LONG_MS = 8 * 6e4;
var STALL_DEATHZONE_MS = 4 * 6e4;
function createReadoutGate(windowMs = 12e4) {
  const seen = /* @__PURE__ */ new Map();
  return {
    /** @returns true = 这份读数刚才答过且没变，可以只回一句「上面已经答过了」。 */
    duplicate(kind, stamp, now = Date.now()) {
      const prev = seen.get(kind);
      if (prev && prev.stamp === stamp && now - prev.at <= windowMs) return true;
      seen.set(kind, { stamp, at: now });
      return false;
    },
    reset(kind) {
      if (kind) seen.delete(kind);
      else seen.clear();
    }
  };
}

// src/mc-tools.ts
var readoutGate = createReadoutGate(12e4);
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
    const cfgPath = ["/app/data/base-protect.json", resolve(process.cwd(), "data/base-protect.json")].find(existsSync2);
    if (cfgPath) {
      const cfg = JSON.parse(readFileSync2(cfgPath, "utf-8"));
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
try {
  const leftover = readVisionSentinel(join2(EPISODIC_DIR, "screenshots"));
  if (leftover) {
    log(`\u26A0\uFE0F \u4E0A\u6B21\u8FDB\u7A0B\u53EF\u80FD\u6B7B\u5728\u89C6\u89C9\u6E32\u67D3\u4E2D\uFF1A${leftover.op} @ ${leftover.ts}\uFF08${leftover.username}\uFF09\u2014\u2014${leftover.note}`);
    log("   \u2192 \u82E5\u518D\u6B21\u53D1\u751F\uFF0C\u4F18\u5148\u5173\u6389 viewerEnabled\uFF08\u5E38\u9A7B 3D \u67E5\u770B\u5668 = neko \u88AB\u62D6\u6B7B\u7684\u540C\u6B3E\u98CE\u9669\uFF09\uFF0C\u5176\u6B21\u518D\u8003\u8651\u7981 mc_see");
  }
  const h = visionHealth();
  log(`\u89C6\u89C9\u5065\u5EB7\uFF1A\u7194\u65AD=${h.tripped ? "\u662F" : "\u5426"}\uFF5C\u8FDE\u7EED\u5931\u8D25=${h.failStreak}\uFF5C\u4E0A\u6B21\u6210\u529F=${h.lastOkMs ?? "-"}ms`);
} catch {
}
var CHROME_PATH = process.env.CHROME_PATH || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "/usr/bin/chromium");
var SHOTS_ROOT = resolve(process.cwd(), "data/screenshots");

// src/mc-connection.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
var CONNECTION_FILE = "mc-connection.json";
var RUNTIME_FILE = "bot-connection.json";
function loadOverrides(dataDir) {
  try {
    const raw = JSON.parse(readFileSync3(join3(dataDir, CONNECTION_FILE), "utf-8"));
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
var name = "mc-bot-service";
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
  const log2 = (msg) => console.log(`[mc-bot-service] ${msg}`);
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
      writeFileSync2(join4(opts.dataDir, RUNTIME_FILE), JSON.stringify(payload, null, 2) + "\n", "utf-8");
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
      log2(`bridged ${persistentListeners.size} persistent event(s) to new bot instance`);
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
    log2(`connecting to ${effective.host}:${effective.port} as "${effective.username}"`);
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
      log2(`spawned at ${p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : "unknown"}`);
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
            log2(`viewer ready: third @ :${effective.viewerPort}, first @ :${effective.viewerPort + 100}`);
          } catch (e) {
            log2(`first-person viewer start failed (ignored): ${e.message}`);
          }
          closeViewer = () => closers.forEach((c) => {
            try {
              c();
            } catch {
            }
          });
        } catch (err) {
          log2(`viewer start failed: ${err.message}`);
        }
      }
    });
    bot.on("death", () => {
      log2("died, auto-respawn in 2s");
      setTimeout(() => {
        if (disposed || currentBot !== bot) return;
        try {
          bot.respawn();
        } catch (err) {
          log2(`respawn failed: ${err.message}`);
        }
      }, 2e3);
    });
    bot.on("login", () => {
      setTimeout(() => {
        if (disposed || currentBot !== bot) return;
        if (!bot.entity) {
          log2("no entity 5s after login (dead at login?), forcing respawn");
          try {
            bot.respawn();
          } catch (err) {
            log2(`force respawn failed: ${err.message}`);
          }
        }
      }, 5e3);
    });
    bot.on("error", (err) => {
      log2(`bot error: ${err.message}`);
    });
    bot.on("end", (reason) => {
      log2(`bot disconnected: ${reason}`);
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
      log2(`reconfiguring connection -> ${effective.host}:${effective.port}`);
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
      log2("disposing, ending bot");
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
function apply(ctx, config) {
  const dataDir = resolve2(config.dataDir || "./data");
  try {
    mkdirSync3(dataDir, { recursive: true });
  } catch {
  }
  const ov = loadOverrides(dataDir);
  const service = createBotService(
    { ...config, ...ov },
    { dataDir, source: Object.keys(ov).length ? "override" : "default" }
  );
  ctx.provide("mcbot", service.facade);
  const ovFile = join4(dataDir, CONNECTION_FILE);
  watchFile(ovFile, { interval: 2e3 }, () => {
    try {
      const next = loadOverrides(dataDir);
      const desired = { host: next.host ?? config.host, port: next.port ?? config.port };
      const cur = service.status();
      if (cur.host === desired.host && cur.port === desired.port) return;
      log0(`connection override file changed -> ${desired.host}:${desired.port}`);
      service.reconfigure(desired, Object.keys(next).length ? "override" : "default");
    } catch (err) {
      log0(`override watcher error: ${err.message}`);
    }
  });
  ctx.effect(() => () => {
    unwatchFile(ovFile);
    service.dispose();
  });
}
var log0 = (msg) => console.log(`[mc-bot-service] ${msg}`);
export {
  Config2 as Config,
  apply,
  createBotService,
  name
};
