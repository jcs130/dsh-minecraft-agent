import test from'node:test';import assert from'node:assert/strict';
import{RetryEvidenceContext}from'../src/harness-bridge.mjs';import{EvidenceReflection}from'../src/harness-reflection.mjs';
const args={steps:[{skill:'use',item:'fixture',at:[1,2,3]}]},base={provider:'original',model:'original',reasoningEffort:'off',maxTokens:6000};
const result=(kind='repeat',rule='farm.soil')=>({structuredContent:{failed:true,meta:{admission:{accepted:false,kind,rule}}}});
const record=(context,n,kind='repeat',options={})=>context.observeAdmission({run:'run',requestId:'req-'+n,name:'mymc_do',args,result:result(kind),...options});

test('core pre-admission rejection reaches bounded evidence and one existing request reflection',()=>{
 const context=new RetryEvidenceContext();record(context,1,'correction');record(context,2);record(context,3);
 const row=context.snapshot().evidence[0];assert.equal(row.kind,'admission');assert.equal(row.attempts,3);assert.equal(row.dispatched,false);
 assert.equal(row.rule,'farm.soil');assert.equal(row.rejectionKind,'repeat');assert.equal(JSON.stringify(row).includes('fixture'),false);
 const reflection=new EvidenceReflection({enabled:true});const intent={sessionId:'same',selectionSeq:1};
 const selected=reflection.select(base,context.snapshot(),{turn:1,step:1,intent});
 assert.equal(selected.reasoningEffort,'low');assert.equal(selected.maxTokens,6000);assert.equal(selected.model,'original');
 assert.equal(reflection.snapshot().lastReason,'repeated-core-admission-rejection');
 const restored=reflection.select(selected,context.snapshot(),{turn:1,step:2,intent});assert.equal(restored.reasoningEffort,'off');
 assert.equal(reflection.state.selections,1);
});

test('one refusal, duplicate delivery, waits and untyped prose never become repeated-error reflection',()=>{
 const context=new RetryEvidenceContext(),p=new EvidenceReflection({enabled:true});
 record(context,1,'correction');record(context,1);assert.equal(context.snapshot().evidence[0].attempts,1);
 assert.equal(p.select(base,context.snapshot(),{turn:1,step:1}),base);
 record(context,2,'wait');record(context,3,'wait');assert.equal(p.select(base,context.snapshot(),{turn:1,step:2}),base);
 context.observeAdmission({run:'run',requestId:'req-4',name:'mymc_do',args,result:{isError:true,content:[{type:'text',text:'repeat farm.soil'}]}});
 assert.equal(context.snapshot().evidence[0].requestId,'req-3');
});

test('corrected scene, accepted plan, source run and changed arguments preserve their own meanings',()=>{
 const context=new RetryEvidenceContext();record(context,1,'correction');record(context,2);record(context,3);
 record(context,4,'correction');assert.equal(context.snapshot().evidence[0].attempts,1);
 const reordered={steps:[{at:[1,2,3],item:'fixture',skill:'use'}]};record(context,5,'repeat',{args:reordered});assert.equal(context.snapshot().evidence[0].attempts,2);
 record(context,6,'repeat',{args:{steps:[{skill:'use',item:'fixture',at:[4,5,6]}]}});assert.equal(context.snapshot().evidence.length,2);
 record(context,7,'repeat',{result:{structuredContent:{failed:false}}});assert.equal(context.snapshot().evidence.length,1);
 record(context,8,'repeat',{run:'another'});assert.equal(context.snapshot().evidence.length,1);assert.equal(context.snapshot().evidence[0].attempts,1);
});

test('metadata is bounded and expires without changing body, goal or retry permission',()=>{
 let now=100;const context=new RetryEvidenceContext({now:()=>now,limit:2,ttlMs:10});
 for(let n=0;n<3;n++)record(context,n,'correction',{args:{steps:[{skill:'use',at:[n,2,3]}]}});
 assert.equal(context.snapshot().evidence.length,2);now=111;assert.equal(context.snapshot(),null);
});
