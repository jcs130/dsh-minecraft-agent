import test from 'node:test';import assert from 'node:assert/strict';
import {EvidenceReflection,installEvidenceReflection} from '../src/harness-reflection.mjs';
const base={provider:'fixture',model:'original',reasoningEffort:'off',maxTokens:6000};
const evidence=(id='r:3',observation='unchanged',phase='completed')=>({evidence:[{kind:'task',run:'r',taskId:id,attempts:4,scope:'target',observation,phase}]});
const step=n=>({turn:1,step:n});
test('default is inert; completed unchanged evidence selects one existing request without changing model, budget or base',()=>{
 assert.equal(new EvidenceReflection().select(base,evidence(),step(1)),base);
 const p=new EvidenceReflection({enabled:true});const value=p.select(base,evidence(),step(1));
 assert.equal(value.reasoningEffort,'low');assert.equal(value.model,base.model);assert.equal(value.maxTokens,6000);assert.equal(base.reasoningEffort,'off');
 assert.equal(p.select(base,evidence(),step(2)),base);assert.equal(p.state.selections,1);
});
test('unchanged is required; explicit high, default-provider thinking and cancelled admission are preserved',()=>{
 const p=new EvidenceReflection({enabled:true});
 assert.equal(p.select(base,evidence('r:1','unknown'),step(1)),base);
 assert.equal(p.select(base,evidence('r:2','changed'),step(2)),base);
 const high={...base,reasoningEffort:'high'},unset={...base,reasoningEffort:undefined};
 assert.equal(p.select(high,evidence(),step(3)),high);assert.equal(p.select(unset,evidence(),step(4)),unset);
 const c=new AbortController();c.abort();assert.equal(p.select(base,evidence(),{...step(5),signal:c.signal}),base);assert.equal(p.state.selections,0);
});
test('cooldown does not pause the agent and requires both elapsed time and enough ordinary requests',()=>{
 let now=0;const p=new EvidenceReflection({enabled:true,minIntervalMs:1000,minRequests:3},{now:()=>now});
 assert.equal(p.select(base,evidence(),step(1)).reasoningEffort,'low');
 now=1001;assert.equal(p.select(base,evidence('r:4'),step(2)),base);
 assert.equal(p.select(base,evidence('r:5'),step(3)),base);
 assert.equal(p.select(base,evidence('r:6'),step(4)).reasoningEffort,'low');
 assert.equal(p.select(base,evidence('r:7'),step(5)),base);
});
test('selection bookkeeping survives reload; repeated admission does not consume two selections',()=>{
 let saved,now=0;const options={now:()=>now,write:x=>saved=structuredClone(x),read:()=>saved};
 const p=new EvidenceReflection({enabled:true,minIntervalMs:1000,minRequests:1},options);
 p.select(base,evidence(),step(1));assert.equal(p.select(base,evidence(),step(1)).reasoningEffort,'low');assert.equal(p.state.selections,1);
 const q=new EvidenceReflection({enabled:true,minIntervalMs:1000,minRequests:1},options);
 assert.equal(q.select(base,evidence('r:5'),step(2)),base);now=1001;
 assert.equal(q.select(base,evidence('r:6'),step(3)).reasoningEffort,'low');assert.equal(saved.selections,2);
});
test('the same failed method source needs two distinct terminal records',()=>{
 const p=new EvidenceReflection({enabled:true}),a={kind:'method',run:'r',methodId:'m:1',sourceHash:'a'.repeat(64)};
 assert.equal(p.select(base,{evidence:[a]},step(1)),base);
 assert.equal(p.select(base,{evidence:[a,a]},step(2)),base);
 assert.equal(p.select(base,{evidence:[a,{...a,methodId:'m:2'}]},step(3)).reasoningEffort,'low');
});

test('presentation keeps early evidence and the private host can choose a two-attempt reflection threshold',()=>{
 const p=new EvidenceReflection({enabled:true,attempts:2});const s=evidence();s.evidence[0].attempts=2;
 assert.equal(p.select(base,s,step(1)).reasoningEffort,'low');
});

