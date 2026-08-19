// src/mc-transmigrator.ts
import Schema from "@deepseek-ai/schemastery";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
var name = "mc-transmigrator";
var inject = [];
var Config = Schema.object({
  registryPath: Schema.string().default("./data/transmigrators.json")
});
var TransmigratorRegistry = class {
  items;
  byUsername;
  constructor(registryPath) {
    const path = resolve(registryPath);
    const base = dirname(path);
    const entries = this.loadEntries(path);
    this.items = entries.map((e) => this.materialize(base, e));
    this.byUsername = new Map(this.items.map((t) => [t.username.toLowerCase(), t]));
  }
  loadEntries(path) {
    try {
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, "utf-8"));
        const list = Array.isArray(raw) ? raw : raw?.transmigrators;
        if (Array.isArray(list)) {
          return list.filter(
            (e) => !!e && typeof e.id === "string" && typeof e.username === "string"
          );
        }
      }
    } catch (err) {
      console.error(
        `[mc-transmigrator] failed to load registry: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return [];
  }
  readText(base, rel, fallback) {
    if (!rel) return fallback;
    try {
      const p = resolve(base, rel);
      if (existsSync(p)) return readFileSync(p, "utf-8").trim();
    } catch {
    }
    return fallback;
  }
  materialize(base, e) {
    return {
      id: e.id,
      name: e.name || e.username,
      username: e.username,
      origin: e.origin === "random" ? "random" : "ip",
      source: e.source ?? null,
      epithet: e.epithet ?? "",
      backstory: this.readText(base, e.backstoryFile, ""),
      persona: this.readText(base, e.personaFile, ""),
      innate: e.innate ?? { preferredAtoms: [], reasoning: "" }
    };
  }
  getByUsername(username) {
    if (!username) return null;
    return this.byUsername.get(username.toLowerCase()) ?? null;
  }
  list() {
    return this.items;
  }
};
function apply(ctx, config) {
  const registry = new TransmigratorRegistry(config.registryPath);
  ctx.provide("mcTransmigrators", registry);
  const names = registry.list().map((t) => `${t.name}(${t.username})`).join(", ") || "(none)";
  console.log(`[mc-transmigrator] loaded ${registry.list().length} transmigrator(s): ${names}`);
}
export {
  Config,
  TransmigratorRegistry,
  apply,
  inject,
  name
};
