import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger, withToolHelp } from 'agent-mc-world/client';
import { createMinecraftMcpServer } from 'agent-mc-world/mcp';
import { HarnessBridge, MinecraftEventInbox, modelToolSchema } from '../src/harness-bridge.mjs';
import { selectTools } from '../src/harness-budget.mjs';
import { minecraftPlanningGuidance } from '../src/harness-composition.mjs';
import { RetryEvidenceContext, renderReceipt } from '../src/harness-bridge.mjs';
import { EvidenceReflection } from '../src/harness-reflection.mjs';
import { capBlocks } from '../src/harness-budget.mjs';

const require = createRequire(import.meta.url);
test('packed MCP pre-dispatch validation reaches host reflection without executing or rewriting invalid arguments',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dsh-packed-core-'));let dispatched=0;
  const schema={type:'object',required:['bounds'],additionalProperties:false,properties:{
    bounds:{type:'array',minItems:6,maxItems:6,items:{type:'integer',minimum:-16,maximum:16}}}};
  const world={id:'schema-recovery-fixture',tools:()=>withToolHelp([{name:'mc_observe',tags:['read'],
    description:'Inert constrained read',parameters:schema,handler:async()=>{dispatched++;return{text:'fixture accepted'};}}],'mc_tool_help'),
    envPromptVars:()=>({}),async start(){},async stop(){}};
  const runtime=new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'fixture.invalid',username:'SchemaQA'},dataDir:dir,log:nullLogger()},world);
  const server=createMinecraftMcpServer(runtime,'schema-consumer'),client=new Client({name:'schema-consumer',version:'1'});
  const [left,right]=InMemoryTransport.createLinkedPair(),bridge=new HarnessBridge(runtime,client),view=new RetryEvidenceContext();
  const invalid={bounds:[0,-3,20,40,3,50]},original=structuredClone(invalid);
  try{
    await runtime.connect();await server.connect(left);await client.connect(right);await bridge.enter('same-session',1,0);
    const spec=(await client.listTools()).tools.find(x=>x.name==='mc_observe');
    for(const requestId of ['invalid-1','invalid-2']){
      const result=await bridge.call(spec.name,invalid,{id:requestId});
      assert.equal(result.isError,true);assert.equal(result.structuredContent.data.executed,false);
      assert.equal(result.structuredContent.data.reason,'schema_validation');
      view.observeValidation({run:runtime.journal.run,requestId,spec,args:invalid,result});
      const visible=JSON.parse(capBlocks(renderReceipt(result),1500)[0].text);
      assert.equal(visible.isError,true);assert.equal(visible.data.executed,false);
      assert.equal(visible.data.errors[0].expected.limit,16);
    }
    assert.equal(dispatched,0);assert.deepEqual(invalid,original);
    assert.equal(view.snapshot().evidence[0].attempts,2);
    const reflection=new EvidenceReflection({enabled:true,attempts:2}),base={provider:'same',model:'same',reasoningEffort:'off',maxTokens:6000};
    assert.deepEqual(reflection.select(base,view.snapshot(),{turn:1,step:3}),{...base,reasoningEffort:'low'});
    const corrected={bounds:[0,-3,0,4,3,5]},result=await bridge.call(spec.name,corrected,{id:'corrected'});
    view.observeValidation({run:runtime.journal.run,requestId:'corrected',spec,args:corrected,result});
    assert.equal(result.isError,undefined);assert.equal(dispatched,1);assert.equal(view.snapshot(),null);
  }finally{await bridge.ended('same-session',1);await bridge.stop();await client.close();await server.close();await removeFixture(dir);}
});

