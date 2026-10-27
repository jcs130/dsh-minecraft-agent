/** Context, chat and lifecycle guards for the DSH Minecraft host. Pure helpers; no I/O. */

export const CONTEXT_WINDOW_EXCEEDED = 'CONTEXT_WINDOW_EXCEEDED';
export const DEFAULT_CONTEXT_TOKENS = 131072;

/** Rarely needed tools hidden by default; `tools.profile: "full"` or `tools.include` restores them. */
export const LEAN_EXCLUDED_SUFFIXES = ['_combat_tactic', '_blueprint', '_railway', '_flight_plan', '_photo',
  '_policy', '_map', '_view_map', '_artifact', '_metrics', '_check', '_cast', '_trace'];

/**
 * Compaction must trigger from the plugin's own contextTokens budget, not the model's (much larger)
 * advertised window, otherwise the host budget check fails before summarization ever runs.
 * compaction-basic computes threshold = min(window * thresholdRatio, window - maxTokens - headroom).
 */
export function compactionForBudget(config, modelWindow) {
  const c = config.compaction ?? {};
  const contextTokens = config.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
  const maxTokens = c.maxTokens ?? config.maxTokens ?? 1800;
  if (!Number.isInteger(modelWindow) || modelWindow <= 0) throw Error('Model context window is unknown; cannot derive compaction trigger');
  if (contextTokens > modelWindow) throw Error(`contextTokens (${contextTokens}) exceeds the model window (${modelWindow})`);
  const triggerRatio = c.triggerRatio ?? 0.55;
  if (!(triggerRatio > 0 && triggerRatio < 1)) throw Error('compaction.triggerRatio must be between 0 and 1');
  const ceiling = contextTokens - (config.maxTokens ?? 1800) - maxTokens;
  let trigger = Math.floor(contextTokens * triggerRatio);
  if (c.thresholdRatio !== undefined) {
    trigger = Math.floor(modelWindow * c.thresholdRatio);
    if (trigger >= ceiling) throw Error(`compaction.thresholdRatio ${c.thresholdRatio} triggers at ${trigger} tokens, past the contextTokens budget ${contextTokens}; use compaction.triggerRatio`);
  }
  trigger = Math.min(trigger, ceiling);
  const retainTokens = c.retainTokens ?? Math.floor(contextTokens * 0.12);
  if (retainTokens >= trigger) throw Error(`compaction.retainTokens (${retainTokens}) must be below the trigger (${trigger})`);
  const options = { auto: true, maxTokens, headroomTokens: 0, thresholdRatio: trigger / modelWindow, retainTokens };
  for (const key of ['summarizationProvider', 'summarizationModel']) if (c[key] !== undefined) options[key] = c[key];
  return { options, triggerTokens: trigger };
}

/** A tail-of-stream error that DSH compaction recognizes and answers with compact-and-retry. */
export function overflowFinish(estimate, budget) {
  return { type: 'finish', reason: { kind: 'error', failure: Object.freeze({
    message: `Minecraft request (${estimate} tokens) exceeds context budget ${budget}; context window exceeded`,
    code: CONTEXT_WINDOW_EXCEEDED }) } };
}

export function selectTools(specs, toolConfig = {}) {
  const include = new Set(toolConfig.include ?? []), exclude = new Set(toolConfig.exclude ?? []);
  const lean = (toolConfig.profile ?? 'lean') === 'lean';
  return specs.filter(spec => {
    if (spec.name.endsWith('_trace')) return false;
    if (include.has(spec.name)) return true;
    if (exclude.has(spec.name)) return false;
    return !(lean && LEAN_EXCLUDED_SUFFIXES.some(s => spec.name.endsWith(s)));
  });
}

/** Cut prose at a sentence boundary; the full text stays available via the core's *_tool_help. */
export function condense(text, max) {
  if (typeof text !== 'string' || text.length <= max) return text;
  const head = text.slice(0, max);
  const cut = Math.max(...['。', '. ', '；', '\n'].map(p => head.lastIndexOf(p)));
  return (cut > max * 0.4 ? head.slice(0, cut + 1) : head).trimEnd() + '…';
}

