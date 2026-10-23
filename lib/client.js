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
var import_react3 = require("react");

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
function Workbench({ game, decision, onConfigure }) {
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

// src/setup-view.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
function QuickSetupView({ state, onAction }) {
  const [fields, setFields] = (0, import_react2.useState)(() => ({ address: "", username: "", auth: "offline", version: "1.21.1", name: "", goal: "", ...state.fields }));
  const [password, setPassword] = (0, import_react2.useState)("");
  const [busy, setBusy] = (0, import_react2.useState)(false), [error, setError] = (0, import_react2.useState)("");
  const opening = state.phase === "opening" || state.phase === "enabled";
  const field = (key) => (event) => setFields((value) => ({ ...value, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    if (busy || opening) return;
    setBusy(true);
    setError("");
    try {
      await onAction("configure", { ...fields, ...password ? { loginPassword: password } : {} });
    } catch (e) {
      setError(e.message || "\u914D\u7F6E\u672A\u80FD\u63D0\u4EA4\uFF0C\u8BF7\u91CD\u8BD5\u3002");
    } finally {
      setPassword("");
      setBusy(false);
    }
  };
  const refreshModel = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onAction("state");
    } catch {
      setError("\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6 DSH \u6A21\u578B\u914D\u7F6E\uFF0C\u8BF7\u91CD\u8BD5\u3002");
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mc-first-run", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("style", { children: CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "mc-setup-eyebrow", children: "MINECRAFT \xD7 DSH" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h1", { children: "\u8BA9\u4F60\u7684 Agent \u8FDB\u5165\u6E38\u620F" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u586B\u5199\u670D\u52A1\u5668\u4E0E\u89D2\u8272\uFF0C\u590D\u7528 DSH \u7684\u6A21\u578B\u3002\u8FDE\u63A5\u540E\u5728\u540C\u4E00\u9875\u9762\u67E5\u770B\u6E38\u620F\u3001\u6A21\u578B\u63A8\u7406\u4E0E\u884C\u52A8\u56DE\u6267\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mc-setup-model", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\u6CBF\u7528 DSH \u9ED8\u8BA4\u6A21\u578B" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: state.model ? `${state.model.provider} / ${state.model.model}` : "\u5C1A\u672A\u914D\u7F6E\uFF0C\u8BF7\u5148\u5728 DSH \u9009\u62E9\u6A21\u578B" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: "\u4F7F\u7528\u73B0\u6709\u51ED\u636E\uFF0C\u63D2\u4EF6\u4E0D\u9700\u8981\u53E6\u586B API Key\u3002" })
    ] }),
    !state.model && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: busy, onClick: refreshModel, children: "\u91CD\u65B0\u8BFB\u53D6 DSH \u9ED8\u8BA4\u6A21\u578B" }),
    opening ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mc-setup-opening", role: "status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: state.phase === "opening" ? "\u6B63\u5728\u8F7D\u5165 Agent \u548C\u6E38\u620F\u8FDE\u63A5\u2026" : "Agent \u5DF2\u542F\u7528\uFF0C\u6B63\u5728\u8BFB\u53D6\u9762\u677F\u2026" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u6A21\u578B\u5C1A\u672A\u8FD4\u56DE\u5185\u5BB9\u65F6\u4E0D\u4F1A\u8865\u5199\u63A8\u7406\u3002\u662F\u5426\u771F\u6B63\u8FDB\u670D\uFF0C\u4EE5\u8FDE\u63A5\u4E0E\u8D26\u53F7\u4E2D\u7684\u8BA4\u8BC1\u548C\u4E16\u754C\u5C31\u7EEA\u72B6\u6001\u4E3A\u51C6\u3002" })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("form", { onSubmit: submit, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
        "\u670D\u52A1\u5668\u5730\u5740",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { required: true, value: fields.address, onChange: field("address"), placeholder: "mc.example.com:25565", autoComplete: "off", maxLength: 300 })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mc-setup-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
          "\u767B\u5F55\u65B9\u5F0F",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { value: fields.auth, onChange: field("auth"), children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "offline", children: "\u79BB\u7EBF\u8EAB\u4EFD" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "microsoft", children: "\u5FAE\u8F6F\u6B63\u7248" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
          fields.auth === "microsoft" ? "\u6B63\u7248\u8D26\u53F7\u6807\u8BC6" : "\u6E38\u620F\u89D2\u8272\u540D",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { required: true, value: fields.username, onChange: field("username"), placeholder: fields.auth === "microsoft" ? "\u7528\u4E8E\u6388\u6743\u7F13\u5B58\u7684\u90AE\u7BB1\u6216\u6807\u8BC6" : "1\u201316 \u4F4D\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF", maxLength: fields.auth === "microsoft" ? 254 : 16, autoComplete: "off" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
        "\u7B2C\u4E00\u6B21\u60F3\u8BA9\u5B83\u505A\u4EC0\u4E48 ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: "\u53EF\u7559\u7A7A\uFF0C\u5148\u8FDB\u5165\u6E38\u620F" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("textarea", { value: fields.goal, onChange: field("goal"), rows: 2, maxLength: 3e3, placeholder: "\u4F8B\u5982\uFF1A\u719F\u6089\u9644\u8FD1\u73AF\u5883\uFF0C\u5BFB\u627E\u5B89\u5168\u7684\u843D\u811A\u5904\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: "\u53EF\u9009\u8BBE\u7F6E\uFF1A\u89D2\u8272\u540D\u79F0\u3001\u7248\u672C\u4E0E\u767B\u5F55\u670D\u5BC6\u7801" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mc-setup-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
            "\u663E\u793A\u540D\u79F0",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { value: fields.name, onChange: field("name"), placeholder: "\u9ED8\u8BA4\u4F7F\u7528\u89D2\u8272\u540D", maxLength: 80 })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
            "Java \u534F\u8BAE\u7248\u672C",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { value: fields.version, onChange: field("version"), placeholder: "1.21.1 \u6216 auto", maxLength: 32 })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
          "\u670D\u52A1\u5668 /login \u5BC6\u7801 ",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: "\u591A\u6570\u670D\u52A1\u5668\u4E0D\u9700\u8981\uFF0C\u9ED8\u8BA4\u4E0D\u914D\u7F6E" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value), autoComplete: "current-password", maxLength: 128, placeholder: state.fields?.hasLoginPassword ? "\u5DF2\u4FDD\u5B58\uFF0C\u7559\u7A7A\u6CBF\u7528" : "\u4EC5\u660E\u786E\u8981\u6C42 /login \u7684\u670D\u52A1\u5668\u586B\u5199" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: "\u672A\u914D\u7F6E\u65F6\u4E0D\u53D1\u9001\u767B\u5F55\u6216\u6CE8\u518C\u547D\u4EE4\u3002\u586B\u5199\u540E\u4EC5\u767B\u5F55\u5DF2\u6709\u89D2\u8272\uFF0C\u5BC6\u7801\u4FDD\u5B58\u5230\u5F53\u524D profile \u7684\u79C1\u6709\u6587\u4EF6\uFF0C\u4E0D\u56DE\u4F20\u3001\u4E0D\u5199\u5165\u4F1A\u8BDD\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "mc-setup-footnote", children: [
          "\u9080\u8BF7\u5236\u670D\u52A1\u5668\u8BF7\u5148\u51C6\u5907\u5DF2\u6FC0\u6D3B\u7684\u8EAB\u4EFD\u3002",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("a", { href: "https://github.com/jcs130/dsh-minecraft-agent/blob/main/docs/qiandengji-invitation.md", target: "_blank", rel: "noopener noreferrer", children: "\u53EF\u9009\uFF1A\u5343\u706F\u7EAA\u9080\u8BF7\u63A5\u5165\u8BF4\u660E" })
        ] })
      ] }),
      (error || state.error) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mc-setup-error", role: "alert", children: error || state.error }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "mc-setup-connect", type: "submit", disabled: busy || !state.model, children: busy ? "\u6B63\u5728\u4FDD\u5B58\u2026" : "\u4FDD\u5B58\u5E76\u8FDE\u63A5\u6E38\u620F" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mc-setup-footnote", children: "\u5B89\u88C5\u548C\u67E5\u770B\u9762\u677F\u4E0D\u8C03\u7528\u6E38\u620F\u6A21\u578B\u3002\u70B9\u51FB\u8FDE\u63A5\u624D\u5EFA\u7ACB\u8EAB\u4F53\uFF1B\u586B\u5199\u4EFB\u52A1\u540E\u4F1A\u6309 DSH \u914D\u7F6E\u8C03\u7528\u6A21\u578B\u3002\u6B63\u7248\u8D26\u53F7\u9996\u6B21\u8FDE\u63A5\u9700\u8981\u5FAE\u8F6F\u6388\u6743\u3002" })
    ] })
  ] });
}
var CSS = `.mc-first-run{max-width:640px;margin:auto;padding:30px 28px;color:#dcebe5;font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif}.mc-first-run *{box-sizing:border-box}.mc-setup-eyebrow{font-size:10px;letter-spacing:2px;color:#91c6a7}.mc-first-run h1{margin:6px 0 8px;font-size:24px}.mc-first-run p{color:#aab9b0;margin:8px 0 18px}.mc-first-run label{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px;margin-bottom:14px;font-size:12px}.mc-first-run input,.mc-first-run select,.mc-first-run textarea{width:100%;min-width:0;border:1px solid #40564a;border-radius:7px;padding:9px 11px;background:#18231d;color:#e6f0e9;font:inherit}.mc-first-run input:focus-visible,.mc-first-run textarea:focus-visible,.mc-first-run select:focus-visible{outline:2px solid #91c6a7;outline-offset:2px}.mc-first-run small{font-size:11px;color:#96aa9e;font-weight:normal}.mc-setup-row{display:flex;gap:14px}.mc-setup-model{border:1px solid #40564a;border-left:3px solid #91c6a7;border-radius:8px;padding:12px 14px;margin:20px 0;display:flex;flex-direction:column;gap:3px;overflow-wrap:anywhere}.mc-setup-model>span{font-size:11px;color:#91c6a7}.mc-setup-model strong{font-size:13px}.mc-first-run details{border-top:1px solid #35463b;padding:10px 0 16px}.mc-first-run summary{cursor:pointer;margin-bottom:12px;font-size:12px;color:#b4c9bc}.mc-setup-connect{width:100%;padding:11px;border:1px solid #a2d6b6;border-radius:7px;background:#9bd0af;color:#14261b;font:600 13px system-ui;cursor:pointer}.mc-setup-connect:disabled{opacity:.45;cursor:wait}.mc-first-run .mc-setup-footnote{font-size:10px;margin:10px 0;color:#91a89a}.mc-setup-footnote a{color:#a7dbbd}.mc-first-run .mc-setup-error{color:#f1b6ac}.mc-setup-opening{padding:20px;border:1px solid #40564a;border-radius:8px}.mc-setup-opening p{font-size:12px;margin-bottom:0}@media(max-width:520px){.mc-first-run{padding:22px 16px}.mc-setup-row{flex-direction:column;gap:0}.mc-first-run h1{font-size:21px}}`;

