import { nativeGoalRounds } from './harness-autonomy.mjs';

/** Apply the owner's configured objective at an explicit activation boundary.
 * Settled goals remain in the native journal: only a different owner-configured
 * objective replaces them. Never reopen the same settled task or replace an
 * active goal. This must not run from the event poll or model tool callbacks.
 */
export async function activateConfiguredGoal(config, { goals, agent, flush }) {
  const goal = goals.get(agent);
  const objective = config.goal?.trim();
  const settled = goal && ['complete', 'blocked', 'paused'].includes(goal.phase);
  if (objective && (!goal || settled && goal.objective.trim() !== objective)) {
    const maxGoalRounds = nativeGoalRounds(config);
    if (!Number.isSafeInteger(maxGoalRounds) || maxGoalRounds < 1) throw Error('Invalid configured goal round budget');
    // Native DSH only permits create over complete. An explicitly different
    // owner objective may replace a pause/block through its durable clear API.
    if (goal && goal.phase !== 'complete') {
      goals.clear(agent, { id: goal.id, revision: goal.revision });
      await flush();
    }
    const created = goals.create(agent, { objective, maxGoalRounds });
    await flush();
    return created;
  }
  if (goal?.phase === 'active' && goal.activation !== 'armed') {
    const resumed = goals.resume(agent, { id: goal.id, revision: goal.revision });
    await flush();
    return resumed;
  }
  return goal;
}

/** An owner follow-up may reuse the identical active goal created at activation. */
export function prepareOperatorGoal(request, config, { goals, agent }) {
  if (!request.goal) return;
  const current = goals.get(agent);
  if (current?.phase === 'active' && current.objective.trim() === request.goal.trim()) return current;
  if (current && current.phase !== 'complete') throw Error('Finish or explicitly handle the current goal before adding an operator goal');
  return goals.create(agent, { objective: request.goal, maxGoalRounds: nativeGoalRounds(config) });
}

/** A host budget is a pause, not evidence that the owner's objective succeeded. */
export function settleHostGoal(reason, disposition, { goals, agent }) {
  const goal = goals.get(agent);
  if (!reason || !goal || goal.phase === 'complete') return goal;
  const ref = { id: goal.id, revision: goal.revision };
  if (disposition === 'complete') return goals.complete(agent, ref);
  if (goal.phase === 'active') return goals.pause(agent, ref);
  return goal;
}

/** A settled native goal gets one closing response, never another autonomous tool loop.
 * New human input or a new goal/turn remains eligible; the native reject boundary
 * parks unadmitted inbox items rather than deleting them. No body task is cancelled.
 */
export class GoalWrapUp {
  closing = null;
  stats = { closingSteps: 0, blockedTools: 0, rejectedSteps: 0 };
  close(turn, goal) {
    if (!Number.isSafeInteger(turn) || !goal?.id || !['complete', 'blocked'].includes(goal.phase)) return;
    if (this.closing?.turn === turn && this.closing.goalId === goal.id) return;
    this.closing = { turn, goalId: goal.id, steps: 0 };
  }
  admit(payload, goal) {
    const c = this.closing;
    if (!c) return true;
    const freshOwner = payload.messages?.some(m => m.source?.kind === 'user'
      || m.source?.kind === 'mc-harness' && m.source?.form === 'notice' && m.source?.summary?.startsWith('Operator request '));
    if (payload.turn !== c.turn || goal?.id !== c.goalId || !['complete', 'blocked'].includes(goal?.phase) || freshOwner) {
      this.closing = null; return true;
    }
    if (c.steps++ === 0) { this.stats.closingSteps++; return true; }
    this.stats.rejectedSteps++; return false;
  }
  denial(goal) {
    if (!this.closing || goal?.id !== this.closing.goalId || !['complete', 'blocked'].includes(goal?.phase)) return;
    this.stats.blockedTools++;
    return '本轮目标已结案。请只根据已有回执作收尾说明；不要继续调用工具。新的工作等待主人指令或下一轮真实事件。';
  }
}

/** Apply an explicit operator budget command once, preserving goal/session history.
 * The prepared receipt permits recovery after a crash between edit and resume.
 * This is never invoked by game events or by a round-limit watchdog.
 */
export async function applyGoalControl(request, { goals, agent, read, write, flush }) {
  if (!request) return false;
  if (request.action !== 'extend-and-resume' || !/^[\w.-]{1,100}$/.test(request.id ?? '')
    || typeof request.goalId !== 'string' || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0
    || !Number.isSafeInteger(request.maxGoalRounds) || request.maxGoalRounds < 1)
    throw Error('Invalid explicit Minecraft goal control');
  const command = { id: request.id, goalId: request.goalId, expectedRevision: request.expectedRevision,
    maxGoalRounds: request.maxGoalRounds };
  const saved = read();
  if (saved?.id === command.id) {
    if (Object.keys(command).some(key => saved[key] !== command[key])) throw Error('Goal control id reused with different parameters');
    if (saved.phase === 'applied') return false;
  } else if (saved?.phase === 'prepared') throw Error('Previous goal control must be settled first');
  let goal = goals.get(agent);
  const validBlocked = () => goal?.id === command.goalId && goal.phase === 'blocked'
    && goal.blockedReason?.code === 'round-limit' && command.maxGoalRounds > goal.roundsStarted;
  if (!saved || saved.id !== command.id) {
    if (!validBlocked() || goal.revision !== command.expectedRevision || command.maxGoalRounds <= goal.maxGoalRounds)
      throw Error('Goal budget command does not match the exhausted original goal');
    write({ ...command, phase: 'prepared' });
  }
  if (validBlocked() && goal.revision === command.expectedRevision) {
    goal = goals.edit(agent, { id: goal.id, revision: goal.revision }, { maxGoalRounds: command.maxGoalRounds });
    await flush();
  }
  if (validBlocked() && goal.revision === command.expectedRevision + 1 && goal.maxGoalRounds === command.maxGoalRounds) {
    goal = goals.resume(agent, { id: goal.id, revision: goal.revision });
    await flush();
  }
  if (goal?.id !== command.goalId || goal.phase !== 'active' || goal.revision !== command.expectedRevision + 2
    || goal.maxGoalRounds !== command.maxGoalRounds) throw Error('Goal control recovery conflicts with the current goal');
  write({ ...command, phase: 'applied', appliedRevision: goal.revision });
  return true;
}