/** Keep every constraint; drop nested prose, shorten top-level parameter notes. */
export function slimSchema(schema, paramChars = 80, depth = 0) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(s => slimSchema(s, paramChars, depth));
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'description' || key === 'title' || key === 'examples') {
      if (key === 'description' && depth === 1 && paramChars > 0) out.description = condense(value, paramChars);
      continue;
    }
    if (key === 'properties' && value && typeof value === 'object')
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, slimSchema(v, paramChars, depth + 1)]));
    else out[key] = typeof value === 'object' ? slimSchema(value, paramChars, depth + 1) : value;
  }
  return out;
}

export function slimDescription(spec, helpName, max = 300) {
  const text = condense(spec.description ?? '', max);
  return text === spec.description || !helpName ? text : `${text}（完整说明：${helpName}）`;
}

/** Bounded, readable event tail for the per-request snapshot; full events stay in the journal. */
/** HH:MM:SS in timeZone (default host zone); journal stamps mix Z and +08:00. Mirrors core clockTime. */
export function clockTime(ts, timeZone) {
  const ms = typeof ts === 'number' ? ts : Date.parse(String(ts));
  if (!Number.isFinite(ms)) return String(ts);
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) }).format(ms);
}

export function compactEvents(events, limit = 10, textChars = 200, timeZone) {
  return events.slice(-limit).map(e => ({ cursor: e.cursor, at: clockTime(e.ts, timeZone),
    type: e.type, ...(e.senderKey ? { from: e.senderKey } : {}),
    ...(e.text ? { text: condense(String(e.text).replace(/\s+/g, ' '), textChars) } : {}) }));
}

/** Model-visible receipt cap. The durable tool value keeps the full receipt (see dsh_history). */
export function capBlocks(blocks, max = 1500) {
  if (!Array.isArray(blocks) || !(max > 0)) return blocks;
  let left = max;
  return blocks.map(block => {
    if (block.type !== 'text') return block;
    if (block.text.length <= left) { left -= block.text.length; return block; }
    const text = block.text.slice(0, Math.max(0, left)) + `…[回执已截断 ${block.text.length - left} 字；完整内容用 dsh_history 查看]`;
    left = 0; return { ...block, text };
  });
}

const WHISPER = /^\/(?:minecraft:)?(msg|tell|w|whisper|r|reply)\s/i;
/** Enforce the public chat budget in code, not only in the persona. */
export class ChatGuard {
  constructor({ maxPublicLines = 0, minIntervalMs = 5000, goodbye } = {}, now = Date.now) {
    this.reserve = goodbye ? 1 : 0; this.max = maxPublicLines; this.minIntervalMs = minIntervalMs;
    this.goodbye = goodbye; this.now = now; this.sent = 0; this.last = -Infinity;
  }
  static publicLines(name, args) {
    if (!name.endsWith('_do') || !Array.isArray(args?.steps)) return [];
    return args.steps.filter(s => s?.skill === 'chat' && typeof s.text === 'string' && !WHISPER.test(s.text.trim()));
  }
  /** Returns a refusal string, or null after recording the lines as sent. */
  check(name, args) {
    this.undo = null;
    const lines = ChatGuard.publicLines(name, args);
    if (!lines.length) return null;
    const allowed = this.max - this.reserve;
    if (this.max > 0 && this.sent + lines.length > allowed)
      return `公屏发言已达本次上限（${allowed} 句${this.reserve ? '，另留 1 句下线道别由宿主发送' : ''}）。本次先继续游戏行动；不要改用私聊绕过限额，也不假定服务器支持私聊命令。`;
    if (this.now() - this.last < this.minIntervalMs)
      return `距上一句公屏发言不足 ${Math.round(this.minIntervalMs / 1000)} 秒。先别接着说，避免前后矛盾；需要时稍后再说。`;
    this.undo = { sent: this.sent, last: this.last };
    this.sent += lines.length; this.last = this.now();
    return null;
  }
  /** The checked call was rejected (e.g. invalid arguments): nothing was said, so restore the budget. */
  refund() { if (this.undo) Object.assign(this, this.undo); this.undo = null; }
  takeGoodbye() {
    if (!this.goodbye || this.max > 0 && this.sent >= this.max) return null;
    this.sent++; const text = this.goodbye; this.goodbye = null; return text;
  }
}

