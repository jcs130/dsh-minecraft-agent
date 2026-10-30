import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {EvidenceReflection} from '../src/harness-reflection.mjs';import {installDecisionReview,decisionReviewNotice} from '../src/harness-decision-review.mjs';
const priority={protocol:'agent-mc-decision-review/v1',key:'decision:'+'a'.repeat(64),reviewNeeded:true,knownIdle:true,idleScope:'registered-current-runtime',noToolRounds:3,toolsAvailable:34};
const base={provider:'local',model:'fixture',reasoningEffort:'none',maxTokens:6000},intent={sessionId:'owner',selectionSeq:8};
test('one existing request recovers a no-tool episode and restores its owned normal thinking choice',()=>{
 let saved;const reflection=new EvidenceReflection({enabled:true,repairOnly:true},{write:s=>saved=s});
 const selected=reflection.select(base,{decisionReview:{priority}},{turn:1,step:1,intent});assert.equal(selected.reasoningEffort,'low');assert.equal(selected.maxTokens,6000);
 assert.equal(reflection.select(selected,{decisionReview:{priority}},{turn:2,step:1,intent}).reasoningEffort,'none');
 const resumed=new EvidenceReflection({enabled:true,repairOnly:true},{read:()=>saved});assert.equal(resumed.select(base,{decisionReview:{priority}},{turn:3,step:1,intent}).reasoningEffort,'none');
 assert.equal(reflection.snapshot().requestSelections,1);
});
test('missing idle evidence and explicit human reasoning levels do not get overwritten',()=>{
 const r=new EvidenceReflection({enabled:true});assert.equal(r.select(base,{decisionReview:{priority:{...priority,knownIdle:false}}},{turn:1,step:1,intent}).reasoningEffort,'none');
 assert.equal(r.select({...base,reasoningEffort:'high'},{decisionReview:{priority}},{turn:2,step:1,intent}).reasoningEffort,'high');
});
test('native event binding retains only metadata and scopes model rounds to the owner goal',()=>{
 let callback,context;const recorded=[],book={recordRound:x=>recorded.push(x),context:()=>null};
 const ctx={on:(name,fn)=>{if(name==='session/event')callback=fn;return()=>{};},systemPrompt:{context:x=>{context=x;return()=>{};}}};
 const binding=installDecisionReview(ctx,{book,sessionId:'owner',run:()=> 'run',goal:()=>({id:'goal',phase:'active'}),execution:()=>null});
 const event=(type,data)=>callback({id:'owner'},{type,data,time:1000});
 event('turn/start',{turn:1});event('user/message',{source:{kind:'goal',goalId:'goal'}});event('request/header',{header:{tools:[{name:'tool'}]}});
 event('assistant/message',{message:{content:[{type:'text',text:'private response fixture'}]}});event('turn/end',{reason:{kind:'completed'}});
 assert.equal(recorded.length,1);assert.equal(recorded[0].autonomous,true);assert.equal(recorded[0].completed,true);assert.equal(recorded[0].toolsAvailable,1);
 assert.equal(recorded[0].response.chars,24);assert.match(recorded[0].response.hash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(recorded).includes('private response fixture'));
 assert.equal(context.text(),'');binding.dispose();
});
test('native stop validation steers once per proven episode and yields after actual tools',()=>{
 const handlers={},now=Date.now(),review={...priority,run:'run',goalId:'goal',generation:1,executionRevision:'b'.repeat(64)},repairs=[];
 let phase='active',revision=review.executionRevision,observedAt=now;
 const ctx={on:(n,fn)=>{handlers[n]=fn;return()=>{};},systemPrompt:{context:()=>()=>{}}};
 const binding=installDecisionReview(ctx,{book:{recordRound:()=>{},context:()=>review},sessionId:'owner',run:()=> 'run',goal:()=>({id:'goal',phase,activation:'armed'}),execution:()=>({protocol:'agent-mc-execution-state/v1',scope:'runtime-receipts',run:'run',generation:1,revision,observedAt}),repair:x=>repairs.push(x.turn)});
 const event=(type,data)=>handlers['session/event']({id:'owner'},{type,data,time:now});
 event('turn/start',{turn:4});event('user/message',{source:{kind:'goal',goalId:'goal'}});event('assistant/message',{message:{content:[{type:'text',text:'fixture acknowledgement'}]}});
 const stop=()=>handlers['agent/turn-stopping']({agent:{id:'owner'},turn:4,signal:new AbortController().signal});
 revision='c'.repeat(64);stop();assert.equal(repairs.length,0);revision=review.executionRevision;observedAt=now-16000;stop();assert.equal(repairs.length,0);
 observedAt=now;phase='paused';stop();assert.equal(repairs.length,0);phase='active';stop();stop();assert.deepEqual(repairs,[4]);
 review.key='decision:'+'d'.repeat(64);stop();assert.deepEqual(repairs,[4]);
 event('tool/call',{name:'fixture'});stop();assert.equal(repairs.length,1);binding.dispose();
});
test('human input and cancellation never trigger autonomous stop correction',()=>{
 const handlers={},repairs=[],now=Date.now(),review={...priority,run:'run',goalId:'goal',generation:1,executionRevision:'b'.repeat(64)};const ctx={on:(n,fn)=>{handlers[n]=fn;return()=>{};},systemPrompt:{context:()=>()=>{}}};
 const binding=installDecisionReview(ctx,{book:{recordRound:()=>{},context:()=>review},sessionId:'owner',run:()=> 'run',goal:()=>({id:'goal',phase:'active',activation:'armed'}),execution:()=>({protocol:'agent-mc-execution-state/v1',scope:'runtime-receipts',run:'run',generation:1,revision:review.executionRevision,observedAt:now}),repair:x=>repairs.push(x)});
 const event=(type,data)=>handlers['session/event']({id:'owner'},{type,data,time:Date.now()});event('turn/start',{turn:4});event('user/message',{source:{kind:'user'}});event('user/message',{source:{kind:'goal',goalId:'goal'}});
 event('assistant/message',{message:{content:[{type:'text',text:'fixture'}]}});handlers['agent/turn-stopping']({agent:{id:'owner'},turn:4,signal:new AbortController().signal});assert.equal(repairs.length,0);
 event('turn/start',{turn:5});event('user/message',{source:{kind:'goal',goalId:'goal'}});event('assistant/message',{message:{content:[{type:'text',text:'fixture'}]}});
 const abort=new AbortController();abort.abort();handlers['agent/turn-stopping']({agent:{id:'owner'},turn:5,signal:abort.signal});assert.equal(repairs.length,0);
 handlers['agent/turn-stopping']({agent:{id:'owner'},turn:5,signal:new AbortController().signal});assert.equal(repairs.length,1);binding.dispose();
});
test('bounded correction uses a durable native context notice, without inventing a human source',async()=>{
 const req=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
 const [{Session},{createUserMessage}]=await Promise.all(['@deepseek-ai/dsh-session','@deepseek-ai/dsh-llm'].map(n=>import(pathToFileURL(req.resolve(n)).href)));
 const session=Session.create('fixture'),message=createUserMessage({content:[{type:'text',text:decisionReviewNotice(priority)}],source:{kind:'mc-decision-review',form:'notice',summary:'Bounded autonomous no-action correction'}});
 const e=session.append('user/message',message,{surfaceOp:'append'});assert.equal(e.data.source.kind,'mc-decision-review');assert.equal(e.data.source.form,'notice');assert.ok(!e.data.source.summary.startsWith('Operator request'));
});
