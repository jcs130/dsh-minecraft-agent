import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autonomyPolicy, AutonomousContinuation } from '../src/harness-autonomy.mjs';
import { HostLifecycle } from '../src/harness-lifecycle.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function fixture(config = {}, saved = null) {
  let time=0,record=saved,goal={id:'same-goal',revision:0,phase:'active',activation:'armed',roundsStarted:0,maxGoalRounds:4,objective:'Survive autonomously'};
  const agent={status:'idle'},calls=[];
  const ref=expected=>{assert.equal(expected.id,goal.id);assert.equal(expected.revision,goal.revision);};
  const goals={get:()=>goal,disarm(){goal={...goal,activation:'disarmed'};calls.push('disarm');},
    edit(_a,r,patch){ref(r);goal={...goal,...patch,revision:goal.revision+1};calls.push('edit');return goal;},
    resume(_a,r){ref(r);assert.ok(goal.roundsStarted<goal.maxGoalRounds);goal={...goal,revision:goal.revision+1,phase:'active',activation:'armed'};delete goal.blockedReason;calls.push('resume');return goal;}};
  const controller=new AutonomousContinuation({config,now:()=>time,read:()=>record,write:r=>record=structuredClone(r)});
  controller.bind(goal);
  const ports={goals,agent,flush:async()=>calls.push('flush')};
  return {controller,ports,calls,get goal(){return goal;},set goal(v){goal=v;},advance(ms){time+=ms;},saved:()=>record};
}
test('default continuous mode has finite checkpoints but no cumulative cap; explicit bounded budgets remain supported',()=>{
  assert.equal(autonomyPolicy().mode,'continuous');assert.equal(autonomyPolicy({maxGoalCalls:30}).mode,'bounded');
  assert.equal(autonomyPolicy({maxGoalRounds:40,autonomy:{mode:'continuous'}}).mode,'continuous');
  for(const config of [{autonomy:{mode:'forever!'}},{autonomy:{roundWindow:Infinity}},{autonomy:{stepWindow:0}}])assert.throws(()=>autonomyPolicy(config));
});
test('1200 cumulative native rounds extend the original finite window without resetting identity, objective or count',async()=>{
  const f=fixture({autonomy:{roundWindow:4}});
  for(let round=1;round<=1200;round++){
    assert.ok(f.goal.roundsStarted<f.goal.maxGoalRounds);
    f.goal={...f.goal,roundsStarted:round};await f.controller.tick(f.ports);
    assert.equal(f.goal.id,'same-goal');assert.equal(f.goal.objective,'Survive autonomously');assert.equal(f.goal.roundsStarted,round);
  }
  assert.ok(f.controller.stats.extendedWindows>300);assert.equal(f.calls.includes('resume'),false);
  assert.equal(f.controller.snapshot().totalRoundLimit,null);
});

test('a new explicitly armed native owner goal can continue after setup; stopped or foreign views are never implicitly resumed',async()=>{
  const f=fixture();const original=f.goal.id;
  for(const value of [{id:'paused',phase:'paused',activation:'disarmed'},{id:'done',phase:'complete',activation:'disarmed'},
    {id:'disarmed',phase:'active',activation:'disarmed'},{id:'blocked',phase:'blocked',activation:'disarmed'}]){
    f.controller.bindArmed(value);assert.equal(f.controller.managedId,original);
  }
  f.goal={...f.goal,id:'new-native-owner-goal',roundsStarted:4,activation:'armed'};
  f.controller.bindArmed(f.goal);await f.controller.tick(f.ports);
  assert.equal(f.controller.managedId,f.goal.id);assert.ok(f.goal.maxGoalRounds>4);assert.equal(f.goal.roundsStarted,4);
});
test('30-step segments yield at the next admission without cancelling actions; the next same-goal round continues',async()=>{
  const f=fixture();
  for(let step=0;step<30;step++){assert.equal(f.controller.beforeStep(1,f.ports),true);f.controller.admitted(1);}
  assert.equal(f.controller.beforeStep(1,f.ports),false);assert.equal(f.goal.phase,'active');assert.equal(f.goal.activation,'disarmed');
  assert.equal(await f.controller.tick(f.ports),false);f.advance(250);assert.equal(await f.controller.tick(f.ports),true);
  assert.equal(f.goal.id,'same-goal');assert.equal(f.controller.beforeStep(2,f.ports),true);
});

