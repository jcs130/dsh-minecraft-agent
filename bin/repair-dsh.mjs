#!/usr/bin/env node
import { repairDshResolver } from '../lib/plugins/dsh-compat.mjs';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: dsh-minecraft-doctor --dsh-root <directory containing @deepseek-ai/dsh/package.json> [--apply|--rollback]\nDefault: read-only check. Fully exit DSH/Desktop before applying or rolling back.\nOnly the exact known DSH 0.2.1-rc.2 resolver files can change; verified sidecar backups are retained.\nNo service restarts, profile edits, model requests or game connections.');
} else {
  try {
    const allowed = new Set(['--dsh-root', '--apply', '--rollback']);
    let dshRoot, action = 'check';
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!allowed.has(arg)) throw Error(`Unknown argument ${arg}`);
      if (arg === '--dsh-root') { dshRoot = args[++i]; if (!dshRoot || dshRoot.startsWith('--')) throw Error('Missing --dsh-root directory'); }
      else { if (action !== 'check') throw Error('Choose only one repair action'); action = arg === '--apply' ? 'apply' : 'rollback'; }
    }
    const result = repairDshResolver({ dshRoot, action });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'repair-required') process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
