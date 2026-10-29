import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join,dirname,resolve}from'node:path';
import{improvementGuidance,installImprovementContext}from'../src/harness-improvement.mjs';
import{constrainMinecraftTools}from'../src/harness-composition.mjs';
import{configuredMethodPractice,nativePracticePorts}from'../src/harness-practice.mjs';
import{createRequire}from'node:module';import{pathToFileURL}from'node:url';
import{writeFile,readFile}from'node:fs/promises';import{apply as learningAddon}from'../src/self-improvement-plugin.mjs';
test('explicit native skill loader is inherited without exposing other host tools',()=>{
 let value;const ctx={tools:{restrict:v=>{value=v;}}};constrainMinecraftTools(ctx,{composed:false});assert.deepEqual(value,{allow:[]});
 constrainMinecraftTools(ctx,{composed:false},['skill','skill']);assert.deepEqual(value,{allow:['skill']});
 assert.throws(()=>constrainMinecraftTools(ctx,{composed:false},['exec']));
 value=null;constrainMinecraftTools(ctx,{composed:true},['skill']);assert.equal(value,null);
});
test('learning migration retains the exact native goal, queues one notice and never replays it on reload',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dsh-learning-migration-')),configFile=join(dir,'config.json'),reportFile=join(dir,'report.json');
 const goal={id:'original-goal',revision:4,phase:'active',activation:'armed',objective:'Original objective'},effects=[],tools=new Map([['mc_script',{name:'mc_script'}],['mc_memory',{name:'mc_memory'}]]);let notices=0;
 const agent={status:'idle',ctx:{tools:{get:n=>tools.get(n)},plugin:()=>({await:async()=>{tools.set('skill',{name:'skill'});},dispose(){tools.delete('skill');}}),systemPrompt:{section:()=>()=>{},context:()=>()=>{}}},runMaintenance:fn=>fn(new AbortController().signal),inject:()=>{notices++;}};
 const ctx={agents:{get:id=>id==='original-session'?agent:null},goals:{get:()=>goal,disarm:()=>{goal.activation='disarmed';},resume:(_a,ref)=>{assert.equal(ref.id,goal.id);assert.equal(ref.revision,4);goal.activation='armed';}},effect:fn=>effects.push(fn())};
 try{
  await writeFile(configFile,JSON.stringify({expectedPid:process.pid,sessionId:'original-session',goalId:goal.id,reportFile,drain:true}));
  learningAddon(ctx,{configFile});let report;for(let i=0;i<80;i++){try{report=JSON.parse(await readFile(reportFile,'utf8'));if(report.state==='installed')break;}catch{}await new Promise(r=>setTimeout(r,10));}
  assert.equal(report.state,'installed');assert.equal(report.modelCallsAtInstall,0);assert.equal(report.bodyRestarted,false);assert.equal(goal.id,'original-goal');assert.equal(goal.activation,'armed');assert.equal(notices,1);
  learningAddon(ctx,{configFile});assert.equal(notices,1);assert.ok(!JSON.stringify(report).includes('Original objective'));
 }finally{for(const f of effects.reverse())await f?.();assert.equal(dirname(dir),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});}
});
test('real DSH scoped skill plugin restores the loader without lifting the game-only tool restriction',async()=>{
 const require=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json')),load=n=>import(pathToFileURL(require.resolve(n)).href);
 const [{Context},{ToolRuntime},{createScope,scopeOf},skillPlugin]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-tools'),load('@deepseek-ai/dsh-scope'),load('@deepseek-ai/dsh-tool-skill')]);
 const root=new Context();let owner;const services=await root.plugin({name:'native-learning-services',apply(ctx){
  ctx.provide('systemPrompt',{tools(){},context(){return()=>{};},section(){return()=>{};}});
  ctx.provide('skills',{list:async()=>[],snapshot:async()=>({skills:[]})});ctx.provide('agents',{get(){}});ctx.provide('workingDirectory',{});
  new ToolRuntime(ctx);
 }}).await();const consumer=await root.plugin({name:'native-learning-owner',inject:['tools'],apply(ctx){owner=ctx;}}).await(),scope=createScope(owner,{});
 const def=name=>({name,description:'fixture',parameters:{type:'object'},output:{schema:{type:'object'},render:()=>[]},execute:async()=>({})});
 try{
  root.tools.register(def('shell_fixture'));scope.ctx.tools.register(def('mc_script'));constrainMinecraftTools(scope.ctx,{composed:false});
  assert.deepEqual(root.tools.schemas(scopeOf(scope.ctx)).map(x=>x.name),['mc_script']);
  const fork=scope.ctx.plugin(skillPlugin);await fork.await();
  const names=root.tools.schemas(scopeOf(scope.ctx)).map(x=>x.name);assert.ok(names.includes('skill'));assert.ok(names.includes('mc_script'));assert.ok(!names.includes('shell_fixture'));
 }finally{await scope.dispose();await consumer.dispose();await services.dispose();}
});
test('native practice port uses the original Agent and rejects a changed game scope before any library write',async()=>{
 const calls=[],signal=new AbortController().signal;let realm='A';const agent={ctx:{tools:{execute:async v=>{calls.push(v);return{value:{structuredContent:{failed:false,text:JSON.stringify(v.name==='mc_connection'?{connection:{ready:true},facts:{experience:{scope:{realm,account:'a',agent:'a'}}}}:{read:true})}}};}}}};
 const port=nativePracticePorts(agent);await port.refresh(signal);assert.equal(port.runtime.currentFacts().experience.scope.realm,'A');
 await port.bridge.call('mc_script',{library:{op:'read',id:'x'}},{signal});assert.ok(calls.every(x=>x.agent===agent));
 realm='B';await assert.rejects(port.bridge.call('mc_script',{library:{op:'save'}},{signal}),/identity changed/);
 assert.equal(calls.filter(x=>x.arguments.library?.op==='save').length,0);
});
test('reflection guidance leads to evidence-bound correction and authoring, with no invented tool or mandatory action',()=>{
 const text=improvementGuidance({script:'mymc_script',memory:'mymc_memory',practice:'mc_practice',reason:'repeated-method-error'});
 for(const v of ['repeated-method-error','authoring','validate','review','adopt','executionId','平地','不重复执行','自然任务'])assert.ok(text.includes(v));
 assert.equal(improvementGuidance({memory:'mc_memory'}),'');assert.ok(!improvementGuidance({script:'mc_script'}).includes('mc_practice'));
 let section,prefix;installImprovementContext({systemPrompt:{section:v=>{prefix=v;},context:v=>{section=v;}}},{tools:[{name:'mc_script'}],reflection:{snapshot:()=>({lastReason:'repeated-method-error'})}});
 assert.equal(section.order,9993);assert.equal(section.interpolate,false);assert.ok(section.text().length<1600);
 assert.ok(prefix.text.includes('api:"authoring"'));assert.ok(!section.text().includes('api:"authoring"'));assert.ok(section.text().length<250);
});
test('dynamic practice exposes the real core contract and capability without model or body calls during discovery',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'dsh-dynamic-method-'));let calls=0,monitor;const effects=[];
 try{
 const tool=await configuredMethodPractice({ctx:{llm:{stream:()=>{calls++;throw Error('No model on help');}},effect:f=>effects.push(f()),systemPrompt:{context(){}}},
  config:{name:'fixture',provider:'fixture',model:'fixture',harness2:{enabled:true,backend:'physics',worker:{command:'fixture-python',workspace:directory}}},
  dataDir:directory,sessionId:'fixture-session',runtime:{tools:()=>[{name:'mc_script'}],currentFacts:()=>({experience:{scope:{realm:'fixture',account:'fixture',agent:'fixture'}}})},
  bridge:{call:()=>{calls++;throw Error('No body on help');}},onMonitor:v=>{monitor=v;}});
 assert.ok(tool.parameters.properties.op.enum.includes('stage'));assert.ok(tool.parameters.properties.methodId);assert.ok(!tool.parameters.properties.jobId);
 const result=await tool.execute({op:'help'},{signal:new AbortController().signal});assert.match(result.capability,/No combat/);assert.equal(calls,0);
 assert.equal(monitor.snapshot().jobs.length,0);
 await assert.rejects(tool.execute({op:'start',id:'x',methodId:'missing',revision:'a'.repeat(64),task:'fixed fixture'},{signal:new AbortController().signal}));
 assert.equal(calls,1);
 }finally{for(const cleanup of effects.reverse())await cleanup?.();assert.equal(dirname(directory),resolve(tmpdir()));assert.ok(directory.startsWith(join(resolve(tmpdir()),'dsh-dynamic-method-')));await rm(directory,{recursive:true,force:true});}
});
