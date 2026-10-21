import { readFileSync, writeFileSync, copyFileSync, openSync, closeSync, renameSync, unlinkSync, existsSync, statSync, realpathSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [
  ['lib/index.js', '5135179ac810e4f626f32ec3bdc3293dc7d2028e8aa92e5e0c006f1a33b78e76'],
  ['lib/worker/profile-resolution-bootstrap.js', 'ccc8086845b5bba49e5fe3eed55cc1ddc3e96fc5eda1fee035e9d6a730137f19'],
];

function patched(bytes) {
  const text = bytes.toString('utf8'), before = 'createRequire(parent).resolve.paths(name)';
  if (text.split(before).length !== 4) throw Error('Unexpected DSH resolver shape');
  return Buffer.from(text.replace(before, 'createRequire(parent).resolve.paths(name + "/package.json")')
    .replaceAll(before, 'createRequire(parent).resolve.paths(request)'));
}

/** Explicit, exact-byte repair only. Never runs during plugin import or installation. */
export function repairDshResolver({ dshRoot, action = 'check' }) {
  if (!['check', 'apply', 'rollback'].includes(action)) throw Error('Unknown repair action');
  if (!dshRoot) throw Error('Specify --dsh-root for the intended DSH installation');
  const anchor = realpathSync(join(resolve(dshRoot), 'package.json'));
  if (JSON.parse(readFileSync(anchor, 'utf8')).name !== '@deepseek-ai/dsh') throw Error('The selected directory is not the DSH package');
  const manifest = createRequire(anchor).resolve('@deepseek-ai/dsh-app-boot/package.json');
  const root = dirname(realpathSync(manifest));
  if (JSON.parse(readFileSync(manifest, 'utf8')).version !== '0.2.1-rc.2') throw Error('No exact-byte repair for this DSH release; no files changed');
  if (root.includes('.asar')) throw Error('Packaged application archives require an official application update');
  const inspect = () => files.map(([relative, stockHash]) => {
    const path = join(root, relative), bytes = readFileSync(path), before = digest(bytes);
    const backup = path + '.agent-mc-original-' + stockHash.slice(0, 12);
    let stock;
    if (before === stockHash) stock = bytes;
    else if (existsSync(backup) && digest(readFileSync(backup)) === stockHash) stock = readFileSync(backup);
    else {
      // Recognize the exact same fix from another installation without claiming its ownership.
      const original = Buffer.from(bytes.toString('utf8')
        .replace('createRequire(parent).resolve.paths(name + "/package.json")', 'createRequire(parent).resolve.paths(name)')
        .replaceAll('createRequire(parent).resolve.paths(request)', 'createRequire(parent).resolve.paths(name)'));
      if (digest(original) !== stockHash) throw Error(`Unrecognized DSH bytes in ${relative}; no files changed`);
      stock = original;
    }
    const fixed = patched(stock), fixedHash = digest(fixed);
    if (before !== stockHash && before !== fixedHash) throw Error(`Unrecognized DSH bytes in ${relative}; no files changed`);
    if (existsSync(backup) && digest(readFileSync(backup)) !== stockHash) throw Error(`Backup mismatch for ${relative}; no files changed`);
    if (action === 'rollback' && before === fixedHash && !existsSync(backup)) throw Error(`No owned backup for ${relative}; no files changed`);
    return { relative, path, backup, bytes, stock, fixed, before, stockHash, fixedHash };
  });
  const report = (entries, status) => ({ status, version: '0.2.1-rc.2', root,
    files: entries.map(entry => ({ file: entry.relative, sha256: digest(readFileSync(entry.path)),
      originalSha256: entry.stockHash, repairedSha256: entry.fixedHash })),
    restarted: false, modelRequests: 0, gameConnections: 0 });
  let entries = inspect();
  if (action === 'check') return report(entries, entries.every(entry => entry.before === entry.fixedHash) ? 'repaired' : 'repair-required');
  const lock = join(root, '.agent-mc-resolver-repair.lock');
  const fd = openSync(lock, 'wx', 0o600);
  const atomic = (path, bytes) => {
    const temporary = path + '.agent-mc-' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, bytes, { flag: 'wx', mode: statSync(path).mode & 0o777, flush: true });
      renameSync(temporary, path);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  };
  const changed = [];
  try {
    entries = inspect(); // Recheck under the exclusive repair lock.
    for (const entry of entries) {
      const target = action === 'apply' ? entry.fixed : entry.stock;
      if (entry.before === digest(target)) continue;
      if (action === 'apply' && !existsSync(entry.backup)) copyFileSync(entry.path, entry.backup, constants.COPYFILE_EXCL);
      atomic(entry.path, target); changed.push(entry);
    }
    return report(entries, action === 'apply' ? 'repaired' : 'restored');
  } catch (error) {
    for (const entry of changed.reverse()) atomic(entry.path, entry.bytes);
    throw error;
  } finally { closeSync(fd); unlinkSync(lock); }
}
