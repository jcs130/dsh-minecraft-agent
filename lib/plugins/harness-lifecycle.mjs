import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const names = new Set(['Error', 'TypeError', 'RangeError', 'AggregateError', 'HarnessError', 'LlmError', 'AbortError']);
const code = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const categories = [
  ['allocation', /allocat|not enough memory|out of memory/i],
  ['context-budget', /exceeds model context|context.*exceed/i],
  ['request-extension', /request extension/i],
  ['checkpoint', /checkpoint|flush|durab/i],
  ['turn-boundary', /decision turn|boundary|pending calls/i],
  ['timeout', /timeout|timed out/i],
  ['cancelled', /cancel|abort/i],
];

/** Classify locally; never persist error messages, paths, stacks or provider response bodies. */
export function failureMetadata(error) {
  const chain = [], seen = new Set();
  for (let e = error; e && chain.length < 6 && !seen.has(e); e = e.cause) {
    seen.add(e); chain.push(e);
  }
  const text = chain.map(e => typeof e === 'string' ? e : e.message ?? '').join('\n');
  return { name: names.has(error?.name) ? error.name : null,
    code: code(error?.failure?.code ?? error?.code),
    categories: categories.filter(([, pattern]) => pattern.test(text)).map(([name]) => name) };
}

/** Host lifecycle is separate from game connectivity and never rearms a failed native goal. */
export class HostLifecycle {
  constructor({ stateFile, eventsFile, sessionId, clock = () => new Date().toISOString() }) {
    Object.assign(this, { stateFile, eventsFile, sessionId, clock });
    this.lastFailure = null; this.lastTurn = null;
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      if (saved.schema === 'dsh-mc-lifecycle/v1' && saved.sessionId === sessionId) {
        // Only restore our fixed metadata projection, even if the file was manually extended.
        if (saved.lastFailure) this.lastFailure = this.failure(saved.lastFailure);
        if (saved.lastTurn) this.lastTurn = this.turn(saved.lastTurn);
      }
    } catch { /* No saved metadata is not a game or session failure. */ }
  }
  failure(value) {
    return { at: typeof value.at === 'string' && Number.isFinite(Date.parse(value.at)) ? value.at : null,
      stage: ['agent', 'boundary', 'poll'].includes(value.stage) ? value.stage : null,
      turn: integer(value.turn), step: integer(value.step),
      name: names.has(value.name) ? value.name : null, code: code(value.code),
      categories: [...new Set((Array.isArray(value.categories) ? value.categories : [])
        .filter(value => categories.some(([name]) => name === value)))] };
  }
  turn(value) {
    return { at: typeof value.at === 'string' && Number.isFinite(Date.parse(value.at)) ? value.at : null,
      turn: integer(value.turn), reason: ['stop', 'tool-use', 'max-tokens', 'error', 'aborted', 'completed', 'concluded', 'cancelled', 'blocked']
        .includes(value.reason) ? value.reason : 'unknown' };
  }
  save(event) {
    const row = { schema: 'dsh-mc-lifecycle/v1', at: this.clock(), sessionId: this.sessionId, ...event };
    try { appendFileSync(this.eventsFile, JSON.stringify(row) + '\n'); } catch { /* Diagnostics cannot stop play. */ }
    try { writeFileSync(this.stateFile, JSON.stringify({ schema: row.schema, sessionId: this.sessionId,
      lastFailure: this.lastFailure, lastTurn: this.lastTurn }) + '\n'); } catch { /* Same isolation for the checkpoint. */ }
  }
  failed(stage, error, position = {}) {
    this.lastFailure = this.failure({ at: this.clock(), stage, ...position, ...failureMetadata(error) });
    this.save({ kind: 'failure', failure: this.lastFailure });
  }
  ended(turn, reason) {
    this.lastTurn = this.turn({ at: this.clock(), turn, reason: reason?.kind });
    // Normal turns update only the in-memory view; avoid a second journal of every successful turn.
    if (['error', 'max-tokens', 'aborted', 'cancelled'].includes(this.lastTurn.reason))
      this.save({ kind: 'turn-stopped', terminal: this.lastTurn });
  }
  activation(goal) {
    this.save({ kind: 'activation', goalId: typeof goal?.id === 'string' && /^[\w-]{1,100}$/.test(goal.id) ? goal.id : null,
      revision: integer(goal?.revision), activation: ['armed', 'disarmed'].includes(goal?.activation) ? goal.activation : null });
  }
  snapshot({ paused, stopped, state, goal, autonomy }) {
    const continuation = stopped ? 'stopped' : paused ? 'paused' : goal?.phase === 'blocked' ? 'blocked'
      : goal?.phase === 'paused' ? 'paused' : goal?.phase === 'active' && goal.activation === 'disarmed' ? 'disarmed'
      : state === 'running' ? 'running' : goal?.phase === 'active' && goal.activation === 'armed' ? 'waiting'
      : goal?.phase === 'complete' ? 'complete' : 'idle';
    const ownedRest = autonomy?.waiting && autonomy.goalId === goal?.id && goal?.phase === 'active' && goal.activation === 'disarmed';
    return { continuation: !paused && !stopped && ownedRest ? 'waiting' : continuation, autonomy,
      goalActivation: goal?.activation ?? null, goalPhase: goal?.phase ?? null,
      goalRounds: goal ? { started: integer(goal.roundsStarted), limit: autonomy?.mode === 'continuous' ? null : integer(goal.maxGoalRounds),
        remaining: autonomy?.mode === 'continuous' ? null : Number.isSafeInteger(goal.maxGoalRounds) && Number.isSafeInteger(goal.roundsStarted)
          ? Math.max(0, goal.maxGoalRounds - goal.roundsStarted) : null,
        ...(autonomy?.mode === 'continuous' ? { windowLimit: integer(goal.maxGoalRounds) } : {}),
        blockedCode: typeof goal.blockedReason?.code === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(goal.blockedReason.code)
          ? goal.blockedReason.code : null } : null,
      lastFailure: this.lastFailure, lastTurn: this.lastTurn };
  }
}
