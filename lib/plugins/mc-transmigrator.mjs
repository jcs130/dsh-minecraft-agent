// src/mc-transmigrator.ts
import Schema from "@deepseek-ai/schemastery";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
var name = "mc-transmigrator";
var inject = [];
var Config = Schema.object({
  registryPath: Schema.string().default("./data/transmigrators.json")
});
var TransmigratorRegistry = class {
  path;
  base;
  items;
  byUsername;
  constructor(registryPath) {
    this.path = resolve(registryPath);
    this.base = dirname(this.path);
    const entries = this.loadEntries(this.path);
    this.items = entries.map((e) => this.materialize(this.base, e));
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
  /**
   * 运行时创建/更新一个穿越者档案（login skill 的落盘步骤）。
   *
   * 写入两处：正文（backstory/persona）落 transmigrators/<id>.*.md，索引条目
   * 追加进 registry JSON（保留 _comment 与 transmigrators 包装结构）。写盘后
   * 同步刷新内存（items + byUsername），后续 getByUsername/list 立即可见。
   *
   * 同名（username 小写）已存在时按 upsert 语义覆盖，避免重复档案。
   */
  create(input) {
    const username = input.username.trim();
    if (!username) throw new Error("[mc-transmigrator] create: username is required");
    const id = username.toLowerCase();
    const backstoryFile = `transmigrators/${id}.backstory.md`;
    const personaFile = `transmigrators/${id}.persona.md`;
    const entry = {
      id,
      username,
      ...input.name !== void 0 ? { name: input.name } : {},
      ...input.origin !== void 0 ? { origin: input.origin } : {},
      ...input.source !== void 0 ? { source: input.source } : {},
      ...input.epithet !== void 0 ? { epithet: input.epithet } : {},
      backstoryFile,
      personaFile,
      ...input.innate !== void 0 ? { innate: input.innate } : {}
    };
    if (input.backstory !== void 0 || input.persona !== void 0) {
      try {
        mkdirSync(resolve(this.base, "transmigrators"), { recursive: true });
      } catch {
      }
      if (input.backstory !== void 0) {
        writeFileSync(resolve(this.base, backstoryFile), input.backstory, "utf-8");
      }
      if (input.persona !== void 0) {
        writeFileSync(resolve(this.base, personaFile), input.persona, "utf-8");
      }
    }
    this.persist(entry);
    const tm = this.materialize(this.base, entry);
    const idx = this.items.findIndex((t) => t.username.toLowerCase() === id);
    if (idx >= 0) this.items[idx] = tm;
    else this.items.push(tm);
    this.byUsername.set(id, tm);
    return tm;
  }
  /** 读原始 JSON（保留 _comment / transmigrators 包装），upsert 后写回。 */
  persist(entry) {
    let root = { transmigrators: [] };
    try {
      if (existsSync(this.path)) {
        root = JSON.parse(readFileSync(this.path, "utf-8"));
      }
    } catch {
      root = { transmigrators: [] };
    }
    const wrapped = !Array.isArray(root);
    const list = (Array.isArray(root) ? root : root.transmigrators) ?? [];
    const idx = list.findIndex((e) => e.id === entry.id);
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    const next = wrapped ? { ...root, transmigrators: list } : list;
    writeFileSync(this.path, JSON.stringify(next, null, 2), "utf-8");
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