test('a user-steered turn during an owned rest is still bounded without falsely rearming a disarmed goal',()=>{
  const f=fixture();f.controller.rest('noop',f.ports);
  for(let step=0;step<30;step++){assert.equal(f.controller.beforeStep(2,f.ports),true);f.controller.admitted(2);}
  assert.equal(f.controller.beforeStep(2,f.ports),false);assert.equal(f.goal.activation,'disarmed');assert.equal(f.calls.includes('resume'),false);
});
test('only an owned round-limit may resume automatically; owner pause, completion, foreign or unknown blockers win',async()=>{
  for(const changed of [{phase:'paused'},{phase:'complete'},{phase:'blocked',blockedReason:{code:'missing-permission'}},{id:'another-goal'},{activation:'disarmed'}]){
    const f=fixture();f.goal={...f.goal,...changed};await f.controller.tick(f.ports);assert.deepEqual(f.calls,[]);
  }
  const f=fixture();f.goal={...f.goal,phase:'blocked',activation:'disarmed',roundsStarted:4,blockedReason:{code:'round-limit'}};
  await f.controller.tick(f.ports);assert.equal(f.goal.phase,'active');assert.equal(f.goal.roundsStarted,4);assert.equal(f.goal.maxGoalRounds,44);
});
test('no-progress rests survive restart, do not run while disconnected or before a settled boundary, and retain the original goal',async()=>{
  const f=fixture();f.controller.rest('no-progress',f.ports);
  const restored=new AutonomousContinuation({config:{},now:()=>20000,read:f.saved,write:()=>{}});
  assert.equal(await restored.tick({...f.ports,ready:()=>false}),false);assert.equal(f.calls.includes('resume'),false);
  assert.equal(await restored.tick(f.ports),true);assert.equal(f.goal.id,'same-goal');assert.equal(f.goal.phase,'active');
  const cancelled=fixture();cancelled.controller.rest('noop',cancelled.ports);cancelled.goal={...cancelled.goal,revision:1,phase:'paused'};
  cancelled.advance(20000);await cancelled.controller.tick(cancelled.ports);assert.equal(cancelled.goal.phase,'paused');
});
test('a pause, replacement or disconnect during a durability flush cannot be auto-resumed',async()=>{
  for(const change of ['pause','replace','disconnect']){
    const f=fixture();f.goal={...f.goal,phase:'blocked',activation:'disarmed',roundsStarted:4,blockedReason:{code:'round-limit'}};
    let connected=true;
    await f.controller.tick({...f.ports,ready:()=>connected,flush:async()=>{
      if(change==='disconnect')connected=false;
      else f.goal={...f.goal,revision:f.goal.revision+1,...change==='pause'?{phase:'paused'}:{id:'replacement'}};
    }});
    assert.equal(f.calls.includes('resume'),false);
  }
});
test('continuous lifecycle exposes a rolling window separately from an unlimited cumulative budget',()=>{
  const f=fixture();const lifecycle=new HostLifecycle({stateFile:'',eventsFile:'',sessionId:'fixture'});
  const state=lifecycle.snapshot({paused:false,stopped:false,state:'idle',goal:f.goal,autonomy:f.controller.snapshot()});
  assert.equal(state.goalRounds.limit,null);assert.equal(state.goalRounds.remaining,null);assert.equal(state.goalRounds.windowLimit,4);
  f.controller.rest('noop',f.ports);const autonomy=f.controller.snapshot();
  assert.equal(lifecycle.snapshot({paused:false,stopped:false,state:'idle',goal:f.goal,autonomy}).continuation,'waiting');
  for(const phase of ['complete','paused','blocked'])assert.equal(lifecycle.snapshot({paused:false,stopped:false,state:'idle',goal:{...f.goal,phase},autonomy}).continuation,phase);
  assert.equal(lifecycle.snapshot({paused:false,stopped:false,state:'idle',goal:{...f.goal,id:'other-goal'},autonomy}).continuation,'disarmed');
});

test('disconnect clearing an owned rest during durable extension does not dereference or revive it',async()=>{
  const f=fixture();f.goal={...f.goal,roundsStarted:4};f.controller.rest('no-progress',f.ports);f.advance(20000);
  let connected=true;
  assert.equal(await f.controller.tick({...f.ports,ready:()=>connected,flush:async()=>{connected=false;f.controller.suspend();}}),false);
  assert.equal(f.controller.hold,null);assert.equal(f.goal.activation,'disarmed');assert.equal(f.calls.includes('resume'),false);
});

test('danger and direct player attention interrupt only our soft rest; ambient traffic and owner pauses do not',async()=>{
  const f=fixture();f.controller.rest('no-progress',f.ports);f.controller.wake(['ambient','chat-other']);
  assert.equal(await f.controller.tick(f.ports),false);
  f.controller.wake(['danger']);assert.equal(await f.controller.tick(f.ports),true);
  f.controller.rest('noop',f.ports);f.goal={...f.goal,phase:'paused',revision:f.goal.revision+1};
  f.controller.wake(['mention']);await f.controller.tick(f.ports);assert.equal(f.goal.phase,'paused');
});

