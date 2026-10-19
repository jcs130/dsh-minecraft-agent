import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dryRun, dryRunConfig } from '../scripts/dry-run.mjs';

test('offline dry run lists the real tool catalog without a model, key or network', async () => {
  const lines = [];
  const report = await dryRun({ env: {}, out: l => lines.push(l) });
  assert.ok(report.tools.includes('mc_bag'));
  assert.ok(report.tools.includes('mc_tool_help'));
  assert.ok(report.help);
  assert.equal(report.connected, false);
  assert.ok(lines.some(l => l.startsWith('tools (')));
});

test('connect mode requires explicit server settings and defaults to 1.21.1', () => {
  assert.throws(() => dryRunConfig({}, true), /MC_HOST/);
  const cfg = dryRunConfig({ MC_HOST: 'example.invalid', MC_USERNAME: 'ag_demo', MC_PORT: '25702' }, true);
  assert.equal(cfg.port, 25702); assert.equal(cfg.version, '1.21.1'); assert.equal(cfg.loginConfigFile, '');
});
