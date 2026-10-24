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

const require = createRequire(import.meta.url);
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
