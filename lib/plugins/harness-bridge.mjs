import { randomUUID } from 'node:crypto';

export const PROTOCOL = 'agent-mc/v1';

/** Only the core's explicitly read-only, non-body query lane may overlap tools.
 * Command spelling never establishes that a server operation is read-only. */
export function gameToolConcurrencySafe(spec) {
  const contract = spec?._meta?.[PROTOCOL];
  return typeof spec?.name === 'string' && spec.name.endsWith('_query')
    && spec.annotations?.readOnlyHint === true
    && contract?.barrierAfter === false && contract?.endsTurn === false;
}

/** Native execution methods retain their owner; spreading exec changes their this. */
export function nativeToolContext(exec, lifetimeSignal) {
  return { id: exec.callId, signal: lifetimeSignal ? AbortSignal.any([lifetimeSignal, exec.signal]) : exec.signal,
    concludeTurn: () => exec.concludeTurn() };
}

/** A host turn spans any number of RPCs. Only a durable host boundary closes it. */
export class HarnessBridge {
  constructor(runtime, transport) {
    this.runtime = runtime; this.transport = transport;
    this.turnId = null; this.sessionId = null; this.decisionId = null;
    this.closed = false; this.boundary = Promise.resolve();
  }
  async enter(session, turn, step) {
    await this.boundary;
    if (this.closed) throw Error('Minecraft adapter is stopped');
    const id = `${session}:${turn}`;
    if (this.turnId && this.turnId !== id) throw Error('Previous DSH turn has no terminal boundary');
    this.sessionId = session;
    this.decisionId = Number.isSafeInteger(step) && step >= 0 ? `${id}:${step}` : id;
    if (this.turnId === id) return;
    this.runtime.beginTurn(id); this.turnId = id;
  }
  ended(session, turn) {
    const id = `${session}:${turn}`;
    this.boundary = this.boundary.then(async () => {
      if (this.turnId !== id || this.closed) return;
      await this.runtime.endTurn(id); this.turnId = null; this.sessionId = null; this.decisionId = null;
    });
    return this.boundary;
  }
  async call(name, args, exec) {
    if (this.closed) throw Error('Minecraft adapter is stopped');
    const requestId = `${this.runtime.journal.run}:${exec.id ?? randomUUID()}`;
    const result = await this.transport.callTool({ name, arguments: args,
      _meta: { [PROTOCOL]: { requestId, ...(this.turnId ? { turnId: this.turnId } : {}),
        ...(this.sessionId ? { attribution: { controller: 'system2', sessionId: this.sessionId,
          ...(this.decisionId ? { decisionId: this.decisionId } : {}) } } : {}) } },
    }, undefined, { signal: exec.signal, timeout: 120000 });
    // Preserve control, task identity, raw receipts and archive references in the durable value.
    const control = result.structuredContent?.control;
    if (control?.barrierAfter) this.runtime.acknowledgeBarrier(control.requestId);
    // A failed game action can still yield control (cooldown, pending observation,
    // etc.). The native boundary must land before any next planner request.
    if (control?.endTurnRequested) exec.concludeTurn();
    return result;
  }
  async stop() {
    this.closed = true;
    await this.runtime.disconnect();
    await this.transport.close();
  }
}

/** DSH distinguishes a failed transport/tool from a returned failed game action.
 * Keep a concluding receipt intact: DSH rc.2 drops conclusion on its error arm.
 * Other MCP errors must enter the native error arm, retaining the full receipt.
 */
export async function mcpResultDecision(exec, result, next) {
  const value = result.value;
  if (!result.isError && value?.isError === true && !value.structuredContent?.control?.endTurnRequested)
    return { kind: 'block', feedback: renderReceipt(value) };
  return next();
}

/** DSH binds the explicit request options on both session creation and resumption. */
export function agentModelOptions(config) {
  const options = { provider: config.provider, model: config.model, maxTokens: config.maxTokens ?? 1800 };
  if (config.reasoningEffort !== undefined) {
    if (typeof config.reasoningEffort !== 'string' || !config.reasoningEffort.trim())
      throw Error('reasoningEffort must name a level supported by the configured DSH provider');
    options.reasoningEffort = config.reasoningEffort;
  }
  return options;
}

