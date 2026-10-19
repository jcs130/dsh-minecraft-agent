import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { HarnessBridge, nativeToolContext, mcpResultDecision, retireFacts, retireLiveFacts, renderReceipt, measuredStream, wakeForMinecraftEvents, MinecraftEventInbox } from '../src/harness-bridge.mjs';
const require = createRequire(resolve(process.env.DSH_RUNTIME ?? '.', 'package.json'));
const { Session } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href);
const { createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);

test('real DSH tool pipeline preserves a failed action conclusion and projects ordinary MCP failures as errors', async () => {
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
  const { ToolRuntime } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href);
  const root = new Context(), boundaries = [];
  const bridge = new HarnessBridge({ journal: { run: 'fixture-run' }, beginTurn() {},
    endTurn: async id => boundaries.push(id) }, { callTool: async p => ({ isError: true,
      content: [{ type: 'text', text: 'fixture failure' }], structuredContent: { text: 'fixture failure', failed: true,
        control: { requestId: p._meta['agent-mc/v1'].requestId, endTurnRequested: p.arguments.conclude === true } } }) });
  const prompts = await root.plugin({ name: 'fixture-prompt', apply(ctx) { ctx.provide('systemPrompt', { tools() {} }); } }).await();
  const tools = await root.plugin({ name: 'fixture-tools', inject: ['systemPrompt'], apply(ctx) { new ToolRuntime(ctx); } }).await();
  try {
    root.tools.register({ name: 'mc_fixture', description: 'Offline returned action', parameters: { type: 'object' },
      output: { schema: { type: 'object' }, render: (_args, value) => renderReceipt(value) },
      execute: (args, exec) => bridge.call('mc_fixture', args, nativeToolContext(exec)) });
    root.on('tools/post-execute', mcpResultDecision);
    await bridge.enter('fixture-session', 1, 1);
    const result = await root.tools.execute({ name: 'mc_fixture', arguments: { conclude: true }, callId: 'cast-failure', signal: new AbortController().signal });
    assert.equal(result.concludesTurn, true);
    assert.equal(JSON.parse(result.content[0].text).failed, true);
    assert.equal(JSON.parse(result.content[0].text).isError, true);
    await bridge.ended('fixture-session', 1); await bridge.enter('fixture-session', 2, 1);
    assert.deepEqual(boundaries, ['fixture-session:1']);
    const ordinary = await root.tools.execute({ name: 'mc_fixture', arguments: {}, callId: 'invalid-cursor', signal: new AbortController().signal });
    assert.equal(ordinary.isError, true); assert.equal(ordinary.concludesTurn, undefined);
    assert.equal(JSON.parse(ordinary.content[0].text).failed, true);
  } finally { await tools.dispose(); await prompts.dispose(); }
});

test('native DSH surface replaces stale facts and preserves raw source attribution', () => {
  const session = Session.create('offline');
  const snapshot = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'old health=2' }],
    source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'minecraft:current-facts', text: 'old health=2' }] } }), { surfaceOp: 'append' });
  const permanent = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Permanent player instruction' }] }), { surfaceOp: 'append' });
  assert.equal(retireFacts(session, createUserMessage, [snapshot, permanent]), 1);
  assert.equal(retireFacts(session, createUserMessage, [snapshot, permanent]), 0);
  assert.equal(snapshot.data.content[0].text, 'old health=2');
  assert.equal(session.surface.replaceGeneration, 1);
  assert.equal(session.deriveMessages().some(m => JSON.stringify(m).includes('old health=2')), false);
  assert.ok(JSON.stringify(session.deriveMessages()).includes('dsh_history'));
  assert.ok(JSON.stringify(session.deriveMessages()).includes('Permanent player instruction'));
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'health=20' }],
    source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'minecraft:current-facts', text: 'health=20' }] } }), { surfaceOp: 'append' });
  assert.equal(session.deriveMessages().at(-1).content[0].text, 'health=20');
});

test('resumed surfaces may contain empty nodes without breaking snapshot retirement or replacing the wrong message', () => {
  const session = Session.create('resumed-empty-surface');
  const empty = session.append('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  const facts = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'stale snapshot' }],
    source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'minecraft:current-facts', text: 'stale snapshot' }] } }), { surfaceOp: 'append' });
  const permanent = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'keep this instruction' }] }), { surfaceOp: 'append' });
  assert.notEqual(session.surface.nodes.length, session.deriveMessages().length);
  assert.equal(retireFacts(session, createUserMessage, [empty, facts, permanent]), 1);
  assert.ok(session.surface.nodes.includes(empty.seq));
  assert.ok(session.surface.nodes.includes(permanent.seq));
  assert.ok(JSON.stringify(session.deriveMessages()).includes('keep this instruction'));
  assert.equal(JSON.stringify(session.deriveMessages()).includes('stale snapshot'), false);
});

