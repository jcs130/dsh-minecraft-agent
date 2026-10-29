/** Scoped migration entry: add learning tools to an existing Agent, no new body. */
import{readFileSync,writeFileSync,appendFileSync}from'node:fs';import{createHash}from'node:crypto';
import{installImprovementContext}from'./harness-improvement.mjs';
import{nativePracticePorts,configuredMethodPractice}from'./harness-practice.mjs';
import{createUserMessage}from'@deepseek-ai/dsh-llm';
export const name='minecraft-self-improvement';export const inject=['agents','goals','tools','skills','workingDirectory','llm'];
export function apply(ctx,options){
 const c=JSON.parse(readFileSync(options.configFile,'utf8'));if(c.expectedPid!==process.pid)return;
 if(typeof c.sessionId!=='string'||typeof c.reportFile!=='string')throw Error('An exact owned Agent and metadata report are required');
 try{const previous=JSON.parse(readFileSync(c.reportFile,'utf8'));
  if(previous.pid===process.pid&&previous.sessionId===c.sessionId&&['notice-intent','installed'].includes(previous.state))return;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const hash=v=>createHash('sha256').update(v).digest('hex');let stopped=false,busy=false,done=false,drain=null,disposers=[];
 const deadline=Date.now()+600000,record=v=>writeFileSync(c.reportFile,JSON.stringify({at:new Date().toISOString(),pid:process.pid,sessionId:c.sessionId,...v,contentRecorded:false},null,2),{mode:0o600});
 const restore=agent=>{if(!drain)return false;const g=ctx.goals.get(agent);
  if(g?.id!==drain.id||g.revision!==drain.revision||g.phase!=='active'||g.activation!=='disarmed'||hash(g.objective)!==drain.objectiveHash)return false;
  ctx.goals.resume(agent,{id:g.id,revision:g.revision});drain=null;return true;};
 const tick=async()=>{
  if(busy||done||stopped)return;busy=true;
  const agent=ctx.agents.get(c.sessionId);if(!agent){busy=false;return;}
  try{
   if(c.drain===true&&!drain){const g=ctx.goals.get(agent);
    if(g?.id===c.goalId&&g.phase==='active'&&g.activation==='armed'){
     drain={id:g.id,revision:g.revision,objectiveHash:hash(g.objective)};ctx.goals.disarm(agent);
     record({state:'draining-agent-only',currentWorkCancelled:false,bodyRestarted:false});
    }
   }
   if(Date.now()>deadline){const rearmed=restore(agent);record({state:'deferred',reason:'native-agent-idle-window-not-reached',rearmed,currentWorkCancelled:false});done=true;return;}
   if(agent.status!=='idle')return;
   await agent.runMaintenance(async signal=>{
    const prefix=c.toolPrefix??'mc',script=agent.ctx.tools.get(prefix+'_script',agent),memory=agent.ctx.tools.get(prefix+'_memory',agent);
    if(!script)throw Error('This Agent has no shared script contract');
    const nativeSkill=await import('@deepseek-ai/dsh-tool-skill');
    const fork=agent.ctx.plugin(nativeSkill);await fork.await();disposers.push(()=>fork.dispose());
    let practice;
    if(c.harness2?.enabled===true){
     const ports=nativePracticePorts(agent,prefix);await ports.refresh(signal);
     const tool=await configuredMethodPractice({ctx:agent.ctx,config:c,dataDir:c.dataDir,sessionId:c.sessionId,metrics:c.metricsFile?{report:v=>appendFileSync(c.metricsFile,JSON.stringify({at:new Date().toISOString(),...v})+'\n')}:undefined,
      ...ports,onMonitor:()=>{},onDispose:off=>disposers.push(off)});
     const off=agent.ctx.tools.register(tool);if(typeof off==='function')disposers.push(off);practice=tool.name;
    }
    const reflection={snapshot:()=>{if(!c.reflectionFile)return{};const r=JSON.parse(readFileSync(c.reflectionFile,'utf8'));
     return Date.now()-r.lastAt<15000?{lastReason:'evidence-reflection-selected'}:{};}};
    const off=installImprovementContext(agent.ctx,{tools:[script,...(memory?[memory]:[])],reflection,practice});if(off)disposers.push(off);
    if(!agent.ctx.tools.get('skill',agent))throw Error('Native skill loader remains hidden');
    // Explicit maintainer feedback, queued once without waking a new model loop.
    // Original receipts are never edited or converted into completed outcomes.
    let recovery='';
    if(c.recoveredQueue){
     const r=c.recoveredQueue;if(hash(readFileSync(r.evidenceFile))!==r.sha256)throw Error('Queue reconstruction evidence changed');
     recovery=`已核实旧排队任务 ${r.executionId} 在 ${r.cancelledAt} 的自保抢占中随队列撤销。独立原始终态当时漏报，原 accepted 和证据仍保留；不要再等它的新完成事件，也不要重播旧任务。核对当前真实队列后继续原目标。`;
    }
    const notice='[维护者转达主人要求与能力接入] 主人要求你学会自己修正、优化和积累能力，而不只依赖预制反射。现已接上原生技能目录、共享脚本库、游戏记忆'+(practice?'及有界隔离练习':'')+'。先按需读取 minecraft-self-improvement 技能；当真实任务暴露方法缺口时，自行写或修订有界脚本，验证、试用、复盘，按证据选择采用并保存经验。反射继续保命，没有证据不宣称学会，不必把每件简单事都写脚本。'+recovery;
    record({state:'notice-intent',bodyHash:hash(notice),currentWorkCancelled:false,bodyRestarted:false});
    agent.inject(createUserMessage({content:[{type:'text',text:notice}],source:{kind:'mc-maintenance-relay',form:'notice',summary:'主人要求自我改进；能力入口与已核验队列证据'}}));
    const rearmed=restore(agent);record({state:'installed',skillLoaderVisible:true,scriptTool:script.name,memoryTool:memory?.name??null,practiceTool:practice??null,
     sameAgent:true,rearmed,bodyRestarted:false,modelRestarted:false,forcedGameActions:0,modelCallsAtInstall:0,currentWorkCancelled:false,noticeQueuedWithoutWake:true});done=true;
   });
  }catch(error){if(/already has active work/.test(error.message??''))return;
   for(const dispose of disposers.reverse())await dispose();disposers=[];
   const rearmed=restore(agent);record({state:'failed',errorType:error.constructor.name,error:String(error.message).slice(0,180),rearmed,bodyRestarted:false});done=true;
  }finally{busy=false;}
 };
 ctx.effect(()=>{const timer=setInterval(()=>void tick(),1000);void tick();return async()=>{stopped=true;clearInterval(timer);const agent=ctx.agents.get(c.sessionId);if(agent)restore(agent);for(const dispose of disposers.reverse())await dispose();};},'native Agent learning migration');
}