const intent={sessionId:'original-session',selectionSeq:12};
test('a temporary low header is restored on the next request and after process recovery',()=>{
 let saved;const storage={read:()=>saved,write:x=>saved=structuredClone(x)};
 const p=new EvidenceReflection({enabled:true},storage);
 const low=p.select(base,evidence(),{...step(1),intent});
 assert.equal(low.reasoningEffort,'low');
 assert.equal(p.select(low,evidence(),{...step(1),intent}).reasoningEffort,'low');
 assert.equal(p.select(low,evidence(),{...step(2),intent}).reasoningEffort,'off');
 const resumed=new EvidenceReflection({enabled:true},storage);
 const restored=resumed.select(low,evidence(),{...step(3),intent});
 assert.equal(restored.reasoningEffort,'off');assert.equal(restored.maxTokens,6000);
 assert.equal(resumed.state.selections,1);
 const disabled=new EvidenceReflection({enabled:false},storage);
 assert.equal(disabled.select(low,evidence(),{...step(4),intent}).reasoningEffort,'off');
});
test('an explicit same-level human choice wins, including a choice made while unloaded',()=>{
 let saved;const storage={read:()=>saved,write:x=>saved=structuredClone(x)};
 const p=new EvidenceReflection({enabled:true},storage);
 const low=p.select(base,evidence(),{...step(1),intent});
 const human={...intent,selectionSeq:40};
 assert.equal(p.select(low,evidence(),{...step(1),intent:human}).reasoningEffort,'low');
 assert.equal(p.lease,null);
 const q=new EvidenceReflection({enabled:true},storage);
 assert.equal(q.select(low,evidence(),{...step(2),intent:human}),low);
 const other=new EvidenceReflection({enabled:true});
 other.select(base,evidence(),{...step(1),intent});
 const high={...low,reasoningEffort:'high'};
 assert.equal(other.select(high,evidence(),{...step(2),intent}),high);
 assert.equal(other.lease,null);
});
test('an override cannot cross session or model boundaries and preserves none and cancellation',()=>{
 const p=new EvidenceReflection({enabled:true});
 const low=p.select({...base,reasoningEffort:'none'},evidence(),{...step(1),intent});
 const c=new AbortController();c.abort();
 assert.equal(p.select(low,evidence(),{...step(2),intent,signal:c.signal}),low);
 assert.equal(p.select(low,evidence(),{...step(3),intent}).reasoningEffort,'none');
 const route={...low,model:'another'};
 assert.equal(p.select(route,evidence(),{...step(4),intent}),route);
 const q=new EvidenceReflection({enabled:true});q.select(base,evidence(),{...step(1),intent});
 assert.equal(q.select(low,evidence(),{...step(2),intent:{...intent,sessionId:'independent'}}),low);
});
test('public hook observes intent once, disposes its cut, then respects live explicit intent',async()=>{
 const listeners=new Map(),ctx={on:(name,fn)=>listeners.set(name,fn)};
 let observations=0,disposals=0;
 const query={observeSession:async()=>{observations++;return{source:'live',header:{id:intent.sessionId},
  events:[{type:'model/selection',seq:12}], [Symbol.dispose]:()=>disposals++};}};
 const reflection=new EvidenceReflection({enabled:true});
 installEvidenceReflection(ctx,{reflection,retryEvidence:{snapshot:evidence},sessionQuery:query});
 const request=listeners.get('agent/request'),agent={session:{id:intent.sessionId}};
 const low=await request({...step(1),agent},async()=>base);
 assert.equal(low.reasoningEffort,'low');
 assert.equal((await request({...step(2),agent},async()=>low)).reasoningEffort,'off');
 listeners.get('session/event')(agent.session,{type:'model/selection',seq:40});
 assert.equal((await request({...step(3),agent},async()=>low)).reasoningEffort,'low');
 assert.equal(observations,1);assert.equal(disposals,1);
});