test('packed SDK/MCP event pages survive the real host cap and distinguish cursor updates from registered work',async t=>{
  const {runtimeExecutionState}=await import('agent-mc-world/client');
  if(typeof runtimeExecutionState!=='function')return t.skip('Installed core predates runtime execution state');
  const nativeRequire=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
  const {snapshotJsonValue}=await import(pathToFileURL(nativeRequire.resolve('@deepseek-ai/dsh-util-values')));
  const dir=await mkdtemp(join(tmpdir(),'dsh-packed-events-'));let host,bodyCalls=0;
  const world={id:'event-consumer-fixture',tools:()=>[{name:'mc_fixture',description:'Inert accepted action fixture',tags:['act'],parameters:{type:'object'},
    handler:async()=>{bodyCalls++;return{text:'accepted fixture',data:{optional:undefined,zero:0},
      execution:{kind:'task',id:'original-generation:3',phase:'accepted',terminal:false,goalCompleted:false}};}}],
    envPromptVars:()=>({}),async start(h){host=h;},async stop(){}};
  const runtime=new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'fixture.invalid',username:'EventConsumer'},dataDir:dir,log:nullLogger()},world);
  const server=createMinecraftMcpServer(runtime,'event-consumer'),client=new Client({name:'event-consumer',version:'1'});
  const[left,right]=InMemoryTransport.createLinkedPair(),bridge=new HarnessBridge(runtime,client),view=new RetryEvidenceContext();
  try{
    await runtime.connect();await server.connect(left);await client.connect(right);await bridge.enter('original-session',3,0);
    await host.pushEvent({source:'fixture',ts:new Date().toISOString(),type:'minecraft.task',text:'original task receipt '.repeat(1000),
      execution:{kind:'task',id:'original-generation:1',phase:'completed',terminal:true,goalCompleted:false}});
    const spec=(await client.listTools()).tools.find(x=>x.name==='mc_events');
    for(const id of ['event-page-1','event-page-2']){
      const value=await bridge.call('mc_events',{run:runtime.journal.run,after:0},{id});
      assert.notEqual(snapshotJsonValue(value),undefined,'Real DSH must accept the MCP value before any renderer is called');
      view.observeEventRead({run:runtime.journal.run,spec,requestId:id,result:value});
      const visible=capBlocks(renderReceipt(value),1500)[0].text,p=JSON.parse(visible);
      assert.equal(p.meta.eventRead.execution.activeCount,0);
      assert.equal(p.meta.eventRead.execution.latestTerminal.id,'original-generation:1');
      assert.equal(p.meta.eventRead.execution.latestTerminal.goalCompleted,false);
      assert.equal(p.meta.eventRead.execution.previousRuns,'not-covered');
      assert.equal(p.meta.eventRead.cursor.nextCursor,value.structuredContent.data.nextCursor);
      assert.equal(value.structuredContent.data.events[0].text,'original task receipt '.repeat(1000));
      assert.ok(visible.length<=1500);
      await host.pushEvent({source:'fixture',ts:new Date().toISOString(),type:'minecraft.chat',text:'new untrusted chat '.repeat(1000),
        senderKey:undefined,meta:{optionalReading:undefined,observedCount:0}});
    }
    assert.equal(view.snapshot().evidence.at(-1).attempts,2);
    const reflection=new EvidenceReflection({enabled:true,effort:'low',attempts:2});
    assert.equal(reflection.select({provider:'same-provider',model:'same-model',reasoningEffort:'none',maxTokens:6000},view.snapshot(),{turn:3,step:1}).reasoningEffort,'low');
    await host.pushEvent({source:'fixture',ts:new Date().toISOString(),type:'minecraft.task',text:'actual task accepted',
      execution:{kind:'task',id:'original-generation:2',phase:'running',terminal:false,goalCompleted:false}});
    const active=await bridge.call('mc_events',{run:runtime.journal.run,after:0},{id:'event-page-3'});
    view.observeEventRead({run:runtime.journal.run,spec,requestId:'event-page-3',result:active});
    assert.equal(view.snapshot(),null);
    for(let i=0;i<2;i++){
      const admitted=await bridge.call('mc_fixture',{}, {id:'same-original-action-request'});
      assert.notEqual(snapshotJsonValue(admitted),undefined,'Native DSH must retain a JSON-safe admission receipt');
      assert.deepEqual(admitted.structuredContent.data,{zero:0});
      assert.equal(admitted.structuredContent.execution.id,'original-generation:3');
      assert.equal(admitted.structuredContent.execution.terminal,false);
      assert.equal(admitted.structuredContent.execution.goalCompleted,false);
    }
    assert.equal(bodyCalls,1,'Querying/replaying the original receipt must not dispatch the action twice');
  }finally{await bridge.ended('original-session',3);await bridge.stop();await client.close();await server.close();
    assert.equal(dirname(dir),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});}
});
test('packed SDK and MCP carry current spatial read evidence into one existing thinking request',async t=>{
  const {spatialReadout}=await import('agent-mc-world/client');
  if(typeof spatialReadout!=='function')return t.skip('Installed core predates typed current spatial reads');
  const dir=await mkdtemp(join(tmpdir(),'dsh-packed-core-'));
  const raw={summary:{observedCells:12,unknownCells:39,materials:[{name:'air',cells:11},{name:'chest',cells:1}]},
    source:'client-visible-world',kind:'voxels',format:'dense',dimension:'overworld',complete:false,retryable:false,
    coverage:{origin:[0,64,0],remainingCount:0,coverageComplete:true,unknownCount:39},cells:[...Array(11).fill(0),1,...Array(39).fill(-1)],next:null};
  const data={readout:spatialReadout(raw),...raw};
  let host,now=Date.now();
  const world={id:'offline-spatial-fixture',tools:()=>withToolHelp([{name:'mc_observe',tags:['read'],description:'Offline read',
    parameters:{type:'object'},handler:async()=>({text:JSON.stringify(data),data,meta:{observation:data.readout}})}],'mc_tool_help'),
    envPromptVars:()=>({}),async start(value){host=value;},async stop(){}};
  const runtime=new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'offline.invalid',username:'SpatialQA'},dataDir:dir,log:nullLogger()},world);
  const server=createMinecraftMcpServer(runtime,'spatial-consumer'),client=new Client({name:'spatial-consumer',version:'1'});
  const[left,right]=InMemoryTransport.createLinkedPair(),bridge=new HarnessBridge(runtime,client),view=new RetryEvidenceContext({now:()=>now});
  try{
    await server.connect(left);await client.connect(right);await runtime.connect();await bridge.enter('original-session',2,0);
    const spec=(await client.listTools()).tools.find(x=>x.name==='mc_observe');
    const readOnce=async id=>{
      const result=await bridge.call('mc_observe',{}, {id});
      assert.deepEqual(result.structuredContent.meta.observation,data.readout);
      assert.equal(result.structuredContent.execution,null);assert.equal(result.isError,undefined);
      const execution={...runtime.executionState(),observedAt:now};
      assert.equal(execution.pendingCalls,0,'The completed MCP read must not remain its own pending work');
      view.observeSpatialRead({run:runtime.journal.run,requestId:id,spec,result,goalId:'original-goal',execution});
      const visible=capBlocks(renderReceipt(result),1500)[0].text;
      assert.ok(visible.includes('"scanComplete":true'));assert.ok(visible.includes('"unknownCount":39'));
      assert.ok(visible.includes('"name":"chest"'));
      return execution;
    };
    const firstState=await readOnce('original-read-1'),secondState=await readOnce('original-read-2');
    assert.equal(firstState.revision,secondState.revision,'Read request identities cannot create a new execution scope');
    const base={provider:'unchanged',model:'unchanged',reasoningEffort:'none',maxTokens:6000};
    const reflection=new EvidenceReflection({enabled:true,attempts:2,minIntervalMs:1000,minRequests:1},{now:()=>now});
    assert.deepEqual(reflection.select(base,view.snapshot(),{turn:2,step:1}),{...base,reasoningEffort:'low'});
    assert.equal(reflection.snapshot().lastReason,'repeated-unchanged-current-observation');
    await host.pushEvent({source:'fixture',ts:new Date().toISOString(),type:'minecraft.task',text:'Fixture task finished',
      execution:{kind:'task',id:'fixture-body:1',phase:'completed',terminal:true,goalCompleted:false}});
    now+=2000;const afterWork=await readOnce('original-read-3');
    assert.notEqual(afterWork.revision,firstState.revision);assert.equal(view.snapshot().evidence[0].attempts,1);
    await readOnce('original-read-4');
    assert.equal(reflection.select(base,view.snapshot(),{turn:3,step:0}).reasoningEffort,'low','New real execution permits recovery of the same terrain read');
    await bridge.ended('original-session',2);
  }finally{await bridge.stop();await server.close();await removeFixture(dir);}
});

