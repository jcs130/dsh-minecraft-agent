import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarnessBridge, mcpResultDecision, normalizeUsage, abortableDelay, deliverOperatorRequest, agentModelOptions, compactionOptions, modelToolSchema } from '../src/harness-bridge.mjs';

test('multiple RPCs stay in the same DSH turn; accepted task is not completion', async () => {
  const calls = [];
  const runtime = { journal: { run: 'run' }, beginTurn: id => calls.push(['begin', id]),
    endTurn: async id => calls.push(['end', id]), acknowledgeBarrier: id => calls.push(['ack', id]) };
  const transport = { callTool: async params => ({ structuredContent: { execution: { id: 't1', phase: 'accepted', goalCompleted: false },
    control: { requestId: params._meta['agent-mc/v1'].requestId, barrierAfter: true, endTurnRequested: true } } }) };
  const bridge = new HarnessBridge(runtime, transport);
  let conclusions = 0;
  await bridge.enter('session', 1);
  const value = await bridge.call('mc_task', {}, { id: 'call1', concludeTurn: () => conclusions++ });
  assert.equal(value.structuredContent.execution.phase, 'accepted');
  assert.equal(value.structuredContent.execution.goalCompleted, false);
  assert.equal(conclusions, 1);
  assert.deepEqual(calls.map(c => c[0]), ['begin', 'ack']);
  await bridge.enter('session', 1);
  assert.deepEqual(calls.map(c => c[0]), ['begin', 'ack']);
  await bridge.ended('session', 1);
  await bridge.enter('session', 2);
  assert.deepEqual(calls.map(c => c[0]), ['begin', 'ack', 'end', 'begin']);
});

test('cancellation is forwarded and stop cannot reopen a turn', async () => {
  const ctrl = new AbortController(); let signal;
  const runtime = { journal: { run: 'r' }, disconnect: async () => {}, beginTurn: () => {} };
  const bridge = new HarnessBridge(runtime, { callTool: async (_p, _s, opts) => {
    signal = opts.signal; await abortableDelay(30000, signal);
  }, close: async () => {} });
  const pending = bridge.call('mc_events', {}, { signal: ctrl.signal });
  ctrl.abort(Error('cancelled'));
  await assert.rejects(pending, /cancelled/); assert.equal(signal, ctrl.signal);
  await bridge.stop(); await assert.rejects(bridge.enter('s', 1), /stopped/);
});

test('failed action control still concludes the native turn before another planner request', async () => {
  let concludes = 0, ends = 0, acknowledgements = 0;
  const value = { isError: true, structuredContent: { failed: true, text: 'cooldown',
    control: { requestId: 'run:cast', barrierAfter: true, endTurnRequested: true } } };
  const bridge = new HarnessBridge({ journal: { run: 'run' }, beginTurn() {},
    acknowledgeBarrier: () => acknowledgements++, endTurn: async () => ends++ }, { callTool: async () => value });
  await bridge.enter('original-session', 1, 1);
  assert.equal(await bridge.call('mc_cast', {}, { id: 'cast', concludeTurn: () => concludes++ }), value);
  assert.equal(concludes, 1); assert.equal(acknowledgements, 1); assert.equal(ends, 0);
  await bridge.ended('original-session', 1); await bridge.enter('original-session', 2, 1);
  assert.equal(ends, 1);
});

test('native error projection preserves original MCP receipts without stripping a requested conclusion', async () => {
  const value = { isError: true, content: [{ type: 'text', text: 'invalid event cursor' }],
    structuredContent: { failed: true, text: 'invalid event cursor', meta: { code: 'EVENT_RUN_REQUIRED' } } };
  let accepted = 0;
  const next = async () => { accepted++; return { kind: 'accept' }; };
  const decision = await mcpResultDecision({}, { isError: false, value }, next);
  assert.equal(decision.kind, 'block'); assert.equal(accepted, 0);
  assert.equal(JSON.parse(decision.feedback[0].text).meta.code, 'EVENT_RUN_REQUIRED');
  value.structuredContent.control = { endTurnRequested: true };
  assert.deepEqual(await mcpResultDecision({}, { isError: false, value }, next), { kind: 'accept' });
  assert.equal(accepted, 1); assert.equal(value.isError, true);
});

test('DSH disjoint input and cache counters convert without losing billed tokens', () => {
  assert.deepEqual(normalizeUsage({ inputTokens: 100, outputTokens: 25, cacheReadTokens: 80, cacheWriteTokens: 20 }),
    { inputTokens: 200, outputTokens: 25, cachedTokens: 80 });
  assert.deepEqual(normalizeUsage(undefined), {});
});

