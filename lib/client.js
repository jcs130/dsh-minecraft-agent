window.__ModuleLoader__.load({id:"@jcs130/dsh-minecraft-agent",factory:(require)=>{var module={exports:{}};var exports=module.exports;
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
  inject: () => inject,
  localPanelUrl: () => localPanelUrl,
  retainPanelSession: () => retainPanelSession
});
module.exports = __toCommonJS(client_exports);
var import_react4 = require("react");

// src/decision-view.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function retainPanelSession(sessions, sessionId, ready) {
  const controller = new AbortController();
  let reference, released = false;
  const release = () => {
    if (released) return;
    released = true;
    controller.abort();
    reference?.release();
  };
  try {
    reference = sessions.retain(sessionId, { source: "minecraftPanel", signal: controller.signal });
    void reference.ready.then(() => {
      if (!released) ready(reference);
    }, () => {
      if (!released) {
        release();
        ready(void 0, "\u65E0\u6CD5\u8BFB\u53D6\u8FD9\u4E2A Agent \u7684\u4F1A\u8BDD\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u8FDE\u63A5\u3002");
      }
    });
  } catch {
    ready(void 0, "\u8FD9\u4E2A Agent \u7684\u4F1A\u8BDD\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u8FDE\u63A5\u3002");
  }
  return release;
}
function usePanelSession(sessions, sessionId) {
  const [state, setState] = (0, import_react.useState)();
  (0, import_react.useEffect)(() => {
    setState(void 0);
    if (sessionId) return retainPanelSession(sessions, sessionId, (reference, error) => setState({ id: sessionId, reference, error }));
  }, [sessions, sessionId]);
  return state?.id === sessionId ? state : void 0;
}
function FixedChat({ renderSlot }) {
  return renderSlot("conversation.session", { view: "chat" });
}
function DecisionView({ renderFactorySlot, useSession, useProjection }) {
  const session = useSession((value) => value);
  const projection = useProjection("goal");
  const goal = projection?.goal;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mc-decision-view", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mc-decision-heading", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mc-eyebrow", children: "AGENT ACTIVITY" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u51B3\u7B56\u4E0E\u884C\u52A8" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mc-live-state", children: session.openState === "error" ? "\u4F1A\u8BDD\u8BFB\u53D6\u5931\u8D25" : session.running ? "\u4F1A\u8BDD\u8FD0\u884C\u4E2D" : "\u7B49\u5F85\u4E0B\u4E00\u8F6E" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mc-goal", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5F53\u524D\u76EE\u6807" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: goal?.objective || (projection === void 0 ? "\u76EE\u6807\u4FE1\u606F\u672A\u63D0\u4F9B" : "\u5C1A\u672A\u8BBE\u7F6E\u76EE\u6807") }),
      goal?.phase && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: { active: "\u8FDB\u884C\u4E2D", paused: "\u5DF2\u6682\u505C", blocked: "\u5DF2\u53D7\u963B", complete: "\u5DF2\u7ED3\u675F" }[goal.phase] ?? "\u72B6\u6001\u672A\u77E5" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mc-disclosure-note", children: "\u63A8\u7406\u5185\u5BB9\u4EC5\u5728\u6A21\u578B\u5B9E\u9645\u8FD4\u56DE\u65F6\u663E\u793A\uFF0C\u53EF\u5C55\u5F00\u67E5\u770B\uFF1B\u672A\u8FD4\u56DE\u65F6\u53EA\u663E\u793A\u56DE\u7B54\u548C\u5DE5\u5177\u3002\u8FD9\u91CC\u662F\u539F\u4F1A\u8BDD\uFF0C\u4E0D\u4F1A\u989D\u5916\u8C03\u7528\u6A21\u578B\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mc-transcript", children: renderFactorySlot("conversation.content", { variant: "embedded", phase: session.openState === "loading" ? "settling" : "active", hero: false }, { slots: { views: FixedChat } }) })
  ] });
}
function Workbench({ game, decision, onConfigure, onSettings }) {
  const [mode, setMode] = (0, import_react.useState)("split");
  const [configuring, setConfiguring] = (0, import_react.useState)(false), [configureError, setConfigureError] = (0, import_react.useState)("");
  const configure = async () => {
    if (configuring || !onConfigure) return;
    setConfiguring(true);
    setConfigureError("");
    try {
      await onConfigure();
    } catch {
      setConfigureError("\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u505C\u6B62\u7ED3\u679C\uFF0C\u8BF7\u6838\u5BF9\u8FDE\u63A5\u540E\u91CD\u8BD5\u3002");
    } finally {
      setConfiguring(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mc-agent-workbench", "data-mode": mode, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: WORKBENCH_CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mc-workbench-bar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mc-view-switch", "aria-label": "\u9762\u677F\u5E03\u5C40", children: [["split", "\u6E38\u620F + \u51B3\u7B56"], ["game", "\u53EA\u770B\u6E38\u620F"], ["decision", "\u53EA\u770B\u51B3\u7B56"]].map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "aria-pressed": mode === id, onClick: () => setMode(id), children: label }, id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mc-private-note", children: "\u672C\u4EBA\u4F1A\u8BDD \xB7 \u76F4\u64AD\u65F6\u53EF\u5207\u6362\u53EA\u770B\u6E38\u620F" }),
      onSettings && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "mc-configure", type: "button", onClick: onSettings, children: "\u89D2\u8272\u4E0E\u7B14\u8BB0" }),
      onConfigure && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "mc-configure", type: "button", disabled: configuring, onClick: configure, children: configuring ? "\u6B63\u5728\u505C\u6B62\u2026" : "\u505C\u6B62\u5E76\u914D\u7F6E" })
    ] }),
    configureError && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", className: "mc-configure-error", children: configureError }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mc-workbench-content", children: [
      mode !== "decision" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mc-game-seat", children: game }),
      mode !== "game" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("aside", { className: "mc-decision-seat", "aria-label": "Agent \u51B3\u7B56\u4E0E\u884C\u52A8", children: decision })
    ] })
  ] });
}
var WORKBENCH_CSS = `
.mc-configure{border:1px solid #405448;border-radius:6px;background:transparent;color:#b8cbbf;padding:6px 9px;font:12px system-ui;cursor:pointer}.mc-configure:disabled{opacity:.5;cursor:wait}.mc-configure-error{color:#f1b6ac;margin:6px 12px}
.mc-agent-workbench{container-type:inline-size;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:360px;overflow:hidden;background:var(--dsw-alias-bg-base,#10151b);color:var(--dsw-alias-text-primary,#dcebe5);font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif}
.mc-agent-workbench *{box-sizing:border-box}.mc-workbench-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:9px 12px;border-bottom:1px solid #35453d;flex:none}.mc-view-switch{display:flex;gap:5px}.mc-view-switch button{border:1px solid #405448;border-radius:6px;background:transparent;color:inherit;padding:6px 9px;font:inherit;font-size:12px;cursor:pointer}.mc-view-switch button[aria-pressed=true]{background:#263c32;border-color:#85c6a5;color:#b9f1d5}.mc-view-switch button:focus-visible{outline:2px solid #85c6a5;outline-offset:2px}.mc-private-note{margin-left:auto;color:#9eaaa5;font-size:11px}.mc-workbench-content{display:flex;flex:1;min-height:0;min-width:0}.mc-game-seat{flex:1;min-width:0;min-height:0}.mc-game-seat>iframe{height:100%;width:100%;border:0;display:block}.mc-decision-seat{display:flex;flex-direction:column;flex:0 0 38%;min-width:320px;max-width:500px;min-height:0;border-left:1px solid #35453d}.mc-agent-workbench[data-mode=decision] .mc-decision-seat{flex:1;max-width:none;border-left:0}.mc-decision-view{display:flex;flex-direction:column;min-height:0;height:100%;overflow:hidden}.mc-decision-heading{display:flex;align-items:center;gap:8px;padding:15px 15px 8px}.mc-decision-heading h2{font-size:16px;margin:1px 0;font-weight:650}.mc-eyebrow{font-size:9px;letter-spacing:1.4px;color:#8aba9f}.mc-live-state{margin-left:auto;white-space:nowrap;color:#b5d8c4;font-size:11px}.mc-goal{margin:0 15px;padding:9px 11px;border:1px solid #35453d;border-radius:7px;background:#1b2922}.mc-goal>span,.mc-goal small{font-size:10px;color:#a4c3b1}.mc-goal p{margin:3px 0;font-size:12px;overflow-wrap:anywhere;line-height:1.6;max-height:100px;overflow:auto;color:#dcebe5}.mc-disclosure-note{margin:9px 15px;color:#a4b3ab;font-size:10px;line-height:1.6}.mc-transcript{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;padding:0 6px 12px;border-top:1px solid #35453d;--dsh-composer-side-clearance:0px}.mc-transcript>div{min-width:0}.mc-agent-workbench[data-mode=split] .mc-game-seat{flex-basis:62%}
@container(max-width:820px){.mc-workbench-content{flex-direction:column;overflow:auto}.mc-agent-workbench[data-mode=split] .mc-game-seat{flex:1 0 320px;min-height:320px}.mc-agent-workbench[data-mode=split] .mc-decision-seat{flex:1 0 360px;min-height:360px;max-width:none;width:100%;border-left:0;border-top:1px solid #35453d}.mc-private-note{margin-left:0}.mc-workbench-bar{gap:6px}.mc-agent-workbench[data-mode=game] .mc-game-seat{min-height:320px}}
`;

