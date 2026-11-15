/** Native DSH ports over the shared core's dynamic Harness2 service. */
import{join}from'node:path';import{randomUUID}from'node:crypto';
import{createDshHarness2Model,bindDshHarness2Lab}from'./harness2.mjs';
export const PHYSICS_CAPABILITY='Java 1.21.1 flat-ground collision physics only. mc.state() exposes snapshot.position and target; await bot.look, bot.setControlState, bot.waitForTicks and bot.clearControlStates. At most32 SDK calls and1000ticks; release controls in finally. No combat, spells, inventory, oxygen or live scene clone.';
/** Existing native Agent tools, for scoped hot upgrades without a second body. */
export function nativePracticePorts(agent,prefix='mc') {
 let facts=null;
 const execute=async(name,args,signal)=>{
  const r=await agent.ctx.tools.execute({callId:'practice-port:'+randomUUID(),name,arguments:args,agent,signal});
  const v=r.value??r;if(r.isError||v.isError||v.structuredContent?.failed||typeof v.structuredContent?.text!=='string')throw Error('Original native practice port rejected request');
  return v;
 };
 const refresh=async signal=>{const r=await execute(prefix+'_connection',{action:'status'},signal),status=JSON.parse(r.structuredContent.text);
  facts=status.facts;
  if(status.connection?.ready!==true||!facts?.experience?.scope)throw Error('Current core game identity is unknown');return facts;};
 return{refresh,runtime:{tools:()=>[{name:prefix+'_script'}],currentFacts:()=>facts},bridge:{call:async(name,args,exec)=>{
  const previous=facts?.experience?.scope;await refresh(exec.signal);
  if(previous&&JSON.stringify(previous)!==JSON.stringify(facts.experience.scope))throw Error('Game identity changed during practice');
  return execute(name,args,exec.signal);
 }}};
}
export async function configuredMethodPractice({ctx,config,dataDir,sessionId,metrics,bridge,memoryTool,lifetimeSignal,onMonitor,onDispose,runtime}) {
 const c=config.harness2;if(c?.enabled!==true)return null;
 if(c.backend!=='physics'||!c.worker?.command||!c.worker?.workspace)throw Error('Dynamic method practice needs an explicit physics worker');
 const core=await import('agent-mc-world/learning'),{harness2WorkerPath}=await import('agent-mc-world/decisions');
 if(!core.Harness2PracticeService||!core.createPracticeCandidateStager)throw Error('Upgrade the shared core for dynamic method practice');
 const scriptName=runtime.tools().find(t=>t.name.endsWith('_script'))?.name;
 if(!scriptName)throw Error('Shared script/library tool unavailable');
 const scope=()=>runtime.status?.().facts?.experience?.scope??runtime.currentFacts()?.experience?.scope??null;
 const call=async(name,args,signal)=>{
  const r=await bridge.call(name,args,{id:'method-practice:'+randomUUID(),signal,concludeTurn:()=>{}});
  if(r.isError||r.structuredContent?.failed)throw Error('Shared method practice port rejected the request');
  if(typeof r.structuredContent?.text!=='string')throw Error('Missing shared method receipt');return r.structuredContent;
 };
 const directory=join(dataDir,'practice','dynamic'),fixture=core.createPhysicsMethodPractice({directory:join(directory,'methods'),seeds:c.seeds??[1,2],
  binding:{instanceId:'practice:'+sessionId,realm:'isolated-physics:'+sessionId,account:'practice',agent:config.name,isolated:true}});
 const memory=memoryTool?core.createPracticeGameMemory({call:async(args,signal)=>JSON.parse((await call(memoryTool,args,signal)).text)}):{};
 const service=new core.Harness2PracticeService({directory:join(directory,'jobs'),worker:{...c.worker,script:c.worker.script||harness2WorkerPath()},
  model:createDshHarness2Model(ctx.llm,{provider:config.provider,model:config.model,maxTokens:4096,reasoningEffort:config.reasoningEffort,...c.model,sessionId:'harness2:'+sessionId},metrics),
  practice:fixture.executor,fixtures:fixture.fixtures,capability:PHYSICS_CAPABILITY,
  budget:c.budget??{modelCalls:8,trials:6,wallMs:180000,trialMs:10000,contextBytes:100000},
  source:()=>{const s=scope();return s?{scope:s,instanceId:`${s.realm}/${s.account}/${s.agent}`}:null;},
  readMethod:async(id,revision,signal)=>JSON.parse((await call(scriptName,{library:{op:'read',id,revision}},signal)).text),
  stageCandidate:core.createPracticeCandidateStager({scope,call:(args,signal)=>call(scriptName,args,signal)}),...memory});
 const monitor={snapshot:()=>service.snapshot()};onMonitor?.(monitor);bindDshHarness2Lab(ctx,sessionId,monitor);
 ctx.effect(()=>()=>service.close(),'Minecraft dynamic practice lifetime');
 onDispose?.(()=>service.close());
 ctx.systemPrompt?.context?.({name:'minecraft:practice-index',order:9994,interpolate:false,text:()=>JSON.stringify(service.context())});
 const spec=service.tool('mc_practice');
 return{name:spec.name,description:spec.description.replaceAll('mc_script',scriptName),parameters:spec.parameters,output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
  isConcurrencySafe:()=>false,execute:async(args,exec)=>service.call(args,lifetimeSignal?AbortSignal.any([exec.signal,lifetimeSignal]):exec.signal)};
}
