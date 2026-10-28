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
