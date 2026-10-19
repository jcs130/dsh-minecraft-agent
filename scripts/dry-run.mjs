#!/usr/bin/env node
// No-model trial run. Never calls an LLM and needs no API key.
//   npm run dry-run              offline: build the real body + MCP bridge, list tools, read tool help. No network.
//   npm run dry-run -- --connect connect with MC_* env vars, read a few snapshots, disconnect. Sends no chat.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from 'agent-mc-world/client';
import { createMinecraftMcpServer } from 'agent-mc-world/mcp';

const READS = ['mc_bag', 'mc_hear', 'mc_risk'];

export function dryRunConfig(env = process.env, connect = false) {
  const cfg = structuredClone(MINECRAFT_CLIENT_DEFAULTS);
  if (!connect) return { ...cfg, host: 'offline.invalid', username: 'DryRunAgent' };
  for (const key of ['MC_HOST', 'MC_USERNAME']) if (!env[key]) throw Error(`--connect needs ${key}`);
  return { ...cfg, host: env.MC_HOST, port: Number(env.MC_PORT ?? 25565), username: env.MC_USERNAME,
    version: env.MC_VERSION ?? '1.21.1', ...(env.MC_LOGIN_CONFIG ? { loginConfigFile: resolve(env.MC_LOGIN_CONFIG) } : {}) };
}

export async function dryRun({ connect = false, env = process.env, out = console.log, readyTimeoutMs = 60000 } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-dry-run-'));
  const runtime = new MinecraftAgentClient({ cfg: dryRunConfig(env, connect), dataDir, agentName: 'dry-run', log: nullLogger() });
  const server = createMinecraftMcpServer(runtime, 'dry-run');
  const client = new Client({ name: 'dsh-minecraft-agent-dry-run', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  const report = { tools: [], help: null, connected: false, reads: {} };
  try {
    await server.connect(left); await client.connect(right);
    report.tools = (await client.listTools()).tools.map(t => t.name);
    out(`tools (${report.tools.length}): ${report.tools.join(', ')}`);
    const help = await client.callTool({ name: 'mc_tool_help', arguments: { name: 'mc_bag' } });
    report.help = help.isError ? null : help.structuredContent ?? help.content;
    out(`mc_tool_help(mc_bag): ${help.isError ? 'error' : 'ok'}`);
    if (connect) {
      await runtime.connect();
      const deadline = Date.now() + readyTimeoutMs;
      while (!runtime.status().facts && Date.now() < deadline) await new Promise(r => setTimeout(r, 500));
      report.connected = Boolean(runtime.status().facts);
      out(`connected: ${report.connected}`);
      if (report.connected) for (const name of READS) {
        const r = await client.callTool({ name, arguments: {} });
        report.reads[name] = r.isError ? 'error' : 'ok';
        out(`${name}: ${report.reads[name]}`);
      }
    }
    return report;
  } finally {
    await runtime.disconnect().catch(() => {});
    await server.close().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  dryRun({ connect: process.argv.includes('--connect') })
    .then(r => process.exit(r.tools.length && (!process.argv.includes('--connect') || r.connected) ? 0 : 1))
    .catch(e => { console.error(e.message); process.exit(1); });
}