// src/profile-view.tsx
var import_react3 = require("react");

// src/notebook-view.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
var blank = { kind: "resource", summary: "", content: "", dimension: "overworld", tags: "" };
var kinds = { resource: "\u77FF\u70B9\u4E0E\u8D44\u6E90", place: "\u5174\u8DA3\u70B9\uFF0F\u636E\u70B9", relationship: "\u4EBA\u7269\u5173\u7CFB", task: "\u4EFB\u52A1\u7EBF\u7D22", method: "\u65B9\u6CD5", lesson: "\u7ECF\u9A8C", note: "\u5176\u4ED6\u7B14\u8BB0" };
var sources = { agent_note: "Agent \u7B14\u8BB0", user_report: "\u4E3B\u4EBA\u62A5\u544A", hypothesis: "\u63A8\u6D4B", runtime_observation: "\u8FD0\u884C\u89C2\u6D4B" };
var date = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "\u65F6\u95F4\u672A\u8BB0\u5F55";
function NotebookView({ onAction, identity }) {
  const [query, setQuery] = (0, import_react2.useState)(""), [dimension, setDimension] = (0, import_react2.useState)("*"), [page, setPage] = (0, import_react2.useState)(), [editing, setEditing] = (0, import_react2.useState)({ ...blank }), [busy, setBusy] = (0, import_react2.useState)(false), [error, setError] = (0, import_react2.useState)(""), [notice, setNotice] = (0, import_react2.useState)("");
  const request = (args) => onAction("notebook", args);
  const load = async (offset = 0) => {
    setBusy(true);
    setError("");
    try {
      setPage({ ...await request({ action: "search", query, dimension, limit: 10, offset }), offset });
    } catch (e) {
      setError(e.message || "\u7B14\u8BB0\u6682\u4E0D\u53EF\u7528\u3002");
    } finally {
      setBusy(false);
    }
  };
  (0, import_react2.useEffect)(() => {
    void load();
  }, [identity]);
  const field = (key) => (e) => setEditing((v) => ({ ...v, [key]: e.target.value }));
  const open = async (id) => {
    setBusy(true);
    setError("");
    try {
      const { entry: p } = await request({ action: "get", id });
      setEditing({ id: p.id, revision: p.revision, kind: p.kind, summary: p.summary, content: p.content, dimension: p.dimension ?? "overworld", tags: p.tags.join(", "), source: p.source, recordedAt: p.recordedAt });
    } catch (e) {
      setError(e.message || "\u8BFB\u53D6\u5931\u8D25\u3002");
    } finally {
      setBusy(false);
    }
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const note = { kind: editing.kind, summary: editing.summary, content: editing.content, dimension: editing.dimension, tags: editing.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean), source: { kind: "user_report", speaker: "owner" } };
      await request({ action: editing.id ? "revise" : "remember", ...editing.id ? { id: editing.id, expectedRevision: editing.revision } : {}, ...note });
      setNotice("\u5DF2\u4FDD\u5B58\u3002Agent \u53EF\u901A\u8FC7 mc_memory \u67E5\u8BE2\uFF1B\u8FD9\u662F\u5386\u53F2\u8BB0\u5F55\uFF0C\u4E0D\u662F\u5F53\u524D\u73B0\u573A\u4E8B\u5B9E\u3002");
      setEditing({ ...blank });
      await load();
    } catch (e2) {
      setError(e2.message || "\u4FDD\u5B58\u672A\u786E\u8BA4\uFF0C\u8BF7\u5237\u65B0\u540E\u6838\u5BF9\u7248\u672C\u3002");
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (!editing.id) return;
    setBusy(true);
    setError("");
    try {
      await request({ action: "archive", id: editing.id, expectedRevision: editing.revision });
      setEditing({ ...blank });
      await load();
      setNotice("\u5DF2\u5F52\u6863\uFF0C\u539F\u7248\u672C\u4ECD\u4FDD\u7559\u3002");
    } catch (e) {
      setError(e.message || "\u5F52\u6863\u672A\u786E\u8BA4\u3002");
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "mc-notebook", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("style", { children: CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: identity }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u6BCF\u4E2A\u670D\u52A1\u5668\u3001\u89D2\u8272\u72EC\u7ACB\u4FDD\u5B58\uFF0C\u7EF4\u5EA6\u5206\u5F00\u67E5\u8BE2\u3002\u8BB0\u4E0B\u5750\u6807\u3001\u53D1\u73B0\u65F6\u95F4\u3001\u6765\u6E90\u548C\u672A\u786E\u5B9A\u4E4B\u5904\uFF1B\u6316\u5B8C\u6216\u73AF\u5883\u53D8\u5316\u540E\u66F4\u65B0\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mc-setup-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
        "\u67E5\u627E\u7B14\u8BB0",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { value: query, onChange: (e) => setQuery(e.target.value), maxLength: 200, placeholder: "\u4F8B\u5982\uFF1A\u897F\u5C71 \u94C1\u77FF\u3001\u6D1E\u53E3\u3001\u6751\u5E84" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
        "\u67E5\u8BE2\u7EF4\u5EA6",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { value: dimension, onChange: (e) => setDimension(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "*", children: "\u6240\u6709\u7EF4\u5EA6" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "overworld", children: "\u4E3B\u4E16\u754C" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "the_nether", children: "\u4E0B\u754C" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "the_end", children: "\u672B\u5730" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: busy, onClick: () => load(), children: "\u67E5\u8BE2\uFF0F\u5237\u65B0" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "mc-note-count", children: page ? `${page.total} \u6761\u5386\u53F2\u7B14\u8BB0` : "\u5C1A\u672A\u8BFB\u53D6" }),
    page?.retrieval && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("small", { children: [
      page.retrieval.mode === "local-vector" ? "\u79BB\u7EBF CPU \u8BCD\u5143\u5411\u91CF\u4E0E\u5173\u952E\u8BCD\u6DF7\u5408" : page.retrieval.mode === "vector" ? "Embeddings \u5411\u91CF\u6DF7\u5408" : "\u5173\u952E\u8BCD\u68C0\u7D22",
      page.retrieval.requested ? " \xB7 \u5916\u90E8\u670D\u52A1\u964D\u7EA7" : ""
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mc-note-list", children: [
      page?.entries?.map((p) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", disabled: busy, onClick: () => open(p.id), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: p.summary }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("small", { children: [
          kinds[p.kind] ?? p.kind,
          " \xB7 ",
          p.dimension ?? "\u7EF4\u5EA6\u672A\u6CE8\u660E",
          " \xB7 v",
          p.revision,
          " \xB7 \u5386\u53F2\uFF0F\u9700\u590D\u6838"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("small", { children: [
          sources[p.source?.kind] ?? "\u6765\u6E90\u8BE6\u89C1\u539F\u8BB0\u5F55",
          " \xB7 ",
          date(p.recordedAt)
        ] })
      ] }, p.id)),
      page?.total === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u6682\u65E0\u5339\u914D\u7B14\u8BB0\u3002\u53EF\u4EE5\u5148\u8BB0\u4E0B\u4E00\u5904\u4EB2\u81EA\u53D1\u73B0\u7684\u77FF\u70B9\u6216\u5174\u8DA3\u70B9\u3002" })
    ] }),
    page && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mc-note-pages", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: busy || !page.offset, onClick: () => load(Math.max(0, page.offset - 10)), children: "\u4E0A\u4E00\u9875" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: busy || page.nextOffset == null, onClick: () => load(page.nextOffset ?? page.offset), children: "\u4E0B\u4E00\u9875" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("form", { onSubmit: save, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { children: editing.id ? "\u7F16\u8F91\u7B14\u8BB0" : "\u65B0\u5EFA\u7B14\u8BB0" }),
      editing.id && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "mc-setup-footnote", children: [
        "\u539F\u8BB0\u5F55\uFF1A",
        sources[editing.source?.kind] ?? "\u6765\u6E90\u672A\u77E5",
        " \xB7 ",
        date(editing.recordedAt),
        "\u3002\u672C\u6B21\u4FEE\u6539\u53E6\u5B58\u4E3A\u4E3B\u4EBA\u62A5\u544A\uFF0C\u4FDD\u7559\u65E7\u7248\u672C\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mc-setup-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
          "\u7C7B\u522B",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("select", { value: editing.kind, onChange: field("kind"), children: Object.entries(kinds).map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: id, children: label }, id)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
          "\u8BB0\u5F55\u7EF4\u5EA6",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { value: editing.dimension, onChange: field("dimension"), maxLength: 120, placeholder: "overworld \u6216\u5B9E\u9645\u7EF4\u5EA6 ID" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
        "\u6807\u9898",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { required: true, value: editing.summary, onChange: field("summary"), maxLength: 180 })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
        "\u8BB0\u5F55",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("textarea", { required: true, rows: 4, value: editing.content, onChange: field("content"), maxLength: 6e3, placeholder: "\u4F8B\u5982\uFF1A\u4E3B\u4E16\u754C (-12,40,35)\uFF0C10 \u6708 25 \u65E5\u6316\u5F00\u6D1E\u58C1\u53D1\u73B0\u4E24\u683C\u94C1\u77FF\u3002\u8FD8\u6CA1\u91C7\u5B8C\uFF0C\u6DF1\u5904\u6570\u91CF\u672A\u77E5\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
        "\u6807\u7B7E ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: "\u9017\u53F7\u5206\u9694\uFF0C\u6700\u591A 12 \u4E2A" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { value: editing.tags, onChange: field("tags"), maxLength: 580 })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mc-note-pages", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "submit", disabled: busy, children: "\u4FDD\u5B58\u7B14\u8BB0" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: busy, onClick: () => {
          setEditing({ ...blank });
          setNotice("");
        }, children: "\u65B0\u5EFA\uFF0F\u53D6\u6D88\u7F16\u8F91" }),
        editing.id && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: busy, onClick: archive, children: "\u5F52\u6863" })
      ] })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", className: "mc-setup-error", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", children: notice })
  ] });
}
var CSS = `.mc-notebook h2{font-size:15px;margin:22px 0 12px}.mc-note-count{margin-left:12px;color:#96aa9e;font-size:11px}.mc-note-list{display:grid;gap:6px;margin:12px 0}.mc-note-list>button{text-align:left;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}.mc-note-pages{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.mc-notebook>small{margin-top:8px}`;

