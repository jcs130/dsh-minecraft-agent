// src/mc-progress.ts
import Schema from "@deepseek-ai/schemastery";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
var name = "mc-progress";
var inject = [];
var Config = Schema.object({
  enabled: Schema.boolean().default(true),
  dataDir: Schema.string().default("./data"),
  stagnationHours: Schema.number().default(24),
  alertCooldownMs: Schema.number().default(6 * 36e5),
  minSamples: Schema.number().default(2)
});
function emptyState(username) {
  return {
    version: 1,
    username,
    chantTotal: 0,
    chantSuccess: 0,
    chantFail: 0,
    lastChantAt: null,
    lastChantText: null,
    level: 0,
    firstSampledAt: null,
    samples: 0,
    levelHistory: [],
    lastLevelUpAt: null,
    stagnationSince: null,
    alerts: [],
    lastAlertAt: null
  };
}
function levelHint(level) {
  if (level <= 0) return "\u5C1A\u672A\u89C9\u9192\u9B54\u529B";
  if (level >= 7) return `\u5DF2\u89E3\u9501\u5168\u90E8 7 \u5C42\u6CD5\u672F`;
  return `\u5DF2\u89E3\u9501 1~${level} \u7EA7\u6CD5\u672F`;
}
function fmtAgo(at, now) {
  if (at == null) return "\uFF08\u4ECE\u672A\uFF09";
  const h = Math.round((now - at) / 36e5);
  if (h < 1) return "\u4E0D\u8DB3 1 \u5C0F\u65F6\u524D";
  if (h < 24) return `${h} \u5C0F\u65F6\u524D`;
  return `${Math.round(h / 24)} \u5929\u524D`;
}
function apply(ctx, config) {
  if (!config.enabled) return;
  const log = (msg) => console.log(`[mc-progress] ${msg}`);
  const dataDir = resolve(config.dataDir);
  const cache = /* @__PURE__ */ new Map();
  const pathOf = (username) => join(dataDir, `progress-${username}.json`);
  function load(username) {
    let s = cache.get(username);
    if (s) return s;
    s = emptyState(username);
    try {
      if (existsSync(pathOf(username))) {
        const raw = JSON.parse(readFileSync(pathOf(username), "utf-8"));
        if (raw && typeof raw === "object" && raw.version === 1) {
          s = { ...emptyState(username), ...raw };
        }
      }
    } catch {
    }
    cache.set(username, s);
    return s;
  }
  function persist(s) {
    try {
      mkdirSync(dataDir, { recursive: true });
      const tmp = pathOf(s.username) + ".tmp";
      writeFileSync(tmp, JSON.stringify(s, null, 2), "utf-8");
      renameSync(tmp, pathOf(s.username));
    } catch (e) {
      log(`persist failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  function recordChant(username, success, chant) {
    if (!username) return;
    const s = load(username);
    const now = Date.now();
    s.chantTotal += 1;
    if (success) s.chantSuccess += 1;
    else s.chantFail += 1;
    s.lastChantAt = now;
    s.lastChantText = chant.slice(0, 80);
    persist(s);
  }
  function sampleLevel(username, level) {
    if (!username) return;
    if (!Number.isInteger(level) || level < 0) return;
    const s = load(username);
    const now = Date.now();
    if (s.firstSampledAt == null) {
      s.firstSampledAt = now;
    }
    s.samples += 1;
    if (level > s.level) {
      s.level = level;
      s.levelHistory.push({ level, at: now });
      s.lastLevelUpAt = now;
      s.stagnationSince = null;
      log(`${username} \u5B66\u4F1A\u65B0\u5C42\u7EA7 \u2192 Lv.${level}\uFF08\u7D2F\u8BA1 ${s.levelHistory.length} \u6B21\u5347\u5C42\uFF09`);
      persist(s);
    }
  }
  function summary(username) {
    const s = load(username);
    const now = Date.now();
    const lines = [];
    lines.push(`\u9B54\u529B\u5C42\u7EA7 Lv.${s.level}\uFF08${levelHint(s.level)}\uFF09`);
    if (s.levelHistory.length > 0) {
      lines.push(`\u5347\u5C42\u8F68\u8FF9\uFF1A${s.levelHistory.map((h) => `Lv.${h.level}@${fmtAgo(h.at, now)}`).join(" \u2192 ")}`);
    } else {
      lines.push(`\u5347\u5C42\u8F68\u8FF9\uFF1A\uFF08\u5C1A\u672A\u5347\u5C42\uFF09`);
    }
    lines.push(`\u548F\u5531 ${s.chantTotal} \u6B21\uFF1A\u6210\u529F ${s.chantSuccess}\u3001\u5931\u8D25 ${s.chantFail}`);
    lines.push(`\u6700\u8FD1\u548F\u5531\uFF1A${s.lastChantAt != null ? fmtAgo(s.lastChantAt, now) : "\uFF08\u4ECE\u672A\uFF09"}`);
    lines.push(`\u6700\u8FD1\u5347\u5C42\uFF1A${fmtAgo(s.lastLevelUpAt, now)}`);
    return lines.join("\n");
  }
  function diagnose(username) {
    const s = load(username);
    const now = Date.now();
    if (s.samples < config.minSamples) return null;
    if (s.firstSampledAt == null) return null;
    const ageMs = now - s.firstSampledAt;
    if (ageMs < config.stagnationHours * 36e5) return null;
    let kind = "";
    let msg = "";
    if (s.chantTotal === 0) {
      kind = "zero-attempt";
      msg = `\u9B54\u6CD5\u5B66\u4E60\u505C\u6EDE\uFF08\u96F6\u5C1D\u8BD5\uFF09\uFF1A\u7A7F\u8D8A\u8005 ${username} \u5DF2\u6D3B\u8DC3 ${fmtAgo(s.firstSampledAt, now)}\uFF0C\u5374\u4ECE\u672A\u548F\u5531\u8FC7\u4E00\u6B21\u9B54\u6CD5\u2014\u2014\u5F15\u5BFC\u6216\u5DE5\u5177\u66B4\u9732\u53EF\u80FD\u6709\u95EE\u9898\uFF08mc_chant \u6CA1\u88AB\u5F15\u5BFC\u53BB\u7528\uFF1F\uFF09\u3002`;
    } else if (s.level <= 1 && s.lastLevelUpAt == null) {
      kind = "no-progress";
      msg = `\u9B54\u6CD5\u5B66\u4E60\u505C\u6EDE\uFF08\u6709\u5C1D\u8BD5\u65E0\u8FDB\u5C55\uFF09\uFF1A${username} \u548F\u5531 ${s.chantTotal} \u6B21\uFF08\u6210\u529F ${s.chantSuccess} / \u5931\u8D25 ${s.chantFail}\uFF09\uFF0C\u4F46\u9B54\u529B\u5C42\u7EA7\u4ECE\u672A\u63D0\u5347\u2014\u2014\u82E5\u6210\u529F ${s.chantSuccess} \u6B21\u4ECD\u4E0D\u6DA8\u5C42\uFF0C\u65BD\u6CD5\u53EF\u80FD\u6CA1\u7ED9\u7ECF\u9A8C\uFF08\u4E16\u754C\u4FA7\u5B66\u4E60\u95ED\u73AF\u65AD\u4E86\uFF09\u3002`;
    } else if (s.lastLevelUpAt != null && now - s.lastLevelUpAt >= config.stagnationHours * 36e5) {
      kind = "stagnant";
      msg = `\u9B54\u6CD5\u5B66\u4E60\u505C\u6EDE\uFF08\u957F\u671F\u672A\u5347\u5C42\uFF09\uFF1A${username} \u5361\u5728 Lv.${s.level} \u5DF2 ${fmtAgo(s.lastLevelUpAt, now)}\uFF08\u671F\u95F4\u548F\u5531 ${s.chantTotal} \u6B21\uFF0C\u6210\u529F ${s.chantSuccess}\uFF09\u2014\u2014\u5B66\u4E60\u673A\u5236\u53EF\u80FD\u574F\u4E86\uFF1A\u65BD\u6CD5\u7ECF\u9A8C\u6CA1\u7D2F\u8BA1\u3001\u7B49\u7EA7\u95E8\u69DB\u4E0D\u5408\u7406\u3001\u6216\u7A7F\u8D8A\u8005\u6CA1\u5728\u5C1D\u8BD5\u65B0\u6CD5\u672F\u3002`;
    } else {
      return null;
    }
    const lastSame = s.alerts.filter((a) => a.kind === kind).map((a) => a.at).sort((a, b) => b - a)[0];
    if (lastSame != null && now - lastSame < config.alertCooldownMs) return null;
    const alert = { at: now, kind, msg };
    s.alerts.push(alert);
    if (s.alerts.length > 20) s.alerts = s.alerts.slice(-20);
    s.lastAlertAt = now;
    s.stagnationSince = s.stagnationSince ?? now;
    persist(s);
    log(`[\u505C\u6EDE\u8BCA\u65AD] ${msg}`);
    return msg;
  }
  ctx.provide("mcProgress", {
    recordChant,
    sampleLevel,
    summary,
    diagnose
  });
  log(`learning-progress ledger ready (dir=${dataDir}, stagnation=${config.stagnationHours}h)`);
}
export {
  Config,
  apply,
  inject,
  name
};
