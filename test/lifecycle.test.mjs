import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { HostLifecycle, failureMetadata } from '../src/harness-lifecycle.mjs';

function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mc-lifecycle-'));
  try {
    const options = { stateFile: join(dir, 'state.json'), eventsFile: join(dir, 'events.ndjson'), sessionId: 'owned-session',
      clock: () => '2026-10-19T07:00:00.000Z' };
    run(options);
  } finally {
    assert.equal(dirname(dir), resolve(tmpdir())); assert.match(dir.split(/[\\/]/).at(-1), /^dsh-mc-lifecycle-/);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('online active but disarmed goals are not reported as continuing play', () => fixture(options => {
  const lifecycle = new HostLifecycle(options);
  const goal = { id: 'g', phase: 'active', activation: 'disarmed' };
  assert.equal(lifecycle.snapshot({ state: 'idle', goal }).continuation, 'disarmed');
  assert.equal(lifecycle.snapshot({ state: 'running', goal }).continuation, 'disarmed');
  goal.activation = 'armed';
  assert.equal(lifecycle.snapshot({ state: 'idle', goal }).continuation, 'waiting');
  assert.equal(lifecycle.snapshot({ state: 'running', goal }).continuation, 'running');
  assert.equal(lifecycle.snapshot({ paused: true, state: 'running', goal }).continuation, 'paused');
  assert.equal(lifecycle.snapshot({ stopped: true, goal }).continuation, 'stopped');
  assert.equal(goal.activation, 'armed');
}));

test('stop metadata survives resume without persisting arbitrary error, goal or conversation text', () => fixture(options => {
  const lifecycle = new HostLifecycle(options);
  const secret = 'SECRET-PROMPT-RESPONSE-TOKEN';
  const cause = new Error('Allocation error : not enough memory ' + secret); cause.cause = cause;
  const error = new Error('DeepSeek request extension preparation failed ' + secret, { cause });
  error.name = 'LlmError'; error.code = 'REQUEST_EXTENSION'; error.stack = secret;
  lifecycle.failed('agent', error, { turn: 2, step: 1, content: secret });
  lifecycle.ended(2, { kind: 'max-tokens', text: secret });
  lifecycle.activation({ id: 'goal-1', revision: 2, activation: 'disarmed', objective: secret });
  const disk = readFileSync(options.eventsFile, 'utf8') + readFileSync(options.stateFile, 'utf8');
  assert.equal(disk.includes(secret), false);
  const resumed = new HostLifecycle(options), snapshot = resumed.snapshot({ state: 'idle' });
  assert.deepEqual(snapshot.lastFailure.categories, ['allocation', 'request-extension']);
  assert.equal(snapshot.lastFailure.code, 'REQUEST_EXTENSION');
  assert.equal(snapshot.lastTurn.reason, 'max-tokens');
  assert.equal(snapshot.lastFailure.turn, 2);
  assert.equal(new HostLifecycle({ ...options, sessionId: 'different-session' }).lastFailure, null);
}));

test('metadata storage failure cannot stop the agent; restored metadata is projected and classified', () => fixture(options => {
  const lifecycle = new HostLifecycle({ ...options, stateFile: join(options.stateFile, 'missing'), eventsFile: join(options.eventsFile, 'missing') });
  assert.doesNotThrow(() => lifecycle.failed('boundary', Error('pending calls')));
  assert.equal(lifecycle.snapshot({}).lastFailure.stage, 'boundary');
  writeFileSync(options.stateFile, JSON.stringify({ schema: 'dsh-mc-lifecycle/v1', sessionId: options.sessionId,
    lastFailure: { stage: 'agent', message: 'PRIVATE', categories: ['allocation', 'PRIVATE'], code: 'raw private text' },
    lastTurn: { turn: 1, reason: 'PRIVATE', content: 'PRIVATE' } }));
  const restored = JSON.stringify(new HostLifecycle(options).snapshot({}));
  assert.equal(restored.includes('PRIVATE'), false);
  assert.equal(failureMetadata(undefined).code, null);
}));
