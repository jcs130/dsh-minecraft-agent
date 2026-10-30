import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RetryEvidenceContext,renderReceipt} from '../src/harness-bridge.mjs';
import {EvidenceReflection} from '../src/harness-reflection.mjs';
import {capBlocks,GoalProgressGuard} from '../src/harness-budget.mjs';

const spec={annotations:{readOnlyHint:true},_meta:{'agent-mc/v1':{tags:['read']}}};
const read=(revision='b'.repeat(64))=>({protocol:'agent-mc-spatial-read/v1',historical:false,kind:'voxels',
  selection:'a'.repeat(64),revision,scanComplete:true,knownComplete:false,remainingCount:0,unknownCount:39,
  unknownUnit:'cells',retryable:false,continuationAvailable:false,interpretation:'扫描已读完；未知格不是排队结果，原地重复读取不保证补全。'});
const result=revision=>({isError:false,structuredContent:{failed:false,meta:{observation:read(revision)}}});
const observe=(view,id,revision,other={})=>view.observeSpatialRead({run:'native-run',requestId:id,spec,result:result(revision),...other});

test('current native spatial reads retain distinct revisions, deduplicate delivery and never become failed tasks',()=>{
  let now=1000;const view=new RetryEvidenceContext({now:()=>now,ttlMs:1000});
  observe(view,'r1');observe(view,'r1');observe(view,'r2');
  assert.deepEqual(view.snapshot().evidence.map(x=>[x.kind,x.attempts,x.historical]),[['observation',2,false]]);
  assert.match(view.snapshot().observationGuidance,/不是排队任务/);
  assert.equal(view.snapshot().evidence[0].taskId,undefined);
  observe(view,'r3','c'.repeat(64));assert.equal(view.snapshot().evidence[0].attempts,1);
  observe(view,'r4','c'.repeat(64),{result:{isError:true,structuredContent:result().structuredContent}});
  assert.equal(view.snapshot().evidence[0].attempts,1);
  observe(view,'r5',undefined,{spec:{_meta:{'agent-mc/v1':{tags:['act']}}}});
  assert.equal(view.snapshot().evidence[0].attempts,1);
  now+=1001;assert.equal(view.snapshot(),null);
  observe(view,'r6');view.bindRun('another-native-run');assert.equal(view.snapshot(),null);
});

test('two identical current reads can select one bounded low request and restore the owned routine after reload',()=>{
  let now=2000,saved;const view=new RetryEvidenceContext({now:()=>now});
  observe(view,'r1');observe(view,'r2');
  const options={enabled:true,effort:'low',attempts:2,minIntervalMs:1000,minRequests:3};
  const storage={now:()=>now,read:()=>saved,write:value=>{saved=structuredClone(value);}};
  const base={provider:'fixture',model:'unchanged-model',reasoningEffort:'none',maxTokens:6000};
  const intent={sessionId:'original-session',selectionSeq:4};
  const first=new EvidenceReflection(options,storage);
  assert.deepEqual(first.select(base,view.snapshot(),{turn:1,step:0,intent}),{...base,reasoningEffort:'low'});
  assert.equal(first.snapshot().lastReason,'repeated-unchanged-current-observation');
  const restored=new EvidenceReflection(options,storage);
  assert.deepEqual(restored.select({...base,reasoningEffort:'low'},view.snapshot(),{turn:1,step:1,intent}),base);
  now+=2000;
  for(let step=2;step<8;step++)assert.deepEqual(restored.select(base,view.snapshot(),{turn:1,step,intent}),base);
  observe(view,'r3','c'.repeat(64));observe(view,'r4','c'.repeat(64));
  assert.deepEqual(restored.select(base,view.snapshot(),{turn:2,step:0,intent}),{...base,reasoningEffort:'low'});
  assert.deepEqual(restored.select({...base,reasoningEffort:'high'},view.snapshot(),{turn:2,step:1,intent}),{...base,reasoningEffort:'high'});
});

