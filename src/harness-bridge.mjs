import { randomUUID } from 'node:crypto';

export const PROTOCOL = 'agent-mc/v1';

/** A host turn spans any number of RPCs. Only a durable host boundary closes it. */
export class HarnessBridge {
  constructor(runtime, transport) {
    this.runtime = runtime; this.transport = transport;
    this.turnId = null; this.closed = false; this.boundary = Promise.resolve();
  }
  async enter(session, turn) {
    await this.boundary;
    if (this.closed) throw Error('Minecraft adapter is stopped');
    const id = `${session}:${turn}`;
    if (this.turnId === id) return;
    if (this.turnId) throw Error('Previous DSH turn has no terminal boundary');
    this.runtime.beginTurn(id); this.turnId = id;
  }
  ended(session, turn) {
    const id = `${session}:${turn}`;
    this.boundary = this.boundary.then(async () => {
      if (this.turnId !== id || this.closed) return;
      await this.runtime.endTurn(id); this.turnId = null;
    });
    return this.boundary;
  }
  async call(name, args, exec) {
    if (this.closed) throw Error('Minecraft adapter is stopped');
    const requestId = `${this.runtime.journal.run}:${exec.id ?? randomUUID()}`;
    const result = await this.transport.callTool({ name, arguments: args,
      _meta: { [PROTOCOL]: { requestId, ...(this.turnId ? { turnId: this.turnId } : {}) } },
    }, undefined, { signal: exec.signal, timeout: 120000 });
    // Preserve control, task identity, raw receipts and archive references in the durable value.
    const control = result.structuredContent?.control;
    if (control?.barrierAfter) this.runtime.acknowledgeBarrier(control.requestId);
    if (!result.isError && control?.endTurnRequested) exec.concludeTurn();
    return result;
  }
  async stop() {
    this.closed = true;
    await this.runtime.disconnect();
    await this.transport.close();
  }
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
export function retireFacts(session, createMessage) {
  const nodes = [...session.surface.nodes], messages = session.deriveMessages();
  if (nodes.length !== messages.length) throw Error('DSH surface/message cardinality changed');
  let count = 0;
  for (let i = 0; i < messages.length; i++) {
    const source = messages[i].source;
    if (source?.kind !== 'runtime-context' || source.form !== 'snapshot') continue;
    const sections = source.sections ?? [];
    if (!sections.some(s => s.name.startsWith('minecraft:'))) continue;
    const retained = sections.filter(s => !s.name.startsWith('minecraft:'));
    const seq = nodes[i];
    const message = createMessage({ content: [{ type: 'text', text: retained.length
      ? retained.map(s => s.text).join('\n\n') : `旧现场已归档：dsh_history(offset=${seq},limit=1)。以请求末尾的新现场为准。` }],
      source: retained.length ? { ...source, sections: retained }
        : { kind: 'mc-harness-archive', form: 'notice', summary: `Archived snapshot ${seq}` } });
    session.append('user/message', message, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] });
    count++;
  }
  return count;
}

/** Instrument dispatched streams, not assistant attempts that may fail before dispatch. */
export async function* measuredStream(request, next, metrics, model) {
  const id = randomUUID(), start = Date.now(); let ttftMs, usage, reason, outcome = 'unknown';
  const role = request.purpose === 'compaction' ? 'background' : 'system2';
  metrics.report({ kind: 'model', id, phase: 'start', role, model });
  try {
    for await (const chunk of next()) {
      if (chunk.type.endsWith('-delta') && ttftMs === undefined) ttftMs = Date.now() - start;
      if (chunk.type === 'usage') usage = chunk.usage;
      if (chunk.type === 'finish') reason = chunk.reason;
      yield chunk;
    }
    outcome = reason === 'error' ? 'failed' : reason === 'aborted' ? 'cancelled' : reason ? 'success' : 'unknown';
  } catch (error) { outcome = request.signal?.aborted ? 'cancelled' : 'failed'; throw error; }
  finally { metrics.report({ kind: 'model', id, phase: 'finish', role, model, outcome,
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
