// src/mc-memory.ts
import Schema from "@deepseek-ai/schemastery";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
var name = "mc-memory";
var inject = [];
var Config = Schema.object({
  memoryPath: Schema.string().default("./data/mc-memory.json"),
  maxPointsPerType: Schema.number().default(20)
});
function emptyState() {
  return { version: 1, base: null, publicChest: null, resourcePoints: {}, currentGoal: null };
}
function round(pos) {
  return { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) };
}
function samePoint(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
var MemoryStore = class {
  state;
  path;
  maxPoints;
  constructor(path, maxPointsPerType) {
    this.path = resolve(path);
    this.maxPoints = Math.max(1, Math.floor(maxPointsPerType));
    this.state = this.load();
  }
  load() {
    try {
      if (existsSync(this.path)) {
        const raw = JSON.parse(readFileSync(this.path, "utf-8"));
        if (raw && typeof raw === "object" && raw.version === 1) {
          return this.normalize(raw);
        }
      }
    } catch (err) {
      console.error(
        `[mc-memory] failed to load memory, starting fresh: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return emptyState();
  }
  normalize(raw) {
    const s = emptyState();
    const base = raw.base;
    if (base && typeof base.x === "number" && typeof base.y === "number" && typeof base.z === "number") {
      s.base = round(base);
    }
    const chest = raw.publicChest;
    if (chest && typeof chest.x === "number" && typeof chest.y === "number" && typeof chest.z === "number") {
      s.publicChest = round(chest);
    }
    const goal = raw.currentGoal;
    if (typeof goal === "string" && goal.trim()) s.currentGoal = goal;
    const points = raw.resourcePoints;
    if (points && typeof points === "object") {
      for (const [type, list] of Object.entries(points)) {
        if (!Array.isArray(list)) continue;
        s.resourcePoints[type] = list.filter(
          (p) => !!p && typeof p.x === "number" && typeof p.y === "number" && typeof p.z === "number"
        ).map((p) => round(p));
      }
    }
    return s;
  }
  save() {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = this.path + ".tmp";
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf-8");
      renameSync(tmp, this.path);
    } catch (err) {
      console.error(`[mc-memory] failed to save memory: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  getBase() {
    return this.state.base;
  }
  setBase(pos) {
    this.state.base = round(pos);
    this.save();
  }
  getPublicChest() {
    return this.state.publicChest;
  }
  setPublicChest(pos) {
    this.state.publicChest = round(pos);
    this.save();
  }
  getCurrentGoal() {
    return this.state.currentGoal;
  }
  setCurrentGoal(goal) {
    if (!goal || !goal.trim()) return;
    this.state.currentGoal = goal.trim();
    this.save();
  }
  /** Remember a resource block location. Returns true only when newly added. */
  rememberResource(type, pos) {
    if (!type) return false;
    const p = round(pos);
    const list = this.state.resourcePoints[type] ?? (this.state.resourcePoints[type] = []);
    if (list.some((q) => samePoint(q, p))) return false;
    if (list.some((q) => Math.abs(q.x - p.x) <= 2 && Math.abs(q.y - p.y) <= 2 && Math.abs(q.z - p.z) <= 2)) {
      return false;
    }
    list.push(p);
    if (list.length > this.maxPoints) list.splice(0, list.length - this.maxPoints);
    this.save();
    return true;
  }
  getResourcePoints(type) {
    return this.state.resourcePoints[type] ?? [];
  }
  /** Human + LLM readable summary of what the bot remembers. */
  summary(maxPerType = 5) {
    const lines = [];
    if (this.state.currentGoal) {
      lines.push(`current goal: ${this.state.currentGoal}`);
    }
    if (this.state.base) {
      lines.push(`base (home): (${this.state.base.x}, ${this.state.base.y}, ${this.state.base.z})`);
    }
    if (this.state.publicChest) {
      lines.push(
        `public chest: (${this.state.publicChest.x}, ${this.state.publicChest.y}, ${this.state.publicChest.z})`
      );
    }
    const types = Object.keys(this.state.resourcePoints).filter((t) => this.state.resourcePoints[t].length > 0);
    if (types.length > 0) {
      lines.push("remembered resource points:");
      for (const type of types) {
        const all = this.state.resourcePoints[type];
        const shown = all.slice(-maxPerType);
        const pts = shown.map((p) => `(${p.x},${p.y},${p.z})`).join(", ");
        lines.push(`  ${type} (${all.length} known): ${pts}`);
      }
    }
    return lines.length > 0 ? lines.join("\n") : "(no memory yet)";
  }
};
function apply(ctx, config) {
  const store = new MemoryStore(config.memoryPath, config.maxPointsPerType);
  ctx.provide("mcMemory", store);
  console.log(`[mc-memory] store ready at ${resolve(config.memoryPath)}`);
}
export {
  Config,
  MemoryStore,
  apply,
  inject,
  name
};
