// Generated fallback copy of agent-mc-world src/client/event-condenser.ts (core > 0.5.7-rc.47). Keep in sync.
const json = (text, code) => {
  const at = text.indexOf(code + " {");
  if (at < 0) return null;
  try {
    return JSON.parse(text.slice(at + code.length + 1));
  } catch {
    return null;
  }
};
const join = (...parts) => parts.filter((p) => p !== void 0 && p !== null && p !== "" && p !== false).join("\uFF1B");
const DEFAULT_CONDENSE_RULES = [
  // Login handshake: the client logs in itself; keep only the outcome and failures.
  { id: "auth-progress", match: /MC_AUTH_(LOGIN|PASSWORD_OK)\]|正在验证登录/, action: "drop" },
  { id: "auth-state", match: /MC_AUTH_STATE \{/, action: "latest", rewrite: (text) => {
    const j = json(text, "MC_AUTH_STATE");
    return j ? `[\u767B\u5F55\u72B6\u6001] ${j.status ?? "\u672A\u77E5"}${j.authorized ? "\uFF08\u5DF2\u6388\u6743\uFF09" : ""}` : text;
  } },
  { id: "guide", match: /MC_GUIDE \{/, action: "once", rewrite: (text) => {
    const j = json(text, "MC_GUIDE");
    return j ? `[\u670D\u52A1\u5668\u6307\u5357] ${join(j.message, j.helpCommand && `\u5E2E\u52A9 ${j.helpCommand}`, j.stateCommand && `\u72B6\u6001 ${j.stateCommand}`)}` : text;
  } },
  { id: "status", match: /MC_STATUS \{/, action: "latest", rewrite: (text) => {
    const j = json(text, "MC_STATUS");
    if (!j) return text;
    return `[\u670D\u52A1\u5668\u72B6\u6001] ${join(
      j.adventurerRank,
      j.mana !== void 0 && `\u9B54\u529B ${j.mana}/${j.maxMana}`,
      j.mainStage && `\u4E3B\u7EBF ${j.mainStage}`,
      j.downed && "\u5012\u5730",
      j.inDungeon && "\u526F\u672C\u4E2D",
      j.inPvp && "PVP \u4E2D",
      j.nextCommand && `\u4E0B\u4E00\u6B65 ${j.nextCommand}`
    )}`;
  } },
  { id: "guide-next", match: /MC_GUIDE_NEXT \{/, action: "latest", rewrite: (text) => {
    const j = json(text, "MC_GUIDE_NEXT");
    return j ? `[\u670D\u52A1\u5668\u5F15\u5BFC] ${join(j.title, j.message, j.nextCommand && `\u4E0B\u4E00\u6B65 ${j.nextCommand}`)}` : text;
  } },
  // Boss bar / event countdowns: only the newest reading per bar matters.
  { id: "bossbar", match: /\] (.{1,24}?) \| \d+:\d+ 状态条进度为/, action: "latest", key: (_e, m) => "bossbar:" + m[1] },
  { id: "event-countdown", match: /\[村庄活动\] (\S+) 还有 \d+ 秒结束/, action: "latest", key: (_e, m) => "countdown:" + m[1] },
  // Per-session tutorial and UI tips.
  { id: "tips", match: /槽位\d|【特色道具】|\[照片\]|\[村庄生活季\]|SkinsRestorer|^mymc\.chat \[MC (插件|系统)\] (守护\/恢复|战斗咏唱|探矿术|探索咏唱|Agent 用 \/mycli|附魔台旁|可学习|每项可用|魔力统一|技能分|逐项说明)/, action: "drop" },
  // "No local notes" for several accounts at login: one running line instead of ~90 chars each.
  {
    id: "player-history-none",
    match: /\[游戏玩家历史\] 账号 (\S+?)；本地未找到/,
    action: "latest",
    rewrite: (text) => `[\u73A9\u5BB6\u5386\u53F2] \u65E0\u672C\u5730\u5173\u7CFB\u7B14\u8BB0\uFF1A${text.match(/账号 (\S+?)；/)?.[1] ?? "?"}\uFF08\u4E0D\u4EE3\u8868\u521D\u6B21\u89C1\u9762\uFF0C\u53EF\u67E5 mymc_memory\uFF09`,
    merge: (previous, current) => {
      const names = (t) => t.match(/无本地关系笔记：([^（]*)/)?.[1].split("\u3001") ?? [];
      const all = [.../* @__PURE__ */ new Set([...names(previous), ...names(current)])];
      return current.replace(/无本地关系笔记：[^（]*/, `\u65E0\u672C\u5730\u5173\u7CFB\u7B14\u8BB0\uFF1A${all.join("\u3001")}`);
    }
  },
  { id: "player-history", match: /\[游戏玩家历史\] 账号 (\S+?)；/, action: "once", key: (_e, m) => "history:" + m[1] },
  // Queue progress notes restate the latest tool receipt; only the newest matters.
  { id: "task-queue", match: /^mymc\.task\.queue /, action: "latest" },
  { id: "world-snapshot", match: /^mymc\.world\.snapshot |出生点读数已更新/, action: "latest" },
  { id: "ambient", match: /^\S+ \[Minecraft\] (\S{1,6}边有\S{1,8}的动静|\S{1,8}走远了)。$/, action: "latest", key: (e) => "ambient:" + e.text }
];
class EventCondenser {
  rules;
  window;
  once = /* @__PURE__ */ new Set();
  events = [];
  keys = [];
  stats = { seen: 0, dropped: 0, deduped: 0, superseded: 0, rewritten: 0 };
  constructor(options = {}) {
    const off = new Set(options.disable ?? []);
    this.rules = [...options.rules ?? [], ...DEFAULT_CONDENSE_RULES.filter((rule) => !off.has(rule.id))];
    this.window = options.window ?? 24;
  }
  /** Feed new journal events (oldest first). */
  push(events) {
    for (const event of events) this.add(event);
  }
  /** Model-facing window, oldest first. Counts of what was hidden are in stats. */
  view() {
    return [...this.events];
  }
  /**
   * Events newer than `cursor` (what the model already read) plus `tail` older ones for continuity.
   * Hosts that retire earlier snapshots use this so each step carries mostly new events.
   */
  since(cursor, tail = 2) {
    const fresh = this.events.filter((e) => e.cursor > cursor);
    const old = this.events.filter((e) => e.cursor <= cursor).slice(-tail);
    return [...old, ...fresh];
  }
  add(event) {
    this.stats.seen++;
    const subject = `${event.type} ${event.text ?? ""}`;
    let rule, match = null;
    for (const candidate of this.rules) {
      match = subject.match(candidate.match);
      if (match) {
        rule = candidate;
        break;
      }
    }
    if (!rule || rule.action === "keep") return this.append(event, null);
    if (rule.action === "drop") {
      this.stats.dropped++;
      return;
    }
    const key = rule.key ? rule.key(event, match) : rule.id;
    if (rule.action === "once") {
      if (this.once.has(key)) {
        this.stats.deduped++;
        return;
      }
      this.once.add(key);
    }
    let text = event.text;
    if (rule.rewrite) {
      const short = rule.rewrite(event.text ?? "");
      if (short === null) {
        this.stats.dropped++;
        return;
      }
      if (short !== text) {
        text = short;
        this.stats.rewritten++;
      }
    }
    if (rule.action === "latest") {
      const index = this.keys.indexOf(key);
      if (index >= 0) {
        if (rule.merge) text = rule.merge(this.events[index].text ?? "", text ?? "");
        this.events.splice(index, 1);
        this.keys.splice(index, 1);
        this.stats.superseded++;
      }
    }
    this.append(text === event.text ? event : { ...event, text }, rule.action === "latest" ? key : null);
  }
  append(event, key) {
    this.events.push(event);
    this.keys.push(key);
    if (this.events.length > this.window) {
      this.events.shift();
      this.keys.shift();
    }
  }
}
export {
  DEFAULT_CONDENSE_RULES,
  EventCondenser
};
