import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EventCondenser as EventCondenserFallback } from './event-condenser-fallback.mjs';
import * as coreClient from 'agent-mc-world/client';
const { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, serveClientConsole } = coreClient;
import { createMinecraftMcpServer } from 'agent-mc-world/mcp';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { HarnessBridge, nativeToolContext, renderReceipt, mcpResultDecision, retireLiveFacts, measuredStream, abortableDelay, MinecraftEventInbox, deliverOperatorRequest, agentModelOptions, modelToolSchema } from './harness-bridge.mjs';
import { connectionPreference, openHostConsole } from './harness-panel.mjs';
import { HostLifecycle } from './harness-lifecycle.mjs';
import { applyGoalControl } from './harness-goal.mjs';
import { compactionForBudget, overflowFinish, selectTools, slimDescription, compactEvents, capBlocks, ChatGuard, NoopRounds, goalClosed, redactUrl, DEFAULT_CONTEXT_TOKENS, classifyWakeFallback, slimToolSchema, WAKE_DEFAULT, WAKE_ACTIVE_GOAL, MovementProgressFallback, GoalProgressGuard, withNotice, compactFactsFallback, observationDigestFallback } from './harness-budget.mjs';

const require = createRequire(import.meta.url);
// Prefer the core's context helpers (agent-mc-world > 0.5.7-rc.47); fall back to identical local copies.
const coreBudget = typeof coreClient.classifyWake === 'function' && typeof coreClient.compactToolSchema === 'function';
const classifyWake = coreBudget ? coreClient.classifyWake : classifyWakeFallback;
const wakeSets = coreBudget ? { idle: coreClient.WAKE_DEFAULT, active: coreClient.WAKE_ACTIVE_GOAL } : { idle: WAKE_DEFAULT, active: WAKE_ACTIVE_GOAL };
const { version: coreVersion } = require('agent-mc-world/package.json');
const { version: adapterVersion } = require('@jcs130/dsh-minecraft-agent/package.json');

export const name = 'mc-harness';
export const inject = ['llm', 'agents', 'agentLoop', 'tools', 'systemPrompt', 'goals', 'sessionPersistence', 'sessionQuery', 'sessions', 'tokenMeter'];
const merge = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(k =>
  [k, a[k] && b[k] && typeof a[k] === 'object' && typeof b[k] === 'object' && !Array.isArray(b[k])
    ? merge(a[k], b[k]) : b[k] ?? a[k]]));