test('installed core matches the adapter pin and exposes the authored-method lifecycle', async () => {
  const adapter = require('@jcs130/dsh-minecraft-agent/package.json'), core = require('agent-mc-world/package.json');
  const pin=adapter.dependencies['agent-mc-world'];
  assert.ok(pin===core.version||pin===`https://github.com/jcs130/minecraft-ai-friend/releases/download/agent-mc-world-v${core.version}/agent-mc-world-${core.version}.tgz`);
  const { METHOD_LIBRARY_SCHEMA, MethodLibrary } = await import('agent-mc-world/client');
  assert.equal(typeof MethodLibrary, 'function');
  for (const op of ['save', 'evidence', 'review', 'adopt'])
    assert.ok(METHOD_LIBRARY_SCHEMA.properties.op.enum.includes(op));
});

test('owner and Agent use the same packed notebook, retain revision checks and leave the decision turn untouched',async()=>{
  const {MinecraftWorld}=await import('agent-mc-world/extension');
  const dir=await mkdtemp(join(tmpdir(),'dsh-packed-core-'));
  const cfg={...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'notebook-fixture.invalid',username:'NotebookQA',memoryAgentId:'dsh:stable-notebook',memory:{mode:'local-vector'}};
  const engine=new MinecraftWorld({cfg,dataDir:dir,timezone:'UTC',botName:'DisplayName'});
  const runtime=new MinecraftAgentClient({cfg,dataDir:dir,agentName:'DisplayName',log:nullLogger()},
    {id:'notebook-offline-fixture',tools:()=>withToolHelp(engine.tools(),'mc_tool_help'),envPromptVars:()=>({}),async start(){},async stop(){}});
  const server=createMinecraftMcpServer(runtime,'notebook-consumer',{catalog:'compact'}),client=new Client({name:'notebook-consumer',version:'1'});
  const[left,right]=InMemoryTransport.createLinkedPair();
  try{
    await server.connect(left);await client.connect(right);await runtime.connect();
    const before=runtime.beginTurn('original-notebook-turn');
    const owner=await runtime.notebook({action:'remember',kind:'resource',summary:'西山铁矿',content:'(-12,40,35)，只见两格，深处未知。',dimension:'overworld',source:{kind:'user_report',speaker:'owner',reference:'fixture:owner'}});
    const read=await client.callTool({name:'mc_memory',arguments:{action:'get',id:owner.entry.id}});
    assert.notEqual(read.isError,true);assert.equal(JSON.parse(read.structuredContent.text).entry.summary,'西山铁矿');
    const agent=await client.callTool({name:'mc_memory',arguments:{action:'revise',id:owner.entry.id,expectedRevision:1,kind:'resource',summary:'西山暴露铁矿已采完',content:'原来两格已采完，其他未知。',source:{kind:'agent_note',reference:'fixture:mine-receipt'}}});
    assert.notEqual(agent.isError,true);
    assert.equal((await runtime.notebook({action:'get',id:owner.entry.id})).entry.revision,2);
    await assert.rejects(runtime.notebook({action:'revise',id:owner.entry.id,expectedRevision:1,kind:'resource',summary:'旧修改',content:'不能覆盖新记录',source:{kind:'user_report',speaker:'owner',reference:'fixture:stale'}}),/Revision conflict/);
    assert.deepEqual(runtime.beginTurn(before.id),before);
    await runtime.endTurn(before.id);
  }finally{await runtime.disconnect();await server.close();await removeFixture(dir);}
});

