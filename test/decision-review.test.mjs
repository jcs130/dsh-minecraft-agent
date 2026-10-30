import test from 'node:test';import assert from 'node:assert/strict';import {EvidenceReflection} from '../src/harness-reflection.mjs';import {installDecisionReview} from '../src/harness-decision-review.mjs';
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
 const ctx={on:(name,fn)=>{assert.equal(name,'session/event');callback=fn;return()=>{};},systemPrompt:{context:x=>{context=x;return()=>{};}}};
 const binding=installDecisionReview(ctx,{book,sessionId:'owner',run:()=> 'run',goal:()=>({id:'goal',phase:'active'}),execution:()=>null});
 const event=(type,data)=>callback({id:'owner'},{type,data,time:1000});
 event('turn/start',{turn:1});event('user/message',{source:{kind:'goal',goalId:'goal'}});event('request/header',{header:{tools:[{name:'tool'}]}});
 event('assistant/message',{message:{content:[{type:'text',text:'private response fixture'}]}});event('turn/end',{reason:{kind:'completed'}});
 assert.equal(recorded.length,1);assert.equal(recorded[0].autonomous,true);assert.equal(recorded[0].completed,true);assert.equal(recorded[0].toolsAvailable,1);
 assert.equal(recorded[0].response.chars,24);assert.match(recorded[0].response.hash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(recorded).includes('private response fixture'));
 assert.equal(context.text(),'');binding.dispose();
});
