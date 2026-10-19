/** Context, chat and lifecycle guards for the DSH Minecraft host. Pure helpers; no I/O. */

export const CONTEXT_WINDOW_EXCEEDED = 'CONTEXT_WINDOW_EXCEEDED';
export const DEFAULT_CONTEXT_TOKENS = 131072;

/** Rarely needed tools hidden by default; `tools.profile: "full"` or `tools.include` restores them. */
export const LEAN_EXCLUDED_SUFFIXES = ['_combat_tactic', '_blueprint', '_railway', '_flight_plan', '_photo',
  '_policy', '_map', '_view_map', '_artifact', '_metrics', '_events', '_script', '_check', '_cast', '_trace'];

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
export function compactEvents(events, limit = 10, textChars = 200) {
  return events.slice(-limit).map(e => ({ cursor: e.cursor, at: typeof e.ts === 'string' ? e.ts.slice(11, 19) : e.ts,
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

const WHISPER = /^\/(msg|tell|w|whisper|r|reply)\s/i;
/** Enforce the public chat budget in code, not only in the persona. */
export class ChatGuard {
  constructor({ maxPublicLines = 4, minIntervalMs = 20000, goodbye } = {}, now = Date.now) {
    this.reserve = goodbye ? 1 : 0; this.max = maxPublicLines; this.minIntervalMs = minIntervalMs;
    this.goodbye = goodbye; this.now = now; this.sent = 0; this.last = -Infinity;
  }
  static publicLines(name, args) {
    if (!name.endsWith('_do') || !Array.isArray(args?.steps)) return [];
    return args.steps.filter(s => s?.skill === 'chat' && typeof s.text === 'string' && !WHISPER.test(s.text.trim()));
  }
  /** Returns a refusal string, or null after recording the lines as sent. */
  check(name, args) {
    const lines = ChatGuard.publicLines(name, args);
    if (!lines.length) return null;
    const allowed = this.max - this.reserve;
    if (this.sent + lines.length > allowed)
      return `公屏发言已达本次上限（${allowed} 句${this.reserve ? '，另留 1 句下线道别由宿主发送' : ''}）。不要再公屏发言；私聊请用 /msg 名字 内容。`;
    if (this.now() - this.last < this.minIntervalMs)
      return `距上一句公屏发言不足 ${Math.round(this.minIntervalMs / 1000)} 秒。先别接着说，避免前后矛盾；需要时稍后再说。`;
    this.sent += lines.length; this.last = this.now();
    return null;
  }
  takeGoodbye() {
    if (!this.goodbye || this.sent >= this.max) return null;
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
