import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createDshHarness2Model,dshPracticeTool,configuredDshPractice} from '../src/harness2.mjs';
const require=createRequire(import.meta.url);

test('Harness2 uses the DSH native DeepSeek route, session, selected thinking level and final usage',async()=>{
  const {DeepSeekAdapter,resolveAdapterOptions}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-deepseek')));
  const patch={files:{'skills/minecraft-method/scripts/run.js':'return 42;'}};
  const requests=[],metrics=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;requests.push({body:JSON.parse(body),session:req.headers['x-deepseek-harness-session-id']});
    res.writeHead(200,{'content-type':'text/event-stream'});
    for(const event of [
      {type:'message_start',message:{id:'offline',type:'message',role:'assistant',model:'deepseek-flash',content:[],usage:{input_tokens:20,cache_read_input_tokens:80,output_tokens:0}}},
      {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
      {type:'content_block_delta',index:0,delta:{type:'text_delta',text:JSON.stringify(patch)}},
      {type:'content_block_stop',index:0},
      {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:25}},
      {type:'message_stop'},
    ])res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const adapter=new DeepSeekAdapter({options:()=>resolveAdapterOptions({baseURL:`http://127.0.0.1:${server.address().port}/anthropic`,thinking:'disabled',reasoningEffort:'off',maxTokens:6000}),
      resolveAuth:async()=>({headers:{'x-api-key':'offline-fixture'}}),resolveUserId:()=> 'fixture',prepareExtensions:async()=>({fields:{},accept:async()=>{}})});
    const model=createDshHarness2Model({stream:options=>adapter.stream(options)},
      {provider:'deepseek',model:'deepseek-flash',reasoningEffort:'off',maxTokens:4096,sessionId:'harness2:fixture'}, {report:v=>metrics.push(v)});
    const result=await model.generate({id:'metadata-request',stage:'inv1.a1',mission:'fixture-only',files:{'task.md':'game-only-fixture'}},new AbortController().signal);
    assert.deepEqual(result.files,patch.files);assert.deepEqual(result.usage,{inputTokens:100,outputTokens:25,cachedTokens:80});
    assert.equal(requests.length,1);assert.equal(requests[0].session,'harness2:fixture');
    assert.equal(requests[0].body.thinking.type,'disabled');assert.equal(requests[0].body.max_tokens,4096);
    assert.equal(metrics.at(-1).outcome,'success');assert.equal(metrics.at(-1).inputTokens,100);
    assert.ok(!JSON.stringify(metrics).includes('fixture-only'));assert.ok(!JSON.stringify(metrics).includes('return 42'));
  }finally{await new Promise(r=>server.close(r));}
});

test('Harness2 rejects incomplete/max-token JSON streams and never requests a model retry',async()=>{
  for(const reason of [null,'max-tokens','error']){
    let calls=0;
    const model=createDshHarness2Model({async *stream(){calls++;yield{type:'reasoning-delta',text:'PRIVATE-THOUGHT'};yield{type:'text-delta',text:'{}'};if(reason)yield{type:'finish',reason:{kind:reason}};}},
      {provider:'fixture',model:'fixture',maxTokens:4096,sessionId:'harness2:fixture'});
    await assert.rejects(model.generate({id:'request',stage:'inv1.a1',mission:'',files:{}},new AbortController().signal));assert.equal(calls,1);
  }
});

test('Agent practice tool allows configured jobs only, carries cancellation and exposes evidence without adoption',async()=>{
  const controller=new AbortController(),jobs=[{id:'walk-job',task:'walk'}];let calls=0;
  const tool=dshPracticeTool({run:async(job,signal)=>{calls++;assert.equal(signal.aborted,false);job.task='changed';return{jobId:job.id,gate:{eligible:true,adopted:false},evidenceRefs:['exact-trial'],adopted:false};}},jobs,controller.signal);
  assert.equal(calls,0);assert.deepEqual(tool.parameters.properties.jobId.enum,['walk-job']);
  const result=await tool.execute({jobId:'walk-job'},{signal:new AbortController().signal});assert.equal(result.adopted,false);assert.equal(jobs[0].task,'walk');
  await assert.rejects(tool.execute({jobId:'other'},{signal:new AbortController().signal}));assert.equal(calls,1);
  assert.equal(await configuredDshPractice({config:{harness2:{enabled:false}}}),null);
});