/** DSH owns persona, goals, memory, model selection and continuation. One neutral client owns the body. */
export async function apply(ctx, options = {}) {
  if (!options.configFile) return; // Installation alone never opens a game/model connection.
  const config = JSON.parse(readFileSync(resolve(options.configFile), 'utf8'));
  if (config.enabled !== true) return;
  config.contextTokens ??= DEFAULT_CONTEXT_TOKENS;
  const agentOptions = agentModelOptions(config);
  // Validate the budget against the real model window at startup, before any connection.
  const modelInfo = await ctx.llm.resolveModelInfo(config.provider, config.model);
  const budget = compactionForBudget(config, modelInfo?.context?.contextWindow);
  const summaryOptions = budget.options;
  const chat = new ChatGuard(config.chat ?? {});
  const view = { receiptChars: config.context?.receiptChars ?? 1500, events: config.context?.events ?? 10,
    eventChars: config.context?.eventChars ?? 200, descriptionChars: config.tools?.descriptionChars ?? 300,
    parameterChars: config.tools?.parameterChars ?? 80 };
  const dataDir = resolve(config.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const nativeLog = ctx.logger('mc-harness');
  const log = { child: () => log, emit: (level, text, metadata) => {
    nativeLog[level === 'trace' ? 'debug' : level]?.(text);
    const event = metadata?.event, data = metadata?.data;
    if (!runtime || !event?.startsWith('host.combat.') || !Number.isSafeInteger(data?.id)) return;
    const id = `fast:${runtime.journal.run}:${data.id}`, model = cfg.hostDecisions?.combat?.model ?? 'typed-decision';
    if (event === 'host.combat.requested') runtime.metrics.report({ kind: 'model', id, role: 'system1', model, phase: 'start' });
    if (event === 'host.combat.result' || event === 'host.combat.error') {
      const usage = data.usage;
      runtime.metrics.report({ kind: 'model', id, role: 'system1', model, phase: 'finish',
        outcome: event.endsWith('error') ? 'failed' : 'success', elapsedMs: data.elapsedMs,
        ...(Number.isSafeInteger(usage?.input_tokens) ? { inputTokens: usage.input_tokens } : {}),
        ...(Number.isSafeInteger(usage?.output_tokens) ? { outputTokens: usage.output_tokens } : {}) });
    }
  }, ...Object.fromEntries(['trace','debug','info','warn','error'].map(level =>
    [level, (...args) => nativeLog[level === 'trace' ? 'debug' : level](...args)])) };
  let cfg, runtime;
  const runtimeOptions = { dataDir: join(dataDir, 'body'), timezone: config.timezone ?? 'Asia/Shanghai',
    agentName: config.name, log, modelFacts: { model: () => config.model,
      contextWindow: () => config.contextTokens, accepts: () => false } };
  if (config.serverPack === 'qiandengji') {
    const { MymcAgentRuntime, MYMC_DEFAULTS } = await import('agent-mc-qiandengji');
    cfg = merge(MYMC_DEFAULTS, config.minecraft);
    runtime = new MymcAgentRuntime({ ...runtimeOptions, cfg });
  } else if (!config.serverPack || config.serverPack === 'none') {
    cfg = merge(MINECRAFT_CLIENT_DEFAULTS, config.minecraft);
    runtime = new MinecraftAgentClient({ ...runtimeOptions, cfg });
  } else throw Error('Unknown explicit Minecraft server pack');
  const lifetime = new AbortController();
  const lean = config.tools?.profile !== 'full';
  // Newer cores advertise the compact catalogue themselves; older ones ignore the option.
  const server = createMinecraftMcpServer(runtime, coreVersion, lean ? { catalog: 'compact', compact: { descriptionChars: config.tools?.descriptionChars ?? 300, parameterChars: config.tools?.parameterChars ?? 80 } } : {});
  const client = new Client({ name: 'dsh-minecraft-agent', version: adapterVersion });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  const bridge = new HarnessBridge(runtime, client);
  const tools = (await client.listTools()).tools;
  const prefix = await runtime.environment();
  const persona = readFileSync(resolve(config.personaFile), 'utf8');
  const sessionFile = join(dataDir, 'session-id.txt');
  const sessionId = existsSync(sessionFile) ? readFileSync(sessionFile, 'utf8').trim() : randomUUID();
  const lifecycle = new HostLifecycle({ sessionId, stateFile: join(dataDir, 'host-lifecycle.json'),
    eventsFile: join(dataDir, 'host-lifecycle.ndjson') });
  const connectionIntent = connectionPreference(join(dataDir,'connection-state.json'), config.startPaused);
  let handle, consoleServer, eventCursor = 0, recentEvents = [], lastStep = 0, timer, paused = connectionIntent.paused;
  const setPaused = value => { connectionIntent.set(value); paused = value; };
  let lastTokens = 0, shuttingDown, pendingGoalClose = null, goalClosedAt = 0;
  const wakeNames = [config.minecraft?.username, config.name, ...(config.wake?.names ?? [])].filter(Boolean);
  const wakeStats = { seen: 0, woken: 0, droppedAfterGoal: 0 };
  const progressConfig = config.progress ?? {};
  const Progress = coreClient.MovementProgress ?? MovementProgressFallback;
  const guard = new GoalProgressGuard({ progress: new Progress(progressConfig), maxCalls: config.maxGoalCalls ?? 30, closeAfter: progressConfig.closeAfter ?? 12,
    digest: coreClient.observationDigest ?? observationDigestFallback });
  const progressStats = { nudges: 0, closedBy: null };
  // Model-facing event list: server noise condensed (raw journal untouched); each step shows mostly new events.
  const eventsConfig = config.events ?? {};
  const condenser = new (coreClient.EventCondenser ?? EventCondenserFallback)({ window: eventsConfig.window ?? 24,
    disable: eventsConfig.disable ?? [],
    rules: (eventsConfig.rules ?? []).map(rule => ({ id: rule.id, action: rule.action, match: new RegExp(rule.match, rule.flags ?? '') })) });
  let shownCursor = 0, renderedCursor = 0;
  const eventTail = eventsConfig.tail ?? 2;
  let wrapUpSteps = 1;
  const quiet = /_(tool_help|help|memory|knowledge|life|connection|protocol|options|bag|queue|blocked|risk|hear|attention)$/;
  const gameToolNames = new Set(tools.map(t => t.name));
  const noop = new NoopRounds(config.noopRoundLimit ?? 3, name => gameToolNames.has(name) && !quiet.test(name));
  // Goal mutations are applied between turns, never inside a running tool call or event dispatch.
  const closeSessionGoal = reason => { pendingGoalClose ??= reason; };
  const settleGoalClose = () => {
    const reason = pendingGoalClose; pendingGoalClose = null; wrapUpSteps = 1;
    // A host cancel pauses the goal first; completing from paused is a valid DSH transition.
    const goal = reason && handle && ctx.goals.get(handle.agent);
    if (!goal || goal.phase === 'complete') return;
    try { ctx.goals.complete(handle.agent, { id: goal.id, revision: goal.revision }); log.info('Session goal completed: %s', reason); }
    catch (error) { log.warn('Could not complete session goal (%s): %s', reason, error.message); }
  };
  const shutdown = reason => shuttingDown ??= (async () => {
    clearTimeout(timer);
    try {
      if (handle) try { ctx.goals.disarm(handle.agent); } catch {}
      if (handle) try { handle.agent.cancel({ kind: 'user', reason: `Minecraft host stopping: ${reason}` });
        await Promise.race([handle.agent.whenIdle(), abortableDelay(5000)]); } catch {}
      const bye = runtime.status().phase === 'started' ? chat.takeGoodbye() : null;
      if (bye) {
        const goodbye = { text: bye, at: new Date().toISOString(), sent: false };
        try {
          const result = await client.callTool({ name: `${runtime.toolPrefix}_do`, arguments: { steps: [{ skill: 'chat', text: bye }] } },
            undefined, { timeout: 10000 });
          goodbye.sent = !result?.isError;
          goodbye.receipt = String(result?.structuredContent?.text ?? result?.content?.[0]?.text ?? '').slice(0, 200);
        } catch (error) { goodbye.error = error.message; }
        (goodbye.sent ? log.info : log.warn)('Goodbye %s: %s', goodbye.sent ? 'sent' : 'failed', goodbye.receipt ?? goodbye.error);
        try { status({ goodbye }); } catch {}
        await abortableDelay(1500);
      }
      await runtime.disconnect();
    } catch (error) { log.warn('Minecraft shutdown: %s', error.message); }
    finally { try { status({ state: 'stopped', stopped: true, reason }); } catch {} }
  })();
  const signals = config.handleSignals === false ? [] : ['SIGINT', 'SIGTERM'];
  const onSignal = signal => { void shutdown(signal).finally(() => {
    // Re-raise only when nobody else (e.g. the DSH CLI) handles the signal.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  }); };
  for (const signal of signals) process.once(signal, onSignal);
  const inbox = new MinecraftEventInbox();
  const statusFile = join(dataDir, 'status.json');
  // DSH may dispose the goal service before this plugin during shutdown; status must still be writable.
  const currentGoal = () => { try { return handle ? ctx.goals.get(handle.agent) : undefined; } catch { return undefined; } };
  const hostLifecycle = () => lifecycle.snapshot({ paused, stopped: lifetime.signal.aborted,
    state: handle?.agent.status, goal: currentGoal() });
  // Merge: later writes (e.g. shutdown) must not erase wake/progress counters or the goodbye result.
  let statusExtra = {};
  const status = extra => writeFileSync(statusFile, JSON.stringify({ at: new Date().toISOString(),
    name: config.name, sessionId, model: config.model, coreVersion, adapterVersion,
    reasoningEffort: config.reasoningEffort ?? null, phase: runtime.status().phase, paused,
    stopped: lifetime.signal.aborted, ...(statusExtra = { ...statusExtra, error: undefined, ...extra }), lifecycle: hostLifecycle() }, null, 2));
  ctx.on('agent/error', payload => {
    if (payload.agent?.id === sessionId) lifecycle.failed('agent', payload.error, { turn: payload.turn, step: payload.step });
  });
  ctx.on('goal/activation-changed', payload => {
    if (payload.sessionId === sessionId) lifecycle.activation(payload.goal);
  });
  ctx.effect(() => async () => {
    for (const signal of signals) process.removeListener(signal, onSignal);
    await shutdown('dispose');
    lifetime.abort(); clearTimeout(timer);
    if (handle) { ctx.goals.disarm(handle.agent); handle.agent.cancel({ kind: 'disposed' });
      await handle.agent.whenIdle(); await ctx.sessions.flush(handle.agent.session); await handle.dispose(); }
    await bridge.stop(); await consoleServer?.close(); await server.close();
    status({ state: 'stopped', stopped: true });
  }, 'minecraft host lifetime');
  if (!paused) await runtime.connect();
  const waitReady = async signal => {
    while (!(await runtime.operatorState()).connection?.connection?.ready) {
      if (paused || lifetime.signal.aborted) throw Error('Minecraft is paused');
      await abortableDelay(1000, signal);
    }
  };
  consoleServer = await openHostConsole(ctx, config.consolePort ? embedOrigins => serveClientConsole(config.consolePort, {
    operatorState: async () => ({ ...await runtime.operatorState(), host: { paused, state: handle?.agent.status,
      name:config.name, model:config.model, reasoningEffort:config.reasoningEffort ?? null, coreVersion, adapterVersion,
      ...hostLifecycle() } }),
    metrics: runtime.metrics, status: () => runtime.status(),
    operatorAction: async action => {
      if (action === 'disconnect') {
        setPaused(true); inbox.clear();
        if (handle) { ctx.goals.disarm(handle.agent); handle.agent.cancel({ kind: 'user', reason: 'Operator disconnected Minecraft' });
          await handle.agent.whenIdle(); await ctx.sessions.flush(handle.agent.session); }
        await bridge.boundary; bridge.turnId = null;
        return runtime.disconnect();
      }
      // Record intent before awaiting connection: a later disconnect must win.
      if (action === 'connect') setPaused(false);
      await runtime.operatorAction(action);
      if (action === 'connect' && !paused) { await waitReady(lifetime.signal); if (handle) await activate(); }
    },
  }, undefined, undefined, {embedOrigins}) : undefined, sessionId);
  const setup = async agentCtx => {
    agentCtx.systemPrompt.section({ name: 'minecraft:persona', order: 0, text: persona + '\n\n' + prefix,
      complete: true, interpolate: false });
    // The complete section deliberately includes every stable game instruction, byte for byte.
    // Dynamic facts use DSH named snapshots at the request tail and remain in its durable log.
    agentCtx.systemPrompt.context({ name: 'minecraft:current-facts', order: 9990,
      text: () => JSON.stringify((coreClient.compactFacts ?? compactFactsFallback)(runtime.currentFacts())) });
    agentCtx.systemPrompt.context({ name: 'minecraft:events', order: 9991,
      text: () => JSON.stringify({ run: runtime.journal.run, nextCursor: eventCursor, events: (() => {
        const list = (coreClient.compactEvents ?? compactEvents)(condenser.since(shownCursor, eventTail), view.events, view.eventChars, runtimeOptions.timezone);
        renderedCursor = Math.max(renderedCursor, ...list.map(e => e.cursor ?? 0)); return list;
      })() }) });
    const gameTools = new Set(tools.map(tool => tool.name));
    agentCtx.on('tools/post-execute', (exec, result, next) =>
      gameTools.has(exec.name) ? mcpResultDecision(exec, result, next) : next());
    const helpName = tools.find(t => t.name.endsWith('_tool_help'))?.name;
    for (const spec of selectTools(tools, config.tools)) {
      // Exact schemas keep every constraint; prose lives behind *_tool_help to keep the fixed prompt small.
      const parameters = !lean || coreBudget ? modelToolSchema(spec.inputSchema)
        : slimToolSchema(modelToolSchema(spec.inputSchema), view.parameterChars);
      if (spec.name.endsWith('_protocol')) parameters.properties.action.enum = ['task', 'facts', 'archive', 'archive_runs', 'prepare_context', 'cancel'];
      if (spec.name.endsWith('_connection')) parameters.properties.action.enum = ['status', 'environment'];
      agentCtx.tools.register({ name: spec.name, description: !lean || coreBudget ? spec.description : slimDescription(spec, helpName, view.descriptionChars), parameters,
        output: { schema: { type: 'object' }, render: (_args, value) => capBlocks(renderReceipt(value), view.receiptChars) },
        isConcurrencySafe: () => false,
        execute: async (args, exec) => {
          noop.call(spec.name);
          const refusal = chat.check(spec.name, args);
          if (refusal) return { isError: true, content: [{ type: 'text', text: refusal }], structuredContent: { text: refusal, chatLimited: true } };
          let value;
          try { value = await bridge.call(spec.name, args, nativeToolContext(exec, lifetime.signal)); }
          catch (error) { chat.refund(); throw error; }
          if (value?.isError) chat.refund();
          if (goalClosed(value)) closeSessionGoal('in-game goal closed');
          const looking = /_(scout|visual)$/.test(spec.name);
          if ((!spec.name.endsWith('_do') && !looking) || value?.isError) return value;
          const verdict = looking ? guard.observe(currentGoal(), JSON.stringify(value?.structuredContent?.text ?? value?.content ?? ''))
            : guard.action(currentGoal(), args?.steps);
          if (verdict.close) { progressStats.closedBy = verdict.close; closeSessionGoal(verdict.close); }
          if (verdict.notice) progressStats.nudges++;
          return withNotice(value, verdict.notice ?? (verdict.close ? `[宿主提示] 本目标因长时间没有进展将在本轮结束时自动完成，请简短收尾，不要再移动。` : undefined));
        },
      });
    }
    agentCtx.tools.register({ name: 'dsh_history', description: '查询本人的原始 DSH 会话，包括已被新现场替换或整理过的记录。offset 是日志序号。',
      parameters: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['offset'] },
      output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => {
        await ctx.sessions.flush(handle.agent.session);
        const log = await ctx.sessionPersistence.open(sessionId, 'read');
        try { return await log.read(args.offset, Math.min(20, args.limit ?? 5), { signal: exec.signal }); }
        finally { await log.close(); }
      },
    });
    // DSH restrictions address the GLOBAL roster; scoped game tools remain available.
    agentCtx.tools.restrict({ allow: [] });
    const goalPlugin = await import('@deepseek-ai/dsh-tool-goal');
    await agentCtx.plugin(goalPlugin.default ?? goalPlugin).await();
    agentCtx.on('agent/pre-step', async (payload, next) => {
      if (paused) throw Error('Minecraft is paused');
      // A guard-closed goal gets one wrap-up step, then the turn ends so the close settles now, not rounds later.
      if (progressStats.closedBy && pendingGoalClose && wrapUpSteps-- <= 0) {
        handle.agent.cancel({ kind: 'hook', reason: `Goal closed by host: ${progressStats.closedBy}` });
        throw Error('Goal closed by host');
      }
      await waitReady(payload.signal);
      await retireLiveFacts(payload.agent.session, createUserMessage, ctx.sessionQuery, payload.signal);
      await abortableDelay(Math.max(0, (config.minStepIntervalMs ?? 3000) - (Date.now() - lastStep)), payload.signal);
      const decision = await next();
      if (decision.kind === 'enter') {
        await bridge.enter(sessionId, payload.turn, payload.step); lastStep = Date.now();
        shownCursor = renderedCursor; // the previous snapshot was read; this step's list starts after it
        const over = guard.step(currentGoal());
        if (over && !pendingGoalClose) { progressStats.closedBy = over; closeSessionGoal(over); }
      }
      return decision;
    });
    const compaction = await import('@deepseek-ai/dsh-compaction-basic');
    await agentCtx.plugin(compaction.default, summaryOptions).await();
    agentCtx.on('session/event', (session, event) => {
      if (session.id !== sessionId) return;
      if (event.type === 'goal/change' && event.data?.operation === 'complete') {
        // Receipts queued for the finished goal must not wake the model afterwards.
        wakeStats.droppedAfterGoal += inbox.pending.length; inbox.clear(); goalClosedAt = Date.now();
        return;
      }
      if (event.type !== 'turn/end') return;
      lifecycle.ended(event.data.turn, event.data.reason);
      const reason = event.data.reason;
      if (reason?.kind === 'error' && /context|CONTEXT_WINDOW/i.test(`${reason.error?.code} ${reason.error?.message}`)) {
        // Compaction could not recover: never idle in game ignoring chat. Leave cleanly.
        log.warn('Context budget exhausted after compaction; logging out');
        void shutdown('context-budget');
      } else if (noop.end()) closeSessionGoal(`${noop.streak} consecutive rounds without a game action`);
      if (pendingGoalClose) setTimeout(settleGoalClose, 0);
      void bridge.ended(sessionId, event.data.turn).catch(error => {
        lifecycle.failed('boundary', error, { turn: event.data.turn });
        status({ state: 'boundary-error' }); handle?.agent.cancel({ kind: 'hook', reason: 'Minecraft turn boundary failed' });
      });
    });
  };
  // LLM service events are service-scoped, not agent-scoped. Filter the real session explicitly.
  ctx.on('llm/stream', async function* (request, next) {
      if (request.sessionId !== sessionId) { yield* next(); return; }
      const meter = ctx.tokenMeter;
      const estimate = request.purpose
        ? request.messages.reduce((sum, message) => sum + meter.estimateMessage(message), 0)
          + meter.estimateMessage(createUserMessage({ content: [{ type: 'text', text: JSON.stringify(request.tools ?? []) }] }))
        : meter.measure(handle.agent.session).totalTokens;
      if (estimate + (request.maxTokens ?? config.maxTokens ?? 1800) > config.contextTokens) {
        // In-band overflow lets DSH compaction summarize and retry the same turn instead of killing it.
        lastTokens = estimate; yield overflowFinish(estimate, config.contextTokens); return;
      }
      lastTokens = estimate;
      yield* measuredStream(request, next, runtime.metrics, request.model ?? config.model);
  });
  // No silent new session on resume failure: preserve the identity and surface the failure.
  const stablePersonaFile = join(dataDir, 'persona-with-environment.txt');
  // Keep the source persona independent; the assembled prompt also contains the neutral tool protocol.
  // Render static instructions once; never insert timestamps, counters or current state here.
  writeFileSync(stablePersonaFile, persona + '\n\n' + prefix);
  handle = existsSync(sessionFile)
    ? await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    : await ctx.agents.create({ sessionId, meta: { cwd: dataDir }, agentOptions, setup });
  writeFileSync(sessionFile, sessionId);
  let activation = Promise.resolve();
  const activate = () => {
    const pending = activation.then(activateOnce);
    activation = pending.catch(() => {});
    return pending;
  };
  const activateOnce = async () => {
  if (paused || lifetime.signal.aborted) return;
  const goalControlFile = join(dataDir, 'operator-goal-control.json');
  await applyGoalControl(config.goalControl, { goals: ctx.goals, agent: handle.agent,
    read: () => existsSync(goalControlFile) ? JSON.parse(readFileSync(goalControlFile, 'utf8')) : null,
    write: value => { writeFileSync(goalControlFile + '.tmp', JSON.stringify(value) + '\n', { mode: 0o600 });
      renameSync(goalControlFile + '.tmp', goalControlFile); },
    flush: () => ctx.sessions.flush(handle.agent.session) });
  const goal = ctx.goals.get(handle.agent);
  if (!goal && config.goal) ctx.goals.create(handle.agent, { objective: config.goal, maxGoalRounds: config.maxGoalRounds ?? 40 });
  else if (goal?.phase === 'active' && goal.activation !== 'armed') ctx.goals.resume(handle.agent, { id: goal.id, revision: goal.revision });
  // Explicit operator follow-ups are consumed once; never reset a completed goal on restart.
  const delivered = join(dataDir, 'operator-request-id.txt');
  await deliverOperatorRequest(config.operatorRequest, {
    lastId: () => existsSync(delivered) ? readFileSync(delivered, 'utf8').trim() : null,
    prepare: request => {
      // Only explicit local operator configuration may create a follow-up goal.
      // Game events retain notice authority and cannot grant themselves a goal.
      if (!request.goal) return;
      const current = ctx.goals.get(handle.agent);
      if (current && current.phase !== 'complete') throw Error('Finish or explicitly handle the current goal before adding an operator goal');
      ctx.goals.create(handle.agent, { objective: request.goal, maxGoalRounds: config.maxGoalRounds ?? 40 });
    },
    steer: request => handle.agent.steer(createUserMessage({ content: [{ type: 'text', text: request.text }],
      source: { kind: 'mc-harness', form: 'notice', summary: `Operator request ${request.id}` } })),
    flush: () => ctx.sessions.flush(handle.agent.session),
    remember: id => writeFileSync(delivered, id),
  });
  };
  if (paused) ctx.goals.disarm(handle.agent); else await activate();
  const poll = async () => {
    if (shuttingDown) return;
    try {
      const events = await runtime.events({ run: runtime.journal.run, after: eventCursor, limit: 64, waitMs: 2000 }, lifetime.signal);
      eventCursor = events.nextCursor;
      if (events.events?.length) { recentEvents = [...recentEvents, ...events.events].slice(-24); condenser.push(events.events); }
      // Wake only for events a person would interrupt for; everything else rides the next snapshot.
      const goalNow = currentGoal();
      const wakeOn = config.wake?.on ?? (goalNow?.phase === 'active' ? wakeSets.active : wakeSets.idle);
      // Events stamped before the goal closed belong to it; only idle-worthy ones may still wake.
      const important = (events.events ?? []).filter(e => classifyWake(e, { selfNames: wakeNames,
        wakeOn: goalClosedAt && Date.parse(e.ts ?? '') <= goalClosedAt ? wakeSets.idle : wakeOn }).wake);
      wakeStats.seen += events.events?.length ?? 0; wakeStats.woken += important.length;
      inbox.add(important);
      inbox.flush(handle.agent, currentGoal(), paused || lifetime.signal.aborted, createUserMessage);
      status({ state: handle.agent.status, goal: currentGoal(), console: redactUrl(consoleServer?.url), tokens: lastTokens, triggerTokens: budget.triggerTokens, wake: wakeStats, progress: { ...progressStats, goalCalls: guard.calls }, events: condenser.stats, coreBudget });
    } catch (error) { if (!lifetime.signal.aborted && !shuttingDown) {
      if (!paused) lifecycle.failed('poll', error);
      status(paused ? { state: 'paused', goal: currentGoal() }
        : { state: 'poll-error', error: error.name });
    } }
    finally { if (!lifetime.signal.aborted && !shuttingDown) timer = setTimeout(poll, 1000); }
  };
  void poll();
  log.info('Minecraft SDK connected for %s; DSH session %s', config.name, sessionId);
}
