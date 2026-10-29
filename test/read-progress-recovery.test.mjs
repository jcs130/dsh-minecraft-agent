import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RetryEvidenceContext} from '../src/harness-bridge.mjs';
import {EvidenceReflection} from '../src/harness-reflection.mjs';
import {GoalProgressGuard,selectTools} from '../src/harness-budget.mjs';
const evidence=(changes={})=>({kind:'readOnly',run:'original-run',requestId:'read-2',selectorHash:'a'.repeat(64),revision:'b'.repeat(64),
  attempts:2,streak:1,knownIdle:true,newInformation:false,repetitive:false,at:1000,...changes});
const spec={name:'mc_guide',annotations:{readOnlyHint:true}};

test('default lean profile exposes the bounded reader while explicit exclusion remains authoritative',()=>{
  const specs=[spec,{name:'mc_read_text'},{name:'mc_artifact'}];
  assert.deepEqual(selectTools(specs).map(x=>x.name),['mc_guide','mc_read_text']);
  assert.deepEqual(selectTools(specs,{exclude:['mc_read_text']}).map(x=>x.name),['mc_guide']);
});

test('generic core read evidence requests one low reconsideration, restores none and survives reload',()=>{
  let now=1000,saved;const view=new RetryEvidenceContext({now:()=>now});
  view.observeReadProgress(evidence(),{});
  const options={enabled:true,attempts:2,minRequests:2,minIntervalMs:1000},storage={now:()=>now,read:()=>saved,write:x=>{saved=structuredClone(x);}};
  const base={provider:'original',model:'original-model',reasoningEffort:'none',maxTokens:6000},intent={sessionId:'same-session',selectionSeq:1};
  const reflection=new EvidenceReflection(options,storage);
  assert.equal(reflection.select(base,view.snapshot(),{turn:1,step:0,intent}).reasoningEffort,'low');
  assert.equal(reflection.snapshot().lastReason,'repeated-unchanged-read-only-result');
  now+=2000;const restored=new EvidenceReflection(options,storage);
  for(let n=1;n<10;n++)assert.equal(restored.select({...base,reasoningEffort:'low'},view.snapshot(),{turn:1,step:n,intent}).reasoningEffort,'none');
  assert.equal(restored.select({...base,reasoningEffort:'high'},view.snapshot(),{turn:2,step:0,intent}).reasoningEffort,'high');
  assert.ok(!JSON.stringify(saved).includes('prompt'));
  view.observeReadProgress(evidence({newInformation:true,attempts:1}),{});assert.equal(view.snapshot(),null);
  view.observeReadProgress(evidence(),{structuredContent:{meta:{readback:{}}}});assert.equal(view.snapshot(),null);
  view.observeReadProgress(evidence(),{});view.observeReadProgress(null,{});assert.equal(view.snapshot(),null);
});

test('a generic read guard uses core evidence without closing completed goals or disturbing registered work',()=>{
  const guard=new GoalProgressGuard({closeAfter:5}),goal={id:'original',phase:'active'};
  assert.deepEqual(guard.read(goal,null),{});assert.deepEqual(guard.read({...goal,phase:'complete'},evidence({repetitive:true,streak:10})),{});
  assert.deepEqual(guard.read(goal,evidence({knownIdle:false,repetitive:true,streak:10})),{});
  assert.match(guard.read(goal,evidence({repetitive:true,streak:4})).notice,/textPage.next/);
  assert.match(guard.read(goal,evidence({repetitive:true,streak:5})).close,/repeated read-only/);
});

test('packed core guide pages pass real DSH JSON validation and never classify fresh continuation as no progress',async t=>{
  const core=await import('agent-mc-world/client');
  if(!core.ReadProgressBook||!core.renderToolTextPage)return t.skip('Public core predates immutable tool text; candidate consumer must run this test');
  const {createRequire}=await import('node:module'),{resolve}=await import('node:path'),{pathToFileURL}=await import('node:url');
  const require=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
  const {snapshotJsonValue}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-util-values')));
  const text='完整攻略 🐟\n'.repeat(500),handle='log:'+'f'.repeat(64),book=new core.ReadProgressBook();
  let value=core.referenceToolText({structuredContent:{failed:false,text}},{readOnly:true,budgetChars:1500,save:()=>handle}),all='',offset=0,n=0;
  const state=core.runtimeExecutionState('r',1,'started',[]);
  while(true){
    assert.notEqual(snapshotJsonValue(value),undefined);
    const rendered=core.renderToolTextPage(value,{budgetChars:1500,toolPrefix:'mc'}),p=JSON.parse(rendered),page=p.meta.textPage;
    assert.ok(rendered.length<=1500);assert.equal(page.offset,offset);all+=p.text;
    const read=book.observe({goalId:'g',run:'r',requestId:String(++n),spec,args:{offset},result:value,execution:state});
    assert.equal(read.newInformation,true);assert.equal(read.repetitive,false);
    if(!page.hasMore)break;
    assert.ok(page.nextOffset>offset);offset=page.nextOffset;
    const next=core.readTextPage(text,handle,page.next.arguments);
    value={structuredContent:{failed:false,text:next.text,data:next}};
    assert.ok(n<100);
  }
  assert.equal(all,text);
});