async function removeFixture(dir) {
  assert.equal(dirname(dir), resolve(tmpdir()));
  assert.match(dir.split(/[\\/]/).at(-1), /^dsh-packed-core-/);
  await rm(dir, { recursive: true, force: true });
}

test('packed public SDK/MCP preserves full tool notes and real DSH action attribution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-packed-core-'));
  const schema = { type: 'object', properties: { value: {
    type: 'string', description: 'Full parameter notes from the shared core' } }, required: ['value'] };
  const tools = withToolHelp([{ name: 'mc_fixture', tags: ['read'], description: 'Offline fixture', parameters: schema,
    handler: async args => ({ text: args.value }) }], 'mc_tool_help', { parameterDescriptions: 'on-demand' });
  let starts = 0;
  const world = { id: 'offline-fixture', tools: () => tools, envPromptVars: () => ({}),
    async start() { starts++; }, async stop() {} };
  const runtime = new MinecraftAgentClient({ cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS),
    host: 'offline.invalid', username: 'DshFixture' }, dataDir: dir, log: nullLogger() }, world);
  const rawCall = runtime.call.bind(runtime), observed = [];
  runtime.call = (...args) => { observed.push(args[2]); return rawCall(...args); };
  const server = createMinecraftMcpServer(runtime, 'consumer-test');
  const client = new Client({ name: 'dsh-consumer-test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  const bridge = new HarnessBridge(runtime, client);
  try {
    await server.connect(left); await client.connect(right);
    const advertised = (await client.listTools()).tools.find(t => t.name === 'mc_fixture');
    assert.equal(advertised.inputSchema.properties.value.description, undefined);
    const help = await client.callTool({ name: 'mc_tool_help', arguments: {
      name: 'mc_fixture', path: '/properties/value', full: true } });
    assert.equal(help.isError, undefined);
    assert.deepEqual(JSON.parse(help.structuredContent.text).schema, schema.properties.value);
    assert.equal(starts, 0); // Import, installation and offline help never connect a game.
    await runtime.connect();
    await bridge.enter('original-session', 7, 2);
    const result = await bridge.call('mc_fixture', { value: 'fixture-result' }, { id: 'native-call' });
    assert.equal(result.structuredContent.text, 'fixture-result');
    assert.deepEqual(observed.at(-1).attribution, { controller: 'system2',
      sessionId: 'original-session', decisionId: 'original-session:7:2' });
    assert.equal(result.structuredContent.execution, null);
    await bridge.ended('original-session', 7);
  } finally {
    await bridge.stop(); await server.close(); await removeFixture(dir);
  }
});

