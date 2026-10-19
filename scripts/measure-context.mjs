#!/usr/bin/env node
// Measure the fixed model-visible prompt: tool definitions + persona/environment prefix.
// Usage: node scripts/measure-context.mjs [qiandengji|none] [personaFile]
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from 'agent-mc-world/client';
import { createMinecraftMcpServer } from 'agent-mc-world/mcp';
import { modelToolSchema } from '../src/harness-bridge.mjs';
import { selectTools, slimSchema, slimDescription } from '../src/harness-budget.mjs';

const pack = process.argv[2] ?? 'qiandengji', persona = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : '';
const dir = mkdtempSync(join(tmpdir(), 'dsh-measure-'));
let runtime;
if (pack === 'qiandengji') {
  const { MymcAgentRuntime, MYMC_DEFAULTS } = await import('agent-mc-qiandengji');
  runtime = new MymcAgentRuntime({ cfg: structuredClone(MYMC_DEFAULTS), dataDir: dir, timezone: 'UTC', agentName: 'measure', log: nullLogger() });
} else runtime = new MinecraftAgentClient({ cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'offline.invalid', username: 'm' }, dataDir: dir, log: nullLogger() });
const server = createMinecraftMcpServer(runtime, 'measure');
const client = new Client({ name: 'measure', version: '1' });
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a); await client.connect(b);
const tools = (await client.listTools()).tools;
const prefix = await runtime.environment();
const help = tools.find(t => t.name.endsWith('_tool_help'))?.name;
const full = tools.filter(t => !t.name.endsWith('_trace')).map(t => ({ name: t.name, description: t.description, parameters: modelToolSchema(t.inputSchema) }));
const lean = selectTools(tools, {}).map(t => ({ name: t.name, description: slimDescription(t, help), parameters: slimSchema(modelToolSchema(t.inputSchema)) }));
const chars = v => JSON.stringify(v).length;
const est = n => Math.ceil(n / 4); // DSH token meter heuristic (chars/4); real CJK-heavy usage is higher.
const sys = (persona + '\n\n' + prefix).length;
console.log(JSON.stringify({ pack, systemChars: sys,
  before: { tools: full.length, toolChars: chars(full), meterTokens: est(chars(full) + sys) },
  after: { tools: lean.length, toolChars: chars(lean), meterTokens: est(chars(lean) + sys) },
  perTool: Object.fromEntries(full.map(t => [t.name, [chars(t), chars(lean.find(l => l.name === t.name) ?? '') ]])) }, null, 1));
await runtime.disconnect(); await server.close(); rmSync(dir, { recursive: true, force: true });
