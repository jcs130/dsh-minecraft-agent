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