test('optional server pack consumes the same public core without starting a second body', async t => {
  let serverPack;
  try { serverPack = await import('agent-mc-qiandengji'); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') return t.skip('Optional server pack not installed'); throw error; }
  const dir = await mkdtemp(join(tmpdir(), 'dsh-packed-core-'));
  const runtime = new serverPack.MymcAgentRuntime({ cfg: structuredClone(serverPack.MYMC_DEFAULTS),
    dataDir: dir, timezone: 'UTC', agentName: 'OfflineDshFixture', log: nullLogger() });
  try {
    assert.ok(runtime instanceof MinecraftAgentClient);
    assert.equal(runtime.status().phase, 'disconnected');
    assert.equal(runtime.toolPrefix, 'mymc');
    assert.ok(runtime.tools().some(t => t.name === 'mymc_memory'));
    assert.ok(runtime.tools().some(t => t.name === 'mymc_tool_help'));
    const { default: Ajv2020 } = await import(pathToFileURL(createRequire(require.resolve('agent-mc-world/package.json')).resolve('ajv/dist/2020.js')));
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const tool of runtime.tools()) assert.doesNotThrow(() => ajv.compile(modelToolSchema(tool.parameters)), tool.name);
    const decisions = await import('agent-mc-world/decisions');
    const forwarded = await import('agent-mc-qiandengji/host-decisions');
    assert.deepEqual(Object.keys(forwarded), Object.keys(decisions));
  } finally { await runtime.disconnect(); await removeFixture(dir); }
});

