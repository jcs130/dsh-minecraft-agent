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
import { HarnessBridge, modelToolSchema } from '../src/harness-bridge.mjs';

const require = createRequire(import.meta.url);
test('installed core matches the adapter pin and exposes the authored-method lifecycle', async () => {
  const adapter = require('@jcs130/dsh-minecraft-agent/package.json'), core = require('agent-mc-world/package.json');
  assert.equal(core.version, adapter.dependencies['agent-mc-world']);
  const { METHOD_LIBRARY_SCHEMA, MethodLibrary } = await import('agent-mc-world/client');
  assert.equal(typeof MethodLibrary, 'function');
  for (const op of ['save', 'evidence', 'review', 'adopt'])
    assert.ok(METHOD_LIBRARY_SCHEMA.properties.op.enum.includes(op));
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
