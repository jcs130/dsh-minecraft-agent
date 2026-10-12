import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { retireFacts, renderReceipt, measuredStream } from '../src/harness-bridge.mjs';
const require = createRequire(resolve(process.env.DSH_RUNTIME ?? '.', 'package.json'));
const { Session } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href);
const { createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);

test('native DSH surface replaces stale facts and preserves raw source attribution', () => {
  const session = Session.create('offline');
  const snapshot = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'old health=2' }],
    source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'minecraft:current-facts', text: 'old health=2' }] } }), { surfaceOp: 'append' });
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Permanent player instruction' }] }), { surfaceOp: 'append' });
  assert.equal(retireFacts(session, createUserMessage), 1);
  assert.equal(retireFacts(session, createUserMessage), 0);
  assert.equal(snapshot.data.content[0].text, 'old health=2');
  assert.equal(session.surface.replaceGeneration, 1);
  assert.equal(session.deriveMessages().some(m => JSON.stringify(m).includes('old health=2')), false);
  assert.ok(JSON.stringify(session.deriveMessages()).includes('dsh_history'));
  assert.ok(JSON.stringify(session.deriveMessages()).includes('Permanent player instruction'));
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'health=20' }],
    source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'minecraft:current-facts', text: 'health=20' }] } }), { surfaceOp: 'append' });
  assert.equal(session.deriveMessages().at(-1).content[0].text, 'health=20');
});

test('MCP renderer does not repeat receipt; durable result is unchanged', () => {
  const value = { content: [{ type: 'text', text: 'original receipt' }], structuredContent: {
    text: 'original receipt', control: { requestId: 'x' }, execution: { phase: 'accepted', goalCompleted: false } } };
  assert.equal((JSON.stringify(renderReceipt(value)).match(/original receipt/g) ?? []).length, 1);
  assert.equal(value.content[0].text, 'original receipt');
  assert.equal(value.structuredContent.execution.goalCompleted, false);
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