test('the same terrain gets a new recovery episode after real execution, not after another round or request',()=>{
  let now=2000,saved;const view=new RetryEvidenceContext({now:()=>now}),intent={sessionId:'original',selectionSeq:4};
  const base={provider:'fixture',model:'unchanged',reasoningEffort:'none',maxTokens:6000};
  const config={enabled:true,attempts:2,minIntervalMs:1000,minRequests:1};
  const storage={now:()=>now,read:()=>saved,write:v=>{saved=structuredClone(v);}},reflection=new EvidenceReflection(config,storage);
  const frame=revision=>({protocol:'agent-mc-execution-state/v1',scope:'runtime-receipts',run:'native-run',generation:1,phase:'started',revision,
    activeCount:0,pendingCalls:0,pendingTactics:0,detachedCount:0,observedAt:now});
  const sample=(id,revision,goalId='original-goal')=>observe(view,id,undefined,{goalId,execution:frame(revision)});
  sample('r1','c'.repeat(64));sample('r2','c'.repeat(64));
  const first=reflection.select(base,view.snapshot(),{turn:1,step:0,intent});assert.equal(first.reasoningEffort,'low');
  assert.equal(reflection.select(first,view.snapshot(),{turn:1,step:1,intent}).reasoningEffort,'none');
  now+=2000;sample('r3','c'.repeat(64));assert.equal(reflection.select(base,view.snapshot(),{turn:80,step:0,intent}).reasoningEffort,'none');
  sample('r4','d'.repeat(64));assert.equal(view.snapshot().evidence[0].attempts,1);
  sample('r5','d'.repeat(64));assert.equal(reflection.select(base,view.snapshot(),{turn:81,step:0,intent}).reasoningEffort,'low');
  const resumed=new EvidenceReflection(config,storage);now+=2000;sample('r6','d'.repeat(64));
  assert.equal(resumed.select(base,view.snapshot(),{turn:82,step:0,intent}).reasoningEffort,'none');
  sample('r7','d'.repeat(64),'different-goal');assert.equal(view.snapshot().evidence[0].attempts,1);
  sample('r8','d'.repeat(64),'different-goal');assert.equal(resumed.select(base,view.snapshot(),{turn:83,step:0,intent}).reasoningEffort,'low');
});

test('scoped observation recovery requires fresh, matching and empty current work; legacy evidence remains distinct',()=>{
  const now=2000,view=new RetryEvidenceContext({now:()=>now}),valid={protocol:'agent-mc-execution-state/v1',scope:'runtime-receipts',run:'native-run',generation:1,phase:'started',revision:'d'.repeat(64),
    activeCount:0,pendingCalls:0,pendingTactics:0,detachedCount:0,observedAt:now};
  for(const bad of[{...valid,activeCount:1},{...valid,pendingCalls:1},{...valid,pendingTactics:1},{...valid,detachedCount:1},{...valid,pendingCalls:undefined},{...valid,run:'other'},
    {...valid,phase:'stopped'},{...valid,observedAt:now-16000},null]){
    observe(view,'known',undefined,{goalId:'goal',execution:valid});
    observe(view,'bad',undefined,{goalId:'goal',execution:bad});assert.equal(view.snapshot(),null);
  }
  observe(view,'legacy');assert.equal(view.snapshot().evidence[0].knownIdle,undefined);
  observe(view,'scoped',undefined,{goalId:'goal',execution:valid});const value=view.snapshot().evidence[0];
  assert.equal(value.attempts,1);assert.equal(value.knownIdle,true);assert.match(value.scopeHash,/^[a-f0-9]{64}$/);
});

test('real capped receipt keeps current-read coverage and control before geometry and presents duplicate JSON once',()=>{
  const readout=read(),data={readout,source:'client-visible-world',kind:'voxels',cells:Array(512).fill(-1),
    palette:[{name:'chest',shape:'original geometry '.repeat(500)}]};
  const value={isError:false,structuredContent:{text:JSON.stringify(data),data,failed:false,
    meta:{observation:readout},control:{requestId:'original-request',endTurnRequested:false}}};
  const before=structuredClone(value),full=renderReceipt(value),parsed=JSON.parse(full[0].text);
  assert.equal(parsed.text,undefined);assert.equal(parsed.data.readout,undefined);
  assert.deepEqual(parsed.data.cells,data.cells);assert.deepEqual(parsed.data.palette,data.palette);
  assert.deepEqual(parsed.meta.observation,readout);
  const visible=capBlocks(full,1500)[0].text;
  for(const marker of ['"scanComplete":true','"knownComplete":false','"unknownCount":39','"retryable":false',
    readout.interpretation,'original-request','dsh_history'])assert.ok(visible.includes(marker),marker);
  assert.deepEqual(value,before);
  const prose={structuredContent:{text:'Original explanation of this observation.',data:{kind:'voxels'}}};
  assert.equal(JSON.parse(renderReceipt(prose)[0].text).text,prose.structuredContent.text);
});

test('progress inspection consumes the exact native revision rather than deleting numeric evidence',()=>{
  const digests=[],progress={recordObservation:digest=>{digests.push(digest);return{repetitive:false};}};
  const guard=new GoalProgressGuard({progress,digest:()=>{throw Error('Typed native data must not use legacy number stripping');}});
  const goal={id:'original-goal',phase:'active'};
  guard.observe(goal,'body with a changed block state','1'.repeat(64));
  guard.observe(goal,'body with another changed block state','2'.repeat(64));
  assert.deepEqual(digests,['1'.repeat(64),'2'.repeat(64)]);
});
