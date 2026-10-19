import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

/** Explicit operator connection intent survives restart. Corrupt state fails closed. */
export function connectionPreference(file, startPaused = false) {
  let paused = startPaused === true;
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved.schema !== 'mc-host-connection/v1' || typeof saved.paused !== 'boolean') throw Error('Invalid saved Minecraft connection preference');
    paused = saved.paused;
  }
  return { get paused() { return paused; }, set(value) {
    if (typeof value !== 'boolean') throw Error('Invalid connection preference');
    writeFileSync(file + '.tmp', JSON.stringify({ schema:'mc-host-connection/v1', paused:value }) + '\n', {mode:0o600});
    renameSync(file + '.tmp', file); paused = value;
  } };
}

/** An authenticated DSH channel reveals only the matching session's local panel address. */
export function panelDescriptor(ownedSession, requestedSession, url) {
  if (requestedSession !== ownedSession) return {ok:false,error:{code:'session-mismatch',message:'此会话未绑定 Minecraft 身体。',details:{}}};
  if (!url) return {ok:false,error:{code:'unavailable',message:'尚未启用本机 Minecraft 面板。',details:{}}};
  return {ok:true,value:{sessionId:ownedSession,url}};
}

/** A standalone console also works headless; DSH embedding binds only after its Web carrier is ready. */
export async function openHostConsole(ctx, createConsole, sessionId) {
  let server = createConsole && await createConsole([]), binding = Promise.resolve(), closed = false;
  ctx.inject(['connection', 'webServer'], async scoped => {
    const origin = `http://127.0.0.1:${scoped.webServer.port}`;
    binding = binding.then(async () => {
      if (closed || !createConsole) return;
      const previous = server; server = undefined;
      await previous?.close();
      if (!closed) server = await createConsole([origin]);
    });
    await binding;
    if (!closed) scoped.connection.rpc.handle('/mc-harness', async (endpoint, payload) => endpoint === 'panel'
      ? panelDescriptor(sessionId, payload?.sessionId, server?.url)
      : {ok:false,error:{code:'not-found',message:'Unknown Minecraft panel endpoint',details:{}}});
  });
  return { get url() { return server?.url; }, async close() {
    if (closed) return;
    closed = true;
    try { await binding; } finally { const previous = server; server = undefined; await previous?.close(); }
  } };
}
