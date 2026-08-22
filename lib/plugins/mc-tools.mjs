// src/mc-tools.ts
import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import pf from "mineflayer-pathfinder";
import Vec32 from "vec3";
import { chromium } from "playwright-core";
import { join as join2, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

// src/mc-camera.ts
import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import Vec3 from "vec3";
var vision = null;
var visionTried = false;
var visionError = "";
async function loadVision() {
  if (visionTried) return vision;
  visionTried = true;
  try {
    const [threeMod, canvasMod, viewerMod, worldViewMod] = await Promise.all([
      import("three"),
      import("node-canvas-webgl/lib/index.js"),
      import("prismarine-viewer/viewer/lib/viewer.js"),
      import("prismarine-viewer/viewer/lib/worldView.js")
    ]);
    const THREE = threeMod.default ?? threeMod;
    const [entitiesMod] = await Promise.all([
      import("prismarine-viewer/viewer/lib/entities.js")
    ]);
    const entitiesRaw = entitiesMod.default ?? entitiesMod;
    const origGetEntityMesh = entitiesRaw.getEntityMesh;
    if (typeof origGetEntityMesh === "function") {
      entitiesRaw.getEntityMesh = (...fnArgs) => {
        try {
          return origGetEntityMesh(...fnArgs);
        } catch {
          const dummy = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 0.25, 0.25),
            new THREE.MeshBasicMaterial({ visible: false })
          );
          return dummy;
        }
      };
    }
    const isEntityNoise = (a) => {
      const flat = a.map((x) => x instanceof Error ? x.message : String(x)).join(" ");
      return /^(Error: )?Unknown entity /.test(flat);
    };
    for (const level of ["error", "log"]) {
      const orig = console[level].bind(console);
      console[level] = (...a) => {
        if (isEntityNoise(a)) return;
        orig(...a);
      };
    }
    global.Worker = Worker;
    global.THREE = THREE;
    vision = {
      THREE,
      createCanvas: canvasMod.createCanvas,
      Viewer: viewerMod.Viewer,
      WorldView: worldViewMod.WorldView
    };
    console.log("[mc-camera] vision stack loaded (three + node-canvas-webgl + prismarine-viewer)");
  } catch (err) {
    visionError = err instanceof Error ? err.message : String(err);
    console.warn(`[mc-camera] vision stack unavailable (headless deployment?) \u2014 mc_see degraded: ${visionError}`);
  }
  return vision;
}
var WIDTH = 800;
var HEIGHT = 512;
var FOV = Number(process.env.MC_EYES_FOV || 90);
var VIEW_DISTANCE = Number(process.env.MC_EYES_VIEW || 10);
var KEEP_SHOTS = 40;
var current = null;
var building = null;
function isAlive(c) {
  return !!c && c.bot.entity != null && c.bot.world != null;
}
async function build(bot) {
  const v = await loadVision();
  if (!v) throw new Error(`camera unavailable (vision stack not loadable: ${visionError})`);
  const canvas = v.createCanvas(WIDTH, HEIGHT);
  const renderer = new v.THREE.WebGLRenderer({ canvas });
  const viewer = new v.Viewer(renderer);
  const entities = viewer.entities;
  if (entities?.update) {
    const origUpdate = entities.update.bind(entities);
    entities.update = (...a) => {
      try {
        origUpdate(...a);
      } catch {
      }
    };
  }
  viewer.camera.fov = FOV;
  viewer.camera.updateProjectionMatrix();
  console.log(`[mc-camera] camera built: fov=${FOV} (v), view=${VIEW_DISTANCE} chunks, ${WIDTH}x${HEIGHT}`);
  const botPos = bot.entity.position;
  const center = new Vec3(botPos.x, botPos.y + bot.entity.height, botPos.z);
  viewer.setVersion(bot.version);
  const worldView = new v.WorldView(bot.world, VIEW_DISTANCE, center);
  viewer.listen(worldView);
  worldView.listenToBot(bot);
  const state = { bot, renderer, canvas, viewer, worldView, ready: Promise.resolve() };
  await worldView.init(center);
  return state;
}
function getCamera(bot) {
  if (isAlive(current) && current.bot === bot) return Promise.resolve(current);
  if (isAlive(current) && current.bot !== bot) {
    current = null;
  }
  if (!building) {
    if (!bot.entity || !bot.world) throw new Error("camera: bot not spawned yet");
    building = build(bot).then((c) => {
      current = c;
      return c;
    }).finally(() => {
      building = null;
    });
  }
  return building;
}
async function pruneOld(dir) {
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg"));
    if (files.length <= KEEP_SHOTS) return;
    const sorted = files.sort();
    for (const f of sorted.slice(0, sorted.length - KEEP_SHOTS)) {
      await unlink(join(dir, f)).catch(() => {
      });
    }
  } catch {
  }
}
async function waitForMesher(cam) {
  const wr = cam.viewer.world;
  if (!wr || wr.sectionsOutstanding.size === 0) return;
  const world = wr;
  const emitter = wr.renderUpdateEmitter;
  await new Promise((resolve2) => {
    const t = setTimeout(done, 15e3);
    function done() {
      clearTimeout(t);
      emitter.off("update", onDone);
      resolve2();
    }
    function onDone() {
      if (world.sectionsOutstanding.size === 0) done();
    }
    emitter.on("update", onDone);
  });
}
async function renderOne(cam, bot, yaw, pitch, shotsRoot, suffix) {
  const e = bot.entity;
  if (cam.viewer.camera.fov !== FOV) {
    cam.viewer.camera.fov = FOV;
    cam.viewer.camera.updateProjectionMatrix();
  }
  const center = new Vec3(e.position.x, e.position.y + e.height, e.position.z);
  cam.viewer.camera.position.set(center.x, center.y, center.z);
  await cam.worldView.updatePosition(center);
  cam.viewer.setFirstPersonCamera(e.position, yaw, pitch);
  cam.viewer.update();
  cam.renderer.render(cam.viewer.scene, cam.viewer.camera);
  const { getBufferFromStream } = await import("prismarine-viewer/viewer/lib/simpleUtils.js");
  const imageStream = cam.canvas.createJPEGStream({ bufsize: 4096, quality: 88, progressive: false });
  const buffer = await getBufferFromStream(imageStream);
  let file = null;
  if (shotsRoot) {
    const dir = join(shotsRoot, bot.username || "unknown");
    await mkdir(dir, { recursive: true });
    const name2 = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}${suffix}.jpg`;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, name2), buffer);
    file = `${bot.username || "unknown"}/${name2}`;
    void pruneOld(dir);
  }
  return { buffer, file };
}
async function captureFirstPerson(bot, shotsRoot) {
  const cam = await getCamera(bot);
  await waitForMesher(cam);
  const e = bot.entity;
  return await renderOne(cam, bot, e.yaw, e.pitch, shotsRoot, "");
}
async function captureLookaround(bot, shotsRoot) {
  const cam = await getCamera(bot);
  await waitForMesher(cam);
  const e = bot.entity;
  const baseYaw = e.yaw;
  const pitch = Math.max(-0.3, Math.min(0.3, e.pitch));
  const dirs = [
    { label: "\u524D\u65B9", key: "front", dy: 0 },
    { label: "\u53F3\u65B9", key: "right", dy: Math.PI / 2 },
    { label: "\u540E\u65B9", key: "back", dy: Math.PI },
    { label: "\u5DE6\u65B9", key: "left", dy: -Math.PI / 2 }
  ];
  const shots = [];
  for (const d of dirs) {
    const shot = await renderOne(cam, bot, baseYaw + d.dy, pitch, shotsRoot, `-${d.key}`);
    shots.push({ ...shot, label: d.label, key: d.key });
  }
  return shots;
}

// src/mc-bots.ts
function registryBots(ctx) {
  try {
    const c = ctx;
    const reg = c.get?.("mcbots");
    return Array.isArray(reg) ? reg : [];
  } catch {
    return [];
  }
}
function botFor(ctx, exec) {
  const reg = registryBots(ctx);
  if (reg.length) {
    const sid = exec?.agent?.id != null ? String(exec.agent.id) : "";
    if (sid) {
      const bySid = reg.find((e) => e.sessionIds.includes(sid));
      if (bySid) return bySid.facade;
      const parsed = sid.replace(/^mc[-_]/i, "").split(/[-_]/)[0]?.toLowerCase();
      if (parsed) {
        const byName = reg.find((e) => e.username.toLowerCase() === parsed);
        if (byName) return byName.facade;
      }
    }
  }
  try {
    const b = exec?.agent?.ctx?.mcbot;
    if (b) return b;
  } catch {
  }
  try {
    return ctx.mcbot;
  } catch {
    return void 0;
  }
}

// src/mc-tools.ts
var name = "mc-tools";
var inject = ["tools", "mcbot", "mcStore"];
var Config = Schema.object({
  dataDir: Schema.string().default("./data")
});
var relDir = (dx, dz) => {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  if (ax === 0 && az === 0) return "\u811A\u4E0B";
  const ew = dx >= 0 ? "\u4E1C" : "\u897F";
  const ns = dz >= 0 ? "\u5357" : "\u5317";
  if (ax >= az * 2) return ew;
  if (az >= ax * 2) return ns;
  return ew + ns;
};
var pluginCtx;
var mcStore;
var sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
function text(value) {
  return [{ type: "text", text: String(value) }];
}
function resolveBot(exec) {
  if (pluginCtx) {
    const b = botFor(pluginCtx, exec);
    if (b) return b;
  }
  try {
    const b = exec?.agent?.ctx?.mcbot;
    if (b) return b;
  } catch {
  }
  return void 0;
}
var EPISODIC_DIR = resolve(process.cwd(), "data");
function recordEpisodic(bot, args, outcome, failed = false) {
  const u = bot.username;
  if (!u) return;
  const p = bot.entity?.position;
  const pos = p ? `(${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}) ` : "";
  let argsStr = "";
  try {
    const s = JSON.stringify(args);
    if (s && s !== "{}") argsStr = ` ${s.slice(0, 120)}`;
  } catch {
  }
  const outcomeStr = typeof outcome === "string" ? outcome : outcome && typeof outcome === "object" && "message" in outcome ? String(outcome.message) : String(outcome);
  const text2 = `${failed ? "\u2717 " : ""}${pos}->${argsStr} = ${outcomeStr.slice(0, 220)}`;
  mcStore?.appendEpisodic(u, text2);
}
function guard(fn) {
  return async (args, exec) => {
    try {
      const bot = resolveBot(exec);
      if (!bot) return "bot not available (agent has no body)";
      if (!bot.entity) return "bot is not connected / has not spawned yet";
      const out = await fn(bot, args);
      try {
        recordEpisodic(bot, args, out);
      } catch {
      }
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        const b = resolveBot(exec);
        if (b) recordEpisodic(b, args, msg, true);
      } catch {
      }
      return `tool error: ${msg}`;
    }
  };
}
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
function hardResetPathfinder(bot) {
  try {
    bot.pathfinder.setGoal(null);
  } catch {
  }
  try {
    bot.pathfinder.stop();
  } catch {
  }
  try {
    bot.clearControlStates();
  } catch {
  }
  try {
    bot.pathfinder.setMovements(tunedMovements(bot));
  } catch {
  }
}
async function resyncPulse(bot) {
  try {
    bot.setControlState("jump", true);
    await sleep(400);
    bot.setControlState("jump", false);
    await sleep(300);
    const dirs = ["forward", "back", "left", "right"];
    for (const dir of dirs) {
      bot.setControlState("jump", true);
      bot.setControlState(dir, true);
      await sleep(500);
      bot.setControlState(dir, false);
      bot.setControlState("jump", false);
      await sleep(200);
    }
  } catch {
  }
}
async function gotoNear(bot, pos, reach, timeoutMs = 2e4) {
  const attempt = async (budgetMs) => {
    const goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, reach);
    const startPos = bot.entity.position.clone();
    let bestProgress = 0;
    let stallTicks = 0;
    let settled = false;
    let abort = null;
    const abortPromise = new Promise((_, reject) => {
      abort = () => reject(new Error("movement wedged: pathfinder active but position frozen"));
    });
    const gotoPromise = bot.pathfinder.goto(goal);
    gotoPromise.catch(() => {
    });
    const watchdog = setInterval(() => {
      if (settled || !abort) return;
      if (!bot.entity) {
        stallTicks = 99;
        abort();
        return;
      }
      const moved = bot.entity.position.distanceTo(startPos);
      if (moved > bestProgress + 0.4) {
        bestProgress = moved;
        stallTicks = 0;
      } else if (bot.pathfinder.isMoving() && !bot.pathfinder.isMining() && !bot.pathfinder.isBuilding()) {
        stallTicks++;
        if (stallTicks >= 3) abort();
      } else {
        stallTicks = 0;
      }
    }, 1500);
    try {
      await Promise.race([
        gotoPromise,
        abortPromise,
        new Promise(
          (_, reject) => setTimeout(() => reject(new Error("pathfinding timed out")), budgetMs)
        )
      ]);
      settled = true;
      const dist = bot.entity ? bot.entity.position.distanceTo(pos) : Infinity;
      if (dist > reach + 1.5) {
        const dy = bot.entity ? Math.abs(bot.entity.position.y - pos.y) : 0;
        const horizontalGap = dist - dy;
        const verticalDesync = horizontalGap <= reach;
        console.error(`[mc-tools] gotoNear FALSE-POSITIVE: resolved but real dist=${dist.toFixed(2)} > reach+1.5 (dy=${dy.toFixed(1)}, hGap=${horizontalGap.toFixed(1)}) \u2014 ${verticalDesync ? "vertical desync \u2192 retry" : "horizontal gap \u2192 give up"}`);
        return { reached: false, wedged: verticalDesync };
      }
      return { reached: true, wedged: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const moved = bot.entity ? bot.entity.position.distanceTo(startPos) : -1;
      const wedged = stallTicks >= 2;
      console.error(`[mc-tools] gotoNear FAIL: ${msg} | moved=${moved.toFixed(2)} target=(${pos.x},${pos.y},${pos.z}) reach=${reach}${wedged ? " | WEDGE detected" : ""}`);
      return { reached: false, wedged };
    } finally {
      settled = true;
      clearInterval(watchdog);
      try {
        bot.pathfinder.setGoal(null);
      } catch {
      }
      try {
        bot.clearControlStates();
      } catch {
      }
    }
  };
  const first = await attempt(timeoutMs);
  if (first.reached) return true;
  hardResetPathfinder(bot);
  await resyncPulse(bot);
  if (!first.wedged) return false;
  const second = await attempt(1e4);
  if (!second.reached) hardResetPathfinder(bot);
  return second.reached;
}
async function gotoXZ(bot, x, z, range, timeoutMs = 15e3) {
  const goal = new pf.goals.GoalNearXZ(x, z, range);
  try {
    await Promise.race([
      bot.pathfinder.goto(goal),
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error("pathfinding timed out")), timeoutMs)
      )
    ]);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mc-tools] gotoXZ FAIL: ${msg} | target=(${x},${z}) range=${range}`);
    hardResetPathfinder(bot);
    return false;
  }
}
async function pickupNearby(bot) {
  const before = bot.inventory.items().reduce((s, i) => s + i.count, 0);
  await sleep(300);
  if (bot.inventory.items().reduce((s, i) => s + i.count, 0) > before) return;
  const item = bot.nearestEntity(
    (e) => e.name === "item" && bot.entity.position.distanceTo(e.position) < 8
  );
  if (!item) return;
  await gotoXZ(bot, item.position.x, item.position.z, 0.5);
  await sleep(300);
}
async function equipBestWeapon(bot) {
  const weapons = bot.inventory.items().filter((i) => i.name.includes("sword") || i.name.includes("axe"));
  if (weapons.length === 0) return;
  weapons.sort((a, b) => b.attackDamage - a.attackDamage);
  const weapon = weapons[0];
  if (weapon) await bot.equip(weapon, "hand");
}
async function craftItem(bot, itemName, count) {
  const item = bot.registry.itemsByName[itemName];
  if (!item) return `unknown item: ${itemName}`;
  const allRecipes = bot.recipesAll(item.id, null, true);
  if (allRecipes.length === 0) return `no recipe for ${itemName}`;
  const resultCount = allRecipes[0].result.count;
  let table = null;
  if (allRecipes.some((r) => r.requiresTable)) {
    const tableBlock = bot.findBlock({
      matching: (b) => !!b && b.name === "crafting_table",
      maxDistance: 16
    });
    if (!tableBlock) return `crafting ${itemName} needs a crafting table, but none is within 16 blocks`;
    const reached = await gotoNear(bot, tableBlock.position, 3);
    if (!reached) return "could not reach the crafting table";
    table = tableBlock;
  }
  const feasible = bot.recipesFor(item.id, null, count * resultCount, table);
  if (feasible.length === 0) {
    const missing = allRecipes[0].delta.filter((d) => d.count < 0).map((d) => {
      const nm = bot.registry.items[d.id]?.name ?? `id:${d.id}`;
      return `${nm} x${Math.abs(d.count) * Math.ceil(count / resultCount)}`;
    }).join(", ");
    return `not enough ingredients to craft ${count} ${itemName}; missing: ${missing || "unknown"}`;
  }
  const recipe = feasible[0];
  try {
    await bot.craft(recipe, count, table);
  } catch (err) {
    return `craft failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  return `crafted ${count} ${itemName}`;
}
var STORAGE_BLOCKS = ["chest", "barrel", "trapped_chest", "hopper", "dropper", "dispenser"];
var FURNACE_BLOCKS = ["furnace", "blast_furnace", "smoker"];
function coordArgs(args) {
  const num = (v) => typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : void 0;
  return { x: num(args.x), y: num(args.y), z: num(args.z) };
}
function findStorageBlock(bot, args, range) {
  const { x, y, z } = coordArgs(args);
  if (x !== void 0 && y !== void 0 && z !== void 0) {
    const b = bot.blockAt(new Vec32(x, y, z));
    return b && STORAGE_BLOCKS.includes(b.name) ? b : null;
  }
  return bot.findBlock({
    matching: (b) => !!b && STORAGE_BLOCKS.includes(b.name),
    maxDistance: range
  }) ?? null;
}
function findFurnaceBlock(bot, args, range) {
  const { x, y, z } = coordArgs(args);
  if (x !== void 0 && y !== void 0 && z !== void 0) {
    const b = bot.blockAt(new Vec32(x, y, z));
    return b && FURNACE_BLOCKS.includes(b.name) ? b : null;
  }
  return bot.findBlock({
    matching: (b) => !!b && FURNACE_BLOCKS.includes(b.name),
    maxDistance: range
  }) ?? null;
}
function noContainerMessage(bot, args, range) {
  const { x, y, z } = coordArgs(args);
  if (x !== void 0 && y !== void 0 && z !== void 0) {
    const b = bot.blockAt(new Vec32(x, y, z));
    if (b && FURNACE_BLOCKS.includes(b.name)) {
      return `(${x}, ${y}, ${z}) is a ${b.name}, not a chest \u2014 use mc_smelt to smelt items in it, or mc_view_furnace to look inside`;
    }
    if (b && (b.name === "enchanting_table" || b.name === "enchantment_table")) {
      return `(${x}, ${y}, ${z}) is an enchanting table, not a chest \u2014 use mc_enchant to enchant items there`;
    }
    if (b) {
      return `(${x}, ${y}, ${z}) is a ${b.name}, not a container this tool can open`;
    }
    return `no block at (${x}, ${y}, ${z}) \u2014 chunk not loaded or wrong coordinates`;
  }
  const f = bot.findBlock({
    matching: (blk) => !!blk && FURNACE_BLOCKS.includes(blk.name),
    maxDistance: range
  });
  if (f) {
    return `no chest/barrel found nearby, but there is a ${f.name} at (${f.position.x}, ${f.position.y}, ${f.position.z}) \u2014 use mc_smelt on it`;
  }
  return "no chest/barrel found nearby (give x/y/z, or move closer to one)";
}
async function openStorage(bot, block) {
  const reached = await gotoNear(bot, block.position, 3);
  if (!reached) throw new Error("could not reach the container");
  return openWithRetry(() => bot.openContainer(block));
}
function heldCount(bot, itemName) {
  return bot.inventory.items().reduce((s, i) => i.name === itemName ? s + i.count : s, 0);
}
async function settleHeldCount(bot, itemName, staleValue, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  let v = heldCount(bot, itemName);
  while (v === staleValue && Date.now() < deadline) {
    await sleep(40);
    v = heldCount(bot, itemName);
  }
  return v;
}
async function transferWithChest(bot, args, mode) {
  const itemName = String(args.itemType ?? "");
  if (!itemName) return "itemType is required";
  const item = bot.registry.itemsByName[itemName];
  if (!item) return `unknown item: ${itemName}`;
  const range = Math.max(1, Math.floor(Number(args.range ?? 16)));
  const block = findStorageBlock(bot, args, range);
  if (!block) return noContainerMessage(bot, args, range);
  const count = args.count === void 0 || args.count === null ? null : Math.max(1, Math.floor(Number(args.count)));
  let container;
  try {
    container = await openStorage(bot, block);
  } catch (err) {
    return `failed to open container: ${err instanceof Error ? err.message : String(err)}`;
  }
  const before = heldCount(bot, itemName);
  let want = 0;
  let transferErr = "";
  try {
    if (mode === "deposit") {
      want = count ?? before;
      if (want > 0) await container.deposit(item.id, null, want);
    } else {
      const inContainer = container.containerItems().reduce((s, i) => i.name === itemName ? s + i.count : s, 0);
      want = count ?? inContainer;
      if (want > 0) await container.withdraw(item.id, null, want);
    }
  } catch (err) {
    transferErr = err instanceof Error ? err.message : String(err);
  } finally {
    container.close();
  }
  const after = await settleHeldCount(bot, itemName, before);
  const moved = mode === "deposit" ? before - after : after - before;
  const ofPart = transferErr || moved < want ? ` of ${want}` : "";
  if (mode === "deposit") {
    if (moved > 0) return `deposited ${moved}${ofPart} ${itemName} into ${block.name}`;
    if (before === 0) return `no ${itemName} in inventory to deposit`;
    return transferErr ? `deposit failed: ${transferErr}` : `no ${itemName} in inventory to deposit`;
  }
  if (moved > 0) return `withdrew ${moved}${ofPart} ${itemName} from ${block.name}`;
  return transferErr ? `withdraw failed: ${transferErr}` : `no ${itemName} in ${block.name} to withdraw`;
}
async function viewChest(bot, args) {
  const range = Math.max(1, Math.floor(Number(args.range ?? 16)));
  const block = findStorageBlock(bot, args, range);
  if (!block) return noContainerMessage(bot, args, range);
  let container;
  try {
    container = await openStorage(bot, block);
  } catch (err) {
    return `failed to open container: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    const items = container.containerItems();
    const at = `(${block.position.x}, ${block.position.y}, ${block.position.z})`;
    if (items.length === 0) return `chest at ${at} is empty`;
    return `chest at ${at} contains: ${items.map((i) => `${i.name} x${i.count}`).join(", ")}`;
  } finally {
    container.close();
  }
}
var FUEL_PRIORITY = [
  "coal",
  "charcoal",
  "oak_planks",
  "spruce_planks",
  "birch_planks",
  "jungle_planks",
  "acacia_planks",
  "dark_oak_planks",
  "mangrove_planks",
  "cherry_planks",
  "bamboo_planks",
  "oak_log",
  "spruce_log",
  "birch_log",
  "stick"
];
var FUEL_BURN_ITEMS = { coal: 8, charcoal: 8 };
var DEFAULT_FUEL_ITEMS = 1.5;
var SMELT_SECONDS_PER_ITEM = 10;
var SMELT_MAX_BATCH = 6;
function fuelEach(name2) {
  return FUEL_BURN_ITEMS[name2] ?? DEFAULT_FUEL_ITEMS;
}
function pickFuel(bot) {
  for (const name2 of FUEL_PRIORITY) {
    const it = bot.inventory.items().find((i) => i.name === name2);
    if (it) return { name: name2, id: it.type };
  }
  return null;
}
async function openFurnaceAt(bot, block) {
  const reached = await gotoNear(bot, block.position, 3);
  if (!reached) throw new Error("could not reach the furnace");
  return openWithRetry(() => bot.openFurnace(block));
}
async function openWithRetry(open) {
  try {
    return await open();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/windowOpen did not fire/.test(msg)) throw err;
    await sleep(600);
    return await open();
  }
}
async function doSmelt(bot, args) {
  const itemName = String(args.itemType ?? "");
  if (!itemName) return "itemType is required";
  const item = bot.registry.itemsByName[itemName];
  if (!item) return `unknown item: ${itemName}`;
  const range = Math.max(1, Math.floor(Number(args.range ?? 16)));
  const block = findFurnaceBlock(bot, args, range);
  if (!block) {
    return 'no furnace/blast furnace/smoker found nearby \u2014 craft one (mc_craft "furnace", needs 8 cobblestone), place it (mc_place), then mc_smelt again';
  }
  const held = heldCount(bot, itemName);
  if (held === 0) return `no ${itemName} in inventory to smelt`;
  const fuelName = args.fuelType ? String(args.fuelType) : "";
  let fuel;
  if (fuelName) {
    const reg = bot.registry.itemsByName[fuelName];
    if (!reg) return `unknown fuel item: ${fuelName}`;
    if (heldCount(bot, fuelName) === 0) return `no ${fuelName} in inventory`;
    fuel = { name: fuelName, id: reg.id };
  } else {
    const picked = pickFuel(bot);
    if (!picked) return "no fuel in inventory (coal, charcoal, planks and logs all work)";
    fuel = picked;
  }
  const want = Math.min(
    args.count ? Math.max(1, Math.floor(Number(args.count))) : held,
    held,
    SMELT_MAX_BATCH
  );
  let furnace;
  try {
    furnace = await openFurnaceAt(bot, block);
  } catch (err) {
    return `failed to open furnace: ${err instanceof Error ? err.message : String(err)}`;
  }
  const at = `(${block.position.x}, ${block.position.y}, ${block.position.z})`;
  let collected = 0;
  let stillQueued = 0;
  try {
    if (furnace.outputItem()) {
      const got = await furnace.takeOutput();
      collected += got.count;
    }
    const cur = furnace.inputItem();
    if (cur && cur.name !== itemName) {
      return `furnace at ${at} is already smelting ${cur.name} x${cur.count} \u2014 try again later or use another furnace`;
    }
    const alreadyIn = cur ? cur.count : 0;
    const load = want - alreadyIn;
    if (load > 0) await furnace.putInput(item.id, null, load);
    const fuelNeed = Math.max(1, Math.ceil(want / fuelEach(fuel.name)));
    const curFuel = furnace.fuelItem();
    if (!curFuel && fuelNeed > 0) {
      const fuelLeft = heldCount(bot, fuel.name);
      if (fuelLeft === 0) return `no ${fuel.name} left for fuel`;
      await furnace.putFuel(fuel.id, null, Math.min(fuelNeed, fuelLeft));
    }
    const deadline = Date.now() + (want * SMELT_SECONDS_PER_ITEM + 20) * 1e3;
    while (furnace.inputItem() && Date.now() < deadline) await sleep(3e3);
    if (furnace.outputItem()) {
      const got = await furnace.takeOutput();
      collected += got.count;
    }
    const remainingInput = furnace.inputItem();
    stillQueued = remainingInput ? remainingInput.count : 0;
  } finally {
    furnace.close();
  }
  const invLeft = await settleHeldCount(bot, itemName, held);
  const parts = [`smelted ${collected} ${itemName} at ${at} (fuel: ${fuel.name})`];
  if (stillQueued > 0) parts.push(`${stillQueued} still smelting inside \u2014 call mc_smelt again in ~${Math.ceil(stillQueued * SMELT_SECONDS_PER_ITEM)}s to collect`);
  if (invLeft > 0 && collected > 0) parts.push(`${invLeft} more ${itemName} in inventory \u2014 call mc_smelt again for the next batch`);
  return parts.join("; ");
}
async function viewFurnaceContent(bot, args) {
  const range = Math.max(1, Math.floor(Number(args.range ?? 16)));
  const block = findFurnaceBlock(bot, args, range);
  if (!block) {
    const c = findStorageBlock(bot, args, range);
    return c ? `that is a ${c.name}, not a furnace \u2014 use mc_view_chest` : "no furnace/blast furnace/smoker found nearby";
  }
  let furnace;
  try {
    furnace = await openFurnaceAt(bot, block);
  } catch (err) {
    return `failed to open furnace: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    const at = `(${block.position.x}, ${block.position.y}, ${block.position.z})`;
    const inp = furnace.inputItem();
    const fu = furnace.fuelItem();
    const out = furnace.outputItem();
    const secsLeft = furnace.progressSeconds;
    const prog = typeof secsLeft === "number" && secsLeft > 0 ? `, ~${Math.ceil(secsLeft)}s left` : "";
    return [
      `${block.name} at ${at}:`,
      `- input: ${inp ? `${inp.name} x${inp.count}` : "empty"}`,
      `- fuel: ${fu ? `${fu.name} x${fu.count}` : "empty"}`,
      `- output: ${out ? `${out.name} x${out.count}` : "empty"}${prog}`,
      "smelt with mc_smelt (it also collects finished output)"
    ].join("\n");
  } finally {
    furnace.close();
  }
}
function findEnchantTable(bot, range = 16) {
  return bot.findBlock({
    matching: (b) => !!b && (b.name === "enchanting_table" || b.name === "enchantment_table"),
    maxDistance: range
  }) ?? null;
}
async function doEnchant(bot, args) {
  const itemName = String(args.itemType ?? "");
  if (!itemName) return "itemType is required";
  const inv = bot.inventory.items().find((i) => i.name === itemName);
  if (!inv) return `no ${itemName} in inventory`;
  const table = findEnchantTable(bot);
  if (!table) {
    return 'no enchanting table nearby \u2014 craft and place one first (mc_craft "enchanting_table", needs book + 2 diamonds + 4 obsidian)';
  }
  const lapis = bot.inventory.items().find((i) => i.name === "lapis_lazuli");
  if (!lapis) return "no lapis_lazuli in inventory \u2014 enchanting costs 1-3 lapis and experience levels";
  if (bot.experience.level < 1) return `not enough experience (level ${bot.experience.level}, need 1+)`;
  const reached = await gotoNear(bot, table.position, 2);
  if (!reached) return "could not reach the enchanting table";
  let et;
  try {
    et = await openWithRetry(() => bot.openEnchantmentTable(table));
  } catch (err) {
    return `failed to open enchanting table: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    await et.putTargetItem(inv);
    await et.putLapis(lapis);
    const deadline = Date.now() + 1e4;
    while (et.enchantments.length === 0 && Date.now() < deadline) await sleep(500);
    const offers = et.enchantments;
    if (offers.length === 0) {
      return "the table offered no enchantments (item may be unenchantable or already enchanted) \u2014 took the item back";
    }
    let idx = 0;
    if (args.choice !== void 0 && args.choice !== null) {
      idx = Math.max(0, Math.min(offers.length - 1, Math.floor(Number(args.choice))));
    } else {
      const lvl = bot.experience.level;
      let bestLevel = -1;
      for (let i = 0; i < offers.length; i++) {
        if (offers[i].level <= lvl && offers[i].level > bestLevel) {
          bestLevel = offers[i].level;
          idx = i;
        }
      }
      if (bestLevel === -1) {
        return `all offers need more levels than you have (${bot.experience.level}) \u2014 took the item back`;
      }
    }
    const chosen = offers[idx];
    if (chosen.level > bot.experience.level) {
      return `option ${idx + 1} costs level ${chosen.level} but you have ${bot.experience.level}`;
    }
    await et.enchant(idx);
    const outItem = await et.takeTargetItem();
    return `enchanted ${itemName} with option ${idx + 1} (cost ${chosen.level} level${chosen.level > 1 ? "s" : ""} + lapis) -> ${outItem.name}`;
  } finally {
    et.close();
  }
}
async function tradeWithVillager(bot, tradeIndex, count) {
  const villager = bot.nearestEntity(
    (e) => e.name === "villager" && bot.entity.position.distanceTo(e.position) < 16
  );
  if (!villager) return "no villager nearby";
  const reached = await gotoNear(bot, villager.position, 1.5);
  if (!reached) return "could not reach the villager";
  await bot.lookAt(villager.position.offset(0, 1, 0), false);
  let v;
  try {
    v = await bot.openVillager(villager);
  } catch (err) {
    await bot.lookAt(villager.position.offset(0, 1, 0), false);
    try {
      v = await bot.openVillager(villager);
    } catch (err2) {
      return `failed to open villager trade: ${err2 instanceof Error ? err2.message : String(err2)}`;
    }
  }
  try {
    if (tradeIndex === void 0) {
      if (v.trades.length === 0) return "villager has no trades";
      const lines = v.trades.map((t2, i) => {
        const out = `${t2.outputItem.name} x${t2.outputItem.count}`;
        const in1 = `${t2.inputItem1.name} x${t2.inputItem1.count}`;
        const in2 = t2.inputItem2 ? ` + ${t2.inputItem2.name} x${t2.inputItem2.count}` : "";
        const uses = `${t2.nbTradeUses}/${t2.maximumNbTradeUses}`;
        const flag = t2.tradeDisabled ? " [DISABLED]" : "";
        return `#${i}: ${in1}${in2} -> ${out} (used ${uses})${flag}`;
      });
      return `villager trades:
${lines.join("\n")}`;
    }
    const t = v.trades[tradeIndex];
    if (!t) return `invalid trade index ${tradeIndex} (villager has ${v.trades.length} trades)`;
    if (t.tradeDisabled) return `trade #${tradeIndex} is disabled`;
    await bot.trade(v, tradeIndex, count);
    return `traded #${tradeIndex} x${count}: received ${t.outputItem.name} x${t.outputItem.count * count}`;
  } finally {
    v.close();
  }
}
var CHROME_PATH = process.env.CHROME_PATH || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "/usr/bin/chromium");
var SHOTS_ROOT = resolve(process.cwd(), "data/screenshots");
var seeBrowser = null;
var seePage = null;
async function seeFirstPersonViaPlaywright() {
  const port = Number(process.env.MC_VIEWER_PORT || 3001) + 100;
  const url = `http://127.0.0.1:${port}/`;
  if (!seePage || seePage.isClosed()) {
    if (seeBrowser) {
      try {
        await seeBrowser.close();
      } catch {
      }
    }
    if (!existsSync(CHROME_PATH)) {
      throw new Error(`no fallback browser at ${CHROME_PATH} (install one or set CHROME_PATH)`);
    }
    seeBrowser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"]
    });
    seePage = await seeBrowser.newPage({ viewport: { width: 640, height: 480 } });
    await seePage.goto(url, { waitUntil: "domcontentloaded", timeout: 15e3 });
    await seePage.waitForTimeout(1500);
  } else if (!seePage.url().startsWith(url)) {
    await seePage.goto(url, { waitUntil: "domcontentloaded", timeout: 15e3 });
    await seePage.waitForTimeout(1500);
  }
  await seePage.waitForTimeout(300);
  const buf = await seePage.screenshot({ type: "png" });
  return { dataUrl: "data:image/png;base64," + buf.toString("base64"), file: null };
}
async function seeFirstPerson(bot) {
  try {
    const shot = await captureFirstPerson(bot, SHOTS_ROOT);
    return { dataUrl: "data:image/jpeg;base64," + shot.buffer.toString("base64"), file: shot.file };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[mc-tools] camera capture failed, falling back to playwright: ${msg}`);
    try {
      return await seeFirstPersonViaPlaywright();
    } catch (pwErr) {
      const pwMsg = pwErr instanceof Error ? pwErr.message : String(pwErr);
      throw new Error(`mc_see unavailable \u2014 in-process camera: ${msg}; browser fallback: ${pwMsg}`);
    }
  }
}
function baseProtectRefusal(p, botPos) {
  try {
    const cfgPath = ["/app/data/base-protect.json", resolve(process.cwd(), "data/base-protect.json")].find(existsSync);
    if (!cfgPath) return null;
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    const r = cfg.r ?? 16;
    const d = Math.hypot(p.x - cfg.x, p.y - cfg.y, p.z - cfg.z);
    if (d <= r && p.distanceTo(botPos) > 2) {
      return `refused: (${p.x}, ${p.y}, ${p.z}) \u5728\u57FA\u5730\u4FDD\u62A4\u533A\u5185\uFF08r=${r} @ ${cfg.x},${cfg.y},${cfg.z}\uFF09\u3002\u57FA\u5730\u5468\u56F4${r}\u683C\u7981\u6B62\u6316\u6398\u53D6\u8D44\u6E90\u2014\u2014\u53BB${r}\u683C\u5916\u6316\uFF1B\u82E5\u786E\u9700\u6539\u5EFA\uFF0C\u8BF7\u5929\u795E\u8C03\u6574 data/base-protect.json\u3002`;
    }
  } catch {
  }
  return null;
}
async function digAt(bot, args) {
  const { x, y, z } = coordArgs(args);
  if (x === void 0 || y === void 0 || z === void 0) return "x, y, z are required";
  const target = new Vec32(x, y, z);
  const refusal = baseProtectRefusal(target, bot.entity.position);
  if (refusal) return refusal;
  let block = bot.blockAt(target);
  if (!block) return `cannot inspect block at (${x}, ${y}, ${z}) (chunk not loaded?)`;
  if (block.boundingBox === "empty") return `already air at (${x}, ${y}, ${z})`;
  if (block.diggable === false) {
    return `${block.name} at (${x}, ${y}, ${z}) cannot be dug (unbreakable)`;
  }
  if (bot.entity.position.distanceTo(target) > 4.5) {
    const reached = await gotoNear(bot, target, 3);
    if (!reached) return `could not get close enough to dig at (${x}, ${y}, ${z})`;
    block = bot.blockAt(target) ?? block;
    if (block.boundingBox === "empty") return `already air at (${x}, ${y}, ${z})`;
  }
  const before = bot.inventory.items().reduce((s, it) => s + it.count, 0);
  await bot.unequip("hand").catch(() => {
  });
  await bot.tool.equipForBlock(block);
  await bot.dig(block);
  await pickupNearby(bot);
  const after = bot.inventory.items().reduce((s, it) => s + it.count, 0);
  return `dug ${block.name} at (${x}, ${y}, ${z})` + (after > before ? " (picked up drops)" : "");
}
async function tunnelStep(bot, dirX, dirZ) {
  const pos = bot.entity.position;
  const feet = Math.floor(pos.y);
  const base = pos.floored();
  const ahead = new Vec32(base.x + dirX, feet, base.z + dirZ);
  for (const dy of [0, 1]) {
    const refusal = baseProtectRefusal(ahead.offset(0, dy, 0), pos);
    if (refusal) return refusal;
  }
  const below = bot.blockAt(ahead.offset(0, -1, 0));
  if (!below || below.boundingBox === "empty" || /water|lava|bubble/.test(below.name)) {
    return `stop: \u901A\u9053\u524D\u65B9\u811A\u4E0B\u662F ${below ? below.name : "\u672A\u52A0\u8F7D\u533A"}\u2014\u2014\u518D\u6316\u5C31\u662F\u60AC\u7A7A/\u6C34\u57DF\uFF0C\u6362\u4E2A\u65B9\u5411`;
  }
  const above = bot.blockAt(ahead.offset(0, 2, 0));
  if (above && /water|lava/.test(above.name)) {
    return `stop: \u901A\u9053\u4E0A\u65B9\u6709 ${above.name}\u2014\u2014\u6316\u7A7F\u4F1A\u6DF9/\u70EB\uFF0C\u6362\u4E2A\u65B9\u5411`;
  }
  for (let round = 0; round < 3; round++) {
    let solidLeft = false;
    for (const dy of [0, 1]) {
      const cell = ahead.offset(0, dy, 0);
      const blk = bot.blockAt(cell);
      if (!blk) return `stop: \u533A\u5757\u672A\u52A0\u8F7D (${cell.x},${cell.y},${cell.z})`;
      if (blk.boundingBox === "empty") continue;
      if (blk.diggable === false) return `stop: ${blk.name} \u6316\u4E0D\u52A8\uFF08\u57FA\u5CA9\uFF1F\uFF09\uFF0C\u6362\u4E2A\u65B9\u5411`;
      await bot.unequip("hand").catch(() => {
      });
      await bot.tool.equipForBlock(blk);
      await bot.dig(blk);
      solidLeft = true;
    }
    if (!solidLeft) break;
    await sleep(400);
  }
  const target = new Vec32(ahead.x + 0.5, feet, ahead.z + 0.5);
  const reached = await gotoNear(bot, target, 0.9, 8e3);
  if (!reached) {
    const p = bot.entity.position;
    return `blocked: \u5DF2\u6316\u5F00 (${ahead.x},${ahead.y},${ahead.z}) \u4F46\u8D70\u4E0D\u8FDB\u53BB\uFF08\u73B0 ${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}\uFF09\u2014\u2014\u53EF\u518D\u8BD5\u4E00\u6B21\u6216\u6362\u65B9\u5411`;
  }
  return "ok";
}
function apply(ctx, config = {}) {
  const log = (msg) => console.log(`[mc-tools] ${msg}`);
  pluginCtx = ctx;
  mcStore = ctx.get?.("mcStore");
  EPISODIC_DIR = resolve(config.dataDir ?? "./data");
  SHOTS_ROOT = join2(EPISODIC_DIR, "screenshots");
  try {
    mkdirSync(EPISODIC_DIR, { recursive: true });
  } catch {
  }
  try {
    mkdirSync(SHOTS_ROOT, { recursive: true });
  } catch {
  }
  log(`dataDir=${EPISODIC_DIR}`);
  ctx.tools.register(defineTool({
    name: "mc_status",
    description: "Get the bot's current state: position, health, food, held item and inventory.",
    parameters: {},
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    execute: guard(async (bot) => {
      const p = bot.entity.position;
      const items = bot.inventory.items().map((i) => `${i.name} x${i.count}`);
      return JSON.stringify({
        position: { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) },
        health: bot.health,
        food: bot.food,
        heldItem: bot.heldItem ? bot.heldItem.name : null,
        inventory: items
      });
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_goto",
    description: "Pathfind to the given coordinates (e.g. a chest, bed or mining spot).",
    parameters: {
      x: { type: "number", required: true, description: "target x coordinate" },
      y: { type: "number", required: true, description: "target y coordinate" },
      z: { type: "number", required: true, description: "target z coordinate" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => {
      const { x, y, z } = args;
      const target = new Vec32(x, y, z);
      log(`goto (${x}, ${y}, ${z})`);
      const reached = await gotoNear(bot, target, 3, 2e4);
      let p = bot.entity.position;
      let dist = p.distanceTo(target);
      if (!reached) {
        return `failed to reach (${x}, ${y}, ${z}); stopped at (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}). \u5BFB\u8DEF\u5361\u6B7B/\u8D85\u65F6\u2014\u2014\u82E5\u88AB\u6811\u53F6\u6216\u65B9\u5757\u56F4\u4F4F\uFF0C\u522B\u518D\u53CD\u590D goto \u540C\u4E00\u5904\uFF1A\u5148\u7528 mc_look \u627E\u5F00\u9614\u65B9\u5411\uFF0C\u518D mc_tunnel \u6CBF\u8BE5\u65B9\u5411\u6316\u5E73\u76F4\u901A\u9053\u8131\u56F0\uFF0C\u6216 mc_place \u81EA\u884C\u57AB\u8DEF`;
      }
      if (dist > 1.5) {
        const precise = await gotoNear(bot, target, 1, 1e4);
        p = bot.entity.position;
        dist = p.distanceTo(target);
        if (dist > 1.5) {
          return `approached (${x}, ${y}, ${z}) but couldn't stand on it \u2014 now at (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}), ${dist.toFixed(1)} blocks away (\u76EE\u6807\u9700\u8981\u8DF3\u8DC3/\u6500\u722C\u6216\u4E0D\u53EF\u7AD9\u7ACB\uFF1B\u7528 mc_tunnel \u6316\u5E73\u76F4\u901A\u9053\u63A5\u8FD1\uFF0C\u6216 mc_place \u81EA\u884C\u57AB\u8DEF)`;
        }
      }
      return `reached (${x}, ${y}, ${z}) \u2014 now at (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}), ${dist.toFixed(1)} blocks away`;
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_tunnel",
    description: "\u6CBF\u6307\u5B9A\u65B9\u5411\u6316\u4E00\u6761\u6C34\u5E73\u7684 2 \u683C\u9AD8\u901A\u9053\u5E76\u9010\u683C\u524D\u8FDB\uFF08\u9ED8\u8BA4 8 \u683C\uFF09\u2014\u2014\u8131\u56F0\u4E13\u7528\uFF1A\u7EAF\u5E73\u5730\u884C\u8D70\u3001\u5B8C\u5168\u4E0D\u4F9D\u8D56\u8DF3\u8DC3\uFF0C\u5751\u5E95/\u5730\u4E0B/\u88AB\u65B9\u5757\u56F4\u4F4F/\u5BFB\u8DEF\u53CD\u590D\u5931\u8D25\u65F6\uFF0C\u4E00\u6B21\u8C03\u7528\u5C31\u53D6\u5F97\u786E\u5B9A\u8FDB\u5C55\u3002\u5148\u7528 mc_look \u770B\u6E05\u56DB\u5468\uFF08\u907F\u5F00\u6C34/\u5CA9\u6D46\u3001\u6311\u5730\u5F62\u4E0B\u5761\u7684\u4E00\u4FA7\uFF09\uFF0C\u518D\u9009\u65B9\u5411\u5F00\u6316\uFF1B\u6316\u5230\u9732\u5929\u6216\u8D70\u4E0D\u901A\u4F1A\u5982\u5B9E\u62A5\u544A\u3002\u4E5F\u9002\u5408\u666E\u901A\u6398\u8FDB\uFF08\u91C7\u77F3/\u6316\u8D70\u5ECA\uFF09\u3002",
    parameters: {
      direction: { type: "string", required: true, description: "east(\u4E1C+x) / west(\u897F-x) / south(\u5357+z) / north(\u5317-z)" },
      length: { type: "number", description: "\u6316\u51E0\u683C\uFF0C\u9ED8\u8BA4 8\uFF0C\u4E0A\u9650 24" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 3e5,
    execute: guard(async (bot, args) => {
      const dirMap = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] };
      const d = String(args.direction ?? "").toLowerCase();
      const v = dirMap[d];
      if (!v) return "direction \u5FC5\u987B\u662F east / west / south / north";
      const n = Math.max(1, Math.min(24, Math.floor(Number(args.length ?? 8))));
      const startY = Math.floor(bot.entity.position.y);
      let dug = 0;
      for (let i = 0; i < n; i++) {
        const r = await tunnelStep(bot, v[0], v[1]);
        if (r !== "ok") {
          const p2 = bot.entity.position;
          return `${r}\u3002\u672C\u6B21\u6CBF ${d} \u5171\u524D\u8FDB ${dug} \u683C\uFF0C\u73B0\u4F4D\u4E8E (${Math.round(p2.x)}, ${Math.round(p2.y)}, ${Math.round(p2.z)})`;
        }
        dug++;
      }
      const p = bot.entity.position;
      let openSky = false;
      try {
        for (let y = Math.floor(p.y) + 2; y < Math.floor(p.y) + 12; y++) {
          const blk = bot.blockAt(new Vec32(Math.floor(p.x), y, Math.floor(p.z)));
          if (!blk) break;
          if (blk.boundingBox !== "empty") {
            openSky = false;
            break;
          }
          openSky = true;
        }
      } catch {
      }
      return `\u5DF2\u6CBF ${d} \u6316\u8FDB ${dug} \u683C\uFF08y=${startY} \u5C42\uFF09\uFF0C\u73B0\u4F4D\u4E8E (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})${openSky ? "\u2014\u2014\u5934\u9876\u5DF2\u9732\u5929\uFF0C\u8131\u56F0\u5728\u671B\uFF1A\u7EE7\u7EED\u5411\u524D\u6216\u57AB\u65B9\u5757\u4E0A\u6765" : "\u3002\u82E5\u4ECD\u672A\u8131\u56F0\uFF0Cmc_look \u89C2\u5BDF\u540E\u6362\u65B9\u5411\u7EE7\u7EED mc_tunnel\uFF0C\u6216\u6CBF\u901A\u9053\u8D70\u5230\u5E95"}\uFF1B\u6316\u5230\u7684\u6389\u843D\u7269\u5DF2\u968F\u624B\u6361\u8D77`;
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_collect",
    description: 'Collect blocks of a type (e.g. "oak_log", "coal_ore", "cobblestone"). The bot walks to the nearest one, mines it and picks up the drops. Returns how many were collected.',
    parameters: {
      blockType: { type: "string", required: true, description: 'block name, e.g. "oak_log" or "coal_ore"' },
      count: { type: "number", description: "how many blocks to collect (default 1)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 12e4,
    execute: guard(async (bot, args) => {
      const blockType = String(args.blockType ?? "");
      const num = Math.max(1, Math.floor(Number(args.count ?? 1)));
      if (!blockType) return "blockType is required";
      const feetY = Math.floor(bot.entity.position.y) - 1;
      let collected = 0;
      for (let i = 0; i < num; i++) {
        let block = bot.findBlock({
          matching: (b) => {
            if (!b || b.name !== blockType) return false;
            if (!b.position) return true;
            return b.position.y >= feetY;
          },
          maxDistance: 48
        });
        if (!block) {
          block = bot.findBlock({
            matching: (b) => !!b && b.name === blockType,
            maxDistance: 48
          });
        }
        if (!block) break;
        const before = bot.inventory.items().reduce((s, it) => s + it.count, 0);
        await bot.unequip("hand").catch(() => {
        });
        await bot.tool.equipForBlock(block);
        const reached = await gotoNear(bot, block.position, 3);
        if (!reached) break;
        try {
          await bot.dig(block);
          await pickupNearby(bot);
          const after = bot.inventory.items().reduce((s, it) => s + it.count, 0);
          if (after > before) collected++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log(`failed to dig ${blockType}: ${msg}`);
          break;
        }
      }
      const pick = bot.inventory.items().find((it) => it.name.includes("pickaxe"));
      if (pick) await bot.equip(pick, "hand").catch(() => {
      });
      return `collected ${collected} ${blockType}`;
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_dig",
    description: "Dig (break) the block at the EXACT given coordinates, then pick up nearby drops. The escape primitive when stuck: dig the block above your head or beside you (use mc_look first to find the blocking coordinates). Warning: digging straight down below your own feet can drop you into caves or lava.",
    parameters: {
      x: { type: "number", required: true, description: "target x coordinate" },
      y: { type: "number", required: true, description: "target y coordinate" },
      z: { type: "number", required: true, description: "target z coordinate" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => digAt(bot, args))
  }));
  ctx.tools.register(defineTool({
    name: "mc_place",
    description: "Place a block from the inventory at the given coordinates. The bot stands next to it and places it against an adjacent solid block.",
    parameters: {
      blockType: { type: "string", required: true, description: 'block/item name, e.g. "oak_planks" or "torch"' },
      x: { type: "number", required: true, description: "target x coordinate" },
      y: { type: "number", required: true, description: "target y coordinate" },
      z: { type: "number", required: true, description: "target z coordinate" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => {
      const blockType = String(args.blockType ?? "");
      const target = new Vec32(Math.floor(Number(args.x)), Math.floor(Number(args.y)), Math.floor(Number(args.z)));
      const item = bot.inventory.items().find((i) => i.name === blockType);
      if (!item) return `no ${blockType} in inventory`;
      const occupied = bot.blockAt(target);
      if (occupied && !["air", "water", "lava", "grass", "short_grass", "tall_grass"].includes(occupied.name)) {
        return `${occupied.name} is in the way at (${target.x}, ${target.y}, ${target.z})`;
      }
      const dirs = [
        new Vec32(0, -1, 0),
        new Vec32(0, 1, 0),
        new Vec32(0, 0, -1),
        new Vec32(0, 0, 1),
        new Vec32(-1, 0, 0),
        new Vec32(1, 0, 0)
      ];
      let refBlock = null;
      let faceVec = null;
      for (const d of dirs) {
        const b = bot.blockAt(target.plus(d));
        if (b && !["air", "water", "lava", "grass", "short_grass", "tall_grass"].includes(b.name)) {
          refBlock = b;
          faceVec = new Vec32(-d.x, -d.y, -d.z);
          break;
        }
      }
      if (!refBlock || !faceVec) return "nothing solid to place the block against";
      if (bot.entity.position.distanceTo(target) > 4) {
        const reached = await gotoNear(bot, target, 3);
        if (!reached) return "could not get close enough to place the block";
      }
      await bot.equip(item, "hand");
      await bot.lookAt(refBlock.position.offset(0.5, 0.5, 0.5));
      await bot.placeBlock(refBlock, faceVec);
      await sleep(150);
      return `placed ${blockType} at (${target.x}, ${target.y}, ${target.z})`;
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_attack",
    description: 'Attack the nearest mob of a type (e.g. "zombie", "creeper", "skeleton"). Optionally keep attacking until it dies.',
    parameters: {
      mobType: { type: "string", required: true, description: 'mob name, e.g. "zombie"' },
      kill: { type: "boolean", description: "keep attacking until dead (default true)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => {
      const mobType = String(args.mobType ?? "");
      const kill = args.kill !== false;
      const mob = bot.nearestEntity(
        (e) => e.name === mobType && bot.entity.position.distanceTo(e.position) < 24
      );
      if (!mob) return `no ${mobType} nearby`;
      await equipBestWeapon(bot);
      if (!kill) {
        await bot.lookAt(mob.position);
        bot.attack(mob);
        return `attacked ${mobType} once`;
      }
      let hits = 0;
      while (mob.isValid && hits < 60) {
        if (!bot.entity) break;
        if (bot.entity.position.distanceTo(mob.position) > 3) {
          await gotoNear(bot, mob.position, 2);
        }
        await bot.lookAt(mob.position);
        try {
          bot.attack(mob);
          hits++;
        } catch {
          break;
        }
        await sleep(600);
      }
      return `attacked ${mobType} ${hits} time(s); ${mob.isValid ? "still alive" : "killed"}`;
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_pickup",
    description: "Walk to and pick up dropped items near the bot.",
    parameters: {},
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    execute: guard(async (bot) => {
      await pickupNearby(bot);
      return "picked up nearby items";
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_craft",
    description: 'Craft an item (e.g. "wooden_pickaxe", "crafting_table", "stick", "oak_planks", "stone_pickaxe"). If the recipe needs a crafting table, the bot walks to the nearest one. Reports what was crafted or which ingredients are missing.',
    parameters: {
      itemType: { type: "string", required: true, description: 'item name to craft, e.g. "wooden_pickaxe" or "crafting_table"' },
      count: { type: "number", description: "how many times to run the recipe (default 1)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => {
      const itemName = String(args.itemType ?? "");
      const count = Math.max(1, Math.floor(Number(args.count ?? 1)));
      if (!itemName) return "itemType is required";
      log(`craft ${count} ${itemName}`);
      return craftItem(bot, itemName, count);
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_equip",
    description: 'Equip an item from the inventory, e.g. "wooden_pickaxe" or "stone_axe". Default destination is the hand; armor goes to head/torso/legs/feet.',
    parameters: {
      itemType: { type: "string", required: true, description: 'item name to equip, e.g. "wooden_pickaxe"' },
      destination: { type: "string", description: 'where to equip: "hand" (default), "head", "torso", "legs", "feet", "off-hand"' }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 3e4,
    execute: guard(async (bot, args) => {
      const itemName = String(args.itemType ?? "");
      const destination = String(args.destination ?? "hand");
      if (!itemName) return "itemType is required";
      const valid = ["hand", "head", "torso", "legs", "feet", "off-hand"];
      if (!valid.includes(destination)) return `invalid destination: ${destination}`;
      const item = bot.inventory.items().find((i) => i.name === itemName);
      if (!item) return `no ${itemName} in inventory`;
      await bot.equip(item, destination);
      return `equipped ${itemName} to ${destination}`;
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_eat",
    description: "Eat a food item to restore hunger and (over time) health. The bot equips the food and consumes it. Omit itemType to auto-pick the most filling food available.",
    parameters: {
      itemType: { type: "string", description: 'food item name to eat, e.g. "cooked_beef", "apple", "rotten_flesh". Omit to auto-pick the best food.' }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => {
      const itemName = String(args.itemType ?? "");
      let item;
      if (itemName) {
        item = bot.inventory.items().find((i) => i.name === itemName);
        if (!item) return `no ${itemName} in inventory`;
      } else {
        const foods = bot.inventory.items().filter((i) => {
          const reg = bot.registry.itemsByName[i.name];
          return reg && typeof reg.foodPoints === "number" && reg.foodPoints > 0;
        });
        if (foods.length === 0) return "no food in inventory";
        foods.sort((a, b) => {
          const ap = bot.registry.itemsByName[a.name]?.foodPoints ?? 0;
          const bp = bot.registry.itemsByName[b.name]?.foodPoints ?? 0;
          return bp - ap;
        });
        item = foods[0];
      }
      const foodPoints = bot.registry.itemsByName[item.name]?.foodPoints ?? 0;
      await bot.equip(item, "hand");
      try {
        await bot.consume();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Food is full")) return "food is already full";
        return `could not eat ${item.name}: ${msg}`;
      }
      return `ate ${item.name} (+${foodPoints} food); food now ${Math.round(bot.food)}/20`;
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_chat",
    description: "\u5168\u670D\u516C\u5C4F\u5E7F\u64AD\uFF08\u6574\u4E2A\u4E16\u754C\u90FD\u542C\u89C1\u7684\u5927\u5587\u53ED\uFF09\u2014\u2014\u91CD\u5927\u5BA3\u544A\u624D\u7528\uFF0C\u5982\u81EA\u6211\u4ECB\u7ECD\u3001\u91CD\u8981\u53D1\u73B0\u3001\u96C6\u7ED3\u547C\u558A\u3002\u65E5\u5E38\u548C\u8EAB\u8FB9\u7684\u540C\u4F34\u8BF4\u8BDD\u7528 mc_voice\uFF08\u6709\u8DDD\u79BB\u611F\uFF1A\u8BF448\u683C/\u558A96\u683C/\u6084\u60846\u683C\uFF09\uFF1B\u5BF9\u67D0\u4E2A\u4EBA\u8BF4\u79C1\u8BDD\u4E14\u4E0D\u7BA1\u8DDD\u79BB\u65F6\uFF0C\u586B to \u53C2\u6570\uFF08\u79C1\u8BED\u76F4\u8FBE\uFF0C\u53EA\u6709\u5BF9\u65B9\u542C\u5F97\u89C1\uFF09\uFF1B\u7ED9\u79BB\u7EBF/\u8FDC\u65B9\u7684\u4EBA\u7559\u8A00\u7528 mc_mail\uFF08\u4E66\u4FE1\uFF09\u3002",
    parameters: {
      message: { type: "string", description: "the message to say in chat" },
      to: { type: "string", description: "\u79C1\u8BED\u76F4\u8FBE\uFF1A\u5BF9\u65B9\u6E38\u620FID\u3002\u586B\u4E86\u5C31\u53EA\u5BF9\u8FD9\u4E2A\u4EBA\u8BF4\uFF08\u4E0D\u9650\u8DDD\u79BB\uFF09\uFF0C\u7559\u7A7A\u5219\u516C\u5C4F\u5E7F\u64AD" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    execute: guard(async (bot, args) => {
      const msg = String(args.message ?? "").trim();
      if (!msg) return "no message";
      const to = String(args.to ?? "").trim();
      if (to) {
        try {
          bot.whisper(to, msg);
          return `whispered to ${to}: ${msg}`;
        } catch {
          return `whisper to ${to} failed (connection error)`;
        }
      }
      bot.chat(msg);
      return `said: ${msg}`;
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_view_chest",
    description: "Look inside a chest or barrel and list its contents. If x/y/z are given, opens that exact block; otherwise opens the nearest one within range.",
    parameters: {
      x: { type: "number", description: "chest x coordinate (optional)" },
      y: { type: "number", description: "chest y coordinate (optional)" },
      z: { type: "number", description: "chest z coordinate (optional)" },
      range: { type: "number", description: "search radius for the nearest chest (default 16)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => viewChest(bot, args))
  }));
  ctx.tools.register(defineTool({
    name: "mc_put_chest",
    description: `Deposit items from the bot's inventory into a chest or barrel. If x/y/z are given, targets that chest; otherwise the nearest one. Deposits "count" of itemType (default: all of that type).`,
    parameters: {
      itemType: { type: "string", required: true, description: 'item name to deposit, e.g. "oak_log" or "cobblestone"' },
      count: { type: "number", description: "how many to deposit (default: all)" },
      x: { type: "number", description: "chest x coordinate (optional)" },
      y: { type: "number", description: "chest y coordinate (optional)" },
      z: { type: "number", description: "chest z coordinate (optional)" },
      range: { type: "number", description: "search radius for the nearest chest (default 16)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => transferWithChest(bot, args, "deposit"))
  }));
  ctx.tools.register(defineTool({
    name: "mc_take_chest",
    description: `Withdraw items from a chest or barrel into the bot's inventory. If x/y/z are given, targets that chest; otherwise the nearest one. Withdraws "count" of itemType (default: all available).`,
    parameters: {
      itemType: { type: "string", required: true, description: 'item name to withdraw, e.g. "coal" or "iron_ingot"' },
      count: { type: "number", description: "how many to withdraw (default: all available)" },
      x: { type: "number", description: "chest x coordinate (optional)" },
      y: { type: "number", description: "chest y coordinate (optional)" },
      z: { type: "number", description: "chest z coordinate (optional)" },
      range: { type: "number", description: "search radius for the nearest chest (default 16)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => transferWithChest(bot, args, "withdraw"))
  }));
  ctx.tools.register(defineTool({
    name: "mc_smelt",
    description: "Smelt items (e.g. raw_iron -> iron_ingot, raw food -> cooked food) in the nearest furnace, blast furnace or smoker. Loads input + fuel, waits, and collects the finished output into inventory. Max 6 items per call; call again for more. Also collects any finished output first.",
    parameters: {
      itemType: { type: "string", required: true, description: 'raw item to smelt, e.g. "raw_iron" or "raw_beef"' },
      count: { type: "number", description: "how many to smelt this batch, max 6 (default: as many as held)" },
      fuelType: { type: "string", description: "fuel item name (default: auto-pick coal/charcoal/planks/logs)" },
      x: { type: "number", description: "furnace x coordinate (optional)" },
      y: { type: "number", description: "furnace y coordinate (optional)" },
      z: { type: "number", description: "furnace z coordinate (optional)" },
      range: { type: "number", description: "search radius for the nearest furnace (default 16)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 12e4,
    execute: guard(async (bot, args) => doSmelt(bot, args))
  }));
  ctx.tools.register(defineTool({
    name: "mc_view_furnace",
    description: "Look inside the nearest furnace / blast furnace / smoker: input, fuel, output and remaining smelt time. Does not take anything (mc_smelt collects output).",
    parameters: {
      x: { type: "number", description: "furnace x coordinate (optional)" },
      y: { type: "number", description: "furnace y coordinate (optional)" },
      z: { type: "number", description: "furnace z coordinate (optional)" },
      range: { type: "number", description: "search radius for the nearest furnace (default 16)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => viewFurnaceContent(bot, args))
  }));
  ctx.tools.register(defineTool({
    name: "mc_enchant",
    description: "Enchant a held item at the nearest enchanting table. Costs 1-3 lapis_lazuli and experience levels. Without choice, auto-picks the strongest offer you can afford; with choice (0/1/2), takes that specific offer.",
    parameters: {
      itemType: { type: "string", required: true, description: 'item to enchant from inventory, e.g. "iron_sword" (must be unenchanted)' },
      choice: { type: "number", description: "offer index 0/1/2 (optional, default: strongest affordable)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => doEnchant(bot, args))
  }));
  ctx.tools.register(defineTool({
    name: "mc_trade",
    description: 'Trade with the nearest villager. Without tradeIndex, lists the available trades. With tradeIndex, executes that trade "count" times (default 1).',
    parameters: {
      tradeIndex: { type: "number", description: "which trade to execute (omit to list trades first)" },
      count: { type: "number", description: "how many times to run the trade (default 1)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => {
      const tradeIndex = args.tradeIndex === void 0 || args.tradeIndex === null ? void 0 : Math.floor(Number(args.tradeIndex));
      const count = Math.max(1, Math.floor(Number(args.count ?? 1)));
      return tradeWithVillager(bot, tradeIndex, count);
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_sleep",
    description: "\u5728\u5929\u9ED1\u6216\u96F7\u96E8\u65F6\u627E\u5230\u9644\u8FD1\u7684\u5E8A\u5E76\u8EBA\u4E0B\u7761\u89C9\uFF0C\u4E00\u89C9\u7761\u5230\u5929\u4EAE\uFF0C\u5B89\u5168\u8DF3\u8FC7\u5371\u9669\u7684\u9ED1\u591C\u3002\u767D\u5929\u4E0D\u80FD\u7761\u3002\u5982\u679C\u9644\u8FD1\u6CA1\u6709\u5E8A\uFF0C\u5148\u60F3\u529E\u6CD5\u5F04\u4E00\u5F20\uFF08\u653E\u4E00\u5F20\u5E8A\uFF0C\u6216\u7948\u613F\u5929\u795E\u8D50\u4E00\u5F20\u5E8A\uFF09\u3002",
    parameters: {},
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot) => {
      const bed = bot.findBlock({
        matching: (b) => !!b && (b.name === "bed" || b.name.endsWith("_bed")),
        maxDistance: 48
      });
      if (!bed) return "\u9644\u8FD1 48 \u683C\u5185\u6CA1\u6709\u5E8A\u3002\u53EF\u4EE5\u5148\u7528 mc_place \u653E\u4E00\u5F20\u5E8A\uFF08\u82E5\u80CC\u5305\u91CC\u6709\uFF09\uFF0C\u6216 mc_pray \u5411\u5929\u795E\u7948\u613F\u8D50\u4E00\u5F20\u5E8A";
      const reached = await gotoNear(bot, bed.position, 2);
      if (!reached) return "\u8D70\u4E0D\u5230\u5E8A\u65C1\u8FB9\uFF0C\u65E0\u6CD5\u5165\u7761";
      try {
        await bot.sleep(bed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `\u65E0\u6CD5\u5165\u7761\uFF1A${msg}`;
      }
      return "\u5DF2\u8EBA\u4E0B\u5165\u7761\uFF0C\u4E00\u89C9\u7761\u5230\u5929\u4EAE\uFF08\u5929\u4EAE\u81EA\u52A8\u9192\u6765\u540E\u7EE7\u7EED\u884C\u52A8\uFF09";
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_look",
    description: "\u73AF\u987E\u56DB\u5468\u7684\u6587\u5B57\u96F7\u8FBE\uFF08\u4E0D\u542B\u753B\u9762\uFF09\uFF1A\u9762\u5411\u4EC0\u4E48\u3001\u773C\u524D\u65B9\u5757\u3001\u5934\u9876\u6709\u6CA1\u6709\u9732\u5929\u51FA\u53E3\uFF08\u5361\u5751\u81EA\u6551\u5173\u952E\uFF09\u3001\u56DB\u9762\u73AF\u5883\u3001\u811A\u4E0B\u5730\u8D28\u3001\u9644\u8FD1\u6C34/\u5CA9\u6D46\u7B49\u5371\u9669\u3001\u9644\u8FD1\u5B9E\u4F53\u3002\u6781\u5FEB\uFF0C\u96F6\u6D88\u8017\u3002\u8FD9\u53EA\u662F\u7C97\u7565\u65B9\u5411\u7EBF\u7D22\u2014\u2014\u60F3\u771F\u6B63\u770B\u6E05\u773C\u524D\u6321\u8DEF\u7684\u662F\u4EC0\u4E48\uFF0C\u7528 mc_see \u622A\u771F\u5B9E\u753B\u9762\u3002\u8FF7\u8DEF\u3001\u5361\u4F4F\u3001\u8FDB\u5165\u964C\u751F\u5730\u5F62\u65F6\u5148\u7528\u5B83\u5FEB\u901F\u5B9A\u4F4D\u3002",
    parameters: {},
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    execute: guard(async (bot) => {
      const pos = bot.entity.position.floored();
      const headY = pos.y + 1;
      const yaw = bot.entity.yaw;
      const dx = -Math.sin(yaw);
      const dz = -Math.cos(yaw);
      const cardinal = Math.abs(dx) > Math.abs(dz) ? dx > 0 ? "\u4E1C (+X)" : "\u897F (-X)" : dz > 0 ? "\u5357 (+Z)" : "\u5317 (-Z)";
      let lookingAt = { block: null };
      try {
        const b = bot.blockInSight(24, 5 / 16);
        if (b) {
          lookingAt = {
            block: b.name,
            distance: Math.round(bot.entity.position.distanceTo(b.position) * 10) / 10,
            position: [b.position.x, b.position.y, b.position.z]
          };
        }
      } catch {
      }
      let firstOpening = null;
      let openSky = true;
      const maxY = Math.min(headY + 64, 319);
      for (let y = headY + 1; y <= maxY; y++) {
        const b1 = bot.blockAt(new Vec32(pos.x, y, pos.z));
        const b2 = bot.blockAt(new Vec32(pos.x, y + 1, pos.z));
        const solid1 = !!b1 && b1.boundingBox !== "empty";
        const solid2 = !!b2 && b2.boundingBox !== "empty";
        if (solid1 || solid2) {
          openSky = false;
        }
        if (firstOpening === null && !solid1 && !solid2) {
          firstOpening = y;
        }
      }
      const blocksAboveHead = firstOpening !== null ? firstOpening - headY : null;
      const dirs = [["\u4E1C", 2, 0], ["\u5357", 0, 2], ["\u897F", -2, 0], ["\u5317", 0, -2]];
      const surroundings = {};
      for (const [label, ox, oz] of dirs) {
        const b = bot.blockAt(new Vec32(pos.x + ox, pos.y + 1, pos.z + oz));
        surroundings[label] = b && b.boundingBox !== "empty" ? `${b.name} \u6321\u8DEF` : "\u5F00\u9614";
      }
      const hazards = [];
      try {
        for (const name2 of ["water", "lava", "flowing_water", "flowing_lava"]) {
          const hb = bot.findBlock({
            matching: (b) => !!b && b.name === name2,
            maxDistance: 8
          });
          if (hb) {
            const d = Math.round(bot.entity.position.distanceTo(hb.position));
            hazards.push(`${name2 === "lava" || name2 === "flowing_lava" ? "\u5CA9\u6D46" : "\u6C34"} ${d}\u683C ${hb.position.x},${hb.position.y},${hb.position.z}`);
          }
        }
      } catch {
      }
      const entities = Object.values(bot.entities).filter((e) => e && e !== bot.entity && e.name && e.position && bot.entity.position.distanceTo(e.position) <= 16).sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)).slice(0, 6).map((e) => {
        const d = Math.round(bot.entity.position.distanceTo(e.position));
        const label = e.username ? "\u73A9\u5BB6" : e.displayName ?? e.name;
        const dir = relDir(e.position.x - bot.entity.position.x, e.position.z - bot.entity.position.z);
        return `${label}(${dir}${d}\u683C)`;
      });
      const under = bot.blockAt(pos.offset(0, -1, 0));
      const inBlock = bot.blockAt(pos.offset(0, 0, 0));
      let hint = "";
      if (firstOpening === null) hint = "\u4F60\u5934\u9876\u88AB\u5C01\u6B7B\uFF0864\u683C\u5185\u65E0\u5F00\u53E3\uFF09\uFF0C\u57AB\u65B9\u5757\u4E0A\u4E0D\u53BB\uFF1A\u7528 mc_dig \u671D\u4E1C/\u5357/\u897F/\u5317\u4EFB\u4E00\u65B9\u5411\u9010\u683C\u6A2A\u5411\u6316\u901A\u9053\u51FA\u53BB\uFF0C\u771F\u6316\u4E0D\u52A8\u518D\u548F\u5531\u6C42\u6551";
      else if (blocksAboveHead > 3) hint = `\u4F60\u5728\u5751\u5E95/\u6D1E\u91CC\uFF0C\u5934\u9876 ${blocksAboveHead} \u683C\uFF08y=${firstOpening}\uFF09\u6709\u5F00\u53E3\uFF08\u90A3\u662F\u51FA\u8DEF\uFF0C\u4E0D\u662F\u88AB\u5C01\u6B7B\uFF09\uFF1A\u53EF\u4EE5 mc_dig \u5411\u4E0A\u6316\u3001\u6216\u57AB\u65B9\u5757\u642D\u67F1\u51FA\u53BB`;
      else if (openSky) hint = "\u5934\u9876\u9732\u5929\uFF0C\u89C6\u91CE\u826F\u597D";
      else hint = `\u4F60\u5728\u6D45\u5751/\u6D1E\u53E3\u4E0B\uFF0C\u5934\u9876\u4EC5 ${blocksAboveHead} \u683C\uFF08y=${firstOpening}\uFF09\u5C31\u6709\u5F00\u53E3\uFF08\u90A3\u662F\u51FA\u8DEF\uFF0C\u4E0D\u662F\u88AB\u5C01\u6B7B\uFF09\uFF1A\u56DB\u5468\u6321\u8DEF\u7684\u65B9\u5757\u7528 mc_dig \u6316\u5F00\u5373\u53EF\u8D70\u51FA\u53BB\uFF1B\u60F3\u5782\u76F4\u4E0A\u53BB\u5C31\u671D\u811A\u4E0B mc_place \u57AB\u65B9\u5757\u642D\u53F0\u9636`;
      return JSON.stringify({
        facing: cardinal,
        lookingAt,
        headroom: { openSky, firstOpeningY: firstOpening, blocksAboveHead },
        surroundings,
        ground: under ? under.name : "unknown",
        bodyIn: inBlock && inBlock.boundingBox !== "empty" ? inBlock.name : "air",
        hazards: hazards.length ? hazards : [],
        entities: entities.length ? entities : [],
        hint
      });
    })
  }));
  ctx.tools.register(defineTool({
    name: "mc_see",
    description: "\u7741\u5F00\u773C\u775B\uFF1A\u622A\u53D6\u4F60\u7B2C\u4E00\u4EBA\u79F0\u89C6\u89D2\u7684\u771F\u5B9E\u6E38\u620F\u753B\u9762\uFF08800x512\uFF09\uFF0C\u753B\u9762\u4F1A\u7ACB\u5373\u968F\u5DE5\u5177\u7ED3\u679C\u8FD4\u56DE\u3001\u88AB\u4F60\u4EB2\u773C\u770B\u89C1\u3002\u9ED8\u8BA4\u53EA\u62CD\u5F53\u524D\u671D\u5411\u4E00\u5F20\uFF1B\u60F3\u73AF\u987E\u56DB\u5468\u67E5\u5A01\u80C1/\u627E\u8DEF\u65F6\u4F20 look=around\uFF08\u89C6\u89C9\u6A21\u578B\u5355\u6B21\u6700\u591A\u770B 2 \u5F20\u56FE\uFF0C\u73AF\u987E\u53EA\u56DE\u4F20\u524D\u3001\u53F3\u4E24\u5411\uFF09\u3002\u8017\u65F6\u7EA6 1-4 \u79D2\u3002",
    parameters: {
      look: { type: "string", description: "front=\u53EA\u62CD\u5F53\u524D\u671D\u5411\uFF08\u9ED8\u8BA4\uFF09\uFF1Baround=\u73AF\u987E\u56DB\u5468\uFF08\u56DE\u4F20\u524D\u3001\u53F3\u4E24\u5411\uFF09" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          message: { type: "string", required: true },
          images: { type: "array", required: true }
        }
      },
      render: (_args, value) => {
        const blocks = [{ type: "text", text: String(value.message ?? "") }];
        for (const img of value.images ?? []) {
          blocks.push({ type: "image", attachment: img });
        }
        return blocks;
      }
    },
    timeoutMs: 3e4,
    execute: guard(async (bot, args) => {
      const attachments = ctx.get?.("attachments");
      const mode = String(args.look ?? "front");
      let shots = [];
      let message = "";
      if (mode === "around") {
        try {
          const all = await captureLookaround(bot, SHOTS_ROOT);
          shots = all.slice(0, 2).map((s) => ({ dataUrl: "data:image/jpeg;base64," + s.buffer.toString("base64") }));
          message = "\u5DF2\u73AF\u987E\u56DB\u5468\uFF08\u524D\u2192\u53F3\u2192\u540E\u2192\u5DE6\u56DB\u8FDE\u62CD\uFF09\uFF0C\u56E0\u89C6\u89C9\u6A21\u578B\u5355\u6B21\u6700\u591A\u770B 2 \u5F20\uFF0C\u5148\u7ED9\u4F60\u524D\u3001\u53F3\u4E24\u5411\u753B\u9762\uFF1B\u5176\u4F59\u4E24\u5411\u53EF\u518D\u8C03 mc_see \u8865\u770B\u3002";
        } catch (err) {
          const emsg = err instanceof Error ? err.message : String(err);
          const one = await seeFirstPerson(bot);
          shots = [{ dataUrl: one.dataUrl }];
          message = `\u73AF\u89C6\u5931\u8D25\uFF08${emsg}\uFF09\uFF0C\u5DF2\u9000\u56DE\u62CD\u6444\u5F53\u524D\u671D\u5411\u5355\u5F20\u753B\u9762\u3002`;
        }
      } else {
        const one = await seeFirstPerson(bot);
        shots = [{ dataUrl: one.dataUrl }];
        message = "\u5DF2\u62CD\u6444\u7B2C\u4E00\u4EBA\u79F0\u753B\u9762\uFF08\u89C1\u4E0B\u65B9\u56FE\u50CF\uFF09\u3002";
      }
      if (!attachments?.saveImage) {
        return { message: `${message}
\uFF08\u26A0\uFE0F \u89C6\u89C9\u56DE\u4F20\u4E0D\u53EF\u7528\uFF1A\u9644\u4EF6\u670D\u52A1\u672A\u6302\u8F7D\uFF0C\u672C\u8F6E\u53EA\u80FD\u9760\u6587\u5B57\u5224\u65AD\u5904\u5883\uFF09`, images: [] };
      }
      const images = [];
      for (let i = 0; i < shots.length; i++) {
        const m = /^data:image\/(?:jpeg|png);base64,([\s\S]*)$/.exec(shots[i].dataUrl);
        if (!m) continue;
        try {
          const ref = await attachments.saveImage({
            data: new Uint8Array(Buffer.from(m[1], "base64")),
            mediaType: "image/jpeg",
            name: `mc-see-${bot.username}-${Date.now()}-${i}.jpg`
          });
          images.push(ref);
        } catch (e) {
          console.warn(`[mc-tools] mc_see saveImage \u5931\u8D25\uFF08\u8DF3\u8FC7\u8BE5\u5F20\uFF09\uFF1A${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return { message, images };
    })
  }));
}
export {
  Config,
  apply,
  digAt,
  doEnchant,
  doSmelt,
  findFurnaceBlock,
  inject,
  name,
  transferWithChest,
  tunedMovements,
  viewFurnaceContent
};
