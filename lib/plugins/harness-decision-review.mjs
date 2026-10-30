import {createHash} from 'node:crypto';
/** Host-only metadata binding. The core owns evidence, the host owns goals and requests. */
export function installDecisionReview(ctx,{book,sessionId,run,goal,execution,repair,onRepair=()=>{},onStatus=()=>{}}){
 let current=null;const served=new Set();
 const read=()=>{const g=goal(),r=run();return g&&r?book.context(r,g.id):null;};
 const off=ctx.on('session/event',(session,event)=>{
  if(session.id!==sessionId)return;const d=event.data??{};
  if(event.type==='turn/start'){current={turn:d.turn,autonomous:false,explicitOwner:false,goalId:null,hadToolCall:false,toolsAvailable:null,response:null};return;}
  if(!current)return;
  if(event.type==='user/message'){
   const source=(d.message??d).source;
   if(source?.kind==='goal'){current.autonomous=!current.explicitOwner;current.goalId=source.goalId;}
   else if(source?.kind==='user'||source?.kind==='mc-harness'&&source.summary?.startsWith('Operator request')){current.autonomous=false;current.explicitOwner=true;}
  }
  if(event.type==='request/header'){const tools=d.header?.tools;current.toolsAvailable=Array.isArray(tools)?tools.length:null;}
  if(event.type==='assistant/message'){
   const message=d.message??d,text=Array.isArray(message.content)?message.content.filter(c=>c.type==='text'&&typeof c.text==='string').map(c=>c.text).join('\n'):'';
   current.response={hash:createHash('sha256').update(text).digest('hex'),chars:text.length};
  }
  if(event.type==='tool/call')current.hadToolCall=true;
  if(event.type==='turn/end'){
   const g=goal(),r=run(),frame=execution();
   if(r&&g)book.recordRound({run:r,goalId:g.id,turn:current.turn,at:event.time,completed:d.reason==='completed'||d.reason?.kind==='completed',autonomous:current.autonomous&&current.goalId===g.id,
    goalActive:g.phase==='active',hadToolCall:current.hadToolCall,toolsAvailable:current.toolsAvailable,response:current.response,execution:frame});
   current=null;onStatus(read());
  }
 });
 const offStop=ctx.on('agent/turn-stopping',payload=>{
  if(!repair||payload.agent?.id!==sessionId||payload.signal?.aborted||!current?.autonomous||current.explicitOwner||current.hadToolCall||!current.response)return;
  const g=goal(),r=run(),review=r&&g?book.context(r,g.id):null,e=execution(),now=Date.now();
  const repairKey=review?JSON.stringify([review.run,review.goalId,review.generation,review.executionRevision]):null;
  if(g?.phase!=='active'||g.activation!=='armed'||current.goalId!==g.id||review?.reviewNeeded!==true||served.has(repairKey)
    ||!e||e.protocol!=='agent-mc-execution-state/v1'||e.scope!=='runtime-receipts'||e.run!==review.run||e.generation!==review.generation||e.revision!==review.executionRevision
    ||!Number.isFinite(e.observedAt)||now-e.observedAt>15000||e.observedAt>now+5000)return;
  // Public native stop validation. One bounded correction per proven episode;
  // no independent worker, forced game action, hidden retry or model routing owner.
  served.add(repairKey);while(served.size>16)served.delete(served.values().next().value);
  repair({agent:payload.agent,review,turn:payload.turn});onRepair({key:review.key,turn:payload.turn,at:now});
 });
 const offContext=ctx.systemPrompt.context({name:'minecraft:decision-review',order:9998,interpolate:false,required:true,text:()=>{const value=read();return value?JSON.stringify(value):'';}});
 return {context:read,priority:()=>{const value=read();return value?.reviewNeeded?value:null;},dispose:()=>{off?.();offStop?.();offContext?.();}};
}
export function decisionReviewNotice(review){return '自主回合行动核验：刚才的文字回复没有提交工具调用，不能当作执行结果。原目标仍在进行，以下是当前运行的真实空转证据。请核对原回执后直接通过可用工具执行你选择的下一步；如果确实只能等待或受阻，用工具记录或核实真实原因、截止时间和唤醒条件。不要只再确认收到、口头承诺执行或宣称完成；不要重投结果未知的旧操作。这是同一目标内一次有界纠偏，不是新用户任务。\n'+JSON.stringify(review);}
