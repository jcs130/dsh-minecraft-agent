/** Host continuation policy. No model loop, game actions or fabricated success. */
export function autonomyPolicy(config = {}) {
  const value = config.autonomy ?? {};
  const mode = value.mode ?? (config.maxGoalCalls !== undefined || config.maxGoalRounds !== undefined ? 'bounded' : 'continuous');
  if (!['continuous', 'bounded'].includes(mode)) throw Error('Invalid autonomy mode');
  const integer = (n, fallback, min, max) => {
    n ??= fallback;
    if (!Number.isSafeInteger(n) || n < min || n > max) throw Error('Invalid autonomy window');
    return n;
  };
  return { mode, continuous: mode === 'continuous',
    roundWindow: integer(value.roundWindow, 40, 2, 10000),
    stepWindow: integer(value.stepWindow, 30, 2, 1000),
    restMs: integer(value.restMs, 10000, 1000, 60000),
    maxRestMs: integer(value.maxRestMs, 60000, 1000, 300000) };
}

export function nativeGoalRounds(config = {}) {
  return autonomyPolicy(config).continuous ? autonomyPolicy(config).roundWindow : config.maxGoalRounds ?? 40;
}

/** Same goal/session; extend native finite windows, never reset cumulative rounds.
 * Only our own holds and the native round-limit are recoverable here. An owner
 * pause/completion, foreign goal, unknown blocker or error remains authoritative.
 */
export class AutonomousContinuation {
  constructor({ config, read = () => null, write = () => {}, now = Date.now }) {
    this.policy = autonomyPolicy(config); this.write = write; this.now = now;
    this.managedId = null; this.hold = null; this.turn = null; this.steps = 0;
    this.stats = { extendedWindows: 0, resumedWindows: 0, yields: 0, rests: 0 };
    const saved = read();
    if (saved?.schema === 'dsh-mc-continuation/v1') {
      this.managedId = typeof saved.goalId === 'string' ? saved.goalId : null;
      const h = saved.hold;
      if (this.policy.continuous && h && h.goalId === this.managedId && Number.isSafeInteger(h.revision) && Number.isFinite(h.notBefore)
        && ['step-window','no-progress','noop'].includes(h.reason)) this.hold = { ...h };
      for (const key of Object.keys(this.stats)) if (Number.isSafeInteger(saved.stats?.[key]) && saved.stats[key] >= 0) this.stats[key] = saved.stats[key];
    }
  }
  save() { this.write({ schema: 'dsh-mc-continuation/v1', goalId: this.managedId, hold: this.hold, stats: this.stats }); }
  bind(goal) {
    if (!this.policy.continuous || !goal) return;
    if (this.managedId !== goal.id) { this.managedId = goal.id; this.hold = null; this.turn = null; this.steps = 0; this.save(); }
  }
  /** Only call with this exact agent's native GoalService view. Native arming
   * supplies continuation authority for a new owner-directed goal after setup. */
  bindArmed(goal) { if (goal?.phase === 'active' && goal.activation === 'armed') this.bind(goal); }
  suspend() { this.hold = null; this.turn = null; this.steps = 0; this.save(); }
  wake(categories) {
    if (this.hold && categories.some(kind => ['danger','mention','whisper'].includes(kind))) {
      this.hold.notBefore = this.now(); this.save();
    }
  }
  owns(goal) { return this.policy.continuous && !!goal && goal.id === this.managedId; }
  rest(reason, { goals, agent }, delay) {
    const goal = goals.get(agent);
    if (!this.owns(goal) || goal.phase !== 'active' || goal.activation !== 'armed') return false;
    goals.disarm(agent);
    const notBefore = this.now() + (delay ?? Math.min(this.policy.maxRestMs, this.policy.restMs * 2 ** Math.min(4, this.stats.rests)));
    this.hold = { goalId: goal.id, revision: goal.revision, reason, notBefore };
    this.stats[reason === 'step-window' ? 'yields' : 'rests']++;
    this.save(); return true;
  }
  /** Reject the next step at a safe native boundary; do not cancel a body task. */
  beforeStep(turn, ports) {
    const goal = ports.goals.get(ports.agent);
    if (!this.owns(goal) || goal.phase !== 'active') return true;
    if (this.turn !== turn) { this.turn = turn; this.steps = 0; }
    if (this.steps < this.policy.stepWindow) return true;
    this.rest('step-window', ports, 250);
    return false;
  }
  admitted(turn) { if (this.turn !== turn) { this.turn = turn; this.steps = 0; } this.steps++; }
  async tick({ goals, agent, flush, ready = () => true, beforeResume = () => {} }) {
    if (!ready() || agent.status !== 'idle') return false;
    let goal = goals.get(agent);
    if (!this.owns(goal)) return false;
    const prepared = this.hold?.extension;
    if (prepared && goal.phase === 'active' && goal.activation === 'disarmed'
      && goal.revision === prepared.revision && goal.maxGoalRounds === prepared.limit) {
      this.hold.revision = goal.revision; delete this.hold.extension; this.save();
    }
    if (this.hold && (this.hold.goalId !== goal.id || this.hold.revision !== goal.revision || goal.phase !== 'active')) {
      this.hold = null; this.save();
    }
    const limited = goal.phase === 'blocked' && goal.blockedReason?.code === 'round-limit';
    const held = this.hold && goal.phase === 'active' && goal.activation === 'disarmed';
    if (held && this.now() < this.hold.notBefore) return false;
    if (!limited && !held && !(goal.phase === 'active' && goal.activation === 'armed')) return false;
    if (goal.roundsStarted + 1 >= goal.maxGoalRounds) {
      const limit = goal.roundsStarted + this.policy.roundWindow;
      if (!Number.isSafeInteger(limit)) throw Error('Native goal round counter exhausted');
      // A prepared metadata receipt bridges a crash after the native edit was
      // flushed but before its owned disarmed hold was updated/resumed.
      if (held) { this.hold.extension = { revision: goal.revision + 1, limit }; this.save(); }
      goal = goals.edit(agent, { id: goal.id, revision: goal.revision }, { maxGoalRounds: limit });
      await flush();
      // Re-read after I/O: a user pause or replacement must win.
      const latest = goals.get(agent);
      if (!ready() || !this.owns(latest) || latest?.id !== goal.id || latest.revision !== goal.revision) return false;
      if (held) {
        // Disconnect can clear the owned hold while durability is pending.
        if (!this.hold || this.hold.goalId !== goal.id || this.hold.extension?.revision !== goal.revision) return false;
        this.hold.revision = goal.revision; delete this.hold.extension;
      }
      this.stats.extendedWindows++; this.save();
      goal = latest;
    }
    if (limited || held) {
      if (agent.status !== 'idle' || !(goal.phase === 'blocked' && goal.blockedReason?.code === 'round-limit'
        || held && goal.phase === 'active' && goal.activation === 'disarmed')) return false;
      beforeResume(this.hold?.reason ?? 'round-window');
      goals.resume(agent, { id: goal.id, revision: goal.revision });
      await flush(); this.hold = null; this.turn = null; this.steps = 0;
      this.stats.resumedWindows++; this.save(); return true;
    }
    return false;
  }
  snapshot() { return { mode: this.policy.mode, goalId: this.managedId, totalRoundLimit: this.policy.continuous ? null : undefined,
    roundWindow: this.policy.roundWindow, stepWindow: this.policy.stepWindow,
    waiting: this.hold?.reason ?? null, nextAt: this.hold ? new Date(this.hold.notBefore).toISOString() : null, ...this.stats }; }
}
