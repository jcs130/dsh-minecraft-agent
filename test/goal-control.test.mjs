import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activateConfiguredGoal, applyGoalControl } from '../src/harness-goal.mjs';

function configuredFixture(initial) {
  let goal = initial && structuredClone(initial);
  const calls = [];
  return { calls, get goal() { return goal; },
    ports: { agent: {}, flush: async () => { calls.push('flush'); },
      goals: { get: () => goal,
        clear: (_agent, ref) => { assert.equal(ref.id, goal.id); assert.equal(ref.revision, goal.revision); calls.push('clear'); goal = undefined; },
        create: (_agent, request) => { calls.push('create'); goal = { ...request, id: 'new-goal', revision: 1, phase: 'active', activation: 'armed', roundsStarted: 0 }; return goal; },
        resume: (_agent, ref) => { assert.equal(ref.revision, goal.revision); calls.push('resume'); goal = { ...goal, activation: 'armed', revision: goal.revision + 1 }; return goal; },
      } } };
}

test('a completed different goal cannot occupy the configured objective; replacement is armed, flushed and idempotent', async () => {
  const f = configuredFixture({ id: 'old', revision: 7, objective: '和玩家互动', phase: 'complete', activation: 'disarmed' });
  const config = { goal: ' 自主生存 ', maxGoalRounds: 120 };
  await activateConfiguredGoal(config, f.ports);
  assert.equal(f.goal.objective, '自主生存'); assert.equal(f.goal.phase, 'active'); assert.equal(f.goal.activation, 'armed');
  assert.equal(f.goal.roundsStarted, 0); assert.equal(f.goal.maxGoalRounds, 120);
  await activateConfiguredGoal(config, f.ports);
  assert.deepEqual(f.calls, ['create', 'flush']);
});

test('identical settled tasks and active different tasks are preserved on reconnect', async () => {
  for (const phase of ['complete', 'paused', 'blocked', 'active']) {
    const f = configuredFixture({ id: 'old', revision: 7, objective: phase === 'active' ? '原来的任务' : '自主生存', phase, activation: phase === 'active' ? 'armed' : 'disarmed' });
    const original = structuredClone(f.goal);
    await activateConfiguredGoal({ goal: '自主生存' }, f.ports);
    assert.deepEqual(f.goal, original); assert.deepEqual(f.calls, []);
  }
  const f = configuredFixture({ objective: 'old', phase: 'complete' });
  await activateConfiguredGoal({ goal: '  ' }, f.ports); assert.deepEqual(f.calls, []);
});

test('different owner objectives replace paused/blocked goals through durable native clear without changing the agent', async () => {
  for (const phase of ['paused', 'blocked']) {
    const f = configuredFixture({ id: 'old', revision: 7, objective: '和玩家互动', phase, activation: 'disarmed' });
    const agent = f.ports.agent;
    await activateConfiguredGoal({ goal: '自主生存' }, f.ports);
    assert.equal(f.ports.agent, agent); assert.equal(f.goal.objective, '自主生存'); assert.equal(f.goal.activation, 'armed');
    assert.deepEqual(f.calls, ['clear', 'flush', 'create', 'flush']);
    await activateConfiguredGoal({ goal: '自主生存' }, f.ports);
    assert.deepEqual(f.calls, ['clear', 'flush', 'create', 'flush']);
  }
});

test('invalid budgets and clear persistence failure cannot silently discard a paused goal and create its replacement', async () => {
  for (const maxGoalRounds of [0, -1, 1.5, Infinity]) {
    const f = configuredFixture({ id: 'old', revision: 7, objective: '和玩家互动', phase: 'paused', activation: 'disarmed' });
    await assert.rejects(activateConfiguredGoal({ goal: '自主生存', maxGoalRounds }, f.ports), /budget/);
    assert.deepEqual(f.calls, []); assert.equal(f.goal.id, 'old');
  }
  const f = configuredFixture({ id: 'old', revision: 7, objective: '和玩家互动', phase: 'paused', activation: 'disarmed' });
  f.ports.flush = async () => { throw Error('fixture interruption after clear'); };
  await assert.rejects(activateConfiguredGoal({ goal: '自主生存' }, f.ports), /interruption/);
  assert.deepEqual(f.calls, ['clear']);
  f.ports.flush = async () => {};
  await activateConfiguredGoal({ goal: '自主生存' }, f.ports);
  assert.equal(f.goal.objective, '自主生存'); assert.deepEqual(f.calls, ['clear', 'create']);
});