test('default DSH tools discover all shared routines through the packed SDK and actual MCP handlers', async () => {
  const { MinecraftWorld, listWorkRoutines, readWorkRoutine } = await import('agent-mc-world/extension');
  const dir = await mkdtemp(join(tmpdir(), 'dsh-packed-core-'));
  const cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'offline.invalid', username: 'DshRoutineTest' };
  const engine = new MinecraftWorld({ cfg, dataDir: join(dir, 'engine'), timezone: 'UTC', botName: cfg.username });
  // Explicit inert lifecycle port: real core handlers, no game transport or model.
  const runtime = new MinecraftAgentClient({ cfg, dataDir: dir, log: nullLogger() }, {
    id: 'routine-offline-fixture', tools: () => withToolHelp(engine.tools(), 'mc_tool_help'),
    envPromptVars: () => ({}), async start() {}, async stop() {},
  });
  const server = createMinecraftMcpServer(runtime, 'routine-consumer', { catalog: 'compact' });
  const client = new Client({ name: 'dsh-routine-consumer', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  const bridge = new HarnessBridge(runtime, client);
  try {
    await server.connect(left); await client.connect(right); await runtime.connect();
    await bridge.enter('original-routine-session', 2, 1);
    const selected = selectTools((await client.listTools()).tools);
    const script = selected.find(tool => tool.name === 'mc_script');
    assert.ok(script, 'Default lean tools must expose shared routines');
    const schema = modelToolSchema(script.inputSchema);
    assert.deepEqual(schema.properties.routine.properties.op.enum, ['list', 'read', 'run']);
    assert.equal(schema.properties.params.additionalProperties, true);
    const call = async args => {
      const value = await bridge.call('mc_script', args, { id: `routine-${JSON.stringify(args)}` });
      assert.notEqual(value.isError, true, JSON.stringify(value));
      return JSON.parse(value.structuredContent.text);
    };
    const catalog = await call({ routine: { op: 'list' } });
    assert.deepEqual(catalog, listWorkRoutines());
    assert.equal(catalog.length, 10);
    for (const { id } of catalog) {
      const read = await call({ routine: { op: 'read', id } });
      const expected = readWorkRoutine(id);
      assert.equal(read.sourceHash, expected.sourceHash);
      assert.deepEqual(read.parameters, expected.parameters);
      assert.equal(read.automaticallyReplayed, false);
      assert.equal(read.supportedTransport, 'mineflayer');
    }
    const invalid = await bridge.call('mc_script', { routine: { op: 'run', id: 'swim_route' },
      params: {}, validate: true }, { id: 'invalid-routine' });
    assert.equal(invalid.isError, true);
    assert.equal(invalid.structuredContent.execution, null);
    await bridge.ended('original-routine-session', 2);
  } finally { await bridge.stop(); await server.close(); await removeFixture(dir); }
});

test('default DSH planner can retrieve bundled survival guides over packed MCP without a game connection or model',async()=>{
  const { MinecraftWorld }=await import('agent-mc-world/extension');
  const { readMinecraftKnowledge }=await import('agent-mc-world/client');
  const dir=await mkdtemp(join(tmpdir(),'dsh-packed-core-'));
  const cfg={...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'offline.invalid',username:'KnowledgeQA',version:'1.21.1'};
  const engine=new MinecraftWorld({cfg,dataDir:join(dir,'engine'),timezone:'UTC',botName:cfg.username});
  let starts=0;
  const runtime=new MinecraftAgentClient({cfg,dataDir:dir,log:nullLogger()}, {id:'knowledge-fixture',
    tools:()=>withToolHelp(engine.tools(),'mc_tool_help'),envPromptVars:()=>({}),async start(){starts++;},async stop(){}});
  const server=createMinecraftMcpServer(runtime,'knowledge-consumer',{catalog:'compact'}),client=new Client({name:'knowledge-consumer',version:'1'});
  const [left,right]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left);await client.connect(right);
    const selected=selectTools((await client.listTools()).tools);
    assert.ok(selected.some(tool=>tool.name==='mc_knowledge'));
    assert.ok(selected.some(tool=>tool.name==='mc_script'));assert.ok(selected.some(tool=>tool.name==='mc_memory'));
    assert.match(minecraftPlanningGuidance(selected),/mc_knowledge/);
    const call=async args=>{const value=await client.callTool({name:'mc_knowledge',arguments:args});
      assert.notEqual(value.isError,true,JSON.stringify(value));return JSON.parse(value.structuredContent.text);};
    const entries=[];let offset=0;
    do { const page=await call({action:'search',kind:'guide',limit:10,offset});entries.push(...page.entries);offset=page.nextOffset; } while(offset!==null);
    for(const id of ['guide/bed','guide/night_shelter','guide/equipment','guide/base','guide/storage','guide/farming']) {
      assert.ok(entries.some(entry=>entry.id===id),id+' must be discoverable');
      const args={action:'get',id},value=await call(args);
      assert.deepEqual(value,readMinecraftKnowledge(args,'1.21.1'));assert.equal(value.currentWorldVerified,false);
      assert.equal(value.version,'1.21.1');assert.ok(value.entry.content.length>100);assert.ok(value.entry.sources.length>0);
    }
    assert.equal(starts,0);assert.equal(runtime.status().phase,'disconnected');
  } finally { await runtime.disconnect();await server.close();await removeFixture(dir); }
});

test('shared method terminal wakes the DSH inbox once, while local steps and idle goals stay quiet', async () => {
  const { classifyWake, WAKE_ACTIVE_GOAL } = await import('agent-mc-world/client');
  const inbox = new MinecraftEventInbox(), messages = [];
  const terminal = { type: 'minecraft.method', text: 'fixture method blocked', trigger: 'flush',
    execution: { kind: 'method', id: 'fixture:1', phase: 'blocked', terminal: true, goalCompleted: false } };
  const events = [{ ...terminal, trigger: 'piggyback' }, terminal];
  inbox.add(events.filter(event => classifyWake(event, { wakeOn: WAKE_ACTIVE_GOAL }).wake));
  assert.equal(inbox.pending.length, 1);
  assert.equal(inbox.flush({ status: 'idle', steer: value => messages.push(value) },
    { phase: 'active', activation: 'armed' }, false, value => value), true);
  assert.equal(messages.length, 1); assert.equal(inbox.pending.length, 0);
  assert.equal(classifyWake(terminal).wake, false);
  assert.equal(terminal.execution.goalCompleted, false);
});
