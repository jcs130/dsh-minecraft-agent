import test from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';import{resolve}from'node:path';import{pathToFileURL}from'node:url';
import{AppendOnlyFactsContext}from'../src/harness-context.mjs';
const req=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
const {Session}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-session')));
const {createUserMessage}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-llm')));
const core=await import(process.env.MC_FACT_UPDATES_MODULE??'agent-mc-world/client');
const options={skip:typeof core.FactUpdateStream!=='function'};
const fixture=()=>{
 const hooks=new Map();let context,facts={run:'one',at:'first',health:20,inventory:[{item:'bread',count:2}],reference:'stable skill guidance '.repeat(150)};
 const ctx={on:(name,fn)=>hooks.set(name,fn),systemPrompt:{context:value=>context=value}};
 let retires=0;const presentation=new AppendOnlyFactsContext({core,facts:()=>facts,retire:async()=>{retires++;return 2;}});
 presentation.install(ctx);const session=Session.create('original');
 const admit=text=>{const event=session.append('user/message',createUserMessage({content:[{type:'text',text}],source:{kind:'runtime-context',form:'snapshot',sections:[{name:context.name,text}]}}),{surfaceOp:'append'});hooks.get('session/event')(session,event);return event;};
 return{hooks,ctx,session,presentation,admit,text:()=>context.text(),facts:()=>facts,set:value=>facts=value,retires:()=>retires};
};
test('native history stays append-only while all changed game facts remain reconstructable',options,async()=>{
 const f=fixture();await f.presentation.prepare({});const initial=f.admit(f.text());
 let reconstructed=core.applyFactUpdate(null,JSON.parse(initial.data.content[0].text));
 const replaceGeneration=f.session.surface.replaceGeneration;
 for(let i=0;i<48;i++){
  const prior=f.session.deriveMessages().map(JSON.stringify);
  f.set({...f.facts(),at:String(i),health:i%11===0?null:20,position:[i,64,0],inventory:i%8?[{item:'bread',count:2}]:[]});
  await f.presentation.prepare({});const event=f.admit(f.text());
  reconstructed=core.applyFactUpdate(reconstructed,JSON.parse(event.data.content[0].text));
  const {at,...expected}=f.facts();assert.deepEqual(reconstructed.values,expected);
  assert.deepEqual(f.session.deriveMessages().slice(0,prior.length).map(JSON.stringify),prior);
 }
 assert.equal(f.session.surface.replaceGeneration,replaceGeneration);assert.equal(f.retires(),1);
 assert.equal(f.presentation.snapshot().fault,null);assert.equal(f.presentation.snapshot().sizeSamples,49);
 assert.ok(f.presentation.snapshot().sentBytes<f.presentation.snapshot().originalBytes*.25);
});
test('unadmitted previews do not become model-visible baselines or count as transmitted updates',options,()=>{
 const f=fixture();f.text();f.set({...f.facts(),health:12});f.text();f.set({...f.facts(),health:5});
 const admitted=f.admit(f.text());assert.equal(JSON.parse(admitted.data.content[0].text).kind,'snapshot');
 assert.equal(f.presentation.snapshot().snapshots,1);assert.equal(f.presentation.snapshot().patches,0);
 assert.deepEqual(JSON.parse(f.text()).values,{});
});
test('native successful compaction resets the baseline and preserves presentation accounting',options,()=>{
 const f=fixture();f.admit(f.text());f.set({...f.facts(),health:3});f.admit(f.text());
 f.hooks.get('session/event')(f.session,{type:'compaction/end',data:{}});
 const frame=JSON.parse(f.text());assert.equal(frame.kind,'snapshot');assert.equal(frame.values.health,3);
 f.admit(JSON.stringify(frame));assert.equal(f.presentation.snapshot().resets,1);assert.equal(f.presentation.snapshot().snapshots,2);
});
test('failed native compaction does not invalidate the intact fact baseline',options,()=>{
 const f=fixture();f.admit(f.text());
 f.hooks.get('session/event')(f.session,{type:'compaction/end',data:{error:{code:'MAX_TOKENS'}}});
 assert.equal(JSON.parse(f.text()).kind,'patch');assert.equal(f.presentation.snapshot().resets,0);
});
test('broken admission fails before dispatch instead of treating unknown state as current',options,async()=>{
 const f=fixture();const bad=JSON.parse(f.text());bad.revision='corrupted';f.admit(JSON.stringify(bad));
 let dispatched=false;await assert.rejects(f.hooks.get('agent/request')({},async()=>{dispatched=true;}),/inconsistent baseline/);
 assert.equal(dispatched,false);assert.equal(f.presentation.snapshot().snapshots,0);
});
