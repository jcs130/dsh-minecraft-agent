import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EventCondenser as EventCondenserFallback } from './event-condenser-fallback.mjs';
import { prepareDshNativeStreams } from './dsh-native-streams.mjs';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { HarnessBridge, observationTool, RetryEvidenceContext, disposeHostResources, gameToolConcurrencySafe, nativeToolContext, renderReceipt, mcpResultDecision, retireLiveFacts, measuredStream, abortableDelay, MinecraftEventInbox, deliverOperatorRequest, agentModelOptions, modelToolSchema } from './harness-bridge.mjs';
import { connectionPreference, openHostConsole } from './harness-panel.mjs';
import { HostLifecycle } from './harness-lifecycle.mjs';
import { AutonomousContinuation } from './harness-autonomy.mjs';
import { EvidenceReflection, installEvidenceReflection } from './harness-reflection.mjs';
import { installImprovementContext } from './harness-improvement.mjs';
import { MethodProgress, installMethodProgress } from './harness-method-progress.mjs';
import { installPlanReview, planReviewEvidence } from './harness-plan-review.mjs';
import { installDecisionReview,decisionReviewNotice } from './harness-decision-review.mjs';
import { minecraftCompactionBackend } from './harness-compaction.mjs';
import { AppendOnlyFactsContext,installTextReadRecovery } from './harness-context.mjs';
import { evidenceCompactionBackend } from './harness-handoff.mjs';
import { qiandengjiAccess, verifyQiandengjiConnection, publicAccessState } from './qiandengji-access.mjs';
import { activateConfiguredGoal, applyGoalControl, prepareOperatorGoal, settleHostGoal, GoalWrapUp, gameGoalCompletesSession, installContinuousGoalAuthority } from './harness-goal.mjs';
import {createQuickSetup,attachQuickSetup} from './quick-setup.mjs';
import {composeMinecraftAgent,constrainMinecraftTools,minecraftPlanningGuidance} from './harness-composition.mjs';
import {conversationDirectory} from './profile-settings.mjs';
import { configuredWake, compactionForBudget, overflowFinish, selectTools, slimDescription, compactEvents, capBlocks, ChatGuard, NoopRounds, redactUrl, DEFAULT_CONTEXT_TOKENS, classifyWakeFallback, slimToolSchema, WAKE_DEFAULT, WAKE_ACTIVE_GOAL, MovementProgressFallback, GoalProgressGuard, withNotice, compactFactsFallback, observationDigestFallback } from './harness-budget.mjs';

prepareDshNativeStreams();
const coreClient = await import('agent-mc-world/client');
const { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, serveClientConsole } = coreClient;
const { createMinecraftMcpServer } = await import('agent-mc-world/mcp');

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
  if(options.configFile)return startConfiguredAgent(ctx,JSON.parse(readFileSync(resolve(options.configFile),'utf8')));
  if(options.quickSetup!==true)return; // The passive browser row owns no body or setup service.
  const profile=ctx.get('profileContext');
  if(!profile?.dir)return;
  const setup=await createQuickSetup({directory:join(resolve(profile.dir),'minecraft-agent'),
    parseAddress:coreClient.parseMinecraftServerAddress,
    selection:()=>ctx.get('agentDefaultModel')?.currentSelection(),
    modelInfo:(provider,model,signal)=>ctx.llm.resolveModelInfo(provider,model,signal),
    listPresets:()=>ctx.get('agentPresets')?.list()??[],
    knowledge:(config,args)=>coreClient.queryMinecraftKnowledge({...args,source:'minedojo'},config.minecraft.version,config.minecraft.knowledge),
    notebook:(config,args)=>new MinecraftAgentClient({cfg:merge(MINECRAFT_CLIENT_DEFAULTS,config.minecraft),
      dataDir:join(config.dataDir,'body'),agentName:config.name,log:coreClient.nullLogger()}).notebook(args),
    launch:config=>{
      let runtime;
      const child=ctx.plugin({name:'minecraft-configured-agent',inject,apply:scoped=>startConfiguredAgent(scoped,config,value=>{runtime=value;})});
      return {ready:child.await(),dispose:()=>child.dispose(),notebook:args=>{
        if(!runtime)throw Error('Notebook is not ready');return runtime.notebook(args);
      }};
    }});
  attachQuickSetup(ctx,setup);
}

