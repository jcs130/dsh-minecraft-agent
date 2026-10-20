import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

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

test('lockfile uses the public registry or the exact explicitly unpublished core candidate', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const sources = JSON.parse(readFileSync(new URL('../candidate-sources.json', import.meta.url), 'utf8'));
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!entry.resolved) continue;
    if (entry.resolved.startsWith('file:')) {
      const candidate=sources.candidates.find(c=>c.role==='core');
      assert.equal(sources.published,false);
      assert.equal(candidate?.published,false);
      assert.equal(path,'node_modules/agent-mc-world');
      assert.match(candidate.file,/^vendor\/agent-mc-world-0\.5\.7-rc\.\d+\.tgz$/);
      assert.equal(entry.resolved,`file:${candidate.file}`);
      assert.equal(entry.version,candidate.version);
      assert.equal(entry.version,pkg.dependencies['agent-mc-world']);
      assert.equal(entry.integrity,candidate.integrity);
      assert.match(candidate.commit,/^[a-f0-9]{40}$/);
      assert.match(candidate.sha256,/^[a-f0-9]{64}$/);
      continue;
    }
    assert.ok(entry.resolved.startsWith('https://registry.npmjs.org/'), `${path}: ${entry.resolved}`);
  }
});
