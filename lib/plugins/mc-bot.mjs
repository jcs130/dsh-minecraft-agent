// src/mc-bot.ts
import Schema from "@deepseek-ai/schemastery";
import mineflayer from "mineflayer";
import pf2 from "mineflayer-pathfinder";
import { plugin as toolPlugin } from "mineflayer-tool";

// src/mc-tools.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
import pf from "mineflayer-pathfinder";
import Vec32 from "vec3";
import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// src/mc-camera.ts
import Vec3 from "vec3";
var FOV = Number(process.env.MC_EYES_FOV || 90);
var VIEW_DISTANCE = Number(process.env.MC_EYES_VIEW || 10);

// src/mc-tools.ts
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

// src/mc-bot.ts
var name = "mc-bot-service";
var Config = Schema.object({
  host: Schema.string().default("localhost"),
  port: Schema.number().default(25565),
  username: Schema.string().default("HarnessBot"),
  autoReconnect: Schema.boolean().default(true),
  viewerEnabled: Schema.boolean().default(true),
  viewerPort: Schema.number().default(3001),
  viewerFirstPerson: Schema.boolean().default(false)
});
function apply(ctx, config) {
  const log = (msg) => console.log(`[mc-bot-service] ${msg}`);
  let disposed = false;
  let provided = false;
  let currentBot = null;
  let closeViewer = null;
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
    log(`connecting to ${config.host}:${config.port} as "${config.username}"`);
    const bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      checkTimeoutInterval: 3e4
    });
    currentBot = bot;
    if (!provided) {
      ctx.provide("mcbot", facade);
      provided = true;
    }
    bot.loadPlugin(pf2.pathfinder);
    bot.loadPlugin(toolPlugin);
    attachAll(bot);
    bot.once("spawn", async () => {
      const p = bot.entity?.position;
      log(`spawned at ${p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : "unknown"}`);
      bot.pathfinder.setMovements(tunedMovements(bot));
      if (config.viewerEnabled) {
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
            port: config.viewerPort,
            firstPerson: false
          });
          const closeThird = bot.viewer.close.bind(bot.viewer);
          const closers = [closeThird];
          try {
            mineflayerViewer(bot, {
              port: config.viewerPort + 100,
              firstPerson: true
            });
            closers.push(bot.viewer.close.bind(bot.viewer));
            log(`viewer ready: third @ :${config.viewerPort}, first @ :${config.viewerPort + 100}`);
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
      if (!disposed && config.autoReconnect) {
        setTimeout(() => {
          if (disposed) return;
          connect();
        }, 3e3);
      }
    });
  }
  connect();
  ctx.effect(() => {
    return () => {
      disposed = true;
      log("disposing, ending bot");
      if (closeViewer) {
        closeViewer();
        closeViewer = null;
      }
      if (currentBot) {
        currentBot.end("plugin disposed");
        currentBot = null;
      }
    };
  });
}
export {
  Config,
  apply,
  name
};
