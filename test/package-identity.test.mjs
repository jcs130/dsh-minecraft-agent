import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('npm name is scoped and resolves through package self-reference', () => {
  assert.equal(pkg.name, '@jcs130/dsh-minecraft-agent');
  assert.equal(require(`${pkg.name}/package.json`).version, pkg.version);
  assert.match(require.resolve(`${pkg.name}/lib/plugins/mc-harness.mjs`), /mc-harness\.mjs$/);
});

test('browser bundle registers under the npm package name DSH loads it by', () => {
  const banner = readFileSync(new URL('../scripts/build-harness.mjs', import.meta.url), 'utf8');
  assert.ok(banner.includes(`id:${JSON.stringify(pkg.name)}`));
});

test('cordis patch rows point at the scoped module while row ids stay stable', () => {
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.match(patch, /id: mc-frontend\s+name: '@jcs130\/dsh-minecraft-agent'/);
  assert.match(patch, /id: mc-harness\s+name: '@jcs130\/dsh-minecraft-agent\/lib\/plugins\/mc-harness\.mjs'/);
});

test('registry candidate has no URL/file/Git subdependencies and pins the exact verified core bytes', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const sources = JSON.parse(readFileSync(new URL('../candidate-sources.json', import.meta.url), 'utf8'));
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!entry.resolved) continue;
    assert.ok(entry.resolved.startsWith('https://registry.npmjs.org/'), `${path}: ${entry.resolved}`);
  }
  const candidate=sources.candidates.find(c=>c.role==='core'),core=lock.packages['node_modules/agent-mc-world'];
  assert.equal(core.version,candidate.version);assert.equal(core.version,pkg.dependencies['agent-mc-world']);
  assert.equal(core.integrity,candidate.integrity);assert.match(candidate.commit,/^[a-f0-9]{40}$/);
  assert.match(candidate.sha256,/^[a-f0-9]{64}$/);
});
test('DSH metadata is localized and its icon is shipped through the public package',()=>{
  for(const language of ['en','zh']){
    const locale=require(`${pkg.name}/locale/${language}.json`);
    assert.ok(locale.meta.title);assert.ok(locale.meta.description);
  }
  assert.equal(pkg.dsh.client.platform,'web'); // Official Desktop consumes the shared Web client.
  assert.equal(pkg.dsh.manifestVersion,1);
  assert.ok(pkg.files.includes('assets/icon.svg'));
  assert.match(readFileSync(new URL('../assets/icon.svg',import.meta.url),'utf8'),/^<svg/);
});
test('optional audio setup is explicit and its help exits without downloading or starting a body',()=>{
  const output=spawnSync(process.execPath,[fileURLToPath(new URL('../bin/prepare-assets.mjs',import.meta.url)),'--help'],{encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(output.status,0);assert.match(output.stdout,/Usage: dsh-minecraft-assets/);assert.equal(output.stderr,'');
});
