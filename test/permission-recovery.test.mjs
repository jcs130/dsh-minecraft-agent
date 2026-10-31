import test from'node:test';import assert from'node:assert/strict';
import{PermissionRecovery,installPermissionRecovery}from'../src/harness-permission-recovery.mjs';
const evidence=(i,extra={})=>({sessionId:'owner',subject:'goal-1',run:'run-1',tool:'update_goal',operation:'pause',code:'GOAL_TOOL_AUTHORITY_REQUIRED',callId:'call-'+i,...extra});

test('248 permission denials yield one bounded notice without granting access, replaying or retaining payload text',()=>{
 let saved;const b=new PermissionRecovery({write:x=>{saved=structuredClone(x);}});
 for(let i=0;i<248;i++)b.record({...evidence(i),revision:i,prompt:'private',errorMessage:'private'});
 const pending=b.pending('owner','goal-1','run-1');assert.equal(pending.count,248);assert(b.queued(pending));assert.equal(b.pending('owner','goal-1','run-1'),null);
 const restored=new PermissionRecovery({read:()=>saved});assert.equal(restored.pending('owner','goal-1','run-1'),null);assert.equal(JSON.stringify(saved).includes('private'),false);
});
test('duplicates, untyped prose and missing authority never become fabricated permission evidence',()=>{
 const b=new PermissionRecovery();b.record(evidence(1));b.record(evidence(1));assert.equal(b.snapshot().episodes[0].count,1);
 for(const code of[undefined,'OTHER_ERROR','invalid','requires a direct human'])b.record(evidence(2,{code}));assert.equal(b.snapshot().episodes.length,1);assert.equal(b.pending('other','goal-1','run-1'),null);
});
test('restoration keeps only bounded metadata and rejects corrupt episode containers',()=>{
 const b=new PermissionRecovery({read:()=>({schema:'dsh-permission-recovery/v1',episodes:[{...evidence(1),count:3,queued:false,prompt:'private',errorMessage:'private'}]})});
 assert.equal(JSON.stringify(b.snapshot()).includes('private'),false);assert(b.pending('owner','goal-1','run-1'));
 assert.equal(new PermissionRecovery({read:()=>({schema:'dsh-permission-recovery/v1',episodes:{}})}).snapshot().episodes.length,0);
});
test('new goals and runs keep separate bounded episodes; revision changes do not create one per call',()=>{
 const b=new PermissionRecovery();for(let i=0;i<100;i++)b.record(evidence(i,{subject:'goal-'+i}));assert.equal(b.snapshot().episodes.length,16);
 for(let i=0;i<3;i++)b.record(evidence('new-'+i,{run:'run-2'}));assert(b.pending('owner','goal-1','run-2'));assert.equal(b.pending('owner','goal-1','run-1'),null);
});
function fixture(){const handlers={},messages=[];let goal={id:'goal-1',phase:'active',activation:'armed'},run='run-1';const book=new PermissionRecovery();
 const off=installPermissionRecovery({on(name,fn){handlers[name]=fn;return()=>{delete handlers[name];};}},{book,sessionId:'owner',goal:()=>goal,run:()=>run,continuous:()=>true,createMessage:x=>x});
 const agent={id:'owner',inject:x=>messages.push(x)},result={isError:true,error:{message:'Original native refusal',info:{code:'GOAL_TOOL_AUTHORITY_REQUIRED'}}};
 const reject=(i,options={})=>handlers['tools/result']({agent,callId:'call-'+i,name:'update_goal',arguments:{action:'pause'},...options},result);
 const step=async(options={})=>{let called=0;const next=async()=>{called++;return{kind:'enter'};};const out=await handlers['agent/pre-step']({agent,...options},next);assert.equal(called,1);assert.equal(out.kind,'enter');};
 return{handlers,book,messages,agent,result,reject,step,off,goal:x=>{goal=x;},run:x=>{run=x;}};
}
test('public hooks retain original errors and inject once into an existing pre-step, never a new generation',async()=>{
 const f=fixture(),before=structuredClone(f.result);for(let i=0;i<248;i++)f.reject(i);assert.deepEqual(f.result,before);assert.equal(f.messages.length,0);
 await f.step();await f.step();assert.equal(f.messages.length,1);assert.equal(f.messages[0].source.kind,'mc-permission-recovery');assert.equal(f.messages[0].source.kind==='user',false);
 f.off();assert.deepEqual(f.handlers,{});
});
test('human pause, abort, foreign agent and foreign run cannot be woken or silently rearmed',async()=>{
 const f=fixture();for(let i=0;i<3;i++)f.reject(i);f.goal({id:'goal-1',phase:'active',activation:'disarmed'});await f.step();assert.equal(f.messages.length,0);
 f.goal({id:'goal-1',phase:'active',activation:'armed'});await f.step({signal:AbortSignal.abort()});await f.step({agent:{id:'other'}});assert.equal(f.messages.length,0);
 f.run('run-2');await f.step();assert.equal(f.messages.length,0);f.run('run-1');await f.step();assert.equal(f.messages.length,1);
});
test('legacy calls to masked host mutations get a capability notice; arbitrary missing game tools do not',async()=>{
 const f=fixture(),missing={isError:true,error:{info:{name:'ToolNotFoundError'}}};
 for(let i=0;i<3;i++)f.handlers['tools/result']({agent:f.agent,callId:'missing-'+i,name:'update_goal'},missing);
 for(let i=0;i<3;i++)f.handlers['tools/result']({agent:f.agent,callId:'other-'+i,name:'mymc_missing'},missing);
 await f.step();assert.equal(f.book.snapshot().episodes.length,1);assert.equal(f.messages.length,1);assert.match(f.messages[0].content[0].text,/TOOL_NOT_FOUND/);
});
test('failed notice delivery is attempted once and diagnostic persistence cannot replace native errors',async()=>{
 let writes=0;const b=new PermissionRecovery({write(){writes++;throw Error('fixture storage unavailable');}});
 for(let i=0;i<3;i++)b.record(evidence(i));const e=b.pending('owner','goal-1','run-1');assert(b.claim(e));assert.equal(b.pending('owner','goal-1','run-1'),null);assert.equal(b.snapshot().persistenceErrors,writes);
 const f=fixture();for(let i=0;i<3;i++)f.reject(i);let attempts=0;f.agent.inject=()=>{attempts++;throw Error('fixture disposed');};await f.step();await f.step();assert.equal(attempts,1);assert.equal(f.book.snapshot().injectionErrors,1);assert.equal(f.book.snapshot().episodes[0].queued,false);
});