// src/profile-view.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var defaults = { address: "", username: "", auth: "offline", version: "auto", name: "", goal: "", personaPreset: "custom", personality: "", backstory: "", initialMemory: "", mineralVision: false, viewerEnabled: true, toolProfile: "lean", skinModel: "classic", useLocalSkin: false, notebookMode: "local-vector", embeddingEndpoint: "", embeddingModel: "", embeddingKeyEnv: "", dshPreset: "", newSession: false };
var tabs = [["connection", "\u8FDE\u63A5"], ["perception", "\u611F\u77E5\u4E0E\u5DE5\u5177"], ["persona", "\u89D2\u8272\u4E0E\u76AE\u80A4"], ["notebook", "\u670D\u52A1\u5668\u7B14\u8BB0"], ["plugins", "DSH \u63D2\u4EF6"]];
function QuickSetupView({ state, onAction, onBack }) {
  const [fields, setFields] = (0, import_react3.useState)(() => ({ ...defaults, ...state.fields }));
  const [tab, setTab] = (0, import_react3.useState)("connection"), [password, setPassword] = (0, import_react3.useState)(""), [skin, setSkin] = (0, import_react3.useState)();
  const [busy, setBusy] = (0, import_react3.useState)(false), [error, setError] = (0, import_react3.useState)(""), [notice, setNotice] = (0, import_react3.useState)("");
  const opening = state.phase === "opening" || state.phase === "enabled";
  const field = (key) => (e) => setFields((v) => ({ ...v, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const action = async (kind) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await onAction(kind, kind === "save" || kind === "configure" ? { ...fields, ...password ? { loginPassword: password } : {}, ...skin ? { skinPngBase64: skin } : {} } : void 0);
      if (value?.fields) setFields({ ...defaults, ...value.fields });
      if (kind === "save") setNotice("\u5DF2\u4FDD\u5B58\uFF0C\u5C1A\u672A\u8FDE\u63A5\u6E38\u620F\u3002");
      setSkin(void 0);
    } catch (e) {
      setError(e.message || "\u64CD\u4F5C\u672A\u786E\u8BA4\uFF0C\u8BF7\u91CD\u8BD5\u3002");
      if (!fields.address || !fields.username) setTab("connection");
    } finally {
      setPassword("");
      setBusy(false);
    }
  };
  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      if (file.size > 256 * 1024 || file.type !== "image/png") throw Error("\u8BF7\u9009\u62E9\u6700\u5927 256 KiB \u7684 PNG \u76AE\u80A4\u3002");
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const image = await createImageBitmap(file);
      const valid = image.width === 64 && (image.height === 64 || image.height === 32);
      image.close();
      if (!valid) throw Error("\u8BF7\u9009\u62E9 64\xD764 \u6216 64\xD732 PNG\u3002");
      setSkin(data.split(",")[1]);
      setFields((v) => ({ ...v, useLocalSkin: true }));
    } catch (e2) {
      setError(e2.message || "\u65E0\u6CD5\u8BFB\u53D6\u76AE\u80A4\u3002");
    } finally {
      e.target.value = "";
    }
  };
  const choose = (id) => {
    const p = state.personaPresets?.find((p2) => p2.id === id);
    setFields((v) => ({ ...v, personaPreset: id, ...p ? { name: p.name, personality: p.personality, backstory: p.backstory } : {} }));
  };
  const preview = skin ? "data:image/png;base64," + skin : state.skinPreview;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mc-first-run", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("style", { children: CSS2 }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mc-setup-heading", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mc-setup-eyebrow", children: "MINECRAFT \xD7 DSH" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h1", { children: "\u89D2\u8272\u3001\u4E16\u754C\u4E0E\u968F\u8EAB\u7B14\u8BB0" })
      ] }),
      onBack && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: onBack, children: "\u8FD4\u56DE\u6E38\u620F" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u7B80\u5355\u8FDE\u63A5\uFF0C\u6309\u81EA\u5DF1\u7684\u65B9\u5F0F\u751F\u6D3B\u3002\u7B14\u8BB0\u968F\u670D\u52A1\u5668\u548C\u89D2\u8272\u4FDD\u5B58\uFF0C\u4E0D\u4F9D\u8D56\u900F\u89C6\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mc-setup-model", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u6CBF\u7528 DSH \u9ED8\u8BA4\u6A21\u578B" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: state.model ? `${state.model.provider} / ${state.model.model}` : "\u5C1A\u672A\u914D\u7F6E\uFF0C\u8BF7\u5148\u5728 DSH \u9009\u62E9\u6A21\u578B" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u5B89\u88C5\u3001\u914D\u7F6E\u4E0E\u672C\u5730\u7B14\u8BB0\u4E0D\u53D1\u8D77\u6E38\u620F\u63A8\u7406\u3002" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("nav", { className: "mc-setup-tabs", "aria-label": "Minecraft \u914D\u7F6E\u5206\u7C7B", children: tabs.map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", "aria-pressed": tab === id, onClick: () => setTab(id), children: label }, id)) }),
    opening && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mc-setup-opening", role: "status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: state.phase === "opening" ? "\u6B63\u5728\u8F7D\u5165 Agent\u2026" : "\u89D2\u8272\u5DF2\u542F\u7528" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: " \u7B14\u8BB0\u53EF\u76F4\u63A5\u4F7F\u7528\uFF1B\u4FEE\u6539\u89D2\u8272\u548C\u8FDE\u63A5\u8BBE\u7F6E\u524D\u5148\u505C\u6B62\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", disabled: busy, onClick: () => action("stop"), children: "\u505C\u6B62\u5E76\u4FEE\u6539\u914D\u7F6E" })
    ] }),
    tab === "notebook" ? state.fields ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(NotebookView, { onAction, identity: `${state.fields.address} \xB7 ${state.fields.username}` }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "status", children: "\u5148\u586B\u5199\u670D\u52A1\u5668\u4E0E\u89D2\u8272\u5E76\u4FDD\u5B58\uFF0C\u5C31\u53EF\u4EE5\u4F7F\u7528\u79BB\u7EBF\u7B14\u8BB0\uFF0C\u4E0D\u5FC5\u5148\u8FDE\u63A5\u6E38\u620F\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("form", { onSubmit: (e) => {
      e.preventDefault();
      void action("configure");
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("fieldset", { disabled: busy || opening, children: [
        tab === "connection" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
            "\u670D\u52A1\u5668\u5730\u5740",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { required: true, value: fields.address, onChange: field("address"), placeholder: "mc.example.com:25565", maxLength: 300 })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mc-setup-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
              "\u767B\u5F55\u65B9\u5F0F",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { value: fields.auth, onChange: field("auth"), children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "offline", children: "\u79BB\u7EBF\u8EAB\u4EFD" }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "microsoft", children: "\u5FAE\u8F6F\u6B63\u7248" })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
              fields.auth === "microsoft" ? "\u6B63\u7248\u8D26\u53F7\u6807\u8BC6" : "\u6E38\u620F\u89D2\u8272\u540D",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { required: true, value: fields.username, onChange: field("username"), maxLength: fields.auth === "microsoft" ? 254 : 16, autoComplete: "off", placeholder: "\u6E38\u620F\u8D26\u53F7\uFF0C\u4E0E\u89D2\u8272\u663E\u793A\u540D\u5206\u5F00" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
            "\u7B2C\u4E00\u6B21\u60F3\u8BA9\u5B83\u505A\u4EC0\u4E48 ",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u7559\u7A7A\u5219\u5148\u8FDB\u5165\u6E38\u620F" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { value: fields.goal, onChange: field("goal"), rows: 2, maxLength: 3e3 })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u534F\u8BAE\u4E0E\u670D\u52A1\u5668\u767B\u5F55\u5BC6\u7801" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
              "Java \u534F\u8BAE\u7248\u672C ",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u9ED8\u8BA4\u81EA\u52A8\u8BC6\u522B\u670D\u52A1\u5668" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { value: fields.version, onChange: field("version"), placeholder: "auto\uFF0C\u4F8B\u5982 1.21.11", maxLength: 32 })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
              "\u670D\u52A1\u5668 /login \u5BC6\u7801 ",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u666E\u901A\u670D\u52A1\u5668\u7559\u7A7A" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value), maxLength: 128, autoComplete: "current-password", placeholder: state.fields?.hasLoginPassword ? "\u5DF2\u4FDD\u5B58\uFF0C\u7559\u7A7A\u6CBF\u7528" : "\u4EC5\u660E\u786E\u8981\u6C42 /login \u65F6\u586B\u5199" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u672A\u914D\u7F6E\u65F6\u4E0D\u53D1\u9001\u767B\u5F55\u6216\u6CE8\u518C\u547D\u4EE4\u3002\u5BC6\u7801\u4EC5\u4FDD\u5B58\u5230\u5F53\u524D profile \u7684\u79C1\u6709\u6587\u4EF6\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mc-setup-footnote", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("a", { href: "https://github.com/jcs130/dsh-minecraft-agent/blob/main/docs/qiandengji-invitation.md", target: "_blank", rel: "noopener noreferrer", children: "\u53EF\u9009\uFF1A\u5343\u706F\u7EAA\u9080\u8BF7\u63A5\u5165" }) })
          ] })
        ] }),
        tab === "perception" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "mc-toggle", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", checked: fields.mineralVision, onChange: field("mineralVision") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "\u77FF\u7269\u900F\u89C6\u67E5\u8BE2" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u9ED8\u8BA4\u5173\u95ED\u3002\u5F00\u542F\u4EC5\u5141\u8BB8\u67E5\u8BE2\u5DF2\u52A0\u8F7D\u300132 \u683C\u5185\u7684\u906E\u6321\u77FF\u7269\uFF1B\u4E0D\u6539\u53D8\u753B\u9762\uFF0C\u4E5F\u4E0D\u653E\u5BBD\u884C\u52A8\u6743\u9650\u3002\u5173\u95ED\u65F6\u4F9D\u9760\u5B9E\u9645\u53D1\u73B0\u4E0E\u7B14\u8BB0\u3002" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "mc-toggle", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", checked: fields.viewerEnabled, onChange: field("viewerEnabled") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "\u542F\u7528\u7F51\u9875\u6E38\u620F\u753B\u9762" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u5173\u95ED\u540E\u4ECD\u53EF\u8FDE\u63A5\u3001\u6267\u884C\u4EFB\u52A1\u5E76\u67E5\u770B\u51B3\u7B56\u3002" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
            "\u6E38\u620F\u5DE5\u5177\u96C6",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { value: fields.toolProfile, onChange: field("toolProfile"), children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "lean", children: "\u7B80\u6D01\u76EE\u5F55 \xB7 \u6309\u9700\u8BFB\u53D6\u5E2E\u52A9" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "full", children: "\u5B8C\u6574\u76EE\u5F55" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mc-setup-footnote", children: "\u5B9E\u4F53\u89C6\u7EBF\u3001\u672A\u52A0\u8F7D\u533A\u57DF\u548C\u8EAB\u4F53\u52A8\u4F5C\u7684\u5B89\u5168\u68C0\u67E5\u4FDD\u6301\u751F\u6548\u3002\u77FF\u900F\u5F00\u5173\u4E0D\u63D0\u4F9B\u5B8C\u6574\u77FF\u8109\u771F\u503C\u3002" })
        ] }),
        tab === "persona" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { children: "\u89D2\u8272\u9884\u8BBE" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mc-preset-grid", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", "aria-pressed": fields.personaPreset === "custom", onClick: () => choose("custom"), children: "\u81EA\u5B9A\u4E49" }),
            state.personaPresets?.map((p) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", title: p.description, "aria-pressed": fields.personaPreset === p.id, onClick: () => choose(p.id), children: p.name }, p.id))
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
            "\u663E\u793A\u540D\u79F0",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { value: fields.name, onChange: field("name"), placeholder: "\u9ED8\u8BA4\u4F7F\u7528\u6E38\u620F\u89D2\u8272\u540D", maxLength: 80 })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
            "\u6027\u683C\u4E0E\u8BF4\u8BDD\u65B9\u5F0F",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { value: fields.personality, onChange: field("personality"), rows: 5, maxLength: 12e3, placeholder: "\u4F8B\u5982\uFF1A\u597D\u5947\u3001\u8C28\u614E\uFF0C\u559C\u6B22\u8BB0\u5F55\u53D1\u73B0\uFF0C\u4E60\u60EF\u7B80\u77ED\u4EA4\u6D41\u3002" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
            "\u80CC\u666F\u6545\u4E8B",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { value: fields.backstory, onChange: field("backstory"), rows: 3, maxLength: 12e3 }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u89D2\u8272\u8BBE\u5B9A\u4E0D\u4EE3\u8868\u5DF2\u7ECF\u53D1\u751F\u7684\u6E38\u620F\u7ECF\u5386\uFF0C\u4E5F\u4E0D\u6388\u4E88\u6280\u80FD\u6216\u6743\u9650\u3002" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
            "\u521D\u59CB\u8BB0\u5FC6\u4E0E\u504F\u597D",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { value: fields.initialMemory, onChange: field("initialMemory"), rows: 3, maxLength: 6e3, placeholder: "\u4F8B\u5982\uFF1A\u559C\u6B22\u63A2\u7D22\u6D1E\u7A74\uFF1B\u9047\u5230\u65B0\u77FF\u70B9\u8981\u8BB0\u4E0B\u6765\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u8FD9\u662F\u4E3B\u4EBA\u63D0\u4F9B\u7684\u80CC\u666F\u8BB0\u5FC6\uFF1B\u77FF\u70B9\u3001\u8DEF\u7EBF\u7B49\u73B0\u573A\u8BB0\u5F55\u8BF7\u653E\u5230\u670D\u52A1\u5668\u7B14\u8BB0\u3002" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mc-skin-row", children: [
            preview && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("img", { className: "mc-skin-preview", src: preview, alt: "\u6240\u9009 PNG \u76AE\u80A4\u7EB9\u7406" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
                "\u4E0A\u4F20\u89D2\u8272\u76AE\u80A4",
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "file", accept: "image/png", onChange: upload }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "64\xD764 \u6216 64\xD732 PNG\uFF0C\u6700\u5927 256 KiB\u3002" })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
                "\u624B\u81C2\u6A21\u578B",
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { value: fields.skinModel, onChange: field("skinModel"), children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "classic", children: "\u5BBD\u81C2" }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "slim", children: "\u7EC6\u81C2" })
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "mc-toggle", children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", checked: fields.useLocalSkin, onChange: field("useLocalSkin") }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u4F7F\u7528\u672C\u5730\u9884\u89C8\u76AE\u80A4" })
              ] })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u672C\u5730\u76AE\u80A4\u53EA\u5F71\u54CD\u672C\u4EBA\u7F51\u9875\u753B\u9762\uFF1B\u5176\u4ED6\u73A9\u5BB6\u6240\u89C1\u7531\u670D\u52A1\u5668\u6216\u6B63\u7248\u8D26\u53F7\u76AE\u80A4\u51B3\u5B9A\uFF0C\u4E0D\u81EA\u52A8\u53D1\u9001\u6362\u80A4\u547D\u4EE4\u3002" })
        ] }),
        tab === "plugins" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
            "DSH \u80FD\u529B\u9884\u8BBE",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { value: fields.dshPreset, onChange: field("dshPreset"), children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "", children: "\u4EC5 Minecraft \u80FD\u529B" }),
              state.dshPresets?.map((p) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("option", { value: p.id, disabled: p.broken, children: [
                p.name,
                p.broken ? "\uFF08\u4E0D\u53EF\u7528\uFF09" : ""
              ] }, p.id))
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u590D\u7528\u5DF2\u5B89\u88C5\u7684\u8BB0\u5FC6\u3001\u641C\u7D22\u7B49 DSH \u63D2\u4EF6\uFF1A\u5148\u5728 DSH \u4E2D\u7EC4\u5408\u6210 Agent \u80FD\u529B\u9884\u8BBE\uFF0C\u518D\u5728\u8FD9\u91CC\u9009\u62E9\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u4EC5\u5217\u51FA\u5F53\u524D DSH \u5DF2\u58F0\u660E\u7684\u9884\u8BBE\uFF0C\u4E0D\u5B89\u88C5\u63D2\u4EF6\uFF0C\u4E0D\u4FEE\u6539\u5168\u5C40\u914D\u7F6E\u3002" }),
          state.fields?.hasSession && fields.dshPreset !== state.fields.dshPreset && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "mc-toggle", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", checked: fields.newSession, onChange: field("newSession") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
              "\u4E3A\u65B0\u7684\u80FD\u529B\u9884\u8BBE\u65B0\u5EFA\u4F1A\u8BDD",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u4FDD\u7559\u539F\u4F1A\u8BDD\u3001\u540C\u4E00\u89D2\u8272\u4E0E\u6E38\u620F\u7B14\u8BB0\uFF1B\u65B0\u4F1A\u8BDD\u4E0D\u81EA\u52A8\u91CD\u653E\u65E7\u4EFB\u52A1\u3002" })
            ] })
          ] }),
          state.dshPresets?.find((p) => p.id === fields.dshPreset)?.description && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: state.dshPresets.find((p) => p.id === fields.dshPreset).description }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { style: { marginTop: 20 }, children: [
            "\u5185\u7F6E\u670D\u52A1\u5668\u7B14\u8BB0\u68C0\u7D22",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { value: fields.notebookMode, onChange: field("notebookMode"), children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "local-vector", children: "\u79BB\u7EBF CPU \u8BCD\u5143\u5411\u91CF + \u5173\u952E\u8BCD" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "local", children: "\u4EC5\u5173\u952E\u8BCD" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "vector", children: "\u81EA\u5B9A\u4E49 embeddings \u8BED\u4E49\u5411\u91CF" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u672C\u5730\u7B14\u8BB0\u59CB\u7EC8\u4FDD\u7559\u3002\u5185\u7F6E CPU \u5411\u91CF\u4E0D\u4E0B\u8F7D\u6A21\u578B\uFF0C\u8BA1\u7B97\u8BCD\u5143\u76F8\u4F3C\u5EA6\uFF0C\u4E0D\u5192\u5145\u795E\u7ECF\u8BED\u4E49\u6A21\u578B\u3002" })
          ] }),
          fields.notebookMode === "vector" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
              "Embeddings \u5B8C\u6574\u5730\u5740",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { value: fields.embeddingEndpoint, onChange: field("embeddingEndpoint"), maxLength: 1e3, placeholder: "http://127.0.0.1:\u7AEF\u53E3/v1/embeddings" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
              "\u5411\u91CF\u6A21\u578B",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { value: fields.embeddingModel, onChange: field("embeddingModel"), maxLength: 200 })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
              "\u5BC6\u94A5\u73AF\u5883\u53D8\u91CF\u540D",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { value: fields.embeddingKeyEnv, onChange: field("embeddingKeyEnv"), maxLength: 120, placeholder: "\u53EF\u7559\u7A7A\uFF1B\u4E0D\u586B\u5199\u5BC6\u94A5\u672C\u8EAB" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "\u4EC5\u5728\u663E\u5F0F\u8BB0\u5F55\u3001\u540C\u6B65\u548C\u67E5\u8BE2\u7B14\u8BB0\u65F6\u8C03\u7528\u8BE5\u670D\u52A1\uFF1B\u6545\u969C\u56DE\u9000\u5173\u952E\u8BCD\u5E76\u62A5\u544A\u3002" })
          ] })
        ] })
      ] }),
      !opening && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mc-setup-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", disabled: busy, onClick: () => action("save"), children: "\u4EC5\u4FDD\u5B58\u914D\u7F6E" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "mc-setup-connect", type: "submit", disabled: busy || !state.model, children: busy ? "\u5904\u7406\u4E2D\u2026" : "\u4FDD\u5B58\u5E76\u8FDE\u63A5\u6E38\u620F" })
      ] })
    ] }),
    (error || state.error) && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mc-setup-error", role: "alert", children: error || state.error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "status", children: notice }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mc-setup-footnote", children: "\u51ED\u636E\u7559\u5728\u672C\u673A\u3002\u666E\u901A\u804A\u5929\u9ED8\u8BA4\u516C\u5C4F\uFF1B\u5B9E\u9645\u5165\u670D\u4EE5\u8BA4\u8BC1\u548C\u4E16\u754C\u5C31\u7EEA\u4E3A\u51C6\u3002" })
  ] });
}
var CSS2 = `.mc-first-run{max-width:780px;margin:auto;padding:26px 28px;color:#dcebe5;font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif}.mc-first-run *{box-sizing:border-box}.mc-first-run h1{margin:5px 0 8px;font-size:23px}.mc-first-run p{color:#aab9b0;margin:8px 0 16px}.mc-first-run label{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px;margin-bottom:14px;font-size:12px}.mc-first-run input,.mc-first-run select,.mc-first-run textarea{width:100%;min-width:0;border:1px solid #40564a;border-radius:7px;padding:8px 10px;background:#18231d;color:#e6f0e9;font:inherit}.mc-first-run :focus-visible{outline:2px solid #91c6a7;outline-offset:2px}.mc-first-run small{display:block;font-size:11px;color:#96aa9e;font-weight:normal}.mc-first-run button{border:1px solid #40564a;border-radius:7px;padding:7px 11px;background:#1d2b23;color:#dcebe5;font:inherit;cursor:pointer}.mc-first-run button:disabled{opacity:.5;cursor:default}.mc-first-run button[aria-pressed=true]{background:#315b46;border-color:#91c6a7}.mc-first-run fieldset{margin:0;padding:0;border:0;min-width:0}.mc-setup-heading,.mc-setup-row,.mc-setup-actions,.mc-skin-row{display:flex;gap:14px;align-items:flex-start}.mc-setup-heading{justify-content:space-between;align-items:center}.mc-setup-eyebrow{font-size:10px;letter-spacing:2px;color:#91c6a7}.mc-setup-model{border-left:3px solid #91c6a7;background:#18231d;border-radius:6px;padding:10px 13px;margin:16px 0;display:flex;flex-direction:column;overflow-wrap:anywhere}.mc-setup-model>span{font-size:10px;color:#91c6a7}.mc-setup-tabs{display:flex;gap:5px;flex-wrap:wrap;padding:0 0 16px;margin-bottom:8px;border-bottom:1px solid #35463b}.mc-setup-tabs button{font-size:12px;flex:1;white-space:nowrap}.mc-first-run .mc-toggle{flex-direction:row;align-items:flex-start;gap:10px;border:1px solid #35463b;padding:12px;border-radius:8px}.mc-first-run .mc-toggle input{width:16px;height:16px;flex:none;margin-top:3px}.mc-preset-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}.mc-skin-preview{width:112px;height:112px;object-fit:contain;image-rendering:pixelated;border:1px solid #40564a;background:#27342b}.mc-skin-row>div{flex:1;min-width:0}.mc-first-run details{border-top:1px solid #35463b;padding:10px 0 15px}.mc-first-run summary{cursor:pointer;margin-bottom:12px;font-size:12px}.mc-setup-actions{margin-top:20px;align-items:stretch}.mc-setup-actions button{flex:1}.mc-first-run .mc-setup-connect{background:#9bd0af;color:#14261b;font-weight:600}.mc-first-run .mc-setup-footnote{font-size:10px;margin:12px 0;color:#91a89a}.mc-setup-footnote a{color:#a7dbbd}.mc-first-run .mc-setup-error{color:#f1b6ac}.mc-setup-opening{padding:12px;border:1px solid #40564a;border-radius:8px;margin-bottom:16px}.mc-setup-opening button{display:block;margin-top:8px}@media(max-width:520px){.mc-first-run{padding:20px 14px}.mc-setup-row,.mc-setup-heading{flex-direction:column;gap:0}.mc-setup-tabs button{flex:1 0 30%}.mc-first-run h1{font-size:21px}.mc-skin-preview{width:80px;height:80px}.mc-setup-actions{flex-direction:column;gap:8px}}`;

