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

test('lockfile resolves only against the public npm registry', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!entry.resolved) continue;
    assert.ok(entry.resolved.startsWith('https://registry.npmjs.org/'), `${path}: ${entry.resolved}`);
  }
});
