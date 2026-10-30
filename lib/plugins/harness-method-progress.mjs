/** Host continuity metadata over the core's original method receipts. No actions or adoption. */
import{createHash}from'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex'),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const parse=v=>{if(typeof v!=='string')return v;try{return JSON.parse(v);}catch{return null;}};
const fields=['sourceHash','callId','historySeq','runtimeRun','localId','executionId','methodId','revision','handle','stage','outcome','reviewId','procedureExecutionId'];
const stages=new Set(['inspect-validation','ready-to-save','ready-for-natural-trial','inspect-execution','review-observed-effect','needs-evidence','revise','assessed-not-adopted','selected']);
export class MethodProgress {
 constructor({sessionId,currentRun=()=>null,read=()=>null,write=()=>{}}){
  this.sessionId=sessionId;this.currentRun=currentRun;this.write=write;this.entries=[];this.storageError=null;this.calls=new Map();
  const saved=read();if(saved?.schema==='dsh-mc-method-progress/v1'&&saved.sessionId===sessionId&&Array.isArray(saved.entries))
   this.entries=saved.entries.filter(x=>hash(x.sourceHash)&&stages.has(x.stage)).slice(-8).map(x=>Object.fromEntries(fields.filter(k=>
    typeof x[k]==='string'&&x[k].length<=240||['localId','historySeq'].includes(k)&&Number.isSafeInteger(x[k])&&x[k]>0).map(k=>[k,x[k]])));
 }
 noteCall(callId,seq){if(typeof callId!=='string'||callId.length>240||!Number.isSafeInteger(seq)||seq<1)return;this.calls.set(callId,seq);while(this.calls.size>16)this.calls.delete(this.calls.keys().next().value);}
 commit(){try{this.write({schema:'dsh-mc-method-progress/v1',sessionId:this.sessionId,entries:this.entries});this.storageError=null;}catch{this.storageError='metadata-write-failed';}}
 observe(name,args,result,callId){
  const v=result?.structuredContent??result;if(v?.failed===true||result?.isError===true||v?.isError===true)return;
  if(!name?.endsWith('_script')||!args||typeof args!=='object')return;
  const body=parse(v?.text),x=v?.execution;let entry;
  if(args.validate===true&&typeof args.code==='string'&&args.code.length<=12000&&x?.kind==='method'){
   const sourceHash=sha(args.code);entry=this.entries.find(e=>e.sourceHash===sourceHash&&!e.revision);
   if(!entry){entry={sourceHash,callId,historySeq:this.calls.get(callId),runtimeRun:this.currentRun(),stage:'inspect-validation'};this.entries.push(entry);}
   else if(entry.callId!==callId)Object.assign(entry,{callId,historySeq:this.calls.get(callId),runtimeRun:this.currentRun(),stage:'inspect-validation'});
   if(typeof x.id==='string')entry.executionId=x.id;
   if(Number.isSafeInteger(x.evidence?.localId))entry.localId=x.evidence.localId;
   if(x.terminal===true)entry.stage=['completed','validated'].includes(x.phase)?'ready-to-save':'revise';
  }else if(Number.isSafeInteger(args.runId)){
   entry=[...this.entries].reverse().find(e=>e.localId===args.runId&&e.runtimeRun===this.currentRun());
   if(entry&&body?.id===args.runId&&body.sourceHash===entry.sourceHash){
    if(body.status==='validated')entry.stage='ready-to-save';
    if(['failed','cancelled'].includes(body.status))entry.stage='revise';
    if(body.status==='completed')entry.stage='review-observed-effect';
    if(typeof body.procedure?.executionId==='string')entry.procedureExecutionId=body.procedure.executionId;
   }
  }else if(args.library?.op==='save'&&typeof args.library.code==='string'&&hash(body?.reference?.revision)&&body.sourceHash===sha(args.library.code)){
   entry=[...this.entries].reverse().find(e=>e.sourceHash===sha(args.library.code));
   if(entry)Object.assign(entry,{methodId:args.library.id,revision:body.reference.revision,handle:body.reference.handle,stage:'ready-for-natural-trial'});
  }else if(args.procedure&&hash(args.procedure.revision)&&x?.kind==='method'){
   entry=this.entries.find(e=>e.revision===args.procedure.revision&&e.handle===args.procedure.handle);
   if(entry){entry.executionId=x.id;entry.runtimeRun=this.currentRun();entry.localId=x.evidence?.localId;
    entry.stage=x.terminal===true?'review-observed-effect':'inspect-execution';}
  }else if(['review','adopt'].includes(args.library?.op)){
   const q=args.library;entry=this.entries.find(e=>e.methodId===q.id&&e.revision===q.revision);
   if(entry&&q.op==='review'&&['achieved','not-achieved','unknown'].includes(body?.outcome)&&body.revision===entry.revision){
    entry.outcome=body.outcome;entry.reviewId=body.id;
    entry.stage=body.outcome==='achieved'?'assessed-not-adopted':body.outcome==='unknown'?'needs-evidence':'revise';
   }else if(entry&&q.op==='adopt'&&body?.reference?.revision===entry.revision)entry.stage='selected';
  }
  if(entry){this.entries=this.entries.slice(-8);this.commit();}
 }
 observeEvents(events){let changed=false;for(const e of events??[]){const x=e?.execution;if(x?.kind!=='method'||x.terminal!==true)continue;
  const entry=this.entries.find(r=>r.executionId===x.id&&r.runtimeRun===e.run);if(!entry)continue;
  if(entry.stage==='inspect-validation')entry.stage=['validated','completed'].includes(x.phase)?'ready-to-save':'revise';
  else if(entry.stage==='inspect-execution')entry.stage='review-observed-effect';else continue;changed=true;
 }if(changed)this.commit();}
 snapshot(){return{protocol:'dsh-mc-method-progress/v1',storageError:this.storageError,pending:this.entries.filter(x=>x.stage!=='selected').slice(-3).map(({callId,runtimeRun,...x})=>({...x,
  sameRuntime:!!runtimeRun&&runtimeRun===this.currentRun()})),
  guidance:'Unfinished method references, not success or new goals. Inspect the original result; dsh_history offset:historySeq retrieves the original code if needed. Across runtime changes never use an old localId against a new body; reconcile original receipts. Validation is not a trial. Save/review/adopt remain your explicit choices; return to the original goal.'};}
}
export function installMethodProgress(ctx,progress,script){
 const events=ctx.on('session/event',(session,event)=>{if(session.id===progress.sessionId&&event.type==='tool/call'&&event.data.name===script)progress.noteCall(event.data.id??event.data.callId,event.seq);});
 const off=ctx.on('tools/post-execute',(exec,result,next)=>{if(exec.agent?.id===progress.sessionId&&exec.name===script)progress.observe(exec.name,exec.arguments,result.value,exec.callId);return next();});
 const prompt=ctx.systemPrompt.context({name:'minecraft:method-progress',order:9995,interpolate:false,text:()=>JSON.stringify(progress.snapshot())});
 return()=>{events?.();off?.();prompt?.();};
}
