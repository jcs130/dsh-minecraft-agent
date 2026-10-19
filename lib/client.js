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
  localPanelUrl: () => localPanelUrl
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots", "connection"];
function localPanelUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && !!url.port && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.href : null;
  } catch {
    return null;
  }
}
function apply(ctx) {
  function Panel({ sessionId }) {
    const [state, setState] = (0, import_react.useState)();
    (0, import_react.useEffect)(() => {
      const controller = new AbortController();
      const refresh = async () => {
        setState(void 0);
        try {
          const result = await ctx.connection.rpc.call("/api", "mc-harness/panel", { sessionId }, controller.signal);
          if (controller.signal.aborted) return;
          const url = result.ok && result.value.sessionId === sessionId && localPanelUrl(result.value.url);
          setState(url ? { sessionId, url } : { sessionId, error: result.ok ? "\u9762\u677F\u5730\u5740\u4E0D\u53EF\u7528\u3002" : result.error.message });
        } catch {
          if (!controller.signal.aborted) setState({ sessionId, error: "Minecraft \u9762\u677F\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u68C0\u67E5\u63D2\u4EF6\u914D\u7F6E\u3002" });
        }
      };
      void refresh();
      const stop = ctx.on("connection/reset", refresh);
      return () => {
        controller.abort();
        stop();
      };
    }, [sessionId]);
    const current = state?.sessionId === sessionId ? state : void 0;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { height: "100%", minHeight: 320, width: "100%", display: "flex", flexDirection: "column", background: "#10151b", color: "#dcebe5" }, children: current?.url ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "iframe",
      {
        title: "Minecraft \xB7 \u6E38\u620F\u4E0E\u8FD0\u884C\u9762\u677F",
        src: current.url,
        referrerPolicy: "no-referrer",
        allow: "fullscreen",
        style: { width: "100%", flex: 1, border: 0, minHeight: 320 }
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", style: { padding: 24 }, children: current?.error ?? "\u6B63\u5728\u8BFB\u53D6 Minecraft \u9762\u677F\u2026" }) });
  }
  ctx.slots.inject("conversation.view", () => ctx.slots.register({
    name: "conversation.view",
    id: "mc-panel",
    order: 100,
    label: () => "Minecraft"
  }, Panel));
}
return module.exports;}});
