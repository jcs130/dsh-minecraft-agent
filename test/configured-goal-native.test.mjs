import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { activateConfiguredGoal, settleHostGoal } from '../src/harness-goal.mjs';
const require = createRequire(resolve(process.env.DSH_RUNTIME ?? '.', 'package.json'));
const load = async name => import(pathToFileURL(require.resolve(name)).href);

test('official DSH replaces the completed goal, resumes from its real journal and retains both goal histories', async () => {
  const [{ Context }, { SessionStore }, { SessionProjectionRegistry }, { GoalService }] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-session'), load('@deepseek-ai/dsh-session-projection'), load('@deepseek-ai/dsh-goal')]);
  const root = new Context(), agents = new Map();
  const services = await root.plugin({ name: 'fixture-native-services', apply(ctx) {
    ctx.provide('agents', { get: id => agents.get(id) });
    new SessionStore(ctx); new SessionProjectionRegistry(ctx);
  } }).await();
  const goalPlugin = await root.plugin(GoalService).await();
  const live = await root.plugin({ name: 'fixture-native-owner', inject: ['sessions', 'goals'], async apply(ctx) {
    const session = ctx.sessions.create('configured-goal-history'), agent = { id: 'fixture-agent', session };
    agents.set(agent.id, agent);
    const original = ctx.goals.create(agent, { objective: '和玩家互动', maxGoalRounds: 40 });
    ctx.goals.complete(agent, { id: original.id, revision: original.revision });
    assert.equal(ctx.goals.get(agent).phase, 'complete');
    const flushed = [];
    const ports = { goals: ctx.goals, agent, flush: async () => { flushed.push(structuredClone(session.log)); } };
    const next = await activateConfiguredGoal({ goal: '自主生存', maxGoalRounds: 80 }, ports);
    assert.notEqual(next.id, original.id); assert.equal(next.phase, 'active'); assert.equal(next.activation, 'armed');
    assert.equal(next.roundsStarted, 0); assert.equal(flushed.length, 1);
    const changes = session.log.filter(event => event.type === 'goal/change');
    assert.deepEqual(changes.map(event => event.data.operation), ['create', 'complete', 'create']);
    assert.equal(changes[0].data.goal.objective, '和玩家互动');
    // Native restore replays the flushed journal; activation starts disarmed.
    const restored = ctx.sessions.create('restored-configured-goal', { seed: flushed[0] });
    const recovered = { id: 'fixture-restored-agent', session: restored }; agents.set(recovered.id, recovered);
    assert.equal(ctx.goals.get(recovered).activation, 'disarmed');
    await activateConfiguredGoal({ goal: '自主生存' }, { ...ports, agent: recovered, flush: async () => {} });
    assert.equal(ctx.goals.get(recovered).id, next.id); assert.equal(ctx.goals.get(recovered).activation, 'armed');
    const current = ctx.goals.get(recovered); ctx.goals.complete(recovered, { id: current.id, revision: current.revision });
    const count = restored.log.length;
    await activateConfiguredGoal({ goal: '自主生存' }, { ...ports, agent: recovered, flush: async () => assert.fail('Completed identical goal must stay complete') });
    assert.equal(restored.log.length, count); assert.equal(ctx.goals.get(recovered).phase, 'complete');
    // The native create API rejects paused/blocked goals: use its journalled
    // clear transition before replacing an explicitly different owner goal.
    for (const phase of ['paused', 'blocked']) {
      const previous = ctx.goals.create(recovered, { objective: '旧的' + phase + '任务' });
      const ref = { id: previous.id, revision: previous.revision };
      if (phase === 'paused') ctx.goals.pause(recovered, ref);
      else ctx.goals.block(recovered, ref, { code: 'fixture-blocked', message: 'Offline fixture' });
      assert.throws(() => ctx.goals.create(recovered, { objective: '自主生存' }), /already exists/);
      const before = restored.log.length;
      const replaced = await activateConfiguredGoal({ goal: '自主生存' }, { ...ports, agent: recovered, flush: async () => {} });
      assert.equal(recovered.session, restored); assert.equal(replaced.phase, 'active'); assert.equal(replaced.activation, 'armed');
      assert.deepEqual(restored.log.slice(before).map(event => event.data.operation), ['clear', 'create']);
      ctx.goals.complete(recovered, { id: replaced.id, revision: replaced.revision });
    }
    const guarded = ctx.goals.create(recovered, { objective: 'Unfinished budget fixture', maxGoalRounds: 40 });
    const stop = () => settleHostGoal('per-goal call budget used up', 'pause', { goals: ctx.goals, agent: recovered });
    stop(); assert.equal(ctx.goals.get(recovered).phase, 'paused'); assert.equal(ctx.goals.get(recovered).id, guarded.id);
    const stoppedCount = restored.log.length; stop(); assert.equal(restored.log.length, stoppedCount);
    assert.equal(restored.log.at(-1).data.operation, 'pause');
  } }).await();
  try { assert.ok(live); } finally { await live.dispose(); await goalPlugin.dispose(); await services.dispose(); }
});
