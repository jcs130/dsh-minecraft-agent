import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RetryEvidenceContext} from '../src/harness-bridge.mjs';
import {EvidenceReflection} from '../src/harness-reflection.mjs';

const base={provider:'original',model:'original',reasoningEffort:'off',maxTokens:6000};
const spec={name:'mc_messages',annotations:{readOnlyHint:true}};
const revision='a'.repeat(64);
const reply=(resource='PRIVATE ORIGINAL RESOURCE',rev=revision)=>({structuredContent:{failed:false,
  meta:{readback:{protocol:'agent-mc-readback/v1',resource,revision:rev,historical:true}},text:'PRIVATE BODY'}});
const intent={sessionId:'original-session',selectionSeq:7};

test('repeated historical readback can deepen one existing request without treating it as a failed body action',()=>{
  const evidence=new RetryEvidenceContext(),reflection=new EvidenceReflection({enabled:true});
  const value=reply(),original=structuredClone(value);
  for(let n=1;n<=3;n++)evidence.observeReadback({run:'r',requestId:'q'+n,spec,result:value});
  const snapshot=evidence.snapshot();
  assert.equal(snapshot.evidence[0].attempts,3);
  assert.equal(snapshot.evidence[0].kind,'readback');
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE'),false);
  assert.deepEqual(value,original);
  const low=reflection.select(base,snapshot,{turn:1,step:1,intent});
  assert.equal(low.reasoningEffort,'low');assert.equal(low.maxTokens,6000);
  assert.equal(reflection.snapshot().lastReason,'repeated-unchanged-historical-readback');
  assert.equal(reflection.select(low,snapshot,{turn:1,step:2,intent}).reasoningEffort,'off');
  assert.equal(reflection.state.selections,1);
});

test('duplicate delivery, new revisions, fresh views, acting tools and failed reads do not become repeat evidence',()=>{
  const evidence=new RetryEvidenceContext();
  const send=(id,result=reply(),tool=spec)=>evidence.observeReadback({run:'r',requestId:id,spec:tool,result});
  send('q1');send('q1');assert.equal(evidence.snapshot().evidence[0].attempts,1);
  send('q2');assert.equal(evidence.snapshot().evidence[0].attempts,2);
  send('q3',reply(undefined,'b'.repeat(64)));assert.equal(evidence.snapshot().evidence[0].attempts,1);
  send('q4',reply('another'));assert.equal(evidence.snapshot().evidence[1].attempts,1);
  const before=structuredClone(evidence.snapshot());
  const fresh=reply();fresh.structuredContent.meta.readback.historical=false;send('q5',fresh);
  const failed=reply();failed.structuredContent.failed=true;send('q6',failed);
  send('q7',reply(),{name:'mc_do',annotations:{readOnlyHint:false}});
  send('q8',reply(undefined,'not-a-revision'));
  assert.deepEqual(evidence.snapshot(),before);
  const reflection=new EvidenceReflection({enabled:true});
  assert.equal(reflection.select(base,before,{turn:1,step:1}),base);
});

test('one unchanged historical revision never causes periodic thinking; explicit intent and cancellation still win',()=>{
  let now=0;const context=new RetryEvidenceContext({now:()=>now});
  for(let i=0;i<3;i++)context.observeReadback({run:'r',requestId:'q'+i,spec,result:reply()});
  const reflection=new EvidenceReflection({enabled:true,minIntervalMs:1000,minRequests:2},{now:()=>now});
  const snapshot=context.snapshot();
  const high={...base,reasoningEffort:'high'};
  assert.equal(reflection.select(high,snapshot,{turn:1,step:0,intent}),high);
  const abort=new AbortController();abort.abort();
  assert.equal(reflection.select(base,snapshot,{turn:1,step:1,intent,signal:abort.signal}),base);
  assert.equal(reflection.select(base,snapshot,{turn:1,step:2,intent}).reasoningEffort,'low');
  now=1001;
  for(let i=3;i<8;i++)assert.equal(reflection.select(base,snapshot,{turn:1,step:i,intent}),base);
  assert.equal(reflection.state.selections,1);
  context.observeReadback({run:'new-run',requestId:'q1',spec,result:reply()});
  assert.equal(context.snapshot().evidence[0].attempts,1);
  now=901002;assert.equal(context.snapshot(),null);
});

test('rotating historical queries cannot evict native negative action evidence',()=>{
  const context=new RetryEvidenceContext();
  context.observeAdmission({run:'r',requestId:'a1',name:'mc_do',args:{steps:[{skill:'take'}]},
    result:{structuredContent:{failed:true,meta:{admission:{accepted:false,kind:'repeat',rule:'missing-item'}}}}});
  for(let i=0;i<8;i++)context.observeReadback({run:'r',requestId:'q'+i,spec,result:reply('resource-'+i)});
  const snapshot=context.snapshot();
  assert.equal(snapshot.evidence.filter(x=>x.kind==='admission').length,1);
  assert.equal(snapshot.evidence.filter(x=>x.kind==='readback').length,2);
});

test('the actual mixed message read/review contract uses its per-result revision, never the review write',()=>{
  const context=new RetryEvidenceContext();
  const mixed={name:'mymc_messages',annotations:{readOnlyHint:false},
    _meta:{'agent-mc/v1':{tags:['read','write'],barrierAfter:false,endsTurn:false}}};
  for(let i=0;i<3;i++)context.observeReadback({run:'r',requestId:'q'+i,spec:mixed,result:reply()});
  assert.equal(context.snapshot().evidence[0].attempts,3);
  const before=structuredClone(context.snapshot());
  context.observeReadback({run:'r',requestId:'review',spec:mixed,result:{structuredContent:{failed:false,text:'marked considered'}}});
  context.observeReadback({run:'r',requestId:'body',spec:{...mixed,_meta:{'agent-mc/v1':{tags:['read','act']}}},result:reply()});
  assert.deepEqual(context.snapshot(),before);
});

test('already-served action evidence cannot hide new historical queries or become reactivated by them',()=>{
  let now=0,saved;
  const reflection=new EvidenceReflection({enabled:true,minIntervalMs:1000,minRequests:1},
    {now:()=>now,read:()=>saved,write:x=>{saved=structuredClone(x);}});
  const action={kind:'task',run:'r',taskId:'r:1',observation:'unchanged',attempts:3};
  const historical={kind:'readback',run:'r',resourceHash:'c'.repeat(64),revision,historical:true,attempts:3};
  assert.equal(reflection.select(base,{evidence:[action]},{turn:1,step:1,intent}).reasoningEffort,'low');
  now=1001;
  const both={evidence:[action,historical]};
  assert.equal(reflection.select(base,both,{turn:1,step:2,intent}).reasoningEffort,'low');
  now=2002;assert.equal(reflection.select(base,both,{turn:1,step:3,intent}),base);
  const resumed=new EvidenceReflection({enabled:true,minIntervalMs:1000,minRequests:1},
    {now:()=>now,read:()=>saved});
  assert.equal(resumed.select(base,both,{turn:2,step:1,intent}),base);
  assert.equal(saved.selections,2);
});
