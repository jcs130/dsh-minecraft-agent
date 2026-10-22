import {readFile, lstat, open, rename, unlink} from 'node:fs/promises';
import {isAbsolute, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

/** Optional server-pack access; no identity, password or HTTP protocol is implemented here. */
export async function qiandengjiAccess(config) {
  if (!config.qiandengjiAccess) return null;
  if (config.serverPack !== 'qiandengji') throw Error('QIANDENGJI_SERVER_PACK_REQUIRED');
  const directory = config.qiandengjiAccess.directory;
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw Error('PRIVATE_ACCESS_DIRECTORY_REQUIRED');
  let portal;
  try { portal = await import('agent-mc-qiandengji/portal'); }
  catch { throw Error('QIANDENGJI_PORTAL_PACKAGE_REQUIRED'); }
  return new portal.QiandengjiPortalAccess({directory:resolve(directory)});
}

export async function readPrivateFile(file, maxBytes = 65536) {
  if (typeof file !== 'string' || !isAbsolute(file)) throw Error('PRIVATE_FILE_ABSOLUTE_PATH_REQUIRED');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maxBytes
    || process.platform !== 'win32' && (info.mode & 0o077)) throw Error('PRIVATE_FILE_REQUIRED');
  return readFile(file, 'utf8');
}

/** The caller must use these exact settings, including the private login config. */
export async function verifyQiandengjiConnection(access, minecraft) {
  if (!access) return;
  const settings = await access.connectionSettings();
  for (const key of ['host','port','version','username','auth','loginConfigFile']) {
    if (minecraft?.[key] !== settings[key]) throw Error('QIANDENGJI_IDENTITY_BINDING_MISMATCH');
  }
}

/** Whitelist server metadata; the API's ready state never claims a live game connection. */
export function publicAccessState(value, gameReady = false) {
  if (!value) return null;
  const states = ['missing','identity_saved','ready','not_created','pending','unknown','awaiting_game_bridge'];
  return {username:/^ag_[A-Za-z0-9_]{1,13}$/.test(value.username ?? '') ? value.username : null,
    state:states.includes(value.state) ? value.state : 'unknown',
    identitySaved:value.identitySaved === true, gameAccountCreated:value.gameAccountCreated === true,
    checkedAt:typeof value.checkedAt === 'string' && /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/.test(value.checkedAt)
      && Number.isFinite(Date.parse(value.checkedAt)) ? value.checkedAt : null,
    gameReady:gameReady === true};
}

/** Explicit local setup only. Binding stages the next load; it never reloads a host or enables play. */
export async function runJoin(argv, output = line => console.log(line)) {
  const [action, ...rest] = argv;
  if (action === '--help' || action === 'help') {
    output('Usage: dsh-minecraft-join prepare|status|import|bind --config-file <absolute private agent.json> [--invite-url-file <private file> --username ag_Name] [--identity-file <existing private identity.json>]\nNo game, model, host restart or automatic connection. Credentials stay in the server pack\'s private identity file.');
    return;
  }
  if (!['prepare','status','import','bind'].includes(action) || rest.length % 2) throw Error('INVALID_JOIN_ARGUMENTS');
  const args = {};
  const allowed = new Set(['--config-file', ...(action === 'prepare' ? ['--invite-url-file','--username'] : []),
    ...(action === 'import' ? ['--identity-file'] : [])]);
  for (let i = 0; i < rest.length; i += 2) {
    if (!allowed.has(rest[i]) || Object.hasOwn(args,rest[i]) || !rest[i+1] || rest[i+1].startsWith('--')) throw Error('INVALID_JOIN_ARGUMENTS');
    args[rest[i]] = rest[i+1];
  }
  const file = args['--config-file'], original = await readPrivateFile(file);
  const config = JSON.parse(original), access = await qiandengjiAccess(config);
  if (!access) throw Error('QIANDENGJI_ACCESS_CONFIG_REQUIRED');
  // Serialize separate CLI processes before touching the shared official identity.
  // A stale lock is retained for operator inspection after a crash, never stolen.
  const lock = await open(file + '.join.lock', 'wx', 0o600);
  try {
    await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}) + '\n');
    let state, backup = null;
    if (action === 'prepare') {
      const saved = await access.state();
      const inviteUrl = !saved.identitySaved && args['--invite-url-file']
        ? (await readPrivateFile(args['--invite-url-file'],8192)).trim() : undefined;
      state = await access.prepare({inviteUrl, username:args['--username']});
    } else if (action === 'import') state = await access.importIdentity(args['--identity-file']);
    else if (action === 'status') state = await access.status();
    else {
      const settings = await access.connectionSettings();
      const stateNow = await access.state();
      // A body directory with prior history belongs to that exact role and realm.
      if (config.minecraft?.username && ['username','host','port'].some(key => config.minecraft[key] !== settings[key]))
        throw Error('EXISTING_BODY_IDENTITY_CONFLICT');
      if (await readFile(file,'utf8') !== original) throw Error('CONFIG_CHANGED_DURING_BIND');
      backup = file + '.before-join-' + randomUUID() + '.json';
      const backupHandle = await open(backup,'wx',0o600);
      try { await backupHandle.writeFile(original); } finally { await backupHandle.close(); }
      const temp = file + '.' + randomUUID() + '.tmp';
      try {
        const handle = await open(temp,'wx',0o600);
        try { await handle.writeFile(JSON.stringify({...config, startPaused:true,
          qiandengjiAccess:{...config.qiandengjiAccess,bindingId:randomUUID()},
          minecraft:{...config.minecraft,...settings}},null,2) + '\n'); } finally { await handle.close(); }
        await rename(temp,file);
      } finally { await unlink(temp).catch(()=>{}); }
      state = stateNow;
    }
    output(JSON.stringify({...publicAccessState(state), action, stagedForNextLoad:action === 'bind',
      ...(backup ? {backupFile:backup} : {}), gameConnections:0, modelRequests:0}));
  } finally { await lock.close(); await unlink(file + '.join.lock'); }
}