/** Counts consecutive goal rounds that issued no game tool call. */
export class NoopRounds {
  constructor(limit = 3, isGameTool = () => true) { this.limit = limit; this.isGameTool = isGameTool; this.streak = 0; this.acted = false; }
  call(name) { if (this.isGameTool(name)) this.acted = true; }
  /** Call at each turn end; returns true when the streak reaches the limit. */
  end() { this.streak = this.acted ? 0 : this.streak + 1; this.acted = false; return this.limit > 0 && this.streak >= this.limit; }
}

export function goalClosed(value) {
  return value?.structuredContent?.meta?.goalClosure?.phase === 'closed';
}

export function redactUrl(text) {
  return typeof text === 'string' ? text.replace(/([?&#](?:token|access_token|key|auth)=)[^&#\s]+/gi, '$1***') : text;
}

// ---- Fallbacks for agent-mc-world releases without src/client/context-budget (<= 0.5.7-rc.47).
// Same behavior as the core's classifyWake / compactToolSchema; the host prefers the core exports.
export const WAKE_DEFAULT = ['whisper', 'mention', 'chat-other', 'danger', 'connection'];
export const WAKE_ACTIVE_GOAL = [...WAKE_DEFAULT, 'task', 'goal'];
export function configuredWake(defaults,policy={}){
  const base=policy.on??defaults;
  return policy.publicChat===false?base.filter(category=>category!=='chat-other')
    :policy.publicChat===true?[...new Set([...base,'chat-other'])]:base;
}
const DANGER = /濒死|生命 ?\d+\/20|受到|被.{0,12}(攻击|打|伤)|敌对|有害|中了「|死了[^(（]|你死|重生点失效|溺水|着火|岩浆|服务器(停|出问题)|下线|断开|Boss 血条/u;
const CONNECTION = /disconnect|lifecycle|kicked|leave_self/i;
export function classifyWakeFallback(event, options = {}) {
  const wakeOn = new Set(options.wakeOn ?? WAKE_DEFAULT);
  const decide = category => ({ wake: wakeOn.has(category), category });
  const kind = event.type.slice(event.type.indexOf('.') + 1), text = String(event.text ?? '');
  const names = (options.selfNames ?? []).filter(Boolean).map(n => n.toLocaleLowerCase());
  if (event.contextDelivery === 'archive-only') return { wake: false, category: 'piggyback' };
  if (CONNECTION.test(kind)) return decide('connection');
  if (kind === 'chat') {
    if (text.startsWith('[MC 私聊发出]')) return { wake: false, category: 'self' };
    if (text.startsWith('[MC 私聊]')) return decide('whisper');
    const speaker = typeof event.meta?.uname === 'string' ? event.meta.uname : undefined;
    if (!speaker) return { wake: false, category: 'system' };
    if (names.includes(speaker.toLocaleLowerCase())) return { wake: false, category: 'self' };
    const body = text.replace(/^\[MC[^\]]*\]\s*[^:：]*[:：]\s*/u, '').toLocaleLowerCase();
    return decide(names.some(n => body.includes(n) || body.includes('@' + n)) ? 'mention' : 'chat-other');
  }
  if (event.trigger === 'piggyback') return { wake: false, category: 'piggyback' };
  if (kind === 'task') return decide('task');
  if (kind.startsWith('task.')) return { wake: false, category: 'ambient' };
  if (kind.startsWith('goal')) return decide('goal');
  if ((kind === 'event' || kind === 'body') && event.trigger === 'flush' && DANGER.test(text)) return decide('danger');
  return { wake: false, category: 'ambient' };
}

/** Collapse object item pools wider than `limit` properties to their discriminator, keeping the signature text. */
/** Terse shape of a collapsed field: enums and array/tuple shapes the model must get right; null = omit. */
export function terseField(schema, depth = 0) {
  if (!schema || typeof schema !== 'object') return null;
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants) && depth === 0) {
    const kept = variants.map(v => terseField(v, 1) ?? (v?.type ? { type: v.type } : null));
    return kept.every(Boolean) && kept.some(v => v.enum || v.type === 'array') ? { anyOf: kept } : null;
  }
  if (Array.isArray(schema.enum)) return { ...(schema.type ? { type: schema.type } : {}), enum: schema.enum };
  const isArray = schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'));
  if (!isArray) return null;
  const out = { type: schema.type };
  for (const k of ['minItems', 'maxItems']) if (schema[k] !== undefined) out[k] = schema[k];
  const items = schema.items;
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    const inner = Array.isArray(items.enum) ? { enum: items.enum } : items.type === 'array' && depth < 2 ? terseField(items, depth + 1)
      : ['integer', 'number', 'string', 'boolean'].includes(items.type) ? { type: items.type } : null;
    if (inner) out.items = inner;
  }
  return out;
}