/** Called only for a previously enabled private config or explicit first-run connection. */
async function startConfiguredAgent(ctx,config,onRuntime) {
  if (config.enabled !== true) return;
  config.contextTokens ??= DEFAULT_CONTEXT_TOKENS;
  const agentOptions = agentModelOptions(config);
  // Validate the budget against the real model window at startup, before any connection.
  const modelInfo = await ctx.llm.resolveModelInfo(config.provider, config.model);
  const budget = compactionForBudget(config, modelInfo?.context?.contextWindow);
  const summaryOptions = budget.options;
  if(config.compaction?.strategy&&!['guided-model','evidence'].includes(config.compaction.strategy))throw Error('Unknown compaction.strategy');
  let checkpointPresentation=null;
  const chat = new ChatGuard(config.chat ?? {});
  const view = { receiptChars: config.context?.receiptChars ?? 1500, events: config.context?.events ?? 10,
    eventChars: config.context?.eventChars ?? 200, descriptionChars: config.tools?.descriptionChars ?? 300,
    parameterChars: config.tools?.parameterChars ?? 80 };
  const dataDir = resolve(config.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const portalAccess = await qiandengjiAccess(config);
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
  let cfg, runtime, onboarding = '';
  // Enabling the host explicitly enables its body unless the caller supplied
  // enabled:false for an offline SDK/engine fixture. Neutral SDK defaults stay inert.
  const minecraft={enabled:true,...config.minecraft};
  const runtimeOptions = { dataDir: join(dataDir, 'body'), timezone: config.timezone ?? 'Asia/Shanghai',
    agentName: config.name, log, modelFacts: { model: () => config.model,
      contextWindow: () => config.contextTokens, accepts: () => false } };
  if (config.serverPack === 'qiandengji') {
    const { MymcAgentRuntime, MYMC_DEFAULTS, readServerGuide } = await import('agent-mc-qiandengji');
    cfg = merge(MYMC_DEFAULTS, minecraft);
    runtime = new MymcAgentRuntime({ ...runtimeOptions, cfg });
    if (portalAccess) onboarding = readServerGuide('onboarding').text;
  } else if (!config.serverPack || config.serverPack === 'none') {
    cfg = merge(MINECRAFT_CLIENT_DEFAULTS, minecraft);
    runtime = new MinecraftAgentClient({ ...runtimeOptions, cfg });
  } else throw Error('Unknown explicit Minecraft server pack');
  onRuntime?.(runtime);
  const lifetime = new AbortController();
  const lean = config.tools?.profile !== 'full';
  // Newer cores advertise the compact catalogue themselves; older ones ignore the option.
  const server = createMinecraftMcpServer(runtime, coreVersion, lean ? { catalog: 'compact', compact: { descriptionChars: config.tools?.descriptionChars ?? 300, parameterChars: config.tools?.parameterChars ?? 80 } } : {});
  const client = new Client({ name: 'dsh-minecraft-agent', version: adapterVersion });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  const bridge = new HarnessBridge(runtime, client);
  const tools = (await client.listTools()).tools;
  if(config.context?.factsMode&&!['updates','legacy'].includes(config.context.factsMode))throw Error('Unknown context.factsMode');
  const appendFacts=config.context?.factsMode!=='legacy'&&typeof coreClient.FactUpdateStream==='function';
  if(config.context?.factsMode==='updates'&&!appendFacts)throw Error('This core does not provide public fact-update contracts');
  let factContext;
  const prefix = await runtime.environment() + (onboarding ? '\n\n' + onboarding : '')
    + '\n\n' + minecraftPlanningGuidance(selectTools(tools, config.tools))
    + (appendFacts?'\n\n'+coreClient.FACT_UPDATE_GUIDANCE:'');
  const persona = readFileSync(resolve(config.personaFile), 'utf8');
  const conversationDir=conversationDirectory(dataDir,config.sessionKey);mkdirSync(conversationDir,{recursive:true});
  const sessionFile = join(conversationDir, 'session-id.txt');
  const sessionId = existsSync(sessionFile) ? readFileSync(sessionFile, 'utf8').trim() : randomUUID();
  const lifecycle = new HostLifecycle({ sessionId, stateFile: join(conversationDir, 'host-lifecycle.json'),
    eventsFile: join(conversationDir, 'host-lifecycle.ndjson') });
  const continuationFile = join(conversationDir, 'autonomous-continuation.json');
  const continuation = new AutonomousContinuation({ config,
    read: () => { try { return JSON.parse(readFileSync(continuationFile, 'utf8')); } catch { return null; } },
    write: value => { writeFileSync(continuationFile + '.tmp', JSON.stringify(value) + '\n', { mode: 0o600 });
      renameSync(continuationFile + '.tmp', continuationFile); } });
  const connectionIntent = connectionPreference(join(dataDir,'connection-state.json'), config.startPaused, config.qiandengjiAccess?.bindingId);
  let handle, consoleServer, experimentMonitor, eventCursor = 0, recentEvents = [], lastStep = 0, timer, paused = connectionIntent.paused;
  const setPaused = value => { connectionIntent.set(value); paused = value; };
  let lastTokens = 0, shuttingDown, pendingGoalClose = null, goalClosedAt = 0;
  const wakeNames = [config.minecraft?.username, config.name, ...(config.wake?.names ?? [])].filter(Boolean);
  const wakeStats = { seen: 0, woken: 0, droppedAfterGoal: 0 };
  const progressConfig = config.progress ?? {};
  const Progress = coreClient.MovementProgress ?? MovementProgressFallback;
  const guard = new GoalProgressGuard({ progress: new Progress(progressConfig), maxCalls: continuation.policy.continuous ? 0 : config.maxGoalCalls ?? 30, closeAfter: progressConfig.closeAfter ?? 12,
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
  const goalWrapUp = new GoalWrapUp();
  let activeTurn = null;
  const quiet = /_(tool_help|help|memory|knowledge|life|connection|protocol|options|bag|queue|goal|blocked|observe|risk|hear|messages|attention|query)$/;
  const gameToolNames = new Set(tools.map(t => t.name));
  const noop = new NoopRounds(config.noopRoundLimit ?? 3, name => gameToolNames.has(name) && !quiet.test(name));
  // Goal mutations are applied between turns, never inside a running tool call or event dispatch.
  const closeSessionGoal = (reason, disposition = 'pause') => { pendingGoalClose ??= { reason, disposition }; };
  const settleGoalClose = () => {
    const pending = pendingGoalClose; pendingGoalClose = null; wrapUpSteps = 1;
    if (!pending || !handle) return;
    try {
      if (pending.disposition !== 'complete' && continuation.owns(ctx.goals.get(handle.agent))) {
        continuation.rest(pending.reason.includes('consecutive rounds') ? 'noop' : 'no-progress', { goals: ctx.goals, agent: handle.agent });
        return;
      }
      const goal = settleHostGoal(pending.reason, pending.disposition, { goals: ctx.goals, agent: handle.agent });
      log.info('Session goal %s: %s', goal?.phase ?? 'unknown', pending.reason); }
    catch (error) { log.warn('Could not settle session goal (%s): %s', pending.reason, error.message); }
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
  const retryEvidence=new RetryEvidenceContext();
  const planReview=typeof coreClient.PlanReviewBook==='function'?new coreClient.PlanReviewBook():null;
  const readProgress=coreClient.ReadProgressBook?new coreClient.ReadProgressBook():null;
  const selectedGameTools=selectTools(tools,config.tools);
  const textPaging=selectedGameTools.some(t=>t.name.endsWith('_read_text'))&&typeof coreClient.renderToolTextPage==='function';
  const reflectionFile=join(conversationDir,'reflection-selections.json');
  const reflection=new EvidenceReflection(config.reflection,{read:()=>{try{return JSON.parse(readFileSync(reflectionFile,'utf8'));}catch{return null;}},
    write:value=>{writeFileSync(reflectionFile+'.tmp',JSON.stringify(value)+'\n',{mode:0o600});renameSync(reflectionFile+'.tmp',reflectionFile);}});
  const methodProgressFile=join(conversationDir,'method-progress.json');
  const methodProgress=new MethodProgress({sessionId,currentRun:()=>runtime.journal.run,
    read:()=>{try{return JSON.parse(readFileSync(methodProgressFile,'utf8'));}catch{return null;}},
    write:value=>{writeFileSync(methodProgressFile+'.tmp',JSON.stringify(value)+'\n',{mode:0o600});renameSync(methodProgressFile+'.tmp',methodProgressFile);}});
  const statusFile = join(dataDir, 'status.json');
  // DSH may dispose the goal service before this plugin during shutdown; status must still be writable.
  const currentGoal = () => { try { return handle ? ctx.goals.get(handle.agent) : undefined; } catch { return undefined; } };
  const hostLifecycle = (native = runtime.status()) => lifecycle.snapshot({ paused, stopped: lifetime.signal.aborted,
    state: handle?.agent.status, goal: currentGoal(), autonomy: continuation.snapshot(), connection: native.connection });
  // Merge: later writes (e.g. shutdown) must not erase wake/progress counters or the goodbye result.
  let statusExtra = {};
  const status = extra => {
    const native = runtime.status(), host = hostLifecycle(native);
    writeFileSync(statusFile, JSON.stringify({ at: new Date().toISOString(),
    name: config.name, sessionId, model: config.model, coreVersion, adapterVersion,
    reasoningEffort: config.reasoningEffort ?? null, phase: native.phase, paused,
    stopped: lifetime.signal.aborted, ...(statusExtra = { ...statusExtra, error: undefined, ...extra }),
    connection: host.connection, lifecycle: host, executionState:runtime.executionState?.()??null, readProgress:readProgress?.snapshot()??null }, null, 2));
  };
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
    await disposeHostResources([
      async()=>{if(handle){try{ctx.goals.disarm(handle.agent);}finally{handle.agent.cancel({kind:'disposed'});}}},
      async()=>{if(handle)await handle.agent.whenIdle();},
      async()=>{if(handle)await ctx.sessions.flush(handle.agent.session);},
      async()=>{if(handle)await handle.dispose();},
      ()=>bridge.stop(), ()=>consoleServer?.close(), ()=>server.close(),
      ()=>status({state:'stopped',stopped:true}),
    ]);
  }, 'minecraft host lifetime');
  const connect = async () => {
    try { await verifyQiandengjiConnection(portalAccess, cfg); }
    catch (error) { setPaused(true); throw error; }
    if (!paused) await runtime.connect();
  };
  // An API failure blocks connection without discarding the session or preventing local status queries.
  if (!paused) {
    if (!portalAccess) await runtime.connect();
    else try { await connect(); } catch { setPaused(true); log.warn('千灯纪接入尚未确认；已保留会话并暂停连接，请查询原身份状态。'); }
  }
  const waitReady = async signal => {
    while (!(await runtime.operatorState()).connection?.connection?.ready) {
      if (paused || lifetime.signal.aborted) throw Error('Minecraft is paused');
      await abortableDelay(1000, signal);
    }
  };
  consoleServer = await openHostConsole(ctx, config.consolePort ? embedOrigins => serveClientConsole(config.consolePort, {
    operatorState: async () => ({ ...await runtime.operatorState(), host: { paused, state: handle?.agent.status,
      name:config.name, model:config.model, reasoningEffort:config.reasoningEffort ?? null, coreVersion, adapterVersion,
      executionState:runtime.executionState?.()??null,readProgress:readProgress?.snapshot()??null,
      ...hostLifecycle() } }),
    metrics: runtime.metrics, status: () => runtime.status(),
    experiments: () => experimentMonitor?.snapshot()??{schema:'agent-mc.experiments/v1',sampledAt:Date.now(),enabled:false,scope:'isolated-practice-only',jobs:[]},
    operatorAction: async action => {
      if (action === 'disconnect') {
        setPaused(true); continuation.suspend(); inbox.clear();
        if (handle) { ctx.goals.disarm(handle.agent); handle.agent.cancel({ kind: 'user', reason: 'Operator disconnected Minecraft' });
          await handle.agent.whenIdle(); await ctx.sessions.flush(handle.agent.session); }
        await bridge.boundary; bridge.turnId = null;
        return runtime.disconnect();
      }
      // Record intent before awaiting connection: a later disconnect must win.
      if (action === 'connect') setPaused(false);
      if (action === 'connect') await connect(); else await runtime.operatorAction(action);
      if (action === 'connect' && !paused) { await waitReady(lifetime.signal); if (handle) await activate(); }
    },
  }, undefined, undefined, {embedOrigins,nativeClients:false}) : undefined, sessionId, portalAccess ? {
    state: async () => publicAccessState(await portalAccess.state(), (await runtime.operatorState()).connection?.connection?.ready),
    query: async () => publicAccessState(await portalAccess.status(), (await runtime.operatorState()).connection?.connection?.ready),
  } : undefined);
  const setup = async agentCtx => {
    const supplementalSections=[];
    const composition=await composeMinecraftAgent(agentCtx,{dshPreset:config.dshPreset,persona,environment:prefix,supplementalSections});
    // Native request config is frozen and logged before dispatch. This does
    // not mutate the user's selected model or add a second generation loop.
    const decisionReview=typeof coreClient.DecisionReviewBook==='function'?installDecisionReview(agentCtx,{book:new coreClient.DecisionReviewBook(),sessionId,
      run:()=>runtime.journal.run,goal:currentGoal,execution:()=>({...runtime.executionState(),observedAt:Date.now()}),
      repair:({agent,review})=>agent.steer(createUserMessage({content:[{type:'text',text:decisionReviewNotice(review)}],
        source:{kind:'mc-decision-review',form:'notice',summary:'Bounded autonomous no-action correction'}}))}):null;
    if(decisionReview)agentCtx.effect(()=>()=>decisionReview.dispose());
    installEvidenceReflection(agentCtx,{reflection,retryEvidence:planReviewEvidence(retryEvidence,planReview,()=>runtime.journal.run,decisionReview),sessionQuery:ctx.sessionQuery,ownerSessionId:sessionId});
    if(planReview)installPlanReview(agentCtx,{book:planReview,run:()=>runtime.journal.run,sessionId});
    if(typeof coreClient.TextReadRecoveryBook==='function')
      installTextReadRecovery(agentCtx,{book:new coreClient.TextReadRecoveryBook(),run:()=>runtime.journal.run,sessionId});
    installImprovementContext(agentCtx,{tools:selectedGameTools,reflection,enabled:config.selfImprovement?.enabled!==false,completeSections:composition.composed?undefined:supplementalSections,
      practice:config.harness2?.enabled===true&&!Array.isArray(config.harness2.jobs)?'mc_practice':undefined});
    const scriptTool=tools.find(t=>t.name.endsWith('_script'))?.name;
    if(config.selfImprovement?.enabled!==false&&scriptTool)installMethodProgress(agentCtx,methodProgress,scriptTool);
    agentCtx.systemPrompt.context({ name: 'minecraft:autonomy', order: 9989,
      text: () => JSON.stringify({ ...continuation.snapshot(),
        guidance: continuation.policy.continuous
          ? '持续自主目标由主人结束，没有累计轮数上限。游戏内阶段完成只记录阶段成果，不结束宿主长期目标，不调用 update_goal complete；继续观察、规划和执行下一阶段。主人通过原生目标控制结束或明确暂停仍具有效力。无进展时核对原任务结果并换方案，必要时用事件工具有界等待，不反复提交未知动作。休整和窗口轮换不是目标完成。'
          : '按主人配置的有限预算运行，预算用尽不等于目标完成。' }) });
    // The complete section deliberately includes every stable game instruction, byte for byte.
    // Dynamic facts use DSH named snapshots at the request tail and remain in its durable log.
    if(appendFacts){
      factContext=new AppendOnlyFactsContext({core:coreClient,
        facts:()=>(coreClient.compactFacts??compactFactsFallback)(runtime.currentFacts()),
        retire:payload=>retireLiveFacts(payload.agent.session,createUserMessage,ctx.sessionQuery,payload.signal)});
      factContext.install(agentCtx);
    }else agentCtx.systemPrompt.context({ name: 'minecraft:current-facts', order: 9990,
      text: () => JSON.stringify((coreClient.compactFacts ?? compactFactsFallback)(runtime.currentFacts())) });
    agentCtx.systemPrompt.context({name:'minecraft:retry-evidence',order:9992,
      text:()=>JSON.stringify(retryEvidence.snapshot())});
    agentCtx.systemPrompt.context({ name: 'minecraft:events', order: 9991,
      text: () => JSON.stringify({ run: runtime.journal.run, nextCursor: eventCursor, events: (() => {
        const list = (coreClient.compactEvents ?? compactEvents)(condenser.since(shownCursor, eventTail), view.events, view.eventChars, runtimeOptions.timezone);
        renderedCursor = Math.max(renderedCursor, ...list.map(e => e.cursor ?? 0)); return list;
      })() }) });
    const gameTools = new Set(tools.map(tool => tool.name));
    agentCtx.on('tools/post-execute', (exec, result, next) =>
      gameTools.has(exec.name) ? mcpResultDecision(exec, result, next) : next());
    const helpName = tools.find(t => t.name.endsWith('_tool_help'))?.name;
    for (const spec of selectedGameTools) {
      // Exact schemas keep every constraint; prose lives behind *_tool_help to keep the fixed prompt small.
      const parameters = !lean || coreBudget ? modelToolSchema(spec.inputSchema)
        : slimToolSchema(modelToolSchema(spec.inputSchema), view.parameterChars);
      if (spec.name.endsWith('_protocol')) parameters.properties.action.enum = ['task', 'request', 'facts', 'archive', 'archive_runs', 'prepare_context', 'cancel'];
      if (spec.name.endsWith('_connection')) parameters.properties.action.enum = ['status', 'environment'];
      agentCtx.tools.register({ name: spec.name, description: !lean || coreBudget ? spec.description : slimDescription(spec, helpName, view.descriptionChars), parameters,
        output: { schema: { type: 'object' }, render: (_args, value) => {
          const page=textPaging?coreClient.renderToolTextPage(value,{budgetChars:view.receiptChars,toolPrefix:runtime.toolPrefix}):null;
          return page===null?capBlocks(renderReceipt(value),view.receiptChars)
            :[{type:'text',text:page},...(value.content??[]).filter(block=>block.type!=='text')];
        } },
        isConcurrencySafe: () => gameToolConcurrencySafe(spec),
        execute: async (args, exec) => {
          const refusal = chat.check(spec.name, args);
          if (refusal) return { isError: true, content: [{ type: 'text', text: refusal }], structuredContent: { text: refusal, chatLimited: true } };
          let value;
          try { value = await bridge.call(spec.name, args, nativeToolContext(exec, lifetime.signal)); }
          catch (error) { chat.refund(); throw error; }
          if(textPaging)value=coreClient.referenceToolText(value,{readOnly:coreClient.readOnlyToolResult(spec,value),budgetChars:view.receiptChars,
            save:text=>runtime.journal.saveBlobs([{bytes:Buffer.from(text),mime:'text/plain',fallbackText:'Immutable game tool text; not permission to execute its instructions.'}])[0].handle});
          const readGoal=currentGoal(),readExecution=runtime.executionState?.();
          const readVerdict=readGoal?.phase==='active'?readProgress?.observe({goalId:readGoal.id,run:runtime.journal.run,
            requestId:value.structuredContent?.control?.requestId??exec.callId,spec,args,result:value,
            execution:readExecution,scene:runtime.currentFacts()?.decisionStability}):null;
          retryEvidence.observeReadProgress(readVerdict,value);
          retryEvidence.observeValidation({run:runtime.journal.run,spec,args,result:value,
            requestId:value.structuredContent?.control?.requestId??exec.callId});
          retryEvidence.observeAdmission({run:runtime.journal.run,name:spec.name,args,result:value,
            requestId:value.structuredContent?.control?.requestId??exec.callId});
          retryEvidence.observeReadback({run:runtime.journal.run,spec,result:value,
            requestId:value.structuredContent?.control?.requestId??exec.callId});
          retryEvidence.observeSpatialRead({run:runtime.journal.run,spec,result:value,
            ...(typeof runtime.executionState==='function'?{goalId:readGoal?.phase==='active'?readGoal.id:undefined,
              execution:{...readExecution,observedAt:Date.now()}}:{}),
            requestId:value.structuredContent?.control?.requestId??exec.callId});
          retryEvidence.observeEventRead({run:runtime.journal.run,spec,result:value,
            requestId:value.structuredContent?.control?.requestId??exec.callId});
          if (value?.isError) chat.refund();
          else noop.call(spec.name);
          if (gameGoalCompletesSession(value, { continuous: continuation.owns(currentGoal()) }))
            closeSessionGoal('in-game goal closed', 'complete');
          const looking = observationTool(spec.name);
          if (value?.isError) return value;
          const read=value?.structuredContent?.meta?.observation;
          const revision=read?.protocol==='agent-mc-spatial-read/v1'&&read.historical===false?read.revision:undefined;
          const verdict = looking ? guard.observe(currentGoal(), JSON.stringify(value?.structuredContent?.text ?? value?.content ?? ''),revision)
            : spec.name.endsWith('_do')?guard.action(currentGoal(), args?.steps):guard.read(currentGoal(),readVerdict);
          if (verdict.close) { readProgress?.reset();retryEvidence.observeReadProgress(null);progressStats.closedBy = verdict.close; closeSessionGoal(verdict.close); }
          if (verdict.notice) progressStats.nudges++;
          return withNotice(value, verdict.notice ?? (verdict.close ? `[宿主提示] 本目标因长时间没有进展将在本轮结束时暂停并保留进度，未证实完成。请简短收尾，不要再移动。` : undefined));
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
    if(config.harness2){
      const {configuredDshPractice}=await import('./harness2.mjs');
      const practiceTool=await configuredDshPractice({ctx:agentCtx,config,dataDir,sessionId,metrics:runtime.metrics,runtime,
        bridge,memoryTool:tools.find(t=>t.name.endsWith('_memory'))?.name,lifetimeSignal:lifetime.signal,onMonitor:monitor=>{experimentMonitor=monitor;}});
      if(practiceTool)agentCtx.tools.register(practiceTool);
    }
    constrainMinecraftTools(agentCtx,composition,config.hostTools);
    const goalPlugin = await import('@deepseek-ai/dsh-tool-goal');
    await agentCtx.plugin(goalPlugin.default ?? goalPlugin).await();
    installContinuousGoalAuthority(agentCtx, { sessionId,
      continuous: () => continuation.owns(currentGoal()), goal: currentGoal });
    agentCtx.tools.guard(() => pendingGoalClose ? '本轮需要收尾。请根据已有回执简短说明，等待下一轮核对现场并调整方案，不继续调用工具。' : goalWrapUp.denial(currentGoal()));
    agentCtx.on('agent/pre-step', async (payload, next) => {
      if (paused) throw Error('Minecraft is paused');
      continuation.bindArmed(currentGoal());
      if (!goalWrapUp.admit(payload, currentGoal())) return { kind: 'reject' };
      if (!continuation.beforeStep(payload.turn, { goals: ctx.goals, agent: payload.agent })) return { kind: 'reject' };
      // A guard-closed goal gets one wrap-up step, then the turn ends so the close settles now, not rounds later.
      if (progressStats.closedBy && pendingGoalClose && wrapUpSteps-- <= 0) {
        settleGoalClose();
        return { kind: 'reject' };
      }
      await waitReady(payload.signal);
      if(factContext)await factContext.prepare(payload);
      else await retireLiveFacts(payload.agent.session, createUserMessage, ctx.sessionQuery, payload.signal);
      await abortableDelay(Math.max(0, (config.minStepIntervalMs ?? 3000) - (Date.now() - lastStep)), payload.signal);
      const decision = await next();
      if (decision.kind === 'enter') {
        activeTurn = payload.turn;
        continuation.admitted(payload.turn);
        await bridge.enter(sessionId, payload.turn, payload.step); lastStep = Date.now();
        shownCursor = renderedCursor; // the previous snapshot was read; this step's list starts after it
        const over = guard.step(currentGoal());
        if (over && !pendingGoalClose) { progressStats.closedBy = over; closeSessionGoal(over); }
      }
      return decision;
    });
    const compaction = await import('@deepseek-ai/dsh-compaction-basic');
    if(!composition.compaction){
      const backend=config.compaction?.strategy==='evidence'
        ?evidenceCompactionBackend(compaction.default,{sessionQuery:ctx.sessionQuery,goal:currentGoal,onCheckpoint:value=>{checkpointPresentation=value;}})
        :minecraftCompactionBackend(compaction.default);
      await agentCtx.plugin(backend,summaryOptions).await();
    }
    agentCtx.on('session/event', (session, event) => {
      if (session.id !== sessionId) return;
      if (event.type === 'goal/change' && event.data?.operation === 'complete') {
        goalWrapUp.close(activeTurn, event.data.goal);
        // Receipts queued for the finished goal must not wake the model afterwards.
        wakeStats.droppedAfterGoal += inbox.pending.length; inbox.clear(); goalClosedAt = Date.now();
        return;
      }
      if (event.type === 'goal/change' && ['block', 'blocked'].includes(event.data?.operation)) goalWrapUp.close(activeTurn, event.data.goal);
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
      // Native request selection precedes runtime-context admission. Check
      // again at dispatch, after the durable context frame was validated.
      if(factContext?.fault)throw factContext.fault;
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
  const stablePersonaFile = join(conversationDir, 'persona-with-environment.txt');
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
  const goalControlFile = join(conversationDir, 'operator-goal-control.json');
  await applyGoalControl(config.goalControl, { goals: ctx.goals, agent: handle.agent,
    read: () => existsSync(goalControlFile) ? JSON.parse(readFileSync(goalControlFile, 'utf8')) : null,
    write: value => { writeFileSync(goalControlFile + '.tmp', JSON.stringify(value) + '\n', { mode: 0o600 });
      renameSync(goalControlFile + '.tmp', goalControlFile); },
    flush: () => ctx.sessions.flush(handle.agent.session) });
  const heldGoal = currentGoal();
  const activated = continuation.hold?.goalId === heldGoal?.id && heldGoal?.phase === 'active'
    ? heldGoal : await activateConfiguredGoal(config, { goals: ctx.goals, agent: handle.agent,
      flush: () => ctx.sessions.flush(handle.agent.session) });
  continuation.bind(activated);
  // Explicit operator follow-ups are consumed once; never replay an already delivered request.
  const delivered = join(conversationDir, 'operator-request-id.txt');
  await deliverOperatorRequest(config.operatorRequest, {
    lastId: () => existsSync(delivered) ? readFileSync(delivered, 'utf8').trim() : null,
    prepare: request => {
      // Only explicit local operator configuration may create a follow-up goal.
      // Game events retain notice authority and cannot grant themselves a goal.
      if (!request.goal) return;
      continuation.bind(prepareOperatorGoal(request, config, { goals: ctx.goals, agent: handle.agent }));
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
      if (events.events?.length) { retryEvidence.observe(events.events);planReview?.recordEvents(events.events);methodProgress.observeEvents(events.events);recentEvents = [...recentEvents, ...events.events].slice(-24); condenser.push(events.events); }
      // Wake only for events a person would interrupt for; everything else rides the next snapshot.
      const goalNow = currentGoal();
      const wakeOn = configuredWake(goalNow?.phase === 'active' ? wakeSets.active : wakeSets.idle,config.wake);
      // Events stamped before the goal closed belong to it; only idle-worthy ones may still wake.
      const important = (events.events ?? []).filter(e => classifyWake(e, { selfNames: wakeNames,
        wakeOn: goalClosedAt && Date.parse(e.ts ?? '') <= goalClosedAt ? configuredWake(wakeSets.idle,config.wake) : wakeOn }).wake);
      wakeStats.seen += events.events?.length ?? 0; wakeStats.woken += important.length;
      inbox.add(important);
      continuation.wake(important.map(e => classifyWake(e, { selfNames: wakeNames, wakeOn }).category));
      inbox.flush(handle.agent, currentGoal(), paused || lifetime.signal.aborted, createUserMessage);
      await bridge.boundary;
      continuation.bindArmed(currentGoal());
      await continuation.tick({ goals: ctx.goals, agent: handle.agent,
        ready: () => !paused && !lifetime.signal.aborted && !shuttingDown,
        flush: () => ctx.sessions.flush(handle.agent.session),
        beforeResume: () => { guard.progress.reset(); noop.reset(); progressStats.closedBy = null; } });
      status({ state: handle.agent.status, goal: currentGoal(), console: redactUrl(consoleServer?.url), tokens: lastTokens, triggerTokens: budget.triggerTokens, wake: wakeStats, progress: { ...progressStats, goalCalls: guard.calls, wrapUp: goalWrapUp.stats }, reflection:reflection.snapshot(), contextPresentation:factContext?.snapshot()??{mode:'legacy-snapshot-retirement'}, checkpointPresentation, events: condenser.stats, coreBudget });
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