test('MCP renderer does not repeat receipt; durable result is unchanged', () => {
  const value = { content: [{ type: 'text', text: 'original receipt' }], structuredContent: {
    text: 'original receipt', control: { requestId: 'x' }, execution: { phase: 'accepted', goalCompleted: false } } };
  assert.equal((JSON.stringify(renderReceipt(value)).match(/original receipt/g) ?? []).length, 1);
  assert.equal(value.content[0].text, 'original receipt');
  assert.equal(value.structuredContent.execution.goalCompleted, false);
});

test('live observation retires only current owned snapshots without reading archived payloads', async () => {
  const session = Session.create('live-snapshot');
  const archive = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'archived payload' }] }), { surfaceOp: 'append' });
  const replacement = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'archive reference' }] }),
    { surfaceOp: { op: 'replace', startSeq: archive.seq, endSeq: archive.seq }, sourceEventSeqs: [archive.seq] });
  const facts = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'old game facts\nother context' }],
    source: { kind: 'runtime-context', form: 'snapshot', sections: [
      { name: 'minecraft:current-facts', text: 'old game facts' }, { name: 'other:context', text: 'other context' }] } }), { surfaceOp: 'append' });
  const permanent = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'permanent instruction' }] }), { surfaceOp: 'append' });
  let disposed = 0;
  const events = [null, replacement, facts, permanent];
  Object.defineProperty(events, 0, { get() { assert.fail('Archived payload must not be inspected or cloned'); } });
  const controller = new AbortController();
  const query = { async observeSession(id, options) {
    assert.equal(id, session.id); assert.equal(options.projectionMode, 'none'); assert.equal(options.signal, controller.signal);
    return { source: 'live', header: session.header, cursor: permanent.seq, events, [Symbol.dispose]() { disposed++; } };
  }, readSurface() { assert.fail('Full history clone/replay must not be used'); } };
  assert.equal(await retireLiveFacts(session, createUserMessage, query, controller.signal), 1);
  assert.equal(disposed, 1);
  const visible = JSON.stringify(session.deriveMessages());
  assert.equal(visible.includes('old game facts'), false);
  assert.ok(visible.includes('other context')); assert.ok(visible.includes('permanent instruction'));
  assert.equal(facts.data.source.sections[0].text, 'old game facts');
});

test('live facts observation is released on cancellation, invalid owner and stale cuts', async () => {
  for (const mode of ['cancelled', 'wrong-session', 'cold', 'missing-event', 'concurrent-append']) {
    const session = Session.create('cut-' + mode), events = [];
    const first = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'first' }] }), { surfaceOp: 'append' });
    events.push(first);
    let disposed = 0; const controller = new AbortController();
    const query = { async observeSession() {
      if (mode === 'cancelled') controller.abort(Error('cancelled'));
      if (mode === 'concurrent-append') session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'new snapshot' }],
        source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'minecraft:events', text: 'new snapshot' }] } }), { surfaceOp: 'append' });
      return { source: mode === 'cold' ? 'prepared' : 'live', header: { ...session.header, id: mode === 'wrong-session' ? 'other' : session.id },
        cursor: first.seq, events: mode === 'missing-event' ? [] : events, [Symbol.dispose]() { disposed++; } };
    } };
    if (mode === 'concurrent-append') {
      assert.equal(await retireLiveFacts(session, createUserMessage, query, controller.signal), 0);
      assert.ok(JSON.stringify(session.deriveMessages()).includes('new snapshot'));
    } else await assert.rejects(retireLiveFacts(session, createUserMessage, query, controller.signal));
    assert.equal(disposed, 1);
  }
});

test('native session query observation preserves the retirement contract', async () => {
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
  const { SessionQueryEngine } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-query')).href);
  const session = Session.create('native-live-query');
  const fact = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'archived game facts' }],
    source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'minecraft:current-facts', text: 'archived game facts' }] } }), { surfaceOp: 'append' });
  const root = new Context();
  const sessions = await root.plugin({ name: 'fixture-sessions', apply(ctx) { ctx.provide('sessions', { get: id => id === session.id ? session : undefined }); } }).await();
  const queries = await root.plugin({ name: 'fixture-queries', inject: ['sessions'], apply(ctx) { new SessionQueryEngine(ctx); } }).await();
  try {
    const query = root.get('sessionQuery');
    assert.equal(await retireLiveFacts(session, createUserMessage, query), 1);
    const surface = await query.readSurface(session.id);
    assert.deepEqual(surface.events.map(event => event.seq), [...session.surface.nodes]);
    assert.equal(surface.events[0].sourceEventSeqs[0], fact.seq);
    assert.equal(await retireLiveFacts(session, createUserMessage, query), 0);
    assert.equal(fact.data.content[0].text, 'archived game facts');
  } finally { await queries.dispose(); await sessions.dispose(); }
});

test('actual stream metrics retain cache counts, cancellation and background role', async () => {
  const records = [], metrics = { report: item => records.push(item) };
  const next = async function* () { yield { type: 'text-delta', text: 'ok' };
    yield { type: 'usage', usage: { inputTokens: 20, cacheReadTokens: 80, outputTokens: 5 } }; yield { type: 'finish', reason: 'stop' }; };
  for await (const _ of measuredStream({ purpose: 'compaction' }, next, metrics, 'same-model')) {}
  assert.equal(records[1].inputTokens, 100); assert.equal(records[1].cachedTokens, 80);
  assert.equal(records[1].role, 'background'); assert.equal(records[1].outcome, 'success');
  const ctrl = new AbortController(); ctrl.abort();
  await assert.rejects(async () => { for await (const _ of measuredStream({ signal: ctrl.signal }, async function* () { throw Error('abort'); }, metrics, 'same-model')) {} });
  assert.equal(records.at(-1).outcome, 'cancelled');
});

