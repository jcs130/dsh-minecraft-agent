import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAX_GOAL_CALLS, GoalProgressGuard, MovementProgressFallback, survivalHint, withNotice } from '../src/harness-budget.mjs';
import { MovementProgress } from 'agent-mc-world/client';

test('finite calls use the expanded budget while explicit zero remains unbounded', () => {
  assert.equal(DEFAULT_MAX_GOAL_CALLS, 80);
  const goal = { id: 'build', phase: 'active' };
  const finite = new GoalProgressGuard({ progress: new MovementProgressFallback() });
  for (let i = 0; i < 80; i++) assert.equal(finite.step(goal), null);
  assert.match(finite.step(goal), /call budget \(80\)/);
  const continuous = new GoalProgressGuard({ progress: new MovementProgressFallback(), maxCalls: 0 });
  for (let i = 0; i < 160; i++) assert.equal(continuous.step(goal), null);
});

test('stationary control requests do not erase repeated-action evidence', () => {
  const guard = new GoalProgressGuard({ progress: new MovementProgress({ window: 3 }), closeAfter: 5 });
  const goal = { id: 'explore', phase: 'active' };
  const action = [{ skill: 'control', keys: ['sneak', 'jump'], durationMs: 250 }];
  assert.deepEqual(guard.action(goal, action), {});
  assert.deepEqual(guard.action(goal, action), {});
  const notice = guard.action(goal, action).notice;
  assert.match(notice, /控制请求/);
  assert.match(notice, /不算完成/);
  guard.action(goal, action);
  assert.match(guard.action(goal, action).close, /control-only/);
  assert.deepEqual(guard.action(goal, [{ skill: 'craft', item: 'oak_planks' }]), {});
});

test('core directional and swimming control remain unknown motion, not a host stall', () => {
  for (const step of [{skill:'control', keys:['forward']}, {skill:'control', mode:'swim', keys:['jump']}]) {
    const guard = new GoalProgressGuard({progress:new MovementProgress({window:3}), closeAfter:5});
    for(let i=0;i<8;i++) assert.deepEqual(guard.action({id:'travel',phase:'active'},[step]),{});
  }
});

test('hunger advice keeps queued execution identity and failure state unchanged', () => {
  const control = { requestId: 'run:craft', barrierAfter: true, endTurnRequested: true };
  const execution = { id: 'task-7', run: 'run', phase: 'accepted', terminal: false, goalCompleted: false };
  const queued = { content: [{ type: 'text', text: 'queued' }], structuredContent: { control, execution, hostNotice: 'existing notice' } };
  const result = withNotice(queued, survivalHint({ observation: { food: 10 } }));
  assert.equal(result.structuredContent.control, control);
  assert.equal(result.structuredContent.execution, execution);
  assert.equal(result.structuredContent.execution.terminal, false);
  assert.equal(result.structuredContent.execution.goalCompleted, false);
  assert.match(result.structuredContent.hostNotice, /^existing notice\n/);
  assert.match(result.structuredContent.hostNotice, /不阻止正在执行/);
  const failed = withNotice({ ...queued, isError: true }, survivalHint({ food: 8 }));
  assert.equal(failed.isError, true);
  assert.equal(queued.structuredContent.hostNotice, 'existing notice');
});

test('hunger hints keep missing/nonfinite facts unknown and honor disable/threshold', () => {
  for (const food of [undefined, null, '10', NaN, Infinity, 15, 20]) assert.equal(survivalHint({ food }), undefined);
  assert.equal(survivalHint({ food: 10 }, { foodThreshold: 0 }), undefined);
  assert.equal(survivalHint({ food: 10 }, { foodThreshold: 8 }), undefined);
  assert.equal(survivalHint({ food: 10 }, { foodThreshold: Infinity }), undefined);
  assert.match(survivalHint({ food: 10 }), /饥饿 10\/20/);
});