// src/client.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
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
    const [binding, setBinding] = (0, import_react3.useState)();
    const [error, setError] = (0, import_react3.useState)("");
    const [attempt, setAttempt] = (0, import_react3.useState)(0);
    const [setup, setSetup] = (0, import_react3.useState)();
    const session = usePanelSession(sessions, binding?.sessionId);
    (0, import_react3.useEffect)(() => {
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
    if (binding && session?.reference) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SessionProvider, { session: session.reference, children: renderSlot("minecraft.panel", { embeddedComposer: true, onConfigure: setup?.fields ? async () => {
      const result = await ctx.connection.rpc.call("/api", "mc-harness/setup", { action: "stop" });
      if (result.ok) {
        setBinding(void 0);
        setSetup(result.value);
      } else throw Error("\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u505C\u6B62\u7ED3\u679C\u3002");
    } : void 0 }) });
    if (setup && !binding) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { height: "100%", overflow: "auto", background: "#10151b" }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(QuickSetupView, { state: setup, onAction: async (action, config) => {
      const result = await ctx.connection.rpc.call("/api", "mc-harness/setup", { action, config });
      if (!result.ok) throw Error(result.error?.message || "\u9996\u6B21\u914D\u7F6E\u6682\u4E0D\u53EF\u7528\u3002");
      setSetup(result.value);
      setAttempt((value) => value + 1);
    } }) });
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { height: "100%", boxSizing: "border-box", padding: 32, overflow: "auto", background: "#10151b", color: "#dcebe5" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h1", { style: { fontSize: 22, marginTop: 0 }, children: "Minecraft \u63A7\u5236\u53F0" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "status", children: error || session?.error || (binding ? "\u6B63\u5728\u8BFB\u53D6 Agent \u7684\u539F\u4F1A\u8BDD\u2026" : "\u6B63\u5728\u8BFB\u53D6 Minecraft \u9762\u677F\u2026") }),
      (error || session?.error) && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u63D2\u4EF6\u754C\u9762\u5DF2\u52A0\u8F7D\u3002\u914D\u7F6E\u5E76\u542F\u7528 Minecraft Agent \u540E\uFF0C\u8FD9\u91CC\u4F1A\u663E\u793A\u6E38\u620F\u753B\u9762\u3001\u8FDE\u63A5\u7BA1\u7406\u3001\u8FD0\u884C\u6307\u6807\u548C\u5B9E\u9A8C\u5BA4\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u8BF7\u68C0\u67E5\u63D2\u4EF6\u7684 configFile\uFF0C\u4EE5\u53CA Agent \u914D\u7F6E\u4E2D\u7684 consolePort\u3002\u6253\u5F00\u6B64\u9875\u9762\u4E0D\u4F1A\u542F\u52A8\u6A21\u578B\u6216\u8FDE\u63A5\u6E38\u620F\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: () => setAttempt((value) => value + 1), children: "\u91CD\u65B0\u68C0\u67E5\u9762\u677F" }),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("a", { href: "https://github.com/jcs130/dsh-minecraft-agent/blob/main/docs/desktop.md", target: "_blank", rel: "noopener noreferrer", style: { color: "#98d6b4" }, children: "\u67E5\u770B\u914D\u7F6E\u8BF4\u660E" })
      ] })
    ] });
  }
  function Panel({ sessionId, renderFactorySlot, embeddedComposer = false, onConfigure }) {
    const [state, setState] = (0, import_react3.useState)();
    const [access, setAccess] = (0, import_react3.useState)();
    const [querying, setQuerying] = (0, import_react3.useState)(false);
    (0, import_react3.useEffect)(() => {
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
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { height: "100%", minHeight: 320, width: "100%", display: "flex", flexDirection: "column", background: "#10151b", color: "#dcebe5" }, children: [
      invitation?.value && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { padding: "10px 14px", borderBottom: "1px solid #314239", fontSize: 13 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("strong", { children: [
          "\u5343\u706F\u7EAA \xB7 ",
          invitation.value.username ?? "\u8EAB\u4EFD\u5F85\u51C6\u5907"
        ] }),
        " \xB7 ",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
          "API \u5EFA\u53F7\uFF1A",
          invitation.value.state === "ready" && invitation.value.gameAccountCreated ? "\u5DF2\u5C31\u7EEA" : accessLabel[invitation.value.state] ?? "\u7ED3\u679C\u672A\u786E\u8BA4"
        ] }),
        " \xB7 ",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
          "\u6E38\u620F\uFF1A",
          invitation.value.gameReady ? "\u8BA4\u8BC1\u53CA\u4E16\u754C\u5DF2\u5C31\u7EEA" : "\u5C1A\u672A\u786E\u8BA4\u5C31\u7EEA"
        ] }),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", disabled: querying, onClick: query, children: querying ? "\u67E5\u8BE2\u4E2D\u2026" : "\u67E5\u8BE2\u539F\u8EAB\u4EFD" }),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("a", { href: "https://mc.kangqiang.site/join", target: "_blank", rel: "noopener noreferrer", style: { color: "#98d6b4" }, children: "\u9080\u8BF7\u63A5\u5165\u8BF4\u660E" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { opacity: 0.75 }, children: [
          "\u7F51\u7AD9\u72B6\u6001\u6838\u5BF9\uFF1A",
          invitation.value.checkedAt ?? "\u5C1A\u672A\u67E5\u8BE2",
          "\uFF1B\u67E5\u8BE2\u53EA\u6838\u5BF9\u539F\u8BF7\u6C42\uFF0C\u8FDB\u670D\u4ECD\u9700\u6E38\u620F\u8BA4\u8BC1\u3002"
        ] }),
        invitation.error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { role: "status", children: invitation.error })
      ] }),
      current?.url ? embeddedComposer ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        Workbench,
        {
          game: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("iframe", { title: "Minecraft \xB7 \u6E38\u620F\u4E0E\u8FD0\u884C\u9762\u677F", src: current.url, referrerPolicy: "no-referrer", allow: "fullscreen" }),
          decision: renderFactorySlot("minecraft.decision", {}),
          onConfigure
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { fontSize: 11, margin: "6px 12px", color: "#a4b3ab" }, children: "\u4F7F\u7528\u4E0B\u65B9\u4F1A\u8BDD\u8F93\u5165\u6846\uFF1B\u4FA7\u680F Minecraft \u53EF\u5E76\u6392\u67E5\u770B\u63A8\u7406\u4E0E\u884C\u52A8\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("iframe", { title: "Minecraft \xB7 \u6E38\u620F\u4E0E\u8FD0\u884C\u9762\u677F", src: current.url, referrerPolicy: "no-referrer", allow: "fullscreen", style: { flex: 1, minHeight: 0, width: "100%", border: 0 } })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "status", style: { padding: 24 }, children: current?.error ?? "\u6B63\u5728\u8BFB\u53D6 Minecraft \u9762\u677F\u2026" })
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
  }, ({ size = 18 }) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 0v9m-9-4 9 4 9-4m-9 4v9", stroke: "currentColor", strokeWidth: "1.6", strokeLinejoin: "round" }) })));
}
return module.exports;}});
