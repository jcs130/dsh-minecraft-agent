import test from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';import{resolve}from'node:path';import{pathToFileURL}from'node:url';
import{nativeGoalPluginForMode}from'../src/harness-goal.mjs';import{PermissionRecovery,installPermissionRecovery}from'../src/harness-permission-recovery.mjs';
const req=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json')),load=name=>import(pathToFileURL(req.resolve(name)).href);
async function fixture({preset=false}={}){
 const[{Context},{default:Prompt},{default:Tools},scopeApi,native,{HarnessError}]=await Promise.all(['@deepseek-ai/cordis','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-scope','@deepseek-ai/dsh-tool-goal','@deepseek-ai/dsh-llm'].map(load));
 const ctx=new Context(),owner={id:'owner',status:'running',session:{snapshotEvents:()=>[{type:'turn/start'}]}},other={id:'other'};
 let goal={id:'goal-1',revision:1,objective:'Synthetic standing goal',phase:'active',activation:'armed',roundsStarted:5,maxGoalRounds:40};
 const goals={get:()=>goal,pause(){goal={...goal,phase:'paused',activation:'disarmed'};return goal;},resume(){goal={...goal,phase:'active',activation:'armed'};return goal;}};
 ctx.provide('agents',{get:id=>id===owner.id?owner:undefined,currentInitiator:()=>owner,roots:()=>[owner]});ctx.provide('goals',goals);ctx.provide('sessionProjections',{stateOf:()=>({openTurnStartSeq:0})});
 const p=ctx.plugin(Prompt);await p.await();const t=ctx.plugin(Tools);await t.await();
 const official=ctx.plugin(native);await official.await();let scope;
 const minter=ctx.plugin({name:'fixture-minter',inject:['tools','systemPrompt','agents','goals','sessionProjections'],apply(inner){const parent=preset?scopeApi.createScope(inner,{id:'preset'}):null;if(parent)native.apply(parent.ctx,{});scope=scopeApi.createScope(inner,owner,parent?{parent:scopeApi.scopeOf(parent.ctx)}:{});}});await minter.await();owner.ctx=scope.ctx;
 const run=(name,args={},callId=name)=>ctx.tools.execute({agent:owner,name,arguments:args,callId,signal:new AbortController().signal});
 return{ctx,owner,other,goals,native,scopeApi,run,HarnessError,close:async()=>{await minter.dispose();await official.dispose();await t.dispose();await p.dispose();}};
}
test('official autonomous pause reproduces the permission denial; continuous scope advertises and executes only goal reads',async()=>{
 const f=await fixture();try{
  const before=await f.run('update_goal',{goal_id:'goal-1',revision:1,action:'pause'});assert.equal(before.isError,true);assert.equal(before.error.info.code,'GOAL_TOOL_AUTHORITY_REQUIRED');
  const ready=[];const plugin=nativeGoalPluginForMode(f.native,{continuous:true,resolveScope:f.scopeApi.scopeOf,onReady:value=>ready.push(value)}),fiber=f.owner.ctx.plugin(plugin);await fiber.await();
  assert.deepEqual(ready,[{mode:'owner-read-only',modelGoalTools:['get_goal'],ownerControl:'native-ui-and-api'}]);
  const own=f.ctx.tools.schemas(f.owner).map(x=>x.name);assert(own.includes('get_goal'));assert(!own.includes('create_goal'));assert(!own.includes('update_goal'));
  const assembly=await f.ctx.systemPrompt.assemble({scope:f.owner});assert(assembly.tools.some(t=>t.name==='get_goal'));assert(!assembly.tools.some(t=>['create_goal','update_goal'].includes(t.name)));assert.match(JSON.stringify(assembly),/read-only/);
  assert(f.ctx.tools.schemas(f.other).some(x=>x.name==='update_goal'),'other agent capability is preserved');
  const read=await f.run('get_goal');assert.equal(read.isError,false);assert.equal(read.value.goal.id,'goal-1');
  const hidden=await f.run('update_goal',{goal_id:'goal-1',revision:1,action:'pause'},'old-history-call');assert.equal(hidden.isError,true);assert.equal(f.goals.get().phase,'active');
  assert.equal(f.goals.pause().phase,'paused','native owner API still controls the original goal');assert.equal(f.goals.resume().id,'goal-1');
  await fiber.dispose();assert(f.ctx.tools.schemas(f.owner).some(x=>x.name==='update_goal'),'disposal lifts only this scope mask');
 }finally{await f.close();}
});
test('a native ancestor preset keeps its unrelated tools while host goal writes are masked for this Agent',async()=>{
 const f=await fixture({preset:true});try{
  const definition=name=>({name,description:'Synthetic game capability',parameters:{type:'object'},output:{schema:{type:'object'},render:()=>[]},execute:async()=>({ok:true})});
  f.owner.ctx.tools.register(definition('mymc_goal'));f.owner.ctx.tools.register(definition('mymc_events'));
  const fiber=f.owner.ctx.plugin(nativeGoalPluginForMode(f.native,{continuous:true,resolveScope:f.scopeApi.scopeOf}),{});await fiber.await();
  const assembly=await f.ctx.systemPrompt.assemble({scope:f.owner});for(const name of['get_goal','mymc_goal','mymc_events'])assert(assembly.tools.some(t=>t.name===name));
  assert(!assembly.tools.some(t=>['create_goal','update_goal'].includes(t.name)));assert.equal((await f.run('mymc_events')).isError,false);await fiber.dispose();
 }finally{await f.close();}
});
test('bounded mode returns the original official goal plugin without a new policy',async()=>{
 const native=await load('@deepseek-ai/dsh-tool-goal');assert.equal(nativeGoalPluginForMode(native,{continuous:false}),native);
});
test('native final errors remain unchanged while 248 rejections queue one non-authorizing notice',async()=>{
 const f=await fixture();try{
  const book=new PermissionRecovery(),messages=[];f.owner.inject=x=>messages.push(x);
  const off=installPermissionRecovery(f.ctx,{book,sessionId:'owner',goal:()=>f.goals.get(),run:()=> 'run-1',createMessage:x=>x});
  let first;for(let i=0;i<248;i++){const r=await f.run('update_goal',{goal_id:'goal-1',revision:1,action:'pause'},'denied-'+i);assert.equal(r.isError,true);assert.equal(r.error.info.code,'GOAL_TOOL_AUTHORITY_REQUIRED');first??=r;}
  assert.equal(book.snapshot().episodes[0].count,248);assert.match(first.error.message,/direct human/);
  await f.ctx.waterfall(f.owner,'agent/pre-step',{agent:f.owner},()=>Promise.resolve({kind:'enter'}));
  await f.ctx.waterfall(f.owner,'agent/pre-step',{agent:f.owner},()=>Promise.resolve({kind:'enter'}));assert.equal(messages.length,1);assert.equal(f.goals.get().phase,'active');off();
 }finally{await f.close();}
});
test('old-history calls to a masked native mutation preserve tool-not-found and get one capability correction',async()=>{
 const f=await fixture();try{
  const fiber=f.owner.ctx.plugin(nativeGoalPluginForMode(f.native,{continuous:true,resolveScope:f.scopeApi.scopeOf}),{});await fiber.await();const book=new PermissionRecovery(),messages=[];f.owner.inject=x=>messages.push(x);
  const off=installPermissionRecovery(f.ctx,{book,sessionId:'owner',goal:()=>f.goals.get(),run:()=> 'run-1',createMessage:x=>x,continuous:()=>true});
  for(let i=0;i<3;i++){const error=await f.run('update_goal',{goal_id:'goal-1',revision:1,action:'pause'},'legacy-'+i);assert.equal(error.isError,true);assert.equal(error.error.info.name,'ToolNotFoundError');}
  await f.ctx.waterfall(f.owner,'agent/pre-step',{agent:f.owner},()=>Promise.resolve({kind:'enter'}));assert.equal(messages.length,1);assert.equal(book.snapshot().episodes[0].code,'TOOL_NOT_FOUND');assert.equal(f.goals.get().activation,'armed');off();await fiber.dispose();
 }finally{await f.close();}
});
