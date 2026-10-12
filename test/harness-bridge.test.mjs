import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarnessBridge, normalizeUsage, abortableDelay } from '../src/harness-bridge.mjs';

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

test('DSH disjoint input and cache counters convert without losing billed tokens', () => {
  assert.deepEqual(normalizeUsage({ inputTokens: 100, outputTokens: 25, cacheReadTokens: 80, cacheWriteTokens: 20 }),
    { inputTokens: 200, outputTokens: 25, cachedTokens: 80 });
  assert.deepEqual(normalizeUsage(undefined), {});
});
