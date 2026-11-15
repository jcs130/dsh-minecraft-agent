import{test}from'node:test';import assert from'node:assert/strict';
import{gameGoalCompletesSession,installContinuousGoalAuthority}from'../src/harness-goal.mjs';
import{createRequire}from'node:module';
import{resolve}from'node:path';
import{pathToFileURL}from'node:url';

test('a completed game stage preserves the owner continuous session and its original receipt',()=>{
 const value={structuredContent:{failed:false,meta:{goalClosure:{phase:'closed',originalStage:'stage-1'}}}},before=structuredClone(value);
 assert.equal(gameGoalCompletesSession(value,{continuous:true}),false);
 assert.equal(gameGoalCompletesSession(value,{continuous:false}),true);
 assert.deepEqual(value,before);
 assert.equal(gameGoalCompletesSession({isError:true,...value},{continuous:false}),false);
 assert.equal(gameGoalCompletesSession({structuredContent:{failed:true,meta:value.structuredContent.meta}}),false);
 assert.equal(gameGoalCompletesSession({structuredContent:{meta:{goalClosure:{phase:'open'}}}}),false);
});

test('the public tool guard distinguishes model completion from game milestones and other owners',()=>{
 let guard,disposed=false,continuous=true;const goal={id:'original-goal',phase:'active',revision:825,roundsStarted:906};
 const ctx={tools:{guard:fn=>{guard=fn;return()=>{disposed=true;};}}};
 const off=installContinuousGoalAuthority(ctx,{sessionId:'owner',continuous:()=>continuous,goal:()=>goal});
 const call={agent:{id:'owner'},name:'update_goal',arguments:{action:'complete',goal_id:'original-goal',revision:825}};
 assert.match(guard(call),/主人/);assert.equal(goal.phase,'active');assert.equal(goal.roundsStarted,906);
 for(const other of[{...call,agent:{id:'other'}},{...call,name:'mymc_goal',arguments:{done:true}},{...call,arguments:{action:'pause',goal_id:'original-goal'}},{...call,arguments:{action:'complete',goal_id:'different-goal'}}])assert.equal(guard(other),undefined);
 continuous=false;assert.equal(guard(call),undefined);off();assert.equal(disposed,true);
});

test('official goal schema and tool dispatch deny model completion before the body and release the guard cleanly',async()=>{
 const require=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
 const load=name=>import(pathToFileURL(require.resolve(name)).href);
 const [{Context},{ToolRuntime},goalPlugin]=await Promise.all(['@deepseek-ai/cordis','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-tool-goal'].map(load));
 const ctx=new Context();ctx.provide('systemPrompt',{tools(){},section(){},getSectionOrder(){return 1;}});
 const runtime=new ToolRuntime(ctx),definitions=[];
 // Capture the official schema without invoking a model or its goal body.
 goalPlugin.apply({systemPrompt:ctx.systemPrompt,tools:{register:def=>definitions.push(def)}},{});
 const native=definitions.find(def=>def.name==='update_goal');
 assert.ok(native.parameters.properties.goal_id);assert.equal(native.parameters.properties.id,undefined);
 let bodies=0,continuous=true;
 runtime.register({...native,execute:async()=>{bodies++;return{goal:null};}});
 const goal={id:'original-goal',phase:'active',revision:1};
 const off=installContinuousGoalAuthority(ctx,{sessionId:'owner',continuous:()=>continuous,goal:()=>goal});
 const run=(id,agentId='owner')=>runtime.execute({callId:id,agent:{id:agentId},name:'update_goal',
   arguments:{goal_id:goal.id,revision:1,action:'complete'},signal:new AbortController().signal});
 assert.equal((await run('denied')).isError,true);assert.equal(bodies,0);assert.equal(goal.phase,'active');
 assert.equal((await run('different-owner','other')).isError,false);assert.equal(bodies,1);
 continuous=false;assert.equal((await run('bounded')).isError,false);assert.equal(bodies,2);
 continuous=true;off();assert.equal((await run('guard-disposed')).isError,false);assert.equal(bodies,3);
});
