import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection';

/** Explicit operator connection intent survives restart. Corrupt state fails closed. */
export function connectionPreference(file, startPaused = false, bindingId) {
  if (bindingId !== undefined && (typeof bindingId !== 'string' || !/^[a-f0-9-]{36}$/i.test(bindingId))) throw Error('Invalid Minecraft identity binding');
  let paused = startPaused === true;
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved.schema !== 'mc-host-connection/v1' || typeof saved.paused !== 'boolean') throw Error('Invalid saved Minecraft connection preference');
    paused = bindingId && saved.bindingId !== bindingId ? true : saved.paused;
  } else if (bindingId) paused = true;
  return { get paused() { return paused; }, set(value) {
    if (typeof value !== 'boolean') throw Error('Invalid connection preference');
    writeFileSync(file + '.tmp', JSON.stringify({ schema:'mc-host-connection/v1', paused:value, ...(bindingId ? {bindingId} : {}) }) + '\n', {mode:0o600});
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
export async function openHostConsole(ctx, createConsole, sessionId, access) {
  let server = createConsole && await createConsole([]), binding = Promise.resolve(), closed = false;
  ctx.inject(['connection', 'webServer'], async scoped => {
    const origin = `http://127.0.0.1:${scoped.webServer.port}`;
    binding = binding.then(async () => {
      if (closed || !createConsole) return;
      const previous = server; server = undefined;
      await previous?.close();
      // Desktop uses the shared Web client at this exact application origin.
      // This allows framing only; it grants no cross-origin API/control access.
      if (!closed) server = await createConsole([origin,'dsh-app://app']);
    });
    await binding;
    // Exact Fetch routes inherit Connection's authentication/Origin fence and do
    // not capture the provider's shadow context through the custom RPC getter.
    if (!closed) scoped.connection.fetch.register({path:'/api/mc-harness/panel-info',methods:['POST'],requestBody:'buffered',fetch:async request=>{
      if (closed) return new Response('Disposed',{status:410});
      let body;try{body=await request.json();}catch{return new Response('Invalid request',{status:400});}
      const parsed=clientRequestSchema.safeParse(body);
      if(!parsed.success||parsed.data.method!=='mc-harness/panel-info')return new Response('Invalid panel envelope',{status:400});
      // Connection authenticates the owner before this exact read-only route.
      // Discovery enables the global page without changing the selected chat.
      return Response.json({type:'server-response',rpcId:parsed.data.rpcId,
        result:panelDescriptor(sessionId,sessionId,server?.url)},{headers:{'cache-control':'no-store'}});
    }});
    if (!closed) scoped.connection.fetch.register({path:'/api/mc-harness/panel',methods:['POST'],requestBody:'buffered',fetch:async request=>{
      if (closed) return new Response('Disposed',{status:410});
      let body;try{body=await request.json();}catch{return new Response('Invalid request',{status:400});}
      const parsed=clientRequestSchema.safeParse(body);
      if(!parsed.success||parsed.data.method!=='mc-harness/panel')return new Response('Invalid panel envelope',{status:400});
      return Response.json({type:'server-response',rpcId:parsed.data.rpcId,
        result:panelDescriptor(sessionId,parsed.data.payload?.sessionId,server?.url)},{headers:{'cache-control':'no-store'}});
    }});
    if (!closed && access) scoped.connection.fetch.register({path:'/api/mc-harness/access',methods:['POST'],requestBody:'buffered',fetch:async request=>{
      if (closed) return new Response('Disposed',{status:410});
      let body; try { body = await request.json(); } catch { return new Response('Invalid request',{status:400}); }
      const parsed = clientRequestSchema.safeParse(body);
      if (!parsed.success || parsed.data.method !== 'mc-harness/access') return new Response('Invalid access envelope',{status:400});
      const {payload,rpcId} = parsed.data;
      let result;
      if (payload?.sessionId !== sessionId) result = {ok:false,error:{code:'session-mismatch',message:'此会话未绑定该 Minecraft 身份。',details:{}}};
      else if (!['state','query'].includes(payload?.action)) return new Response('Invalid action',{status:400});
      else try { result = {ok:true,value:{sessionId,access:await access[payload.action]()}}; }
      catch { result = {ok:false,error:{code:'access-unconfirmed',message:'网站接入状态未确认；保留原身份，稍后查询。',details:{}}}; }
      return Response.json({type:'server-response',rpcId,result},{headers:{'cache-control':'no-store'}});
    }});
  });
  return { get url() { return server?.url; }, async close() {
    if (closed) return;
    closed = true;
    try { await binding; } finally { const previous = server; server = undefined; await previous?.close(); }
  } };
}
