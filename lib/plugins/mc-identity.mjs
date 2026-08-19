// src/mc-identity.ts
import Schema from "@deepseek-ai/schemastery";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
var name = "mc-identity";
var inject = ["mcTransmigrators", "mcMemos"];
var Config = Schema.object({
  seedStatePath: Schema.string().default("./data/identity-seed.json"),
  maxChunkChars: Schema.number().default(400),
  seedIntervalMs: Schema.number().default(300)
});
function chunkStory(text, maxChars) {
  const chunks = [];
  const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const para of paras) {
    if (para.length <= maxChars) {
      chunks.push(para);
      continue;
    }
    let buf = "";
    for (const part of para.split(/(?<=[。！？!?…])/)) {
      if (buf && buf.length + part.length > maxChars) {
        chunks.push(buf);
        buf = part;
      } else {
        buf += part;
      }
    }
    if (buf) chunks.push(buf);
  }
  return chunks;
}
function sha256(text) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}
function apply(ctx, config) {
  const log = (msg) => console.log(`[mc-identity] ${msg}`);
  const statePath = resolve(config.seedStatePath);
  const service = {
    anchor(username) {
      const t = ctx.mcTransmigrators.getByUsername(username);
      if (!t) return "";
      const parts = [];
      if (t.persona.trim()) parts.push(t.persona.trim());
      if (t.backstory.trim()) {
        parts.push(
          [
            `\u4F60\u7684\u524D\u4E16\uFF08\u8EAB\u4EFD\u4E4B\u951A\u2014\u2014\u65E0\u8BBA\u5728\u8FD9\u4E2A\u4E16\u754C\u7ECF\u5386\u591A\u5C11\u5C81\u6708\uFF0C\u8FD9\u90FD\u662F\u4F60\u4E4B\u6240\u4EE5\u662F\u4F60\u7684\u51ED\u636E\uFF0C\u6C38\u4E0D\u5FD8\u5374\uFF09\uFF1A`,
            t.backstory.trim()
          ].join("\n")
        );
      }
      return parts.join("\n\n");
    }
  };
  ctx.provide("mcIdentity", service);
  async function seedAll() {
    let state = {};
    try {
      if (existsSync(statePath)) state = JSON.parse(readFileSync(statePath, "utf-8"));
    } catch {
      state = {};
    }
    for (const t of ctx.mcTransmigrators.list()) {
      try {
        if (!t.backstory.trim()) continue;
        const hash = sha256(t.backstory);
        const prev = state[t.id];
        if (prev && prev.hash === hash && prev.count > 0) continue;
        const chunks = chunkStory(t.backstory, config.maxChunkChars);
        const memoryIds = [];
        let failed = 0;
        for (let i = 0; i < chunks.length; i++) {
          const id = await ctx.mcMemos.remember(
            t.username,
            `\u524D\u4E16\u8BB0\u5FC6\xB7${i + 1}/${chunks.length}\uFF1A${chunks[i]}`
          );
          if (id === null) failed++;
          else if (id !== "ok") memoryIds.push(id);
          if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, config.seedIntervalMs));
        }
        if (failed > 0) {
          log(`seed partially failed for "${t.name}" (${failed}/${chunks.length} chunks lost) \u2014 will retry on next boot`);
          continue;
        }
        state[t.id] = { hash, count: chunks.length, at: (/* @__PURE__ */ new Date()).toISOString(), memoryIds };
        saveState(state);
        log(`seeded ${chunks.length} past-life memory chunk(s) for "${t.name}"(${t.username}) into MemOS`);
      } catch (err) {
        log(`seed failed for "${t.name}" (${err instanceof Error ? err.message : String(err)}) \u2014 will retry on next boot`);
      }
    }
  }
  function saveState(state) {
    try {
      mkdirSync(dirname(statePath), { recursive: true });
      const tmp = statePath + ".tmp";
      writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
      renameSync(tmp, statePath);
    } catch (err) {
      log(`seed state write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  log(`identity service ready (anchor=persona+backstory; seeding past-life memories to MemOS in background)`);
  void seedAll();
}
export {
  Config,
  apply,
  chunkStory,
  inject,
  name
};
