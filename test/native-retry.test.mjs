import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
const require=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
const {Session}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')));
const {apply}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-retry')));
const {resolveRetryPolicy}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')));
const yaml=require('yaml');

test('shipped provider policy retries malformed requests finitely and native retry survives attempt replay',async()=>{
 const config=yaml.parse(fs.readFileSync(new URL('../examples/harness/deepseek.patch.yml',import.meta.url),'utf8')).find(x=>x.id==='llm-deepseek').config;
 const policy=resolveRetryPolicy(config.retryPolicy),session=Session.create('retry-fixture'),agent={session},events=[];
 let definition,handler;
 const ctx={sessionProjections:{register:d=>{definition=d},stateOf:()=>events.reduce((s,e)=>definition.apply(s,e),definition.init())},
  on:(name,h)=>{if(name==='agent/request-error')handler=h},effect(){},logger:{warn(){}}};
 const append=session.append.bind(session);session.append=(...args)=>{const e=append(...args);events.push(e);return e};
 apply(ctx,{}, {random:()=>.5});
 assert.equal(policy.mode,'normal');assert.equal(policy.maxRetries,2);
 // Keep the executor real; eliminate wall-clock waiting for this offline fixture.
 const immediate={...policy,initialDelayMs:0,maxDelayMs:0};
 const payload={agent,turn:1,step:1,provider:'deepseek-official',failure:{code:'MALFORMED_RESPONSE',message:'offline malformed tool input'},retryPolicy:immediate,signal:new AbortController().signal};
 assert.deepEqual(await handler(payload,async()=>undefined),{kind:'retry'});
 assert.deepEqual(await handler(payload,async()=>undefined),{kind:'retry'});
 assert.equal(await handler(payload,async()=>undefined),undefined);
 assert.equal(events.filter(x=>x.type==='llm/retry').length,2);
 // Reinstalling the executor over the same durable attempts cannot reset the allowance.
 apply(ctx,{}, {random:()=>.5});assert.equal(await handler(payload,async()=>undefined),undefined);
 session.append('step/start',{turn:1,step:2});
 for(const code of ['AUTHENTICATION','INVALID_REQUEST','CONTEXT_LENGTH','PERMISSION'])
  assert.equal(await handler({...payload,step:2,failure:{code,message:'offline terminal error'}},async()=>undefined),undefined);
 const cancelled=new AbortController();cancelled.abort();
 assert.equal(await handler({...payload,step:2,signal:cancelled.signal},async()=>undefined),undefined);
 assert.equal(events.filter(x=>x.type==='llm/retry').length,2);
 assert.equal(events.some(x=>x.type==='tool/call'),false);
});

test('native DeepSeek rejects invalid tool JSON before dispatch and a fresh request keeps session identity',async()=>{
 const {DeepSeekAdapter,resolveAdapterOptions}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-deepseek')));
 const sessions=[];let attempts=0,dispatches=0;
 const server=createServer(async(req,res)=>{
  for await(const _ of req){}sessions.push(req.headers['x-deepseek-harness-session-id']);attempts++;
  res.writeHead(200,{'content-type':'text/event-stream'});
  const events=[{type:'message_start',message:{usage:{input_tokens:10,cache_read_input_tokens:90}}},
   {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'fixture-tool',name:'mc_fixture',input:{}}},
   {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:attempts===1?'{"value":':'{"value":1}'}},
   {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:10}},{type:'message_stop'}];
  for(const e of events)res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const options=resolveAdapterOptions({baseURL:`http://127.0.0.1:${server.address().port}`,reasoningEffort:'off'});
  const adapter=new DeepSeekAdapter({options:()=>options,resolveAuth:async()=>({headers:{'x-api-key':'offline-fixture'}}),resolveUserId:()=> 'fixture',prepareExtensions:async()=>({fields:{},accept:async()=>{}})});
  const request={provider:'deepseek-official',model:'deepseek-flash',sessionId:'original-fixture-session',messages:[],tools:[],reasoningEffort:'off',maxTokens:100};
  const execute=async()=>{const chunks=[];for await(const chunk of adapter.stream(request))chunks.push(chunk);
   assert.equal(chunks.at(-1).reason.kind,'tool-calls');
   const block=chunks.find(c=>c.type==='block-end').block;assert.deepEqual(JSON.parse(block.arguments),{value:1});dispatches++;
  };
  await assert.rejects(execute(),e=>e.code==='MALFORMED_RESPONSE');assert.equal(dispatches,0);
  await execute();assert.equal(dispatches,1);assert.equal(attempts,2);assert.deepEqual(sessions,['original-fixture-session','original-fixture-session']);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