// src/client.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
var inject = ["slots", "connection", "sessions"];
function localPanelUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && !!url.port && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.href : null;
  } catch {
    return null;
  }
}
function apply(ctx) {
  const sessions = ctx.sessions;
  function Dashboard({ SessionProvider, renderSlot }) {
    const [binding, setBinding] = (0, import_react4.useState)();
    const [error, setError] = (0, import_react4.useState)("");
    const [attempt, setAttempt] = (0, import_react4.useState)(0);
    const [setup, setSetup] = (0, import_react4.useState)();
    const [showSettings, setShowSettings] = (0, import_react4.useState)(false);
    const session = usePanelSession(sessions, binding?.sessionId);
    (0, import_react4.useEffect)(() => {
      const controller = new AbortController();
      let timer;
      let revision = 0;
      const refresh = async () => {
        clearTimeout(timer);
        const currentRevision = ++revision;
        setBinding(void 0);
        setError("");
        try {
          let result;
          try {
            result = await ctx.connection.rpc.call("/api", "mc-harness/panel-info", {}, controller.signal);
          } catch {
          }
          if (controller.signal.aborted || currentRevision !== revision) return;
          const value = result?.ok && result.value;
          const url = value && localPanelUrl(value.url);
          if (url && typeof value.sessionId === "string" && value.sessionId.length > 0) {
            setBinding({ sessionId: value.sessionId, url });
            try {
              const response = await ctx.connection.rpc.call("/api", "mc-harness/setup", { action: "state" }, controller.signal);
              if (!controller.signal.aborted && currentRevision === revision && response.ok) setSetup(response.value);
            } catch {
            }
          } else {
            const response = await ctx.connection.rpc.call("/api", "mc-harness/setup", { action: "state" }, controller.signal);
            if (controller.signal.aborted || currentRevision !== revision) return;
            if (response.ok) {
              setSetup(response.value);
              setError("");
              if (["opening", "enabled"].includes(response.value.phase)) timer = setTimeout(refresh, 1500);
            } else setError("Minecraft \u9762\u677F\u5C1A\u672A\u542F\u7528\u3002");
          }
        } catch {
          if (!controller.signal.aborted && currentRevision === revision) {
            setSetup(void 0);
            setError("Minecraft \u9762\u677F\u6682\u672A\u8FDE\u63A5\u3002");
          }
        }
      };
      void refresh();
      const stop = ctx.on("connection/reset", refresh);
      return () => {
        controller.abort();
        clearTimeout(timer);
        stop();
      };
    }, [attempt]);
    const setupAction = async (action, config) => {
      const result = await ctx.connection.rpc.call("/api", "mc-harness/setup", { action, config });
      if (!result.ok) throw Error(result.error?.message || "\u914D\u7F6E\u64CD\u4F5C\u672A\u786E\u8BA4\u3002");
      if (action === "notebook") return result.value;
      setSetup(result.value);
      if (action === "stop") setBinding(void 0);
      if (["configure", "retry"].includes(action)) {
        setShowSettings(false);
        setAttempt((value) => value + 1);
      }
      return result.value;
    };
    if (setup && (showSettings || !binding)) return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { height: "100%", overflow: "auto", background: "#10151b" }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(QuickSetupView, { state: setup, onAction: setupAction, onBack: binding ? () => setShowSettings(false) : void 0 }) });
    if (binding && session?.reference) return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(SessionProvider, { session: session.reference, children: renderSlot("minecraft.panel", {
      embeddedComposer: true,
      onConfigure: setup?.fields ? () => setupAction("stop") : void 0,
      onSettings: setup?.fields ? () => setShowSettings(true) : void 0
    }) });
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { height: "100%", boxSizing: "border-box", padding: 32, overflow: "auto", background: "#10151b", color: "#dcebe5" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h1", { style: { fontSize: 22, marginTop: 0 }, children: "Minecraft \u63A7\u5236\u53F0" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", children: error || session?.error || (binding ? "\u6B63\u5728\u8BFB\u53D6 Agent \u7684\u539F\u4F1A\u8BDD\u2026" : "\u6B63\u5728\u8BFB\u53D6 Minecraft \u9762\u677F\u2026") }),
      (error || session?.error) && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u63D2\u4EF6\u754C\u9762\u5DF2\u52A0\u8F7D\u3002\u914D\u7F6E\u5E76\u542F\u7528 Minecraft Agent \u540E\uFF0C\u8FD9\u91CC\u4F1A\u663E\u793A\u6E38\u620F\u753B\u9762\u3001\u8FDE\u63A5\u7BA1\u7406\u3001\u8FD0\u884C\u6307\u6807\u548C\u5B9E\u9A8C\u5BA4\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u8BF7\u68C0\u67E5\u63D2\u4EF6\u7684 configFile\uFF0C\u4EE5\u53CA Agent \u914D\u7F6E\u4E2D\u7684 consolePort\u3002\u6253\u5F00\u6B64\u9875\u9762\u4E0D\u4F1A\u542F\u52A8\u6A21\u578B\u6216\u8FDE\u63A5\u6E38\u620F\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: () => setAttempt((value) => value + 1), children: "\u91CD\u65B0\u68C0\u67E5\u9762\u677F" }),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("a", { href: "https://github.com/jcs130/dsh-minecraft-agent/blob/main/docs/desktop.md", target: "_blank", rel: "noopener noreferrer", style: { color: "#98d6b4" }, children: "\u67E5\u770B\u914D\u7F6E\u8BF4\u660E" })
      ] })
    ] });
  }
  function Panel({ sessionId, renderFactorySlot, embeddedComposer = false, onConfigure, onSettings }) {
    const [state, setState] = (0, import_react4.useState)();
    const [access, setAccess] = (0, import_react4.useState)();
    const [querying, setQuerying] = (0, import_react4.useState)(false);
    (0, import_react4.useEffect)(() => {
      const controller = new AbortController();
      let accessTimer;
      let revision = 0;
      const readAccess = async () => {
        const currentRevision = revision;
        try {
          const status = await ctx.connection.rpc.call("/api", "mc-harness/access", { sessionId, action: "state" }, controller.signal);
          if (!controller.signal.aborted && currentRevision === revision && status.ok && status.value.sessionId === sessionId) {
            setAccess({ sessionId, value: status.value.access });
            return true;
          }
        } catch {
        }
        return false;
      };
      const refresh = async () => {
        const currentRevision = ++revision;
        clearInterval(accessTimer);
        setState(void 0);
        setAccess(void 0);
        try {
          const result = await ctx.connection.rpc.call("/api", "mc-harness/panel", { sessionId }, controller.signal);
          if (controller.signal.aborted || currentRevision !== revision) return;
          const url = result.ok && result.value.sessionId === sessionId && localPanelUrl(result.value.url);
          setState(url ? { sessionId, url } : { sessionId, error: result.ok ? "\u9762\u677F\u5730\u5740\u4E0D\u53EF\u7528\u3002" : result.error.message });
          if (url) {
            const supported = await readAccess();
            if (supported && !controller.signal.aborted && currentRevision === revision) accessTimer = setInterval(readAccess, 5e3);
          }
        } catch {
          if (!controller.signal.aborted) setState({ sessionId, error: "Minecraft \u9762\u677F\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u68C0\u67E5\u63D2\u4EF6\u914D\u7F6E\u3002" });
        }
      };
      void refresh();
      const stop = ctx.on("connection/reset", refresh);
      return () => {
        controller.abort();
        clearInterval(accessTimer);
        stop();
      };
    }, [sessionId]);
    const current = state?.sessionId === sessionId ? state : void 0;
    const invitation = access?.sessionId === sessionId ? access : void 0;
    const accessLabel = {
      missing: "\u672A\u51C6\u5907\u8EAB\u4EFD",
      identity_saved: "\u8EAB\u4EFD\u5DF2\u4FDD\u5B58",
      not_created: "\u5C1A\u672A\u6FC0\u6D3B",
      ready: "\u5EFA\u53F7\u7ED3\u679C\u672A\u786E\u8BA4",
      pending: "\u7B49\u5F85\u5EFA\u53F7",
      unknown: "\u7ED3\u679C\u672A\u786E\u8BA4",
      awaiting_game_bridge: "\u7B49\u5F85\u5EFA\u53F7\u6865"
    };
    const query = async () => {
      setQuerying(true);
      try {
        const result = await ctx.connection.rpc.call("/api", "mc-harness/access", { sessionId, action: "query" });
        setAccess(result.ok && result.value.sessionId === sessionId ? { sessionId, value: result.value.access } : { sessionId, value: invitation?.value, error: "\u63A5\u5165\u72B6\u6001\u672A\u786E\u8BA4\uFF0C\u4FDD\u7559\u539F\u8EAB\u4EFD\u540E\u91CD\u8BD5\u67E5\u8BE2\u3002" });
      } catch {
        setAccess({ sessionId, value: invitation?.value, error: "\u6682\u65F6\u65E0\u6CD5\u67E5\u8BE2\uFF1B\u6CA1\u6709\u91CD\u65B0\u5EFA\u53F7\u6216\u8FDE\u63A5\u6E38\u620F\u3002" });
      } finally {
        setQuerying(false);
      }
    };
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { height: "100%", minHeight: 320, width: "100%", display: "flex", flexDirection: "column", background: "#10151b", color: "#dcebe5" }, children: [
      invitation?.value && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { padding: "10px 14px", borderBottom: "1px solid #314239", fontSize: 13 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("strong", { children: [
          "\u5343\u706F\u7EAA \xB7 ",
          invitation.value.username ?? "\u8EAB\u4EFD\u5F85\u51C6\u5907"
        ] }),
        " \xB7 ",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
          "API \u5EFA\u53F7\uFF1A",
          invitation.value.state === "ready" && invitation.value.gameAccountCreated ? "\u5DF2\u5C31\u7EEA" : accessLabel[invitation.value.state] ?? "\u7ED3\u679C\u672A\u786E\u8BA4"
        ] }),
        " \xB7 ",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
          "\u6E38\u620F\uFF1A",
          invitation.value.gameReady ? "\u8BA4\u8BC1\u53CA\u4E16\u754C\u5DF2\u5C31\u7EEA" : "\u5C1A\u672A\u786E\u8BA4\u5C31\u7EEA"
        ] }),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", disabled: querying, onClick: query, children: querying ? "\u67E5\u8BE2\u4E2D\u2026" : "\u67E5\u8BE2\u539F\u8EAB\u4EFD" }),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("a", { href: "https://mc.kangqiang.site/join", target: "_blank", rel: "noopener noreferrer", style: { color: "#98d6b4" }, children: "\u9080\u8BF7\u63A5\u5165\u8BF4\u660E" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { opacity: 0.75 }, children: [
          "\u7F51\u7AD9\u72B6\u6001\u6838\u5BF9\uFF1A",
          invitation.value.checkedAt ?? "\u5C1A\u672A\u67E5\u8BE2",
          "\uFF1B\u67E5\u8BE2\u53EA\u6838\u5BF9\u539F\u8BF7\u6C42\uFF0C\u8FDB\u670D\u4ECD\u9700\u6E38\u620F\u8BA4\u8BC1\u3002"
        ] }),
        invitation.error && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { role: "status", children: invitation.error })
      ] }),
      current?.url ? embeddedComposer ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        Workbench,
        {
          game: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("iframe", { title: "Minecraft \xB7 \u6E38\u620F\u4E0E\u8FD0\u884C\u9762\u677F", src: current.url, referrerPolicy: "no-referrer", allow: "fullscreen" }),
          decision: renderFactorySlot("minecraft.decision", {}),
          onConfigure,
          onSettings
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: { fontSize: 11, margin: "6px 12px", color: "#a4b3ab" }, children: "\u4F7F\u7528\u4E0B\u65B9\u4F1A\u8BDD\u8F93\u5165\u6846\uFF1B\u4FA7\u680F Minecraft \u53EF\u5E76\u6392\u67E5\u770B\u63A8\u7406\u4E0E\u884C\u52A8\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("iframe", { title: "Minecraft \xB7 \u6E38\u620F\u4E0E\u8FD0\u884C\u9762\u677F", src: current.url, referrerPolicy: "no-referrer", allow: "fullscreen", style: { flex: 1, minHeight: 0, width: "100%", border: 0 } })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", style: { padding: 24 }, children: current?.error ?? "\u6B63\u5728\u8BFB\u53D6 Minecraft \u9762\u677F\u2026" })
    ] });
  }
  ctx.slots.inject("conversation.view", () => ctx.slots.register({
    name: "conversation.view",
    id: "mc-panel",
    order: 100,
    label: () => "Minecraft"
  }, Panel));
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "minecraft", children: { "minecraft.panel": { kind: "single", scope: "session" } } }, Dashboard));
  ctx.slots.inject("minecraft.panel", () => ctx.slots.register({ name: "minecraft.panel" }, Panel));
  ctx.slots.registerFactory({ name: "minecraft.decision", scope: "session" }, DecisionView);
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    name: "sidebar.panellist",
    id: "minecraft",
    order: 100,
    label: () => "Minecraft"
  }, ({ size = 18 }) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("path", { d: "m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 0v9m-9-4 9 4 9-4m-9 4v9", stroke: "currentColor", strokeWidth: "1.6", strokeLinejoin: "round" }) })));
}
return module.exports;}});