test('operator follow-up is remembered only after durable flush and is not replayed on restart', async () => {
  let last = null; const calls = [];
  const delivery = { lastId: () => last, prepare: () => calls.push(['prepare']), steer: r => calls.push(['steer', r.id]),
    flush: async () => calls.push(['flush']), remember: id => { calls.push(['remember']); last = id; } };
  const request = { id: 'operator-1', text: 'Continue the authorized test' };
  assert.equal(await deliverOperatorRequest(request, delivery), true);
  assert.equal(await deliverOperatorRequest(request, delivery), false);
  assert.deepEqual(calls.map(c => c[0]), ['prepare', 'steer', 'flush', 'remember']);
  await assert.rejects(deliverOperatorRequest({ ...request, id: 'operator-2' }, { ...delivery, flush: async () => { throw Error('disk'); } }), /disk/);
  assert.equal(last, 'operator-1');
});

test('native model options preserve an explicit thinking choice on creation and resumption', () => {
  const config = { provider: 'official', model: 'deepseek-v4-flash', maxTokens: 2000 };
  assert.deepEqual(agentModelOptions(config), config);
  for (const reasoningEffort of ['off', 'low', 'high', 'max'])
    assert.deepEqual(agentModelOptions({ ...config, reasoningEffort }), { ...config, reasoningEffort });
  for (const reasoningEffort of ['', ' ', null, false])
    assert.throws(() => agentModelOptions({ ...config, reasoningEffort }), /reasoningEffort/);
});

test('MCP attributes actual DSH session and step without inventing a learned policy', async () => {
  const calls = [];
  const bridge = new HarnessBridge({ journal: { run: 'body-run' }, beginTurn() {}, async endTurn() {} },
    { async callTool(params) { calls.push(params); return {}; } });
  await bridge.enter('persistent-session', 3, 0);
  await bridge.call('mc_action', {}, { id: 'tool-a' });
  await bridge.enter('persistent-session', 3, 1);
  await bridge.call('mc_action', {}, { id: 'tool-b' });
  await assert.rejects(bridge.enter('wrong-session', 4, 0), /terminal boundary/);
  await bridge.call('mc_action', {}, { id: 'tool-c' });
  const meta = calls.map(c => c._meta['agent-mc/v1']);
  assert.deepEqual(meta[0], { requestId: 'body-run:tool-a', turnId: 'persistent-session:3',
    attribution: { controller: 'system2', sessionId: 'persistent-session', decisionId: 'persistent-session:3:0' } });
  assert.equal(meta[1].attribution.decisionId, 'persistent-session:3:1');
  assert.deepEqual(meta[2].attribution, meta[1].attribution);
  assert.equal(meta[0].attribution.policy, undefined);
  await bridge.ended('persistent-session', 3);
  await bridge.call('mc_status', {}, { id: 'outside-turn' });
  assert.equal(calls.at(-1)._meta['agent-mc/v1'].attribution, undefined);
});

test('explicit compaction route survives model migration without silently reusing the old route', () => {
  const options = compactionOptions({ maxTokens: 2000, compaction: { retainTokens: 16000, maxTokens: 6000,
    summarizationProvider: 'deepseek-official', summarizationModel: 'deepseek-v4-flash' } });
  assert.equal(options.summarizationProvider, 'deepseek-official');
  assert.equal(options.summarizationModel, 'deepseek-v4-flash');
  assert.equal(options.retainTokens, 16000); assert.equal(options.maxTokens, 6000);
  assert.equal(compactionOptions({}).summarizationProvider, undefined);
  assert.throws(() => compactionOptions({ compaction: { summarizationProvider: 'official' } }), /together/);
  assert.throws(() => compactionOptions({ compaction: { summarizationModel: 'flash' } }), /together/);
});

test('model schema translation preserves tuple limits and leaves examples and source untouched', () => {
  const schema = { type: 'object', properties: { angles: { type: 'array', minItems: 3,
    items: [{ type: 'number', minimum: -90, maximum: 90 }, { type: 'number' }, { type: 'number', exclusiveMinimum: 0 }],
    additionalItems: false } }, examples: [{ items: ['literal', 'data'] }] };
  const translated = modelToolSchema(schema);
  assert.equal(translated.properties.angles.maxItems, 3);
  assert.deepEqual(translated.properties.angles.prefixItems, schema.properties.angles.items);
  assert.deepEqual(translated.properties.angles.items, {});
  assert.equal(translated.properties.angles.additionalItems, undefined);
  assert.deepEqual(translated.examples, schema.examples);
  assert.equal(Array.isArray(schema.properties.angles.items), true);
});
