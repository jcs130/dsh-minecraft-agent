import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';

const require=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));

test('native plugin admission accepts both supported DSH generations without exemptions',async()=>{
  const {evaluatePluginCompatibility}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')));
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  for(const version of ['0.2.0-rc.2','0.2.1-rc.2','0.2.1-rc.3'])
    assert.equal(evaluatePluginCompatibility(manifest,{},version),undefined);
  const refused=evaluatePluginCompatibility(manifest,{},'0.1.7-rc.2');
  assert.equal(refused.exempted,false);
  assert.ok(Object.keys(refused.requirements??refused.peers).length>0);
});

for(const mode of ['cancel','idle']) test(`native DeepSeek ${mode} settles and closes an unfinished upstream stream`,{timeout:5000},async()=>{
  const {DeepSeekAdapter,resolveAdapterOptions}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-deepseek')));
  const closed=Promise.withResolvers();let calls=0;
  const server=createServer(async(req,res)=>{
    for await(const _ of req){}calls++;
    res.once('close',()=>closed.resolve());
    res.writeHead(200,{'content-type':'text/event-stream'});
    for(const event of [
      {type:'message_start',message:{usage:{input_tokens:1}}},
      {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    // Leave the response open; the provider must own cancellation and socket cleanup.
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const controller=new AbortController();
  const options=resolveAdapterOptions({baseURL:`http://127.0.0.1:${server.address().port}`,
    reasoningEffort:'off',streamIdleTimeoutMs:mode==='idle'?75:1000});
  const adapter=new DeepSeekAdapter({options:()=>options,resolveAuth:async()=>({headers:{'x-api-key':'offline-fixture'}}),
    resolveUserId:()=> 'offline',prepareExtensions:async()=>({fields:{},accept:async()=>{}})});
  const stream=adapter.stream({provider:'deepseek-official',model:'deepseek-flash',sessionId:'offline-persistent',
    messages:[],tools:[],reasoningEffort:'off',maxTokens:100,signal:controller.signal})[Symbol.asyncIterator]();
  try{
    assert.equal((await stream.next()).value.type,'block-start');
    const pending=stream.next();
    if(mode==='cancel') controller.abort();
    await assert.rejects(pending,error=>error.code===(mode==='cancel'?'ABORTED':'TIMEOUT'));
    await closed.promise;
    assert.equal(calls,1);
  }finally{
    controller.abort();server.closeAllConnections();await new Promise(r=>server.close(r));
  }
});
