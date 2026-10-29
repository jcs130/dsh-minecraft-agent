import{test}from'node:test';import assert from'node:assert/strict';
import{EvidenceReflection,installEvidenceReflection}from'../src/harness-reflection.mjs';
import{installPlanReview}from'../src/harness-plan-review.mjs';
const base={provider:'fixture',model:'original',reasoningEffort:'off',maxTokens:6000},intent={sessionId:'s',selectionSeq:10};
const plan={key:'r:'+ 'a'.repeat(64)+':epoch:1',count:2},evidence={planReview:{priority:plan}},step=n=>({turn:1,step:n,intent});
test('a failed-plan episode receives two existing requests immediately, survives recovery and then restores no-thinking',()=>{
 let saved;const config={enabled:true,repairOnly:true,minRequests:24,minIntervalMs:180000};
 const p=new EvidenceReflection(config,{now:()=>1000,write:v=>{saved=structuredClone(v);}});
 const first=p.select(base,evidence,step(1));assert.equal(first.reasoningEffort,'low');
 assert.equal(p.select(first,evidence,step(1)).reasoningEffort,'low');assert.equal(saved.planRepairs[0].uses,1);
 const q=new EvidenceReflection(config,{now:()=>1001,read:()=>saved,write:v=>{saved=structuredClone(v);}});
 const second=q.select(first,evidence,step(2));assert.equal(second.reasoningEffort,'low');
 assert.equal(q.select(second,evidence,step(3)).reasoningEffort,'off');assert.equal(saved.planRepairs[0].uses,2);
});
test('a changed plan stops the temporary override and explicit human thinking is never reduced',()=>{
 const p=new EvidenceReflection({enabled:true,repairOnly:true});
 const low=p.select(base,evidence,step(1));assert.equal(p.select(low,{planReview:{priority:null}},step(2)).reasoningEffort,'off');
 const high={...base,reasoningEffort:'high'};assert.equal(p.select(high,evidence,{...step(3),intent:{...intent,selectionSeq:11}}),high);
});
test('priority repair applies after the old periodic lease so the old handler cannot silently cancel it',()=>{
 const old=new EvidenceReflection({enabled:true}),repair=new EvidenceReflection({enabled:true,repairOnly:true});
 const oldTask={evidence:[{kind:'task',run:'r',taskId:'r:old',phase:'blocked',observation:'unchanged',attempts:4}]};
 let incoming=old.select(base,oldTask,step(0));assert.equal(incoming.reasoningEffort,'low');
 for(let i=1;i<=3;i++){incoming=repair.select(old.select(incoming,{evidence:[]},step(i)),evidence,step(i));assert.equal(incoming.reasoningEffort,i<=2?'low':'off');}
});
test('a host observer stays metadata-only, scope-bound and leaves the original tool result and decision intact',()=>{
 let hook,prompt,calls=0;const book={recordCall:()=>{calls++;},recordEvents(){},context:()=>({episodes:[]})};
 const off=installPlanReview({on:(_n,f)=>{hook=f;return()=>{};},systemPrompt:{context:v=>{prompt=v;return()=>{};}}},{book,run:()=> 'r',sessionId:'s'});
 const value={structuredContent:{failed:false}},next={kind:'continue'};
 assert.equal(hook({agent:{id:'other'},name:'mymc_do',arguments:{},callId:'x'},{value},()=>next),next);assert.equal(calls,0);
 assert.equal(hook({agent:{id:'s'},name:'mymc_do',arguments:{},callId:'x'},{value},()=>next),next);assert.equal(calls,1);assert.ok(prompt.text().length<100);off();
});
test('native request-hook registration supports prepending without model probes',()=>{
 const options=[];installEvidenceReflection({on:(name,_fn,opt)=>options.push({name,opt})},{reflection:{},retryEvidence:{},sessionQuery:{},prepend:true});
 assert.equal(options.find(x=>x.name==='agent/request').opt,true);
});
test('another Agent cannot change this scope model-selection intent or consume a repair request',async()=>{
 const hooks=new Map();let queried=0,selected=0;installEvidenceReflection({on:(name,fn)=>hooks.set(name,fn)},
  {ownerSessionId:'s',reflection:{needsIntent:true,select:()=>{selected++;}},retryEvidence:{snapshot:()=>evidence},sessionQuery:{observeSession:()=>{queried++;}}});
 const value=await hooks.get('agent/request')({agent:{id:'foreign'}},async()=>base);
 assert.equal(value,base);assert.equal(queried,0);assert.equal(selected,0);
});