const collapseNode = node => {
  const required = Array.isArray(node.required) ? node.required : [];
  const properties = {};
  for (const [k, v] of Object.entries(node.properties ?? {})) {
    if (required.includes(k)) properties[k] = Object.fromEntries(Object.entries(v).filter(([key]) => key !== 'description'));
    else { const t = terseField(v); if (t) properties[k] = t; }
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: true };
};

/** Mirrors core compactToolSchema: wide item pools, and wide objects nested >= nestedLevel property levels. */
export function collapseWidePools(schema, limit = 24, signatureChars = 3000, nested = 8, nestedLevel = 3, level = 0) {
  if (Array.isArray(schema)) return schema.map(s => collapseWidePools(s, limit, signatureChars, nested, nestedLevel, level));
  if (!schema || typeof schema !== 'object') return schema;
  if (level >= nestedLevel && schema.properties && typeof schema.properties === 'object' && Object.keys(schema.properties).length > nested) {
    const out = collapseNode(schema);
    if (schema.type !== undefined) out.type = schema.type;
    if (schema.items && typeof schema.items === 'object') out.items = schema.items.properties ? collapseNode(schema.items) : schema.items;
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (['enum', 'const', 'default'].includes(k)) out[k] = v;
    else if (k === 'properties' && v && typeof v === 'object')
      out[k] = Object.fromEntries(Object.entries(v).map(([n, c]) => [n, collapseWidePools(c, limit, signatureChars, nested, nestedLevel, level + 1)]));
    else out[k] = collapseWidePools(v, limit, signatureChars, nested, nestedLevel, level);
  }
  const items = schema.items;
  if (items && typeof items === 'object' && items.properties && Object.keys(items.properties).length > limit) {
    out.items = collapseNode(items);
    if (typeof schema.description === 'string') out.description = condense(schema.description, signatureChars);
  }
  return out;
}

