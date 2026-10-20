/** Explicit packed-core/DSH native-provider integration. Loopback fixture, zero paid model calls. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {configuredDshPractice} from '@jcs130/dsh-minecraft-agent/harness2';
import {GameMemoryBook} from 'agent-mc-world/client';
const require=createRequire(import.meta.url);

test('packed DSH tool uses native DeepSeek, actual pinned Harness2, physical probes and existing game memory',
  {skip:!process.env.HARNESS2_TEST_WORKER,timeout:240000},async()=>{
    const keep=process.env.HARNESS2_TEST_REPORT_DIR;
    if(keep)await mkdir(keep,{recursive:true});
    const dir=await mkdtemp(join(keep??tmpdir(),'dsh-harness2-'));
    const {DeepSeekAdapter,resolveAdapterOptions}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-deepseek')));
    const code=`const target=(await mc.state()).target;
try { await bot.setControlState('forward',true);
for(let i=0;i<7;i++){const p=(await mc.state()).snapshot.position;const dx=target.x-p.x,dz=target.z-p.z;
if(Math.hypot(dx,dz)<0.65)break;await bot.look(Math.atan2(-dx,-dz),0);await bot.waitForTicks(Math.min(20,Math.max(1,Math.floor(Math.hypot(dx,dz)/0.22))));}
}finally{await bot.clearControlStates();}return (await mc.state()).snapshot.position;`;
    const requests=[],metrics=[];
    const server=createServer(async(req,res)=>{
      let raw='';for await(const part of req)raw+=part;
      const body=JSON.parse(raw),text=body.messages.flatMap(m=>m.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('');
      const stage=JSON.parse(text).stage;
      const reply=stage.startsWith('experience.')?{experience:{cue:'A public target on flat supported ground',lesson:'Steer from measured positions and release controls.',evidence:'The read-only reference stayed still; the revised program reached train and independent fixtures.',confidence:'Only these isolated physics cases'}}:{files:{'skills/minecraft-method/scripts/run.js':code}};
      const output=JSON.stringify(reply);requests.push({stage,inputChars:text.length,outputChars:output.length,session:req.headers['x-deepseek-harness-session-id'],thinking:body.thinking});
      res.writeHead(200,{'content-type':'text/event-stream'});
      for(const event of [
        {type:'message_start',message:{id:randomUUID(),type:'message',role:'assistant',model:'deepseek-flash',content:[],usage:{input_tokens:20,cache_read_input_tokens:80,output_tokens:0}}},
        {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
        {type:'content_block_delta',index:0,delta:{type:'text_delta',text:output}},
        {type:'content_block_stop',index:0},
        {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:25}},
        {type:'message_stop'},
      ])res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{
      const adapter=new DeepSeekAdapter({options:()=>resolveAdapterOptions({baseURL:`http://127.0.0.1:${server.address().port}/anthropic`,thinking:'disabled',reasoningEffort:'off',maxTokens:4096}),
        resolveAuth:async()=>({headers:{'x-api-key':'offline-fixture'}}),resolveUserId:()=> 'fixture',prepareExtensions:async()=>({fields:{},accept:async()=>{}})});
      const scope={realm:'example.invalid:25565',account:'fixture',agent:'fixture'},book=new GameMemoryBook(join(dir,'game-memory'));
      const config={name:'fixture',provider:'deepseek',model:'deepseek-flash',reasoningEffort:'off',minecraft:{host:'example.invalid',port:25565,username:'fixture'},
        harness2:{enabled:true,backend:'physics',seeds:[1,2],worker:JSON.parse(process.env.HARNESS2_TEST_WORKER),jobs:[{
          id:'packed-walk',methodId:'packed-walk',task:'Reach mc.state().target using observed snapshot.position. Await bot.look, setControlState, waitForTicks and clearControlStates; release keys. Flat supported Java 1.21.1.',
          baseline:{code:'return (await mc.state()).snapshot.position;',params:{},guidance:'Only read; wiring-check baseline.'},train:'walk-1',holdout:['walk-2'],mode:'parallel',k:1,
          budget:{modelCalls:6,trials:6,wallMs:180000,trialMs:10000,contextBytes:300000}}]}};
      const tool=await configuredDshPractice({ctx:{llm:{stream:options=>adapter.stream(options)}},config,dataDir:dir,sessionId:'fixture-session',metrics:{report:r=>metrics.push(r)},
        bridge:{call:async(name,args)=>{assert.equal(name,'mc_memory');return{structuredContent:{text:JSON.stringify(book.execute(args,{scope,dimension:null}))}};}},memoryTool:'mc_memory',lifetimeSignal:new AbortController().signal});
      assert.equal(requests.length,0);
      const started=new Date().toISOString(),result=await tool.execute({jobId:'packed-walk'},{signal:new AbortController().signal});
      assert.equal(result.gate.eligible,true);assert.equal(result.adopted,false);assert.equal(result.trials,6);assert.equal(result.modelCalls,4);
      assert.equal(requests.length,4);assert.ok(requests.every(r=>r.session==='harness2:fixture-session'&&r.thinking.type==='disabled'));
      assert.equal(book.execute({action:'search',tags:['harness2']},{scope,dimension:null}).total,1);
      assert.deepEqual(await tool.execute({jobId:'packed-walk'},{signal:new AbortController().signal}),result);assert.equal(requests.length,4);
      const journal=JSON.parse(await readFile(join(dir,'practice/jobs/packed-walk/journal.json'),'utf8'));
      assert.equal(journal.memory,'stored');assert.equal(journal.status,'completed');
      await writeFile(join(dir,'summary.json'),JSON.stringify({started,ended:new Date().toISOString(),dataClass:'offline-physics-and-loopback-provider',tokenUsageIsSyntheticFixture:true,realModelApiCalls:0,loopbackProviderCalls:requests.length,
        result,requests,metrics,core:require('agent-mc-world/package.json').version,adapter:require('@jcs130/dsh-minecraft-agent/package.json').version},null,2));
    }finally{await new Promise(r=>server.close(r));if(!keep)await rm(dir,{recursive:true,force:true});}
  });
