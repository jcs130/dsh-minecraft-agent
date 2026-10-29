import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RetryEvidenceContext,renderReceipt} from '../src/harness-bridge.mjs';
import {capBlocks} from '../src/harness-budget.mjs';
import {EvidenceReflection} from '../src/harness-reflection.mjs';
const spec={name:'mc_events',annotations:{readOnlyHint:true}};
const state=(revision='a'.repeat(64))=>({protocol:'agent-mc-execution-state/v1',scope:'runtime-receipts',run:'native-run',generation:1,phase:'started',revision,
 activeCount:0,active:[],detachedCount:0,detached:[],latestTerminal:{kind:'task',id:'actual-body:1',phase:'completed',terminal:true,goalCompleted:false},previousRuns:'not-covered'});
const result=(s=state(),cursor=1)=>{const data={readout:{protocol:'agent-mc-event-read/v1',returnedCount:1,cursor:{nextCursor:cursor,gap:false,hasMore:false},execution:s},protocol:'agent-mc/v1',run:'native-run',nextCursor:cursor,
 latestCursor:cursor,gap:false,hasMore:false,events:[{type:'minecraft.chat',text:'untrusted content '.repeat(2000)}]};return{structuredContent:{failed:false,control:{requestId:'original-request',endTurnRequested:false},meta:{eventRead:data.readout},text:JSON.stringify(data),data}};};
const observe=(view,id,value=result(),other={})=>view.observeEventRead({run:'native-run',requestId:id,spec,result:value,...other});

test('long event pages stay valid JSON and retain typed execution evidence without mutating the original',()=>{
  const original=result(),before=structuredClone(original),out=capBlocks(renderReceipt(original),1500)[0].text,p=JSON.parse(out);
  assert.ok(out.length<=1500);assert.equal(p.control.requestId,'original-request');
  assert.deepEqual(p.meta.eventRead.execution,state());assert.equal(p.meta.eventRead.returnedCount,1);
  assert.equal(p.meta.eventRead.cursor.nextCursor,1);
  assert.equal(p.projection.truncated,true);assert.match(p.projection.history,/dsh_history/);assert.match(p.projection.original,/core request/);
  assert.ok(p.projection.partialFields.includes('data'));assert.deepEqual(original,before);
  assert.equal(JSON.parse(renderReceipt(original)[0].text).data.readout,undefined);
});

test('cursor movement does not count as body execution and only explicit consecutive idle reads qualify',()=>{
  const view=new RetryEvidenceContext();observe(view,'r1');observe(view,'r1');observe(view,'r2',result(state(),100));
  assert.equal(view.snapshot().evidence[0].attempts,2);assert.equal(view.snapshot().evidence[0].kind,'eventWait');
  observe(view,'r3',result({...state(),activeCount:1}));assert.equal(view.snapshot(),null);
  observe(view,'r4');observe(view,'r5',result({...state(),detachedCount:1}));assert.equal(view.snapshot(),null);
  observe(view,'r6');observe(view,'r7',result(),{spec:{name:'mc_bag',annotations:{readOnlyHint:true}}});assert.equal(view.snapshot(),null);
  observe(view,'r8');observe(view,'r9',result(state('b'.repeat(64))));assert.equal(view.snapshot().evidence[0].attempts,1);
  view.bindRun('new-runtime');assert.equal(view.snapshot(),null);
});

test('one low request can reconsider repeated idle events and routine effort restores across process recovery',()=>{
  let now=1000,saved;const view=new RetryEvidenceContext();observe(view,'r1');observe(view,'r2');
  const options={enabled:true,effort:'low',attempts:2,minRequests:2,minIntervalMs:1000},store={now:()=>now,read:()=>saved,write:x=>{saved=structuredClone(x);}};
  const base={provider:'original',model:'original-model',reasoningEffort:'none',maxTokens:6000},intent={sessionId:'original-session',selectionSeq:1};
  const reflection=new EvidenceReflection(options,store);
  assert.equal(reflection.select(base,view.snapshot(),{turn:1,step:0,intent}).reasoningEffort,'low');
  assert.equal(reflection.snapshot().lastReason,'repeated-events-without-current-execution');
  const reloaded=new EvidenceReflection(options,store);now+=2000;
  for(let step=1;step<5;step++)assert.equal(reloaded.select({...base,reasoningEffort:'low'},view.snapshot(),{turn:1,step,intent}).reasoningEffort,'none');
  assert.equal(reloaded.select({...base,reasoningEffort:'high'},view.snapshot(),{turn:2,step:0,intent}).reasoningEffort,'high');
});
