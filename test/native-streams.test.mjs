import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = fileURLToPath(new URL('fixtures/stock-dsh.mjs', import.meta.url));
function run(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8',
    timeout: 45000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return result.stdout;
}

test('untouched official DSH reproduces its original transitive process/ loading defect', () => {
  const env = { ...process.env }; delete env.READABLE_STREAM;
  const report = JSON.parse(run([fixture, '--negative'], env).trim().split('\n').at(-1));
  assert.equal(report.officialDefectReproduced, true);
  assert.equal(report.frameworkUnchanged, true);
});

test('stock DSH loads SDK, MCP, actual offline IPC, server pack, physics and fresh Worker', () => {
  for (const order of [[], ['--harness2-first']]) {
    const report = JSON.parse(run([fixture, ...order]).trim().split('\n').at(-1));
    assert.equal(report.moduleLoaded, true); assert.ok(report.mcpTools > 20);
    assert.equal(report.offlineEngineIpc, true); assert.equal(report.workerLoaded, true);
    assert.equal(report.workerOfficialResolverActive, true);
    assert.equal(report.frameworkUnchanged, true); assert.equal(report.environmentRestored, true);
    assert.equal(report.modelRequests, 0); assert.equal(report.gameConnections, 0);
  }
});

test('native stream bootstrap restores every environment mode and supports pipeline, abort and descendants', () => {
  for (const mode of [undefined, '', 'disable', 'custom']) {
    const env = { ...process.env }; if (mode === undefined) delete env.READABLE_STREAM; else env.READABLE_STREAM = mode;
    run(['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import {createRequire} from 'node:module';
      import {spawnSync} from 'node:child_process';
      import {Readable,Transform,Writable} from 'node:stream';
      import {pipeline} from 'node:stream/promises';
      import {prepareDshNativeStreams} from './src/dsh-native-streams.mjs';
      const before=process.env.READABLE_STREAM; prepareDshNativeStreams(); prepareDshNativeStreams();
      assert.equal(process.env.READABLE_STREAM,before);
      const require=createRequire(import.meta.url),streams=require('readable-stream');
      assert.equal(streams.Readable,Readable); assert.equal(streams.Writable,Writable);
      let bytes=0;await pipeline(Readable.from([Buffer.alloc(2**20),Buffer.alloc(2**20)]),
        new Transform({transform(chunk,encoding,cb){cb(null,chunk);}}),
        new Writable({write(chunk,encoding,cb){bytes+=chunk.length;cb();}}));
      assert.equal(bytes,2**21);
      const controller=new AbortController(),source=new Readable({read(){}});
      const pending=pipeline(source,new Writable({write(chunk,encoding,cb){cb();}}),{signal:controller.signal});
      controller.abort(); await assert.rejects(pending,{name:'AbortError'});assert.equal(source.destroyed,true);
      const child=spawnSync(process.execPath,['-e','process.stdout.write(JSON.stringify(process.env.READABLE_STREAM??null))'],{encoding:'utf8',windowsHide:true});
      assert.equal(child.status,0);assert.equal(JSON.parse(child.stdout),before??null);
    `], env);
  }
});