/** A resumed session can name its previous route; explicit compaction routing avoids reusing it. */
export function compactionOptions(config) {
  const c = config.compaction ?? {};
  const options = { auto: true, maxTokens: c.maxTokens ?? config.maxTokens ?? 1800,
    headroomTokens: 12000, thresholdRatio: c.thresholdRatio ?? 0.7,
    ...(c.retainTokens !== undefined ? { retainTokens: c.retainTokens } : { retainRatio: 0.2 }) };
  if (c.summarizationProvider !== undefined || c.summarizationModel !== undefined) {
    for (const key of ['summarizationProvider', 'summarizationModel']) {
      if (typeof c[key] !== 'string' || !c[key].trim())
        throw Error('compaction.summarizationProvider and summarizationModel must be configured together');
      options[key] = c[key];
    }
  }
  return options;
}

/** Translate draft-07 tuples for a model's 2020-12 tool boundary; MCP still validates the original. */
export function modelToolSchema(schema) {
  if (typeof schema === 'boolean') return schema;
  const out = structuredClone(schema);
  for (const key of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'])
    if (out[key]) out[key] = Object.fromEntries(Object.entries(out[key]).map(([name, value]) => [name, modelToolSchema(value)]));
  for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems'])
    if (Array.isArray(out[key])) out[key] = out[key].map(modelToolSchema);
  for (const key of ['additionalProperties', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties'])
    if (out[key] !== undefined) out[key] = modelToolSchema(out[key]);
  if (Array.isArray(out.items)) {
    out.prefixItems = out.items.map(modelToolSchema);
    if (out.additionalItems === false) out.maxItems = Math.min(out.maxItems ?? Infinity, out.prefixItems.length);
    out.items = typeof out.additionalItems === 'object' ? modelToolSchema(out.additionalItems) : {};
    delete out.additionalItems;
  } else if (out.items !== undefined) out.items = modelToolSchema(out.items);
  return out;
}

/** DSH input counts exclude cache reads/writes; the shared metrics contract includes them. */
export function normalizeUsage(usage) {
  if (!usage) return {};
  const out = {};
  if (Number.isSafeInteger(usage.inputTokens)) out.inputTokens = usage.inputTokens
    + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  if (Number.isSafeInteger(usage.outputTokens)) out.outputTokens = usage.outputTokens;
  if (Number.isSafeInteger(usage.cacheReadTokens)) out.cachedTokens = usage.cacheReadTokens;
  if (Number.isSafeInteger(usage.reasoningTokens)) out.reasoningTokens = usage.reasoningTokens;
  return out;
}

/** Store the full MCP result; show each receipt once in the model's tool result. */
export function renderReceipt(value) {
  if (!value.structuredContent) return value.content ?? [{ type: 'text', text: JSON.stringify(value) }];
  const extra = (value.content ?? []).filter(block => block.type !== 'text');
  return [{ type: 'text', text: JSON.stringify({ ...value.structuredContent,
    ...(value.isError ? { isError: true } : {}) }) }, ...extra];
}

/** Completing a goal stops its continuation, not the connected agent's event inbox. */
export function wakeForMinecraftEvents(agent, goal, paused, events, createMessage) {
  if (paused || agent.status !== 'idle' || !events?.length) return false;
  // Paused/blocked goals and a lifecycle-disarmed active goal still need human resumption.
  if (goal?.activation === 'disarmed' && goal.phase !== 'complete') return false;
  agent.steer(createMessage({
    content: [{ type: 'text', text: `游戏收到 ${events.length} 条新事件。读取请求尾部当前事实、事件及原始回执后决定。` }],
    source: { kind: 'mc-harness', form: 'notice', summary: 'Minecraft events' },
  }));
  return true;
}

/** Keep a bounded notification while the model is busy; full events remain in the journal. */
export class MinecraftEventInbox {
  pending = [];
  add(events) { this.pending = [...this.pending, ...events].slice(-64); }
  clear() { this.pending = []; }
  flush(agent, goal, paused, createMessage) {
    if (paused) { this.clear(); return false; }
    if (!wakeForMinecraftEvents(agent, goal, false, this.pending, createMessage)) return false;
    this.clear(); return true;
  }
}

export async function deliverOperatorRequest(request, delivery) {
  if (!request?.id || !request?.text || delivery.lastId() === request.id) return false;
  await delivery.prepare?.(request);
  delivery.steer(request);
  await delivery.flush();
  delivery.remember(request.id);
  return true;
}

/** Retire only our volatile sections through durable DSH surface replacements. */
export function retireFacts(session, createMessage, surfaceEvents) {
  const nodes = new Set(session.surface.nodes);
  let count = 0;
  // Section names restated by a later snapshot, per snapshot seq.
  const restated = new Map(); let later = new Set();
  for (const event of [...surfaceEvents].reverse()) {
    if (!nodes.has(event.seq)) continue;
    const source = session.deriveEventMessage(event)?.source;
    if (source?.kind !== 'runtime-context' || source.form !== 'snapshot') continue;
    restated.set(event.seq, later);
    later = new Set([...later, ...(source.sections ?? []).map(s => s.name)]);
  }
  for (const event of surfaceEvents) {
    if (!nodes.has(event.seq)) continue;
    const source = session.deriveEventMessage(event)?.source;
    if (source?.kind !== 'runtime-context' || source.form !== 'snapshot') continue;
    const sections = source.sections ?? [];
    if (!sections.some(s => s.name.startsWith('minecraft:'))) continue;
    // Other sections are retired only when a newer snapshot restates them (DSH snapshots restate all
    // sections): keeping them added ~1.5k chars of history per step. The archive note keeps the raw snapshot.
    const retained = sections.filter(s => !s.name.startsWith('minecraft:') && !(restated.get(event.seq)?.has(s.name)));
    const seq = event.seq;
    const message = createMessage({ content: [{ type: 'text', text: retained.length
      ? retained.map(s => s.text).join('\n\n') : `旧现场#${seq}已归档(dsh_history)` }],
      source: retained.length ? { ...source, sections: retained }
        : { kind: 'mc-harness-archive', form: 'notice', summary: `Archived snapshot ${seq}` } });
    session.append('user/message', message, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] });
    count++;
  }
  return count;
}

/** Borrow an exact live cut; do not clone and replay the entire durable history each step. */
export async function retireLiveFacts(session, createMessage, sessionQuery, signal) {
  const observation = await sessionQuery.observeSession(session.id, { signal, projectionMode: 'none' });
  try {
    signal?.throwIfAborted();
    if (observation.source !== 'live' || observation.header.id !== session.id)
      throw Error('Minecraft facts require the attached DSH session');
    // The live surface owns projections. A concurrent append after this cut is left for the next step.
    const events = observation.events;
    const current = session.surface.nodes.filter(seq => seq <= observation.cursor).map(seq => {
      const event = events[seq];
      if (!event || event.seq !== seq) throw Error('Minecraft live surface observation is inconsistent');
      return event;
    });
    return retireFacts(session, createMessage, current);
  } finally { observation[Symbol.dispose](); }
}

/** Instrument dispatched streams, not assistant attempts that may fail before dispatch. */
export async function* measuredStream(request, next, metrics, model) {
  const id = randomUUID(), start = Date.now(); let ttftMs, usage, reason, outcome = 'unknown';
  const role = request.purpose === 'compaction' ? 'background' : 'system2';
  const requested = request.reasoningEffort === 'off' ? 'none' : request.reasoningEffort;
  const effort = ['none', 'low', 'medium', 'high', 'xhigh', 'default'].includes(requested) ? { effort: requested } : {};
  metrics.report({ kind: 'model', id, phase: 'start', role, model, ...effort });
  try {
    for await (const chunk of next()) {
      if (chunk.type.endsWith('-delta') && ttftMs === undefined) ttftMs = Date.now() - start;
      if (chunk.type === 'usage') usage = chunk.usage;
      if (chunk.type === 'finish') reason = chunk.reason;
      yield chunk;
    }
    const kind = typeof reason === 'string' ? reason : reason?.kind;
    outcome = kind === 'error' ? 'failed' : kind === 'aborted' ? 'cancelled' : kind ? 'success' : 'unknown';
  } catch (error) { outcome = request.signal?.aborted ? 'cancelled' : 'failed'; throw error; }
  finally { metrics.report({ kind: 'model', id, phase: 'finish', role, model, outcome, ...effort,
    elapsedMs: Date.now() - start, ...(ttftMs === undefined ? {} : { ttftMs }), ...normalizeUsage(usage) }); }
}

export function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { done(); reject(signal.reason ?? Error('Stopped')); };
    const timer = setTimeout(() => { done(); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