test('a crash between native window extension and owned hold resumption is recoverable without resetting history',async()=>{
  const f=fixture();f.goal={...f.goal,roundsStarted:4};f.controller.rest('no-progress',f.ports);f.advance(20000);
  await assert.rejects(f.controller.tick({...f.ports,flush:async()=>{throw Error('Fixture crash after native edit');}}),/crash/);
  assert.equal(f.goal.revision,1);assert.equal(f.goal.activation,'disarmed');assert.equal(f.saved().hold.extension.limit,44);
  const restored=new AutonomousContinuation({config:{},read:f.saved,now:()=>20000});
  assert.equal(await restored.tick(f.ports),true);assert.equal(f.goal.id,'same-goal');assert.equal(f.goal.roundsStarted,4);assert.equal(f.goal.activation,'armed');
});
test('official DSH replays rolling same-goal rounds and restores the original cumulative history',async()=>{
  const require=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
  const load=name=>import(pathToFileURL(require.resolve(name)));
  const [{Context},{SessionStore},{SessionProjectionRegistry},{GoalService},{createUserMessage}]=await Promise.all([
    '@deepseek-ai/cordis','@deepseek-ai/dsh-session','@deepseek-ai/dsh-session-projection','@deepseek-ai/dsh-goal','@deepseek-ai/dsh-llm'].map(load));
  const root=new Context(),agents=new Map();
  const services=await root.plugin({name:'autonomy-native-fixture',apply(ctx){ctx.provide('agents',{get:id=>agents.get(id)});new SessionStore(ctx);new SessionProjectionRegistry(ctx);}}).await();
  const gp=await root.plugin(GoalService).await();
  const owner=await root.plugin({name:'autonomy-native-owner',inject:['goals','sessions'],async apply(ctx){
    const session=ctx.sessions.create('continuous-native'),agent={id:'continuous-agent',session,status:'idle'};agents.set(agent.id,agent);
    const initial=ctx.goals.create(agent,{objective:'Autonomous fixture',maxGoalRounds:4});
    let time=0;
    const controller=new AutonomousContinuation({config:{autonomy:{roundWindow:4}},now:()=>time});controller.bind(initial);
    for(let round=1;round<=100;round++){
      const current=ctx.goals.get(agent);
      session.append('user/message',createUserMessage({content:[{type:'text',text:'Offline goal-round fixture'}],source:{kind:'goal',goalId:current.id,revision:current.revision,round}}),{surfaceOp:'append'});
      assert.equal(ctx.goals.get(agent).roundsStarted,round);
      await controller.tick({goals:ctx.goals,agent,flush:async()=>{}});
    }
    const ports={goals:ctx.goals,agent,flush:async()=>{}};
    for(let step=0;step<30;step++){assert.equal(controller.beforeStep(101,ports),true);controller.admitted(101);}
    const revision=ctx.goals.get(agent).revision;
    assert.equal(controller.beforeStep(101,ports),false);
    assert.equal(ctx.goals.get(agent).activation,'disarmed');assert.equal(ctx.goals.get(agent).revision,revision);
    time+=250;assert.equal(await controller.tick(ports),true);assert.equal(ctx.goals.get(agent).activation,'armed');
    const saved=structuredClone(session.log),restored=ctx.sessions.create('continuous-restored',{seed:saved});
    const other={id:'continuous-restored-agent',session:restored,status:'idle'};agents.set(other.id,other);
    const recovered=ctx.goals.get(other);assert.equal(recovered.id,initial.id);assert.equal(recovered.roundsStarted,100);
    assert.equal(recovered.phase,'active');assert.ok(recovered.maxGoalRounds>100);
    assert.equal(saved.filter(e=>e.type==='goal/change'&&e.data.operation==='create').length,1);
    controller.rest('no-progress',ports);const current=ctx.goals.get(agent);
    ctx.goals.pause(agent,{id:current.id,revision:current.revision});time+=60000;
    assert.equal(await controller.tick(ports),false);assert.equal(ctx.goals.get(agent).phase,'paused');
    const paused=ctx.goals.get(agent);ctx.goals.complete(agent,{id:paused.id,revision:paused.revision});
    const next=ctx.goals.create(agent,{objective:'New native owner task after setup',maxGoalRounds:2});
    controller.bindArmed(next);await controller.tick(ports);
    assert.equal(controller.managedId,next.id);assert.notEqual(controller.managedId,initial.id);
  }}).await();
  try{assert.ok(owner);}finally{await owner.dispose();await gp.dispose();await services.dispose();}
});