/** Fallback copy of core observationDigest. */
export function observationDigestFallback(text) {
  const norm = String(text).replace(/\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim().slice(0, 4000);
  let h = 2166136261;
  for (let i = 0; i < norm.length; i++) { h ^= norm.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** Fallback copy of core compactFacts. */
export function compactFactsFallback(facts) {
  const out = {};
  if (!facts) return out;
  if (facts.run) out.run = facts.run;
  const o = facts.observation, r = n => typeof n === 'number' ? Math.round(n * 10) / 10 : n;
  if (o) {
    if (typeof o.at === 'string') out.at = o.at;
    if (o.dimension !== undefined) out.dimension = o.dimension;
    if (o.position) out.position = [o.position.x, o.position.y, o.position.z].map(r);
    for (const k of ['health', 'food', 'inventory']) if (o[k] !== undefined) out[k] = o[k];
  }
  for (const part of facts.parts ?? []) {
    const text = String(part.text ?? '').trim();
    if (!text || text === '{}' || text === '[]' || text === 'null') continue;
    let value = text;
    if (/^[[{]/.test(text)) { try { value = JSON.parse(text); } catch {} }
    out[part.key in out ? `part:${part.key}` : part.key] = value;
  }
  return out;
}

const MOVEMENT_SKILLS = ['goto', 'look', 'observe', 'walk', 'wander', 'face'];
/** Fallback copy of core MovementProgress (agent-mc-world > 0.5.7-rc.47). */
export class MovementProgressFallback {
  constructor({ window = 6, radius = 24, cellSize = 16, movementSkills = MOVEMENT_SKILLS } = {}) {
    Object.assign(this, { window, radius, cellSize }); this.movement = new Set(movementSkills);
    this.cells = new Set(); this.recent = []; this.streak = 0;
  }
  reset() { this.streak = 0; this.recent = []; this.cells.clear(); this.seen = new Set(); }
  recordObservation(digest) {
    this.seen ??= new Set();
    if (this.seen.has(digest)) { this.streak++; this.recent = [...this.recent, { points: [], newCells: 0 }].slice(-this.window); }
    else this.seen.add(digest);
    return this.verdict();
  }
  record(steps) {
    const work = steps.map(s => typeof s?.skill === 'string' ? s.skill : '').filter(k => k !== 'chat');
    if (!work.length || work.some(k => !this.movement.has(k))) {
      if (work.length) { this.streak = 0; this.recent = []; }
      return this.verdict();
    }
    const points = steps.map(s => s?.at).filter(p => Array.isArray(p) && p.length === 3 && p.every(n => typeof n === 'number'));
    let newCells = 0;
    for (const [x, , z] of points) {
      const key = `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
      if (!this.cells.has(key)) { this.cells.add(key); newCells++; }
    }
    this.streak++; this.recent = [...this.recent, { points, newCells }].slice(-this.window);
    return this.verdict();
  }
  verdict() {
    const points = this.recent.flatMap(e => e.points), newCells = this.recent.reduce((s, e) => s + e.newCells, 0);
    let spread = 0;
    if (points.length) {
      const cx = points.reduce((s, p) => s + p[0], 0) / points.length, cz = points.reduce((s, p) => s + p[2], 0) / points.length;
      spread = Math.round(Math.max(...points.map(p => Math.hypot(p[0] - cx, p[2] - cz))));
    }
    return { streak: this.streak, spread, newCells, repetitive: this.streak >= this.window && (spread <= this.radius || newCells === 0) };
  }
}

/** Per-goal guard: nudge on wandering, close the goal on continued wandering or an exhausted call budget. */
export class GoalProgressGuard {
  constructor({ progress, maxCalls = 30, closeAfter = 12, digest = observationDigestFallback } = {}) { Object.assign(this, { progress, maxCalls, closeAfter, digest }); this.goalId = null; this.calls = 0; }
  /** Call once per model step; returns a close reason or null. */
  step(goal) {
    if (goal?.phase !== 'active') return null;
    if (goal.id !== this.goalId) { this.goalId = goal.id; this.calls = 0; this.progress.reset(); }
    this.calls++;
    return this.maxCalls > 0 && this.calls > this.maxCalls ? `per-goal call budget (${this.maxCalls}) used up` : null;
  }
  /** Call for each action tool; returns { notice?, close? }. */
  action(goal, steps) {
    if (goal?.phase !== 'active' || !Array.isArray(steps)) return {};
    return this.judge(this.progress.record(steps), 'move');
  }
  /** Call for each look-around tool with its result text. */
  observe(goal, text) {
    if (goal?.phase !== 'active' || typeof this.progress.recordObservation !== 'function') return {};
    return this.judge(this.progress.recordObservation(this.digest(text)), 'look');
  }
  judge(v, kind) {
    if (!v.repetitive) return {};
    const what = kind === 'look' ? `张望/侦察没有新发现` : `只在约 ${v.spread} 格范围内走动/张望，没有到达新地方`;
    if (this.closeAfter > 0 && v.streak >= this.closeAfter) return { close: kind === 'look' ? `${v.streak} actions without progress, ending in repeated look-arounds with nothing new`
      : `${v.streak} movement-only actions in one ~${v.spread}-block area without new ground` };
    return { notice: `[宿主提示] 最近 ${v.streak} 次${what}。目标若已达成请调用 update_goal 标记完成并停下；否则换一件实际的事或去新的区域。继续原地打转会暂停本目标并保留进度，不算完成。` };
  }
}

export function withNotice(value, notice) {
  if (!notice) return value;
  if (value?.structuredContent) return { ...value, structuredContent: { ...value.structuredContent, hostNotice: notice } };
  return { ...value, content: [...(value?.content ?? []), { type: 'text', text: notice }] };
}

/** Local compact schema: collapse wide pools, drop prose, keep collapsed nodes' signature text. */
export function slimToolSchema(schema, paramChars = 80) {
  const collapsed = collapseWidePools(schema);
  const slim = slimSchema(collapsed, paramChars);
  for (const [key, value] of Object.entries(collapsed.properties ?? {})) {
    const wasWide = schema.properties?.[key]?.items?.additionalProperties !== true;
    if (wasWide && value?.items?.additionalProperties === true && typeof value.description === 'string')
      slim.properties[key].description = value.description;
  }
  return slim;
}
