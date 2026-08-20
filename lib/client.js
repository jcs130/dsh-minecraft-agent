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
var inject = ["slots"];
function McPanelAction({ wide }) {
  const [open, setOpen] = (0, import_react.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        title: "MC \u63A7\u5236\u9762\u677F",
        "aria-label": "MC \u63A7\u5236\u9762\u677F",
        onClick: () => setOpen((v) => !v),
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: wide ? "6px 10px" : "6px",
          border: "1px solid rgba(128,128,128,.35)",
          borderRadius: 6,
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          fontSize: wide ? 13 : 11,
          lineHeight: 1
        },
        children: wide ? "\u{1F579} MC \u9762\u677F" : "\u{1F579}"
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        style: {
          position: "fixed",
          inset: 0,
          zIndex: 1e4,
          display: "flex",
          flexDirection: "column",
          background: "#17191d",
          color: "#e6e8eb"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 14px",
                borderBottom: "1px solid rgba(128,128,128,.25)",
                flex: "none"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "MC \u63A7\u5236\u9762\u677F" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-label": "\u5173\u95ED",
                    onClick: () => setOpen(false),
                    style: {
                      border: "none",
                      background: "transparent",
                      color: "inherit",
                      cursor: "pointer",
                      fontSize: 20,
                      lineHeight: 1,
                      padding: "2px 8px"
                    },
                    children: "\xD7"
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "iframe",
            {
              src: "/mc-panel/",
              title: "MC \u63A7\u5236\u9762\u677F",
              style: { flex: 1, width: "100%", border: "none", display: "block" }
            }
          )
        ]
      }
    ) : null
  ] });
}
function apply(ctx) {
  ctx.slots.inject(
    "sidebar.footer.action",
    () => ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "mc-panel",
        order: 100
      },
      McPanelAction
    )
  );
}
return module.exports; } });
