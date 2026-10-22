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
    const [access, setAccess] = (0, import_react.useState)();
    const [querying, setQuerying] = (0, import_react.useState)(false);
    (0, import_react.useEffect)(() => {
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
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { height: "100%", minHeight: 320, width: "100%", display: "flex", flexDirection: "column", background: "#10151b", color: "#dcebe5" }, children: [
      invitation?.value && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "10px 14px", borderBottom: "1px solid #314239", fontSize: 13 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
          "\u5343\u706F\u7EAA \xB7 ",
          invitation.value.username ?? "\u8EAB\u4EFD\u5F85\u51C6\u5907"
        ] }),
        " \xB7 ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          "API \u5EFA\u53F7\uFF1A",
          invitation.value.state === "ready" && invitation.value.gameAccountCreated ? "\u5DF2\u5C31\u7EEA" : accessLabel[invitation.value.state] ?? "\u7ED3\u679C\u672A\u786E\u8BA4"
        ] }),
        " \xB7 ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          "\u6E38\u620F\uFF1A",
          invitation.value.gameReady ? "\u8BA4\u8BC1\u53CA\u4E16\u754C\u5DF2\u5C31\u7EEA" : "\u5C1A\u672A\u786E\u8BA4\u5C31\u7EEA"
        ] }),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: querying, onClick: query, children: querying ? "\u67E5\u8BE2\u4E2D\u2026" : "\u67E5\u8BE2\u539F\u8EAB\u4EFD" }),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: "https://mc.kangqiang.site/join", target: "_blank", rel: "noopener noreferrer", style: { color: "#98d6b4" }, children: "\u9080\u8BF7\u63A5\u5165\u8BF4\u660E" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { opacity: 0.75 }, children: [
          "\u7F51\u7AD9\u72B6\u6001\u6838\u5BF9\uFF1A",
          invitation.value.checkedAt ?? "\u5C1A\u672A\u67E5\u8BE2",
          "\uFF1B\u67E5\u8BE2\u53EA\u6838\u5BF9\u539F\u8BF7\u6C42\uFF0C\u8FDB\u670D\u4ECD\u9700\u6E38\u620F\u8BA4\u8BC1\u3002"
        ] }),
        invitation.error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "status", children: invitation.error })
      ] }),
      current?.url ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "iframe",
        {
          title: "Minecraft \xB7 \u6E38\u620F\u4E0E\u8FD0\u884C\u9762\u677F",
          src: current.url,
          referrerPolicy: "no-referrer",
          allow: "fullscreen",
          style: { width: "100%", flex: 1, border: 0, minHeight: 0 }
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", style: { padding: 24 }, children: current?.error ?? "\u6B63\u5728\u8BFB\u53D6 Minecraft \u9762\u677F\u2026" })
    ] });
  }
  ctx.slots.inject("conversation.view", () => ctx.slots.register({
    name: "conversation.view",
    id: "mc-panel",
    order: 100,
    label: () => "Minecraft"
  }, Panel));
}
return module.exports;}});