test('stream metadata reports requested thinking-off without claiming an engine execution time', async () => {
  for (const reasoningEffort of ['off', 'low', undefined, 'max']) {
    const records = [];
    for await (const _ of measuredStream({ reasoningEffort }, async function* () {
      yield { type: 'finish', reason: 'stop' };
    }, { report: value => records.push(value) }, 'flash')) {}
    assert.equal(records[0].effort, reasoningEffort === 'off' ? 'none' : reasoningEffort === 'low' ? 'low' : undefined);
    assert.equal(records[1].effort, records[0].effort);
    assert.equal(records[1].inputTokens, undefined);
    assert.equal(records[1].executionMs, undefined);
    assert.equal(records[1].reasoningTokens, undefined);
    assert.equal(typeof records[1].elapsedMs, 'number');
  }
});

test('native DSH structured finish reasons retain failure and cancellation', async () => {
  for (const [kind, expected] of [['error', 'failed'], ['aborted', 'cancelled'], ['stop', 'success']]) {
    const records = [];
    for await (const _ of measuredStream({}, async function* () { yield { type: 'finish', reason: { kind } }; },
      { report: x => records.push(x) }, 'deepseek-flash')) {}
    assert.equal(records.at(-1).outcome, expected);
  }
});

test('completed goal keeps the event inbox alive without granting human or goal-resume authority', () => {
  const session = Session.create('event-wakeup');
  const goal = Object.freeze({ id: 'original-goal', revision: 5, phase: 'complete', activation: 'disarmed' });
  let wakes = 0;
  const agent = { status: 'idle', steer(message) {
    wakes++;
    session.append('user/message', message, { surfaceOp: 'append' });
  } };
  assert.equal(wakeForMinecraftEvents(agent, goal, false,
    [{ type: 'mymc.chat', cursor: 263, senderKey: 'companion' }], createUserMessage), true);
  const message = session.deriveMessages().at(-1);
  assert.equal(wakes, 1);
  assert.equal(message.source.kind, 'mc-harness');
  assert.equal(message.source.form, 'notice');
  assert.match(message.content[0].text, /1 条新事件/);
  assert.deepEqual(goal, { id: 'original-goal', revision: 5, phase: 'complete', activation: 'disarmed' });
  assert.equal(wakeForMinecraftEvents(agent, goal, false, [], createUserMessage), false);
  assert.equal(wakes, 1);
});

test('operator stop and suspended goals cannot be awakened by game events', () => {
  const agent = { status: 'idle', steer() { assert.fail('Stopped agent must not wake'); } };
  const events = [{ type: 'mymc.chat' }, { type: 'mymc.damage' }];
  assert.equal(wakeForMinecraftEvents(agent, { phase: 'complete', activation: 'disarmed' }, true, events, createUserMessage), false);
  for (const phase of ['active', 'paused', 'blocked'])
    assert.equal(wakeForMinecraftEvents(agent, { phase, activation: 'disarmed' }, false, events, createUserMessage), false);
});

test('event notices retain the existing idle-only behavior during a live model turn', () => {
  let wakes = 0;
  const agent = { status: 'running', steer() { wakes++; } }, events = [{ type: 'mymc.chat' }];
  assert.equal(wakeForMinecraftEvents(agent, { phase: 'active', activation: 'armed' }, false, events, createUserMessage), false);
  agent.status = 'idle';
  assert.equal(wakeForMinecraftEvents(agent, { phase: 'active', activation: 'armed' }, false, events, createUserMessage), true);
  assert.equal(wakeForMinecraftEvents(agent, undefined, false, events, createUserMessage), true);
  assert.equal(wakes, 2);
});

test('busy-turn events wake exactly once after idle, even when the next poll is empty', () => {
  const inbox = new MinecraftEventInbox(); let wakes = 0;
  const agent = { status: 'running', steer() { wakes++; } };
  const goal = { phase: 'complete', activation: 'disarmed' };
  inbox.add([{ type: 'mymc.chat', cursor: 20 }]);
  assert.equal(inbox.flush(agent, goal, false, createUserMessage), false);
  inbox.add([]); agent.status = 'idle';
  assert.equal(inbox.flush(agent, goal, false, createUserMessage), true);
  assert.equal(inbox.flush(agent, goal, false, createUserMessage), false);
  assert.equal(wakes, 1);
  inbox.add([{ type: 'mymc.chat', cursor: 21 }]);
  assert.equal(inbox.flush(agent, goal, true, createUserMessage), false);
  assert.equal(inbox.flush(agent, goal, false, createUserMessage), false);
  assert.equal(wakes, 1);
});
