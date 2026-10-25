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
    const maxGoalRounds = config.maxGoalRounds ?? 40;
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
