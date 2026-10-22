/** Real published DSH profile resolution, never the optional doctor or a mocked resolver. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const root = resolve(process.env.MC_DSH_PROFILE ?? fileURLToPath(new URL('../../', import.meta.url)));
const profileRequire = createRequire(join(root, 'package.json'));
const require = createRequire(profileRequire.resolve('@jcs130/dsh-minecraft-agent/package.json'));
const host = createRequire(join(resolve(process.env.DSH_RUNTIME ?? root), 'package.json'));
const load = name => import(pathToFileURL(require.resolve(name)));
const loadHost = name => import(pathToFileURL(host.resolve(name)));
const inheritedStreamMode = process.env.READABLE_STREAM;
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');

if (!isMainThread) {
  // DSH propagates its profile resolver to Workers. They start with fresh module caches.
  const before = Module._resolveFilename;
  const originalDefect = error => error.name === 'TypeError' && /ResolutionRouter\.routeScoped/.test(error.stack);
  assert.throws(() => require.resolve('process/'), originalDefect, 'Official Worker resolver must actually be active');
  const entry = await load('@jcs130/dsh-minecraft-agent');
  await entry.apply(new Proxy({}, { get() { throw Error('Passive worker import used services'); } }), {});
  await load('@jcs130/dsh-minecraft-agent/harness2');
  await load('agent-mc-world/learning');
  await load('agent-mc-qiandengji');
  assert.equal(Module._resolveFilename, before);
  assert.throws(() => require.resolve('process/'), originalDefect, 'Plugin must not change the host resolver');
  assert.equal(process.env.READABLE_STREAM, inheritedStreamMode);
  assert.equal(require('readable-stream').Readable, require('node:stream').Readable);
  parentPort.postMessage({ workerLoaded: true, workerOfficialResolverActive: true, environmentRestored: true, resolverUnchanged: true });
} else {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-stock-minecraft-'));
  const { Context } = await loadHost('@deepseek-ai/cordis');
  const { loadProfileDirectory, createRuntimeResolution, PluginPackages } = await loadHost('@deepseek-ai/dsh-app-boot');
  const anchor = host.resolve('@deepseek-ai/dsh/package.json');
  const boot = dirname(host.resolve('@deepseek-ai/dsh-app-boot/package.json'));
  const files = ['lib/index.js', 'lib/worker/profile-resolution-bootstrap.js'].map(path => join(boot, path));
  const beforeHashes = files.map(digest);
  // This baseline intentionally reproduces the official rc.2 bug before testing the new entry.
  assert.ok(files.every(path => readFileSync(path, 'utf8').includes('createRequire(parent).resolve.paths(name)')),
    'Regression needs the untouched official DSH fixture, not a doctor-repaired installation');
  const profile = loadProfileDirectory('stock-minecraft-fixture', root, anchor);
  const resolution = await createRuntimeResolution({ installAnchor: anchor, profile, home: directory });
  const ctx = new Context();
  let runtime, mcpServer, mcpClient, worker;
  const report = { dsh: host('@deepseek-ai/dsh/package.json').version, modelRequests: 0, gameConnections: 0 };
  try {
    await ctx.plugin(PluginPackages, { resolution }).await();
    const resolverBeforeImport = Module._resolveFilename;
    if (process.argv.includes('--negative')) {
      // The transitive path taken by a new core can change. Exercise the exact
      // broken resolver request directly; positive cases still load the real SDK.
      assert.throws(() => require.resolve('process/'), error => {
        assert.equal(error.name, 'TypeError');
        assert.match(error.message, /not iterable/);
        assert.match(error.stack, /ResolutionRouter\.routeScoped/);
        return true;
      });
      report.officialDefectReproduced = true;
    } else {
      const { Loader } = await loadHost('@deepseek-ai/cordis-plugin-loader');
      ctx.baseUrl = pathToFileURL(join(root, 'package.json')).href;
      await ctx.plugin(Loader).await();
      const loader = ctx.get('loader');
      // Both independent entry orders run in fresh processes, with no shared module cache.
      if (process.argv.includes('--harness2-first')) await loader.import('@jcs130/dsh-minecraft-agent/harness2');
      const entry = await loader.import('@jcs130/dsh-minecraft-agent');
      await entry.apply(new Proxy({}, { get() { throw Error('Passive import used services'); } }), {});
      await load('@jcs130/dsh-minecraft-agent/harness2');
      const core = await load('agent-mc-world/client');
      const { createMinecraftMcpServer } = await load('agent-mc-world/mcp');
      const { Client } = await load('@modelcontextprotocol/sdk/client/index.js');
      const { InMemoryTransport } = await load('@modelcontextprotocol/sdk/inMemory.js');
      const pack = await load('agent-mc-qiandengji');
      const { createPhysicsMethodPractice } = await load('agent-mc-world/learning');
      const practice = createPhysicsMethodPractice({ directory: join(directory, 'practice'),
        binding: { instanceId: 'offline-fixture', realm: 'offline', account: 'fixture', agent: 'fixture', isolated: true }, seeds: [7, 11] });
      assert.equal(practice.fixtures.length, 2);
      assert.equal(typeof pack.MymcAgentRuntime, 'function');
      const options = { cfg: { ...structuredClone(core.MINECRAFT_CLIENT_DEFAULTS), enabled: false,
        host: 'offline.invalid', username: 'StockDshFixture' }, dataDir: join(directory, 'body'),
        agentName: 'fixture', log: core.nullLogger() };
      runtime = new core.MinecraftAgentClient(options);
      mcpServer = createMinecraftMcpServer(runtime, 'stock-dsh-fixture');
      mcpClient = new Client({ name: 'stock-dsh-fixture', version: '1' });
      const [left, right] = InMemoryTransport.createLinkedPair();
      await mcpServer.connect(left); await mcpClient.connect(right);
      const tools = (await mcpClient.listTools()).tools;
      assert.ok(tools.some(tool => tool.name === 'mc_script'));
      const help = await mcpClient.callTool({ name: 'mc_tool_help', arguments: { name: 'mc_bag' } });
      assert.notEqual(help.isError, true);
      // enabled:false starts the compiled IPC runtime without a server connection.
      await runtime.connect();
      const result = await runtime.call('mc_memory', { action: 'remember', kind: 'method',
        summary: 'Stock DSH synthetic fixture', content: 'Offline compatibility evidence only.',
        source: { kind: 'hypothesis', reference: 'stock-dsh-fixture' } }, { requestId: 'stock-dsh-offline-memory' });
      assert.notEqual(result.failed, true);
      const events = await runtime.events({ run: runtime.journal.run, after: 0, limit: 200, waitMs: 0 });
      assert.equal(events.events.some(event => event.type.includes('connected') && !event.type.includes('disconnected')), false);
      worker = new Worker(new URL(import.meta.url), { execArgv: ['--import',
        pathToFileURL(host.resolve('@deepseek-ai/dsh-app-boot/worker/profile-resolution-bootstrap')).href] });
      const workerResult = await new Promise((resolve, reject) => {
        worker.once('message', resolve); worker.once('error', reject);
        worker.once('exit', code => { if (code) reject(Error(`Worker exited ${code}`)); });
      });
      await worker.terminate(); worker = null;
      assert.equal(Module._resolveFilename, resolverBeforeImport);
      assert.equal(require('readable-stream').Readable, require('node:stream').Readable);
      Object.assign(report, { moduleLoaded: true, officialPluginLoader: true, mcpTools: tools.length, offlineEngineIpc: true,
        offlineGameMemory: true, serverPackLoaded: true, physicsFixtures: practice.fixtures.length, ...workerResult });
    }
  } finally {
    await worker?.terminate();
    await runtime?.disconnect();
    await mcpClient?.close(); await mcpServer?.close();
    await ctx.fiber.dispose();
    assert.deepEqual(files.map(digest), beforeHashes, 'Plugin changed official DSH files');
    assert.equal(process.env.READABLE_STREAM, inheritedStreamMode);
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.match(directory.split(/[\\/]/).at(-1), /^dsh-stock-minecraft-/);
    rmSync(directory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ ...report, frameworkSha256: beforeHashes, frameworkUnchanged: true, environmentRestored: true }));
}
