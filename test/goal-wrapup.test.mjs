import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoalWrapUp,prepareOperatorGoal,settleHostGoal} from '../src/harness-goal.mjs';
import {selectTools} from '../src/harness-budget.mjs';
import {minecraftPlanningGuidance} from '../src/harness-composition.mjs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('a completed goal permits one closing request but no subsequent tool loop',()=>{
 const gate=new GoalWrapUp(),goal={id:'goal-a',phase:'complete'};
 assert.equal(gate.admit({turn:1,messages:[]},{...goal,phase:'active'}),true);
 assert.equal(gate.denial(goal),undefined);
 gate.close(1,goal);gate.close(1,goal);
 assert.equal(gate.admit({turn:1,messages:[]},goal),true);
 assert.match(gate.denial(goal),/结案/);
 assert.equal(gate.admit({turn:1,messages:[]},goal),false);
 assert.deepEqual(gate.stats,{closingSteps:1,blockedTools:1,rejectedSteps:1});
});
test('new human input, a new goal, or a later event turn can use tools again',()=>{
 for(const [payload,next] of [
  [{turn:3,messages:[{source:{kind:'user'}}]},{id:'a',phase:'complete'}],
  [{turn:3,messages:[{source:{kind:'mc-harness',form:'notice',summary:'Operator request owner-2'}}]},{id:'a',phase:'complete'}],
  [{turn:4,messages:[]},{id:'a',phase:'complete'}],
  [{turn:3,messages:[]},{id:'b',phase:'active'}],
  [{turn:3,messages:[]},{id:'a',phase:'active'}],
 ]){const gate=new GoalWrapUp();gate.close(3,{id:'a',phase:'complete'});assert.equal(gate.admit(payload,next),true);assert.equal(gate.denial(next),undefined);}
});
test('ambient events cannot renew a closing budget; blocked goals have the same bounded wrap-up',()=>{
 const gate=new GoalWrapUp(),goal={id:'a',phase:'blocked'},payload={turn:2,messages:[{source:{kind:'mc-harness',form:'notice',summary:'Minecraft events'}}]};
 gate.close(2,goal);assert.equal(gate.admit(payload,goal),true);gate.close(2,goal);
 assert.equal(gate.admit(payload,goal),false);
});
test('operator follow-up reuses an identical active goal, without replacing other active work',()=>{
 const goal={id:'a',phase:'active',objective:'测试'},calls=[];
 const ports={agent:{},goals:{get:()=>goal,create:(_agent,args)=>calls.push(args)}};
 assert.equal(prepareOperatorGoal({goal:' 测试 '},{},ports),goal);assert.deepEqual(calls,[]);
 assert.throws(()=>prepareOperatorGoal({goal:'其他工作'},{},ports),/Finish/);
 goal.phase='complete';prepareOperatorGoal({goal:'测试'},{},ports);assert.deepEqual(calls,[{objective:'测试',maxGoalRounds:40}]);
});
test('the lean catalogue retains the existing bounded event-wait tool and its cursor guidance',()=>{
 const tools=selectTools([{name:'mc_events'},{name:'mc_queue'},{name:'mc_trace'}]);
 assert.deepEqual(tools.map(t=>t.name),['mc_events','mc_queue']);
 assert.match(minecraftPlanningGuidance(tools),/waitMs/);assert.match(minecraftPlanningGuidance(tools),/run 和 nextCursor/);
});

test('budget/no-progress settlement preserves unfinished goals instead of reporting success',()=>{
 for(const phase of ['active','paused','blocked']){
  let goal={id:'keep-id',revision:5,phase,objective:'Keep the owner objective',roundsStarted:3};const calls=[];
  const ports={agent:{},goals:{get:()=>goal,pause:(_a,ref)=>{assert.equal(ref.id,goal.id);calls.push('pause');goal={...goal,phase:'paused'};return goal;},complete:()=>assert.fail('Budget cannot complete a goal')}};
  settleHostGoal('per-goal call budget used up','pause',ports);assert.equal(goal.id,'keep-id');assert.equal(goal.roundsStarted,3);assert.notEqual(goal.phase,'complete');assert.deepEqual(calls,phase==='active'?['pause']:[]);
 }
});

test('the official tool runtime denies post-goal side effects before invoking their body',async()=>{
 const require=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
 const [{Context},{ToolRuntime}]=await Promise.all(['@deepseek-ai/cordis','@deepseek-ai/dsh-tools'].map(name=>import(pathToFileURL(require.resolve(name)))));
 const ctx=new Context();ctx.provide('systemPrompt',{tools(){}});
 const runtime=new ToolRuntime(ctx),gate=new GoalWrapUp();
 const goal={id:'native-goal',phase:'complete'};let bodies=0;
 runtime.register({name:'fixture_action',description:'Synthetic action',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},isConcurrencySafe:()=>false,execute:async()=>{bodies++;return{dispatched:true};}});
 runtime.guard(()=>gate.denial(goal));
 const run=id=>runtime.execute({callId:id,name:'fixture_action',arguments:{},signal:new AbortController().signal});
 assert.equal((await run('before-close')).isError,false);assert.equal(bodies,1);
 gate.close(1,goal);const denied=await run('after-close');assert.equal(denied.isError,true);assert.equal(bodies,1);
 gate.admit({turn:2,messages:[]},goal);assert.equal((await run('next-real-turn')).isError,false);assert.equal(bodies,2);
});
