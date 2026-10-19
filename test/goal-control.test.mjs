import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGoalControl } from '../src/harness-goal.mjs';

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
