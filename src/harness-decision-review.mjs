import {createHash} from 'node:crypto';
/** Host-only metadata binding. The core owns evidence, the host owns goals and requests. */
export function installDecisionReview(ctx,{book,sessionId,run,goal,execution,onStatus=()=>{}}){
 let current=null;
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
 const offContext=ctx.systemPrompt.context({name:'minecraft:decision-review',order:9998,interpolate:false,required:true,text:()=>{const value=read();return value?JSON.stringify(value):'';}});
 return {context:read,priority:()=>{const value=read();return value?.reviewNeeded?value:null;},dispose:()=>{off?.();offContext?.();}};
}
