// src/mc-panel.ts
import Schema from "@deepseek-ai/schemastery";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

// src/mc-connection.ts
var CONNECTION_FILE = "mc-connection.json";
var RUNTIME_FILE = "bot-connection.json";
function validateOverrides(input) {
  if (typeof input !== "object" || input === null) return { ok: false, error: "\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F JSON \u5BF9\u8C61" };
  const raw = input;
  const value = {};
  if (typeof raw.host !== "string" || !raw.host.trim()) return { ok: false, error: "host \u4E0D\u80FD\u4E3A\u7A7A" };
  const host = raw.host.trim();
  if (host.length > 253 || /\s/.test(host)) return { ok: false, error: "host \u4E0D\u662F\u5408\u6CD5\u7684\u5730\u5740\uFF08\u57DF\u540D\u6216 IP\uFF09" };
  value.host = host;
  const port = raw.port;
  if (port !== void 0 && port !== null && port !== "") {
    const p = typeof port === "number" ? port : Number.parseInt(String(port), 10);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return { ok: false, error: "\u7AEF\u53E3\u5FC5\u987B\u662F 1-65535 \u7684\u6574\u6570" };
    value.port = p;
  }
  return { ok: true, value };
}

// src/mc-panel.ts
var name = "mc-panel";
var inject = ["mcStore"];
var Config = Schema.object({
  enabled: Schema.boolean().default(true),
  dataDir: Schema.string().default("./data"),
  /** which agent this panel shows; '' = auto-pick the freshest status in mc-store */
  username: Schema.string().default("")
});
function okRpc(value) {
  return { ok: true, value };
}
function errRpc(message, code = "internal") {
  return { ok: false, error: { code, message, details: {} } };
}
var KILL_RE = /击杀|杀死|斩杀|斩了|killed|slain|defeated|击败/;
var START_MS = Date.now();
var panelStore;
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}
function resolveUsername(dataDir, configured, store) {
  void dataDir;
  if (configured) return configured;
  const s = store ?? panelStore;
  try {
    const rows = s?.listStatusAgents() ?? [];
    let best = "";
    let bestTs = "";
    for (const a of rows) {
      if (!a.username || a.username === "unknown") continue;
      if (a.updatedAt > bestTs) {
        bestTs = a.updatedAt;
        best = a.username;
      }
    }
    return best;
  } catch {
    return "";
  }
}
function facingLabel(yaw) {
  if (yaw == null || !Number.isFinite(yaw)) return "\u2014";
  const heading = (-yaw * 180 / Math.PI % 360 + 360) % 360;
  const compass = (360 - heading) % 360;
  if (compass >= 315 || compass < 45) return "\u5357 (+Z)";
  if (compass < 135) return "\u897F (-X)";
  if (compass < 225) return "\u5317 (-Z)";
  return "\u4E1C (+X)";
}
function resolveShotPath(dataDir, shot) {
  if (!shot) return null;
  const root = resolve(dataDir, "screenshots");
  const full = resolve(root, shot);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return existsSync(full) ? full : null;
}
function collect(dataDir, username, store) {
  const s = store ?? panelStore;
  const u = resolveUsername(dataDir, username, s);
  const payload = {
    username: u,
    status: null,
    staleMs: null,
    online: false,
    archive: null,
    mystic: null,
    wiki: { total: 0, cards: [] },
    memory: null,
    defects: [],
    latestShot: null,
    uptimeSec: Math.round((Date.now() - START_MS) / 1e3),
    topo: null,
    events: [],
    kills: { recent: 0, items: [] },
    connection: { override: null, runtime: null }
  };
  payload.connection.override = readJson(join(dataDir, CONNECTION_FILE));
  payload.connection.runtime = readJson(join(dataDir, RUNTIME_FILE));
  if (!u) return payload;
  const statusRaw = s?.loadStatus(u);
  const status = statusRaw ?? {};
  payload.status = statusRaw ? status : null;
  if (status.updatedAt) {
    const age = Date.now() - new Date(status.updatedAt).getTime();
    if (Number.isFinite(age)) {
      payload.staleMs = age;
      payload.online = status.connected === true;
    }
  }
  const tr = readJson(join(dataDir, "transmigrators.json"));
  const list = tr?.transmigrators ?? [];
  const entry = list.find((t) => t.username === u);
  if (entry) payload.archive = { name: entry.name, epithet: entry.epithet, source: entry.source };
  const mystic = readJson(join(dataDir, "mystic-state.json"));
  const players = mystic?.players ?? {};
  if (players[u]) payload.mystic = { innateSkill: players[u].innateSkill, level: players[u].level };
  try {
    const lines = readFileSync(join(dataDir, `wiki-${u}.jsonl`), "utf-8").split("\n").filter(Boolean);
    payload.wiki.total = lines.length;
    payload.wiki.cards = lines.slice(-8).reverse().map((l) => {
      try {
        const c = JSON.parse(l);
        return { topic: c.topic ?? "", source: c.source ?? "", ts: c.ts ?? 0, content: c.content ?? "" };
      } catch {
        return { topic: "(\u635F\u574F\u884C)", source: "", ts: 0, content: "" };
      }
    });
  } catch {
  }
  payload.memory = readJson(join(dataDir, "mc-memory.json"));
  try {
    const ddir = join(dataDir, "defects");
    for (const f of readdirSync(ddir)) {
      if (!f.endsWith(".json")) continue;
      const d = readJson(join(ddir, f));
      if (!d) continue;
      const toolFromName = /^DEFECT-\d{14}-(.+)\.json$/.exec(f)?.[1] ?? f;
      payload.defects.push({ ...d, file: f, tool: d.tool ?? toolFromName });
    }
    payload.defects.sort((a, b) => String(b.file).localeCompare(String(a.file)));
  } catch {
  }
  for (let i = (status.recentSteps?.length ?? 0) - 1; i >= 0; i--) {
    const step = status.recentSteps[i];
    if (step.shot && resolveShotPath(dataDir, step.shot)) {
      payload.latestShot = step.shot;
      break;
    }
  }
  if (!payload.latestShot) {
    try {
      const shotDir = join(dataDir, "screenshots", u);
      const files = readdirSync(shotDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
      if (files.length) {
        const rel = join(u, files[files.length - 1]);
        if (resolveShotPath(dataDir, rel)) payload.latestShot = rel;
      }
    } catch {
    }
  }
  payload.topo = s?.loadMap(u) ?? null;
  try {
    const rows = s?.episodicTail(u, 40) ?? [];
    const events = rows.map((r) => ({
      ts: r.ts,
      text: r.text,
      kill: KILL_RE.test(r.text)
    }));
    payload.events = events.reverse();
    const kills = events.filter((e) => e.kill).slice(0, 10);
    payload.kills = { recent: events.filter((e) => e.kill).length, items: kills };
  } catch {
  }
  return payload;
}
function apply(ctx, config) {
  if (!config.enabled) return;
  const dataDir = resolve(config.dataDir);
  panelStore = ctx.get("mcStore");
  ctx.inject(["connection"], (connectionCtx) => {
    const rpc = connectionCtx.connection?.rpc;
    if (!rpc || typeof rpc.handle !== "function") {
      console.warn("[mc-panel] connection.rpc.handle unavailable \u2014 RPC \u9762\u677F\u4E0D\u542F\u7528");
      return;
    }
    const disposeRpc = rpc.handle("/mc-panel", async (endpoint, payload) => {
      try {
        switch (endpoint) {
          case "snapshot": {
            const user = payload?.user ?? config.username;
            return okRpc(collect(dataDir, user));
          }
          case "connection.set": {
            const v = validateOverrides(payload);
            if (!v.ok) return errRpc(v.error, "bad-request");
            mkdirSync(dataDir, { recursive: true });
            const saved = { ...v.value, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), updatedBy: "mc-panel" };
            writeFileSync(join(dataDir, CONNECTION_FILE), JSON.stringify(saved, null, 2) + "\n", "utf-8");
            console.log(`[mc-panel] connection override saved: ${v.value.host}:${v.value.port ?? "(default)"} (bot auto-reconnects)`);
            return okRpc({ saved: v.value });
          }
          case "connection.reset": {
            try {
              unlinkSync(join(dataDir, CONNECTION_FILE));
            } catch {
            }
            console.log("[mc-panel] connection override removed (back to profile defaults)");
            return okRpc({ reset: true });
          }
          default:
            return errRpc(`unknown endpoint: ${endpoint}`);
        }
      } catch (e) {
        return errRpc(e instanceof Error ? e.message : String(e));
      }
    }, { authority: "loopback" });
    ctx.effect(() => () => {
      void disposeRpc();
    });
    console.log(`[mc-panel] RPC mounted at /mc-panel (data=${dataDir})`);
  });
  const SHOT_PREFIX = "/mc-panel/shot/";
  ctx.inject(["webServer"], () => {
    const ws = ctx.get("webServer");
    if (!ws || typeof ws.register !== "function") return;
    const disposeShot = ws.register({
      kind: "prefix",
      path: SHOT_PREFIX,
      handler: (req, res) => {
        try {
          const raw = (req.url ?? "").split("?")[0];
          const rel = decodeURIComponent(raw.slice(SHOT_PREFIX.length));
          const full = resolveShotPath(dataDir, rel);
          if (!full) {
            res.writeHead(404).end("not found");
            return;
          }
          const img = readFileSync(full);
          res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": img.length, "Cache-Control": "no-cache" });
          res.end(img);
        } catch {
          try {
            res.writeHead(404).end("gone");
          } catch {
          }
        }
      }
    });
    ctx.effect(() => disposeShot);
    console.log(`[mc-panel] screenshot route mounted at ${SHOT_PREFIX}`);
  });
}
export {
  Config,
  apply,
  collect,
  facingLabel,
  inject,
  name,
  resolveShotPath,
  resolveUsername
};
