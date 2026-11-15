/** Host scheduling only; correlation and native failure projection belong to the shared core. */
export function installPlanReview(ctx,{book,run,sessionId}) {
 const off=ctx.on('tools/post-execute',(exec,result,next)=>{
  if(exec.agent?.id===sessionId){
   book.recordCall({run:run(),name:exec.name,args:exec.arguments,result:result.value});
   if(exec.name.endsWith('_events')){const s=result.value?.structuredContent;let v=s?.data;
    if(!v&&typeof s?.text==='string')try{v=JSON.parse(s.text);}catch{}
    if(Array.isArray(v?.events))book.recordEvents(v.events);
   }
  }
  return next();
 });
 const prompt=ctx.systemPrompt.context({name:'minecraft:plan-review',order:9996,interpolate:false,text:()=>JSON.stringify(book.context(run()))});
 return()=>{off?.();prompt?.();};
}
export function planReviewEvidence(retryEvidence,book,run,decisionReview) {
 return{snapshot:()=>({...retryEvidence?.snapshot()??{evidence:[]},planReview:{priority:book?.priority(run())??null},
  decisionReview:{priority:decisionReview?.priority()??null}})};
}
