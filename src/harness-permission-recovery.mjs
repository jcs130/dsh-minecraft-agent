const CODES=new Set(['GOAL_TOOL_AUTHORITY_REQUIRED','GOAL_TOOL_AGENT_REQUIRED','GOAL_TOOL_DRIVER_REQUIRED','GOAL_TOOL_RESUME_PAUSED','PERMISSION_DENIED','TOOL_PERMISSION_DENIED','EACCES','EPERM','TOOL_NOT_FOUND']);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9:._-]{1,180}$/.test(value);
/** Permission evidence only: never grants access, retries tools or starts a model. */
export class PermissionRecovery {
  constructor({threshold=3,read=()=>null,write=()=>{}}={}){
    if(!Number.isSafeInteger(threshold)||threshold<2)throw Error('Invalid permission recovery threshold');
    this.threshold=threshold;this.write=write;this.episodes=[];this.seen=new Set();this.persistenceErrors=0;this.injectionErrors=0;
    const saved=read();if(saved?.schema==='dsh-permission-recovery/v1')this.episodes=(Array.isArray(saved.episodes)?saved.episodes:[]).filter(x=>id(x.sessionId)&&id(x.subject)&&id(x.run)&&id(x.tool)&&id(x.operation)&&CODES.has(x.code)&&Number.isSafeInteger(x.count)&&x.count>0&&typeof x.queued==='boolean').slice(-16).map(x=>({sessionId:x.sessionId,subject:x.subject,run:x.run,tool:x.tool,operation:x.operation,code:x.code,count:x.count,attempted:x.attempted===true||x.queued,queued:x.queued}));
  }
  save(){try{this.write({schema:'dsh-permission-recovery/v1',episodes:this.episodes});}catch{this.persistenceErrors++;}}
  record({sessionId,subject,run,tool,operation='call',code,callId}){
    if(![sessionId,subject,run,tool,operation,callId].every(id)||!CODES.has(code))return;
    if(this.seen.has(callId))return;this.seen.add(callId);while(this.seen.size>128)this.seen.delete(this.seen.values().next().value);
    let e=this.episodes.find(x=>x.sessionId===sessionId&&x.subject===subject&&x.run===run&&x.tool===tool&&x.operation===operation&&x.code===code);
    if(!e){e={sessionId,subject,run,tool,operation,code,count:0,attempted:false,queued:false};this.episodes.push(e);this.episodes=this.episodes.slice(-16);}
    e.count=Math.min(Number.MAX_SAFE_INTEGER,e.count+1);this.save();
  }
  pending(sessionId,subject,run){return this.episodes.find(x=>x.sessionId===sessionId&&x.subject===subject&&x.run===run&&!x.attempted&&x.count>=this.threshold)??null;}
  claim(e){if(!this.episodes.includes(e)||e.attempted)return false;e.attempted=true;this.save();return true;}
  queued(e){if(!this.episodes.includes(e)||e.queued)return false;e.attempted=true;e.queued=true;this.save();return true;}
  snapshot(){return{schema:'dsh-permission-recovery/v1',threshold:this.threshold,persistenceErrors:this.persistenceErrors,injectionErrors:this.injectionErrors,episodes:this.episodes.map(x=>({...x})),note:'queued notices are not permission grants, tool retries, dispatched inference or gameplay recovery'};}
}

/** Observe final native errors; queue at most one notice per proven episode at
 * an existing pre-step. No timer, followup, steering, goal mutation or wakeup. */
export function installPermissionRecovery(ctx,{book,sessionId,goal,run,createMessage,continuous=()=>false}){
  const offResult=ctx.on('tools/result',(exec,result)=>{
    if(exec.agent?.id!==sessionId||result.isError!==true)return;
    let code=result.error?.info?.code??result.error?.code;
    if(code==='TOOL_NOT_FOUND'||result.error?.info?.name==='ToolNotFoundError'){
      if(!continuous()||!['create_goal','update_goal'].includes(exec.name))return;
      code='TOOL_NOT_FOUND';
    }
    const g=goal(),r=run();if(!g||!r)return;
    const action=exec.arguments?.action;
    book.record({sessionId,subject:g.id,run:r,tool:exec.name,operation:id(action)?action:'call',code,callId:exec.callId??exec.id});
  });
  const offStep=ctx.on('agent/pre-step',async(payload,next)=>{
    const g=goal(),r=run();if(payload.agent?.id!==sessionId||payload.signal?.aborted||g?.phase!=='active'||g.activation!=='armed'||!r)return next();
    const e=book.pending(sessionId,g.id,r);if(e&&book.claim(e)){try{
      const message=createMessage({content:[{type:'text',text:'权限与能力拒绝恢复：以下是同一目标内重复的原生拒绝，TOOL_NOT_FOUND 表示当前没有这项工具能力，不表示已获权限。原始失败仍然有效；不要原样重试、改参数绕过或创建替代目标。宿主持续目标由主人控制。请从当前声明的合法工具中选择只读核对、游戏阶段操作或有界事件等待；确需主人权限时通过已有沟通能力说明条件，不把本通知当授权或成功。证据：'+JSON.stringify(e)}],source:{kind:'mc-permission-recovery',form:'notice',summary:'One bounded notice for repeated native permission rejection'}});
      payload.agent.inject(message);book.queued(e);
    }catch{book.injectionErrors++;}}
    return next();
  });
  return()=>{offStep?.();offResult?.();};
}
