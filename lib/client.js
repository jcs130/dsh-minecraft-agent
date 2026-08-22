window.__ModuleLoader__.load({ id: "dsh-minecraft-agent", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots", "sessions", "connection"];
var MC_PROJECT_DIR_NAME = "scratch-plugin";
function cwdInMcProject(cwd) {
  if (!cwd) return false;
  const normalized = cwd.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] === MC_PROJECT_DIR_NAME;
}
function hhmmss(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return "";
  }
}
function fmtUptime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  return h > 0 ? `${h}\u5C0F\u65F6${m}\u5206` : `${m}\u5206${s % 60}\u79D2`;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round((n >> 16 & 255) * (1 + f)));
  const g = Math.min(255, Math.round((n >> 8 & 255) * (1 + f)));
  const b = Math.min(255, Math.round((n & 255) * (1 + f)));
  return `rgb(${r},${g},${b})`;
}
function drawTopo(c, p, setSub) {
  const g = c.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, c.width, c.height);
  const m = p?.topo ?? null;
  if (!m || !m.cells) {
    setSub("\u7B49\u5F85\u5730\u5F62\u6570\u636E\u2026");
    return;
  }
  const R = m.r || 16;
  const N = 2 * R + 1;
  const SZ = Math.floor(c.width / N);
  const COL = {
    g: "#4a7c3f",
    d: "#7a5b3a",
    "#": "#6e6e6e",
    s: "#d9c07a",
    "~": "#3a6ea5",
    L: "#e07020",
    w: "#8a6236",
    l: "#3a6b35",
    c: "#8f8f8f",
    o: "#f0c94a",
    T: "#ffcc44",
    b: "#e0564f",
    C: "#c39a6b",
    F: "#d9a03f",
    G: "#9fc6e8",
    "?": "#556070",
    ".": "#10141b"
  };
  const hs = m.heights || [];
  for (let i = 0; i < m.cells.length && i < N * N; i++) {
    const ch = m.cells[i];
    const h = hs[i] || 0;
    const base = COL[ch] || COL["?"];
    g.fillStyle = shade(base, Math.max(-0.4, Math.min(0.4, h * 0.06)));
    g.fillRect(i % N * SZ, Math.floor(i / N) * SZ, SZ, SZ);
  }
  const cx = m.cx ?? 0;
  const cz = m.cz ?? 0;
  const mem = p?.memory ?? null;
  const RCOL = {
    base: "#f5d76e",
    publicChest: "#c39a6b",
    coal_ore: "#5d6d7e",
    iron_ore: "#dfe4ea",
    cobblestone: "#aab7b8",
    oak_log: "#52be80",
    spruce_log: "#1e8449"
  };
  const drawPt = (x, z, color, r) => {
    const dx = x - cx;
    const dz = z - cz;
    if (Math.abs(dx) > R || Math.abs(dz) > R) return;
    g.fillStyle = color;
    g.beginPath();
    g.arc((dx + R) * SZ + SZ / 2, (dz + R) * SZ + SZ / 2, r, 0, 7);
    g.fill();
    g.strokeStyle = "#0b0d10";
    g.lineWidth = 1;
    g.stroke();
  };
  if (mem?.base) drawPt(mem.base.x, mem.base.z, RCOL.base, 4);
  if (mem?.publicChest) drawPt(mem.publicChest.x, mem.publicChest.z, RCOL.publicChest, 4);
  Object.keys(mem?.resourcePoints || {}).forEach((k) => {
    ;
    (mem?.resourcePoints?.[k] || []).forEach((q) => drawPt(q.x, q.z, RCOL[k] || "#889", 2.5));
  });
  (m.entities || []).forEach((e) => {
    const px = (e.dx + R) * SZ + SZ / 2;
    const pz = (e.dz + R) * SZ + SZ / 2;
    const isP = /player/.test(e.name);
    g.fillStyle = isP ? "#4fd8ff" : "#ff5a5a";
    g.beginPath();
    g.arc(px, pz, 3, 0, 7);
    g.fill();
    if (isP) {
      g.fillStyle = "#bfeaff";
      g.font = "10px sans-serif";
      g.fillText(e.name.replace("(player)", ""), px + 5, pz + 3);
    }
  });
  const mx = R * SZ + SZ / 2;
  const mz = R * SZ + SZ / 2;
  const yaw = m.yaw || 0;
  const ax = -Math.sin(yaw);
  const az = Math.cos(yaw);
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(mx, mz, 4, 0, 7);
  g.fill();
  g.strokeStyle = "#fff";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(mx, mz);
  g.lineTo(mx + ax * 12, mz + az * 12);
  g.stroke();
  g.lineWidth = 1;
  g.fillStyle = "#8a93a3";
  g.font = "11px sans-serif";
  g.fillText("N \u2191", 6, 14);
  const legend = [["#f5d76e", "\u57FA\u5730"], ["#c39a6b", "\u516C\u5171\u7BB1"], ["#5d6d7e", "\u77FF"], ["#52be80", "\u6728"]];
  g.font = "10px sans-serif";
  legend.forEach(([col, lab], i) => {
    const ly = 12 + i * 13;
    g.fillStyle = col;
    g.fillRect(c.width - 62, ly - 8, 8, 8);
    g.fillStyle = "#8a93a3";
    g.fillText(lab, c.width - 50, ly);
  });
  setSub(`\u4E2D\u5FC3 ${m.cx != null ? "(" + m.cx + "," + m.cy + "," + m.cz + ")" : "\u2014"} \xB7 ${(m.entities || []).length} \u5B9E\u4F53 \xB7 ${hhmmss(m.updatedAt)}`);
}
var CSS = `
.mcp{--bg:#0f1115;--card:#1a1d24;--line:#262a33;--fg:#d7dce4;--dim:#8a93a3;--acc:#4f8cff;--ok:#3fb96f;--bad:#e0564f;--warn:#d9a03f;background:var(--bg);color:var(--fg);font:14px/1.5 "Segoe UI",system-ui,"Microsoft YaHei",sans-serif;height:100%;overflow:auto}
.mcp *{box-sizing:border-box}
.mcp a{color:var(--acc);text-decoration:none}
.mcp .wrap{max-width:1280px;margin:0 auto;padding:14px}
.mcp .top{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;padding:10px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:12px}
.mcp .top h1{font-size:18px;margin:0}.mcp .top .sub{color:var(--dim);font-size:12px}
.mcp .badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--line)}
.mcp .badge.on{color:var(--ok);border-color:var(--ok)}.mcp .badge.off{color:var(--bad);border-color:var(--bad)}
.mcp .grid{display:grid;grid-template-columns:1fr 340px;gap:12px}
@media(max-width:900px){.mcp .grid{grid-template-columns:1fr}}
.mcp .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px}
.mcp .card h2{font-size:13px;color:var(--dim);margin:0 0 8px;font-weight:600;letter-spacing:.05em}
.mcp .viewer{position:relative;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden}
.mcp .viewer iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.mcp .fs{position:absolute;right:8px;top:8px;background:#0009;color:#fff;border:0;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px}
.mcp .shotwrap{position:relative}.mcp .shotwrap img{width:100%;border-radius:8px;display:block;background:#000}
.mcp .vrow{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:13px}
.mcp .bar{flex:1;height:9px;background:#0b0d10;border-radius:6px;overflow:hidden}.mcp .bar i{display:block;height:100%}
.mcp .hp i{background:linear-gradient(90deg,#c0392b,#e0564f)}.mcp .fd i{background:linear-gradient(90deg,#b9770e,#d9a03f)}
.mcp .steps{max-height:520px;overflow:auto;display:flex;flex-direction:column;gap:8px}
.mcp .step{border-left:3px solid var(--acc);padding:6px 10px;background:#141821;border-radius:0 8px 8px 0}
.mcp .step.err{border-left-color:var(--bad)}
.mcp .step .meta{color:var(--dim);font-size:11px;display:flex;gap:8px;flex-wrap:wrap}
.mcp .step .th{margin:3px 0}.mcp .step .out{font-size:12px;color:#aab3c2;word-break:break-all}
.mcp .chips{display:flex;flex-wrap:wrap;gap:6px}.mcp .chip{background:#141821;border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:12px}
.mcp .item{font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}.mcp .item:last-child{border-bottom:0}
.mcp .item .t{color:var(--dim);font-size:11px}
.mcp .bottom{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:1000px){.mcp .bottom{grid-template-columns:1fr}}
.mcp canvas{width:100%;border-radius:8px;background:#0b0d10}
.mcp .empty{color:var(--dim);font-size:12px;padding:6px 0}
.mcp .vtab{font-size:11px;padding:2px 8px;border:1px solid #2a3346;border-radius:9px;background:transparent;color:var(--dim);cursor:pointer}
.mcp .vtab:hover{color:#fff}
.mcp .conn{background:#141821;border:1px solid var(--line);border-radius:6px;color:var(--fg);padding:4px 8px;font-size:13px;flex:1;min-width:0}
.mcp .btn{background:var(--acc);border:0;border-radius:6px;color:#fff;padding:4px 12px;font-size:12px;cursor:pointer}
.mcp .btn:hover{filter:brightness(1.15)}
.mcp .btn.ghost{background:transparent;border:1px solid var(--line);color:var(--dim)}
`;
var VTABS = [
  { id: "3", label: "\u8F68\u9053" },
  { id: "smooth", label: "\u7B2C\u4E00\u4EBA\u79F0" },
  { id: "map", label: "\u4FEF\u89C6\u5730\u56FE" }
];
function McPanelView({ rpc }) {
  const [p, setP] = (0, import_react.useState)(null);
  const [pv, setPv] = (0, import_react.useState)("3");
  const [viewerSrc, setViewerSrc] = (0, import_react.useState)("about:blank");
  const [shotSrc, setShotSrc] = (0, import_react.useState)(null);
  const [topoSub, setTopoSub] = (0, import_react.useState)("\u7B49\u5F85\u5730\u5F62\u6570\u636E\u2026");
  const [connHost, setConnHost] = (0, import_react.useState)("");
  const [connPort, setConnPort] = (0, import_react.useState)("");
  const [connEdited, setConnEdited] = (0, import_react.useState)(false);
  const [connMsg, setConnMsg] = (0, import_react.useState)("");
  const lastShotRef = (0, import_react.useRef)(null);
  const topoRef = (0, import_react.useRef)(null);
  const viewerMapRef = (0, import_react.useRef)(null);
  const vwrapRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    if (!rpc) {
      setP(null);
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const res = await rpc.call("/mc-panel", "snapshot", {});
        if (alive && res.ok) setP(res.value);
      } catch {
      }
    };
    void tick();
    const t = setInterval(tick, 3e3);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [rpc]);
  (0, import_react.useEffect)(() => {
    if (topoRef.current) drawTopo(topoRef.current, p, setTopoSub);
    if (viewerMapRef.current) drawTopo(viewerMapRef.current, p, () => {
    });
  }, [p, pv]);
  (0, import_react.useEffect)(() => {
    const ls = p?.latestShot ?? null;
    if (ls && ls !== lastShotRef.current) {
      lastShotRef.current = ls;
      setShotSrc("/mc-panel/shot/" + encodeURIComponent(ls) + "?t=" + Date.now());
    } else if (!ls) {
      lastShotRef.current = null;
      setShotSrc(null);
    }
  }, [p?.latestShot]);
  const viewerPort = p?.status?.bot?.viewerPort;
  (0, import_react.useEffect)(() => {
    if (!viewerPort) return;
    const port = pv === "smooth" ? viewerPort + 100 : viewerPort;
    setViewerSrc(`http://${location.hostname}:${port}/`);
  }, [viewerPort, pv]);
  const rtHost = p?.connection?.runtime?.host;
  const rtPort = p?.connection?.runtime?.port;
  (0, import_react.useEffect)(() => {
    if (connEdited) return;
    if (rtHost) setConnHost(rtHost);
    setConnPort(rtPort ? String(rtPort) : "");
  }, [rtHost, rtPort, connEdited]);
  const onSaveConn = async () => {
    if (!rpc) return;
    setConnMsg("\u4FDD\u5B58\u4E2D\u2026");
    const body = { host: connHost.trim() };
    const pp = connPort.trim();
    if (pp) body.port = parseInt(pp, 10);
    try {
      const res = await rpc.call("/mc-panel", "connection.set", body);
      setConnMsg(res.ok ? "\u5DF2\u4FDD\u5B58\uFF0Cbot \u91CD\u8FDE\u4E2D\uFF08\u7EA6 2-5 \u79D2\uFF09" : "\u5931\u8D25\uFF1A" + (res.error.message || "\u672A\u77E5\u9519\u8BEF"));
    } catch (e) {
      setConnMsg("\u8BF7\u6C42\u5931\u8D25\uFF1A" + String(e));
    }
  };
  const onResetConn = async () => {
    if (!rpc) return;
    setConnMsg("\u6062\u590D\u4E2D\u2026");
    setConnEdited(false);
    try {
      const res = await rpc.call("/mc-panel", "connection.reset", {});
      setConnMsg(res.ok ? "\u5DF2\u6062\u590D\u914D\u7F6E\u9ED8\u8BA4\uFF08bot \u91CD\u8FDE\u4E2D\uFF09" : "\u5931\u8D25");
    } catch (e) {
      setConnMsg("\u8BF7\u6C42\u5931\u8D25\uFF1A" + String(e));
    }
  };
  const fs = () => {
    const w = vwrapRef.current;
    if (!w) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void w.requestFullscreen?.();
  };
  const st = p?.status?.bot ?? null;
  const titleName = p?.archive?.name || st?.personaName || p?.username || "\u672A\u77E5\u7A7F\u8D8A\u8005";
  const subText = (p?.archive?.epithet ? p.archive.epithet + " \xB7 " : "") + (p?.username || "") + (p?.archive?.source ? " \xB7 " + p.archive.source : "");
  const hp = st?.health ?? 0;
  const fd = st?.food ?? 0;
  const pos = st?.position;
  const yaw = st?.yaw ?? 0;
  const dirs = ["\u5357", "\u897F", "\u5317", "\u4E1C"];
  const di = Math.round((yaw * 180 / Math.PI + 360) % 360 / 90) % 4;
  const goal = p?.memory?.currentGoal || (p?.status?.recentSteps?.length ? p.status.recentSteps[p.status.recentSteps.length - 1].goal : "\u2014");
  const cards = p?.status?.context?.cards ?? [];
  const steps = (p?.status?.recentSteps ?? []).slice(-30).reverse();
  const rt = p?.connection?.runtime ?? null;
  const cAge = rt ? Date.now() - new Date(rt.updatedAt).getTime() : 0;
  const inv = st?.inventory ?? [];
  const agg = {};
  inv.forEach((i) => {
    agg[i.name] = (agg[i.name] || 0) + i.count;
  });
  const invKeys = Object.keys(agg).sort((a, b) => agg[b] - agg[a]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mcp", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wrap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "top", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", { children: [
          "\u2694 ",
          titleName
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "sub", children: subText }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "badge " + (p?.online ? "on" : "off"), children: p?.online ? "\u{1F7E2} \u5728\u7EBF" : "\u{1F534} \u5931\u8054/\u79BB\u7EBF" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "badge", children: p?.mystic?.level != null ? "Lv." + p.mystic.level : "Lv.\u2014" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "badge", children: p?.mystic?.innateSkill ? "\u5929\u8D4B\u300C" + p.mystic.innateSkill + "\u300D" : "\u5929\u8D4B\u672A\u5B9A" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "badge", children: p?.kills?.recent ? "\u2694 \u8FD1\u671F\u51FB\u6740 " + p.kills.recent : "\u2694 0" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "card", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", { children: [
              "\u6E38\u620F\u89C6\u89D2",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { float: "right" }, children: VTABS.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  className: "vtab",
                  onClick: () => setPv(t.id),
                  style: pv === t.id ? { background: "var(--acc)", color: "#0d1117" } : void 0,
                  children: t.label
                },
                t.id
              )) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "viewer", ref: vwrapRef, children: [
              pv === "map" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", { ref: viewerMapRef, width: 512, height: 512, style: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", height: "100%", aspectRatio: "1 / 1" } }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("iframe", { src: viewerSrc, title: "3D \u89C6\u89D2" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "fs", onClick: fs, children: "\u26F6 \u5168\u5C4F" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "card", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u6700\u8FD1\u6240\u89C1\uFF08agent \u622A\u56FE\uFF09" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "shotwrap", children: shotSrc ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: shotSrc, alt: "\u622A\u56FE" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "empty", children: "\u6682\u65E0\u622A\u56FE" }) })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "card", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u670D\u52A1\u5668\u8FDE\u63A5\uFF08\u9875\u9762\u53EF\u914D\uFF09" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "vrow", children: rt ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
              "\u751F\u6548 ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
                rt.host,
                ":",
                rt.port
              ] }),
              " \xB7 ",
              rt.source === "override" ? "\u9875\u9762\u8BBE\u7F6E" : "\u914D\u7F6E\u9ED8\u8BA4",
              " \xB7",
              " ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "badge " + (rt.connected ? "on" : "off"), children: rt.connected ? "\u5DF2\u8FDE\u63A5" : cAge < 3e4 ? "\u91CD\u8FDE\u4E2D\u2026" : "\u672A\u8FDE\u63A5" })
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "empty", children: "\u7B49\u5F85 bot \u4E0A\u62A5\u8FDE\u63A5\u72B6\u6001\u2026" }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "vrow", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  className: "conn",
                  placeholder: "\u670D\u52A1\u5668\u5730\u5740\uFF08IP/\u57DF\u540D\uFF09",
                  spellCheck: false,
                  value: connHost,
                  onChange: (e) => {
                    setConnEdited(true);
                    setConnHost(e.target.value);
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  className: "conn",
                  placeholder: "\u7AEF\u53E3",
                  inputMode: "numeric",
                  style: { width: 76, flex: "none" },
                  value: connPort,
                  onChange: (e) => {
                    setConnEdited(true);
                    setConnPort(e.target.value);
                  }
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "vrow", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "btn", onClick: () => void onSaveConn(), children: "\u4FDD\u5B58\u5E76\u91CD\u8FDE" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "btn ghost", onClick: () => void onResetConn(), children: "\u6062\u590D\u9ED8\u8BA4" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "sub", style: { fontSize: 11 }, children: connMsg })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "sub", style: { fontSize: 11, color: "var(--dim)" }, children: "\u6539\u52A8\u7EA6 2-5 \u79D2\u5185\u81EA\u52A8\u751F\u6548\uFF1Abot \u7528\u65B0\u5730\u5740\u91CD\u5EFA\u8FDE\u63A5\uFF0C\u65E0\u9700\u91CD\u542F" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "card", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u72B6\u6001" }),
            st ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "vrow", children: [
                "\u2764 \u751F\u547D ",
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bar hp", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: hp / 20 * 100 + "%" } }) }),
                " ",
                hp,
                "/20"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "vrow", children: [
                "\u{1F357} \u9971\u98DF ",
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bar fd", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: fd / 20 * 100 + "%" } }) }),
                " ",
                fd,
                "/20"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "vrow", children: [
                "\u{1F4CD} \u5750\u6807 ",
                pos ? `${pos.x}, ${pos.y}, ${pos.z}` : "\u2014"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "vrow", children: [
                "\u{1F9ED} \u671D\u5411 ",
                dirs[di],
                " \xB7 \u270B \u624B\u6301 ",
                st.heldItem || "\u7A7A\u624B",
                st.sleeping ? " \xB7 \u{1F634} \u7761\u7720\u4E2D" : ""
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "vrow", children: [
                "\u{1F3AF} \u76EE\u6807 ",
                goal
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "vrow", children: [
                "\u23F1 \u8FDB\u7A0B ",
                fmtUptime(p?.uptimeSec ?? 0),
                " \xB7 \u66F4\u65B0 ",
                hhmmss(p?.status?.updatedAt)
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "vrow", children: [
                "\u{1F9E0} \u4E0A\u4E0B\u6587\u63D0\u793A\u5361 ",
                cards.length ? cards.map((k) => k.id + "\xD7" + k.remain).join(" ") : "\u65E0\uFF08\u6309\u9700\u62AB\u9732\u4E2D\uFF09"
              ] })
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "empty", children: "\u6682\u65E0\u72B6\u6001\u6570\u636E\uFF08\u7B49\u5F85 agent \u8FDE\u63A5\u670D\u52A1\u5668\u2026\uFF09" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "card", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u5468\u56F4\u5730\u5F62\uFF08\u5B9E\u65F6\u4FEF\u89C6 33\xD733\uFF09" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", { ref: topoRef, width: 330, height: 330 }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "sub", style: { color: "var(--dim)", fontSize: 11, marginTop: 4 }, children: topoSub })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "card", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u751F\u5B58\u77E5\u8BC6\u5E93" }),
            p?.wiki?.total ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "item", children: [
                "\u5171 ",
                p.wiki.total,
                " \u5F20\u77E5\u8BC6\u5361\uFF08\u5C55\u793A\u6700\u8FD1 ",
                p.wiki.cards.length,
                " \u5F20\uFF09"
              ] }),
              p.wiki.cards.map((c, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "item", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: c.topic }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "t", children: [
                  c.source,
                  " \xB7 ",
                  hhmmss(String(c.ts)),
                  " \xB7 ",
                  (c.content || "").slice(0, 80),
                  "\u2026"
                ] })
              ] }, i))
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "empty", children: "\u8FD8\u6CA1\u5B66\u4F1A\u4EFB\u4F55\u6559\u8BAD" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "card", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u7F3A\u9677\u5DE5\u5355" }),
            p?.defects?.length ? p.defects.slice(0, 6).map((d, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "item", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                "\u2692 ",
                d.tool,
                " \xD7",
                d.count != null ? d.count : "?"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "t", children: d.lastSample || d.lastAt || d.file })
            ] }, i)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "empty", children: "\u65E0\u672A\u51B3\u5DE5\u5355\uFF0C\u8FD0\u884C\u5065\u5EB7" })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "card", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u601D\u8003\u4E0E\u884C\u52A8\u6D41" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "steps", children: steps.length ? steps.map((s, i) => {
          const bad = /error|could not|failed|timeout/i.test(s.outcome || "");
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "step" + (bad ? " err" : ""), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "meta", children: [
              "#",
              s.step ?? "?",
              " \xB7 ",
              hhmmss(s.ts),
              " \xB7 \u2692 ",
              s.tool || ""
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "th", children: [
              "\u{1F4AD} ",
              s.thought || ""
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "meta", children: [
              "\u{1F3AF} ",
              s.goal || ""
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "out", children: (s.outcome || "").slice(0, 300) })
          ] }, i);
        }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "empty", children: "\u6682\u65E0\u884C\u52A8\u8BB0\u5F55" }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "card", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u7F16\u5E74\u53F2\u4E8B\u4EF6\u6D41\uFF08\u2694 \u6218\u6597\u51FB\u6740\u9AD8\u4EAE\uFF09" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "steps", style: { maxHeight: 300 }, children: p?.events?.length ? p.events.slice(0, 25).map((e, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "step" + (e.kill ? " err" : ""), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "meta", children: [
            hhmmss(e.ts),
            e.kill ? " \xB7 \u2694 \u6218\u6597" : ""
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "out", children: e.text.slice(0, 260) })
        ] }, i)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "empty", children: "\u6682\u65E0\u7F16\u5E74\u53F2" }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bottom", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "card", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u80CC\u5305" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "chips", children: invKeys.length ? invKeys.map((k) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "chip", children: [
            k,
            " \xD7",
            agg[k]
          ] }, k)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "empty", children: "\u80CC\u5305\u7A7A\u7A7A\u5982\u4E5F" }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "card", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u6863\u6848" }),
          p?.archive ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "item", children: [
              "\u540D\u5B57\uFF1A",
              p.archive.name
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "item", children: [
              "\u79F0\u53F7\uFF1A",
              p.archive.epithet || "\u2014"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "item", children: [
              "\u6765\u81EA\uFF1A",
              p.archive.source || "\u2014"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "item", children: [
              "MC \u7528\u6237\u540D\uFF1A",
              p.username
            ] })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "empty", children: "\u672A\u6CE8\u518C\u7A7F\u8D8A\u8005\u6863\u6848" })
        ] })
      ] })
    ] })
  ] });
}
function apply(ctx) {
  const connection = ctx.get("connection");
  const rpc = connection?.rpc;
  ctx.slots.inject("conversation.view", () => {
    let disposeEntry = null;
    const sync = () => {
      const state = ctx.sessions.list.getSnapshot();
      const currentId = state.current;
      const current = currentId === void 0 ? void 0 : state.byId[currentId];
      const inMc = cwdInMcProject(current?.cwd);
      if (inMc && disposeEntry === null) {
        const View = () => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(McPanelView, { rpc });
        disposeEntry = ctx.slots.register(
          {
            name: "conversation.view",
            id: "mc-panel",
            order: 100,
            label: () => "MC\u9762\u677F"
          },
          View
        );
      } else if (!inMc && disposeEntry !== null) {
        disposeEntry();
        disposeEntry = null;
      }
    };
    sync();
    const unsubscribe = ctx.sessions.list.subscribe(sync);
    return () => {
      unsubscribe();
      if (disposeEntry !== null) {
        disposeEntry();
        disposeEntry = null;
      }
    };
  });
}
return module.exports; } });
