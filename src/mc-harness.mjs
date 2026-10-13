import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, serveClientConsole } from 'agent-mc-world/client';
import { createMinecraftMcpServer } from 'agent-mc-world/mcp';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { HarnessBridge, renderReceipt, retireFacts, measuredStream, abortableDelay, MinecraftEventInbox, deliverOperatorRequest } from './harness-bridge.mjs';

export const name = 'mc-harness';
export const inject = ['agents', 'agentLoop', 'tools', 'systemPrompt', 'goals', 'sessionPersistence', 'sessions', 'tokenMeter'];
const merge = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(k =>
  [k, a[k] && b[k] && typeof a[k] === 'object' && typeof b[k] === 'object' && !Array.isArray(b[k])
    ? merge(a[k], b[k]) : b[k] ?? a[k]]));

/** DSH owns persona, goals, memory, model selection and continuation. One neutral client owns the body. */
export async function apply(ctx, options = {}) {
  if (!options.configFile) return; // Installation alone never opens a game/model connection.
  const config = JSON.parse(readFileSync(resolve(options.configFile), 'utf8'));
  if (config.enabled !== true) return;
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
  const server = createMinecraftMcpServer(runtime, '0.4.0');
  const client = new Client({ name: 'dsh-minecraft-agent', version: '0.2.0' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  const bridge = new HarnessBridge(runtime, client);
  const tools = (await client.listTools()).tools;
  const prefix = await runtime.environment();
  const persona = readFileSync(resolve(config.personaFile), 'utf8');
  const sessionFile = join(dataDir, 'session-id.txt');
  const sessionId = existsSync(sessionFile) ? readFileSync(sessionFile, 'utf8').trim() : randomUUID();
  let handle, consoleServer, eventCursor = 0, recentEvents = [], lastStep = 0, timer, paused = false;
  const inbox = new MinecraftEventInbox();
  const statusFile = join(dataDir, 'status.json');
  const status = extra => writeFileSync(statusFile, JSON.stringify({ at: new Date().toISOString(),
    name: config.name, sessionId, model: config.model, phase: runtime.status().phase,
    stopped: lifetime.signal.aborted, ...extra }, null, 2));
  ctx.effect(() => async () => {
    lifetime.abort(); clearTimeout(timer);
    if (handle) { ctx.goals.disarm(handle.agent); handle.agent.cancel({ kind: 'disposed' });
      await handle.agent.whenIdle(); await ctx.sessions.flush(handle.agent.session); await handle.dispose(); }
    await bridge.stop(); await consoleServer?.close(); await server.close();
    status({ state: 'stopped' });
  }, 'minecraft host lifetime');
  await runtime.connect();
  const waitReady = async signal => {
    while (!(await runtime.operatorState()).connection?.connection?.ready) {
      if (paused || lifetime.signal.aborted) throw Error('Minecraft is paused');
      await abortableDelay(1000, signal);
    }
  };
  if (config.consolePort) consoleServer = await serveClientConsole(config.consolePort, {
    operatorState: async () => ({ ...await runtime.operatorState(), host: { paused, state: handle?.agent.status } }),
    metrics: runtime.metrics, status: () => runtime.status(),
    operatorAction: async action => {
      if (action === 'disconnect') {
        paused = true; inbox.clear();
        if (handle) { ctx.goals.disarm(handle.agent); handle.agent.cancel({ kind: 'user', reason: 'Operator disconnected Minecraft' });
          await handle.agent.whenIdle(); await ctx.sessions.flush(handle.agent.session); }
        await bridge.boundary; bridge.turnId = null;
        return runtime.disconnect();
      }
      await runtime.operatorAction(action);
      if (action === 'connect') { paused = false; await waitReady(lifetime.signal);
        const goal = handle && ctx.goals.get(handle.agent);
        if (goal?.phase === 'active') ctx.goals.resume(handle.agent, { id: goal.id, revision: goal.revision }); }
    },
  });
  const setup = async agentCtx => {
    agentCtx.systemPrompt.section({ name: 'minecraft:persona', order: 0, text: persona + '\n\n' + prefix,
      complete: true, interpolate: false });
    // The complete section deliberately includes every stable game instruction, byte for byte.
    // Dynamic facts use DSH named snapshots at the request tail and remain in its durable log.
    agentCtx.systemPrompt.context({ name: 'minecraft:current-facts', order: 9990,
      text: () => JSON.stringify(runtime.currentFacts()) });
    agentCtx.systemPrompt.context({ name: 'minecraft:events', order: 9991,
      text: () => JSON.stringify({ run: runtime.journal.run, nextCursor: eventCursor, events: recentEvents }) });
    for (const spec of tools) {
      if (spec.name.endsWith('_trace')) continue; // Only measured host instrumentation writes model traces.
      const parameters = structuredClone(spec.inputSchema);
      if (spec.name.endsWith('_protocol')) parameters.properties.action.enum = ['task', 'facts', 'archive', 'archive_runs', 'prepare_context', 'cancel'];
      if (spec.name.endsWith('_connection')) parameters.properties.action.enum = ['status', 'environment'];
      agentCtx.tools.register({ name: spec.name, description: spec.description, parameters,
        output: { schema: { type: 'object' }, render: (_args, value) => renderReceipt(value) },
        isConcurrencySafe: () => false,
        execute: (args, exec) => bridge.call(spec.name, args, { ...exec, id: exec.callId,
          signal: AbortSignal.any([lifetime.signal, exec.signal]) }),
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
      await waitReady(payload.signal);
      retireFacts(payload.agent.session, createUserMessage);
      await abortableDelay(Math.max(0, (config.minStepIntervalMs ?? 3000) - (Date.now() - lastStep)), payload.signal);
      const decision = await next();
      if (decision.kind === 'enter') { await bridge.enter(sessionId, payload.turn); lastStep = Date.now(); }
      return decision;
    });
    const compaction = await import('@deepseek-ai/dsh-compaction-basic');
    await agentCtx.plugin(compaction.default, { auto: true, maxTokens: config.compaction?.maxTokens ?? config.maxTokens ?? 1800,
      headroomTokens: 12000, thresholdRatio: config.compaction?.thresholdRatio ?? 0.7,
      ...(config.compaction?.retainTokens !== undefined ? { retainTokens: config.compaction.retainTokens } : { retainRatio: 0.2 }) }).await();
    agentCtx.on('session/event', (_session, event) => {
      if (event.type === 'turn/end') void bridge.ended(sessionId, event.data.turn).catch(() => {
        status({ state: 'boundary-error' }); handle?.agent.cancel({ kind: 'hook', reason: 'Minecraft turn boundary failed' });
      });
    });
    // Observe the exact request, including tool schemas and all retained history; no silent truncation.
    agentCtx.on('llm/stream', async function* (request, next) {
      const meter = ctx.tokenMeter;
      const estimate = request.purpose
        ? request.messages.reduce((sum, message) => sum + meter.estimateMessage(message), 0)
          + meter.estimateMessage(createUserMessage({ content: [{ type: 'text', text: JSON.stringify(request.tools ?? []) }] }))
        : meter.measure(handle.agent.session).totalTokens;
      if (estimate + (request.maxTokens ?? config.maxTokens ?? 1800) > config.contextTokens)
        throw Error('Minecraft request exceeds model context including tool definitions and reserved output.');
      yield* measuredStream(request, next, runtime.metrics, request.model ?? config.model);
    });
  };
  // No silent new session on resume failure: preserve the identity and surface the failure.
  const agentOptions = { provider: config.provider, model: config.model, maxTokens: config.maxTokens ?? 1800 };
  const stablePersonaFile = join(dataDir, 'persona-with-environment.txt');
  // Keep the source persona independent; the assembled prompt also contains the neutral tool protocol.
  // Render static instructions once; never insert timestamps, counters or current state here.
  writeFileSync(stablePersonaFile, persona + '\n\n' + prefix);
  handle = existsSync(sessionFile)
    ? await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    : await ctx.agents.create({ sessionId, meta: { cwd: dataDir }, agentOptions, setup });
  writeFileSync(sessionFile, sessionId);
  const goal = ctx.goals.get(handle.agent);
  if (!goal && config.goal) ctx.goals.create(handle.agent, { objective: config.goal, maxGoalRounds: config.maxGoalRounds ?? 2000 });
  else if (goal?.phase === 'active') ctx.goals.resume(handle.agent, { id: goal.id, revision: goal.revision });
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
      ctx.goals.create(handle.agent, { objective: request.goal, maxGoalRounds: config.maxGoalRounds ?? 300 });
    },
    steer: request => handle.agent.steer(createUserMessage({ content: [{ type: 'text', text: request.text }],
      source: { kind: 'mc-harness', form: 'notice', summary: `Operator request ${request.id}` } })),
    flush: () => ctx.sessions.flush(handle.agent.session),
    remember: id => writeFileSync(delivered, id),
  });
  const poll = async () => {
    try {
      const events = await runtime.events({ run: runtime.journal.run, after: eventCursor, limit: 64, waitMs: 2000 }, lifetime.signal);
      eventCursor = events.nextCursor;
      if (events.events?.length) recentEvents = [...recentEvents, ...events.events].slice(-24);
      const important = events.events?.filter(e => /chat|damage|death|task|completed|failed|login|disconnect/i.test(e.type));
      inbox.add(important ?? []);
      inbox.flush(handle.agent, ctx.goals.get(handle.agent), paused || lifetime.signal.aborted, createUserMessage);
      status({ state: handle.agent.status, goal: ctx.goals.get(handle.agent), console: consoleServer?.url });
    } catch (error) { if (!lifetime.signal.aborted) status(paused
      ? { state: 'paused', goal: ctx.goals.get(handle.agent) } : { state: 'poll-error', error: error.name }); }
    finally { if (!lifetime.signal.aborted) timer = setTimeout(poll, 1000); }
  };
  void poll();
  log.info('Minecraft SDK connected for %s; DSH session %s', config.name, sessionId);
}
