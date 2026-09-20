// src/mc-panel.ts
import Schema from "@deepseek-ai/schemastery";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readdirSync, readFileSync as readFileSync2, unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join, resolve as resolve2, sep } from "node:path";

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

// src/agent-store.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
var DEFAULT_COMMENT = "\u901A\u7528 MC AI Agent \u4EBA\u7269\u6CE8\u518C\u8868\u3002\u6BCF\u4E2A\u4EBA\u7269 = \u4E00\u4E2A dsh agent\uFF08= session\uFF09\uFF0C\u62E5\u6709\u72EC\u7ACB\u5DE5\u4F5C\u7A7A\u95F4\uFF08meta.cwd\uFF09\u4E0E\u4E0A\u4E0B\u6587\u8BB0\u5FC6\uFF08dsh-session-persistence\uFF09\u3002\u5B57\u6BB5\uFF1Aid=\u552F\u4E00\u6807\u8BC6\uFF08=sessionId=cwd \u76EE\u5F55\u540D\uFF09\uFF1Bname=\u663E\u793A\u540D\uFF08\u4E2D\u6587\uFF09\uFF1Busername=MC \u767B\u5F55\u540D\uFF08mineflayer \u7528\u6237\u540D\uFF09\uFF1Bbackground=\u80CC\u666F\u8EAB\u4EFD\uFF08\u81EA\u7531\u6587\u672C\uFF0C\u6CE8\u5165\u4EBA\u683C/\u884C\u4E3A\u65B9\u5F0F\uFF0C\u4E0D\u518D\u5F3A\u5236\u300C\u7A7F\u8D8A\u8005+\u9B54\u6CD5\u300D\u7ED3\u6784\uFF09\uFF1Bskin=\u76AE\u80A4\u9884\u8BBE key\uFF08\u5BF9\u5E94 skins.json \u7684 presets\uFF09\uFF1Bserver=\u8FDE\u63A5\u76EE\u6807\uFF1Bstatus=stopped/running\u3002\u63A7\u5236\u9875\u9762\u7684\u4EBA\u7269\u7BA1\u7406\uFF08\u65B0\u589E/\u5220\u9664/\u7F16\u8F91\u540D\u5B57\u80CC\u666F\u8EAB\u4EFD\uFF09\u8BFB\u5199\u672C\u6587\u4EF6\u3002";
var AGENTS_FILE = "agents.json";
function filePath(dataDir) {
  return resolve(dataDir, AGENTS_FILE);
}
function loadFile(dataDir) {
  const path = filePath(dataDir);
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      if (Array.isArray(raw.agents)) {
        return { _comment: raw._comment, agents: raw.agents.filter(isValidRecord) };
      }
    }
  } catch (err) {
    console.error(`[agent-store] \u8BFB\u53D6 ${path} \u5931\u8D25\uFF08\u56DE\u843D\u7A7A\u8868\uFF09: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { agents: [] };
}
function isValidRecord(e) {
  return !!e && typeof e === "object" && typeof e.id === "string" && typeof e.name === "string" && typeof e.username === "string";
}
function saveFile(dataDir, file) {
  mkdirSync(dataDir, { recursive: true });
  const out = { _comment: DEFAULT_COMMENT, agents: file.agents };
  writeFileSync(filePath(dataDir), JSON.stringify(out, null, 2) + "\n", "utf-8");
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function listAgents(dataDir) {
  return loadFile(dataDir).agents.map((a) => ({ ...a }));
}
function updateAgent(dataDir, id, patch) {
  const file = loadFile(dataDir);
  const idx = file.agents.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  const cur = file.agents[idx];
  const next = { ...cur };
  if (patch.name !== void 0) next.name = String(patch.name).trim() || cur.name;
  if (patch.username !== void 0) {
    const uname = String(patch.username).trim();
    if (!uname) return null;
    if (file.agents.some((a) => a.id !== id && a.username.toLowerCase() === uname.toLowerCase())) return null;
    next.username = uname;
  }
  if (patch.background !== void 0) next.background = String(patch.background).trim();
  if (patch.skin !== void 0) next.skin = patch.skin;
  if (patch.server !== void 0) next.server = patch.server;
  if (patch.status !== void 0) next.status = patch.status;
  next.updatedAt = nowIso();
  file.agents[idx] = next;
  saveFile(dataDir, file);
  return { ...next };
}
function loadSkins(dataDir) {
  try {
    const raw = JSON.parse(readFileSync(resolve(dataDir, "skins.json"), "utf-8"));
    return {
      presets: raw.presets ?? {},
      assignments: raw.assignments ?? {},
      _note: raw._note
    };
  } catch {
    return { presets: {}, assignments: {} };
  }
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
var panelStoreResolver;
function readJson(file) {
  try {
    return JSON.parse(readFileSync2(file, "utf-8"));
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
  const root = resolve2(dataDir, "screenshots");
  const full = resolve2(root, shot);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return existsSync2(full) ? full : null;
}
function collect(dataDir, username, store) {
  const s = store ?? panelStoreResolver?.() ?? panelStore;
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
    goal: null,
    spellbook: null,
    progress: null,
    defects: [],
    latestShot: null,
    uptimeSec: Math.round((Date.now() - START_MS) / 1e3),
    topo: null,
    events: [],
    kills: { recent: 0, items: [] },
    connection: { override: null, runtime: null }
  };
  try {
    payload.characters = listAgents(dataDir).map((a) => ({ id: a.id, name: a.name, username: a.username, skin: a.skin, status: a.status }));
    const sk = loadSkins(dataDir);
    payload.skins = {
      presets: Object.fromEntries(Object.entries(sk.presets).map(([k, v]) => [k, { url: v.url, model: v.model, displayName: v.displayName }])),
      assignments: sk.assignments
    };
  } catch {
  }
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
    const lines = readFileSync2(join(dataDir, `wiki-${u}.jsonl`), "utf-8").split("\n").filter(Boolean);
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
    const ag = readJson(join(dataDir, "active-goals.json"));
    const g = ag?.[u]?.goal;
    payload.goal = g ?? payload.memory?.currentGoal ?? null;
  } catch {
  }
  try {
    const sb = s?.loadSpellbook?.(u);
    if (sb) {
      const skills = sb.skills ? Object.values(sb.skills) : [];
      payload.spellbook = {
        level: sb.level,
        innate: sb.innate ?? null,
        total: skills.length,
        skills: skills.slice().sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || String(a.name).localeCompare(String(b.name)))
      };
    }
  } catch {
  }
  try {
    const pj = s?.loadProgress?.(u);
    if (pj) {
      payload.progress = {
        level: pj.level,
        chantTotal: pj.chantTotal,
        chantSuccess: pj.chantSuccess,
        chantFail: pj.chantFail,
        lastChantAt: pj.lastChantAt,
        lastChantText: pj.lastChantText,
        samples: pj.samples,
        lastLevelUpAt: pj.lastLevelUpAt
      };
    }
  } catch {
  }
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
  const dataDir = resolve2(config.dataDir);
  panelStore = ctx.get("mcStore");
  panelStoreResolver = () => ctx.get("mcStore");
  console.log(`[mc-panel] store ${panelStore ? "\u5DF2\u5C31\u7EEA" : "\u672A\u5C31\u7EEA\uFF08\u9762\u677F\u6570\u636E\u4F1A\u7A7A\uFF0C\u5DF2\u542F\u7528\u60F0\u6027\u91CD\u53D6\uFF09"}`);
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
            mkdirSync2(dataDir, { recursive: true });
            const saved = { ...v.value, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), updatedBy: "mc-panel" };
            writeFileSync2(join(dataDir, CONNECTION_FILE), JSON.stringify(saved, null, 2) + "\n", "utf-8");
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
  const DATA_PREFIX = "/mc-panel/data/";
  ctx.inject(["webServer"], () => {
    const ws = ctx.get("webServer");
    if (!ws || typeof ws.register !== "function") {
      console.warn("[mc-panel] webServer \u4E0D\u53EF\u7528 \u2014\u2014 \u9762\u677F\u6570\u636E\u8DEF\u7531\u672A\u6302\u8F7D");
      return;
    }
    const disposeData = ws.register({
      kind: "prefix",
      path: DATA_PREFIX,
      handler: (req, res) => {
        const send = (code, obj) => {
          res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(obj));
        };
        try {
          const u = new URL(req.url ?? "/", "http://localhost").searchParams.get("user") ?? config.username;
          if (req.method === "POST") {
            let raw = "";
            req.on("data", (c) => {
              raw += c;
            });
            req.on("end", () => {
              try {
                const body = JSON.parse(raw || "{}");
                if (!body.id) return send(400, { error: "\u7F3A id" });
                const patch = {};
                if (body.skin !== void 0) patch.skin = body.skin;
                if (body.name !== void 0) patch.name = body.name;
                if (body.background !== void 0) patch.background = body.background;
                const next = updateAgent(dataDir, body.id, patch);
                if (!next) return send(404, { error: "\u6539\u4E0D\u52A8\uFF08\u4EBA\u7269\u4E0D\u5B58\u5728\u6216\u540D\u5B57\u51B2\u7A81\uFF09" });
                send(200, { ok: true, agent: next, payload: collect(dataDir, u) });
              } catch (e) {
                send(400, { error: e instanceof Error ? e.message : String(e) });
              }
            });
            return;
          }
          send(200, collect(dataDir, u));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      }
    });
    console.log(`[mc-panel] data route mounted at ${DATA_PREFIX}`);
    ctx.effect?.(() => disposeData);
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
          const img = readFileSync2(full);
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