test('configured creation uses a finite default; a disarmed active goal resumes with its original definition', async () => {
  const fresh = configuredFixture();
  await activateConfiguredGoal({ goal: '自主生存' }, fresh.ports);
  assert.equal(fresh.goal.maxGoalRounds, 40); assert.deepEqual(fresh.calls, ['create', 'flush']);
  const existing = configuredFixture({ id: 'original', revision: 4, objective: '原来的任务', phase: 'active', activation: 'disarmed', roundsStarted: 9, maxGoalRounds: 12 });
  await activateConfiguredGoal({ goal: '自主生存' }, existing.ports);
  assert.equal(existing.goal.objective, '原来的任务'); assert.equal(existing.goal.roundsStarted, 9);
  assert.equal(existing.goal.maxGoalRounds, 12); assert.deepEqual(existing.calls, ['resume', 'flush']);
  await activateConfiguredGoal({ goal: '自主生存' }, existing.ports); assert.deepEqual(existing.calls, ['resume', 'flush']);
});

test('persistence failure is surfaced instead of reporting a successfully activated goal', async () => {
  const f = configuredFixture(); f.ports.flush = async () => { throw Error('fixture write failure'); };
  await assert.rejects(activateConfiguredGoal({ goal: '自主生存' }, f.ports), /write failure/);
});

const command = { id: 'operator-budget-1', action: 'extend-and-resume', goalId: 'original-goal', expectedRevision: 17, maxGoalRounds: 600 };
function fixture({ crashAfterEdit = false, crashAfterResume = false } = {}) {
  let goal = { id: 'original-goal', revision: 17, phase: 'blocked', activation: 'disarmed',
    blockedReason: { code: 'round-limit' }, roundsStarted: 300, maxGoalRounds: 300, objective: 'unchanged original objective' };
  let saved = null, flushes = 0;
  const calls = [];
  return { calls, get goal() { return goal; }, set goal(value) { goal = value; }, get saved() { return saved; },
    ports: { agent: {}, read: () => saved, write: value => { saved = structuredClone(value); },
      flush: async () => { flushes++; if (crashAfterEdit && flushes === 1 || crashAfterResume && flushes === 2) throw Error('fixture interruption'); },
      goals: { get: () => structuredClone(goal),
        edit: (_a, ref, patch) => { assert.equal(ref.revision, goal.revision); calls.push('edit'); goal = { ...goal, ...patch, revision: goal.revision + 1 }; return structuredClone(goal); },
        resume: (_a, ref) => { assert.equal(ref.revision, goal.revision); calls.push('resume'); goal = { ...goal, phase: 'active', activation: 'armed', revision: goal.revision + 1 }; return structuredClone(goal); },
      } } };
}

test('explicit budget extension preserves the exhausted goal, rounds and objective and applies once', async () => {
  const f = fixture();
  assert.equal(await applyGoalControl(command, f.ports), true);
  assert.equal(f.goal.id, command.goalId); assert.equal(f.goal.roundsStarted, 300);
  assert.equal(f.goal.objective, 'unchanged original objective'); assert.equal(f.goal.maxGoalRounds, 600);
  assert.equal(f.goal.phase, 'active'); assert.deepEqual(f.calls, ['edit', 'resume']);
  assert.equal(await applyGoalControl(command, f.ports), false);
  await assert.rejects(applyGoalControl({ ...command, maxGoalRounds: 900 }, f.ports), /reused/);
});

test('prepared command recovers interruption after edit or resume without repeating either mutation', async () => {
  for (const options of [{ crashAfterEdit: true }, { crashAfterResume: true }]) {
    const f = fixture(options);
    await assert.rejects(applyGoalControl(command, f.ports), /interruption/);
    assert.equal(f.saved.phase, 'prepared');
    assert.equal(await applyGoalControl(command, f.ports), true);
    assert.deepEqual(f.calls, ['edit', 'resume']); assert.equal(f.saved.phase, 'applied');
  }
});

test('budget control cannot resume errors, paused/completed/different goals or stale revisions', async () => {
  for (const patch of [{ phase: 'complete' }, { phase: 'paused' }, { blockedReason: { code: 'checkpoint-error' } },
    { id: 'different-goal' }, { revision: 18 }, { roundsStarted: 600 }]) {
    const f = fixture(); f.goal = { ...f.goal, ...patch };
    await assert.rejects(applyGoalControl(command, f.ports)); assert.deepEqual(f.calls, []); assert.equal(f.saved, null);
  }
  const f = fixture();
  assert.equal(await applyGoalControl(undefined, f.ports), false); assert.deepEqual(f.calls, []);
  for (const maxGoalRounds of [0, -1, 300, 1.1, Infinity])
    await assert.rejects(applyGoalControl({ ...command, maxGoalRounds }, f.ports));
});
