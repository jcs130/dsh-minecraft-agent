/** Opt-in host request routing. No extra generation, action or skill adoption. */
export class EvidenceReflection {
  constructor(config={}, {now=Date.now,read=()=>null,write=()=>{}}={}) {
    this.enabled=config.enabled===true;this.effort=config.effort??'low';this.now=now;this.write=write;
    this.minIntervalMs=config.minIntervalMs??180000;this.minRequests=config.minRequests??24;this.attempts=config.attempts??3;
    if(typeof this.effort!=='string'||!this.effort.trim()||['off','none'].includes(this.effort))throw Error('Reflection requires an explicit thinking effort');
    for(const [k,min]of [['minIntervalMs',1000],['minRequests',1],['attempts',2]])if(!Number.isSafeInteger(this[k])||this[k]<min)throw Error('Invalid reflection bound: '+k);
    const saved=read();this.state={schema:'dsh-mc-reflection/v1',requests:0,selections:0,lastAt:null,lastRequest:0,lastEvidence:null,readbacksSeen:[],observationsSeen:[],eventWaitsSeen:[],readsSeen:[]};
    if(saved?.schema===this.state.schema&&Number.isSafeInteger(saved.requests)&&saved.requests>=0&&Number.isSafeInteger(saved.selections)&&saved.selections>=0
      &&Number.isSafeInteger(saved.lastRequest)&&saved.lastRequest>=0&&(saved.lastAt===null||Number.isFinite(saved.lastAt))
      &&(saved.lastEvidence===null||typeof saved.lastEvidence==='string'))
      this.state=Object.fromEntries(Object.keys(this.state).map(key=>[key,saved[key]??this.state[key]]));
    this.state.readbacksSeen=Array.isArray(saved?.readbacksSeen)?saved.readbacksSeen.filter(x=>typeof x==='string'
      &&/^[A-Za-z0-9._:-]{1,160}:readback:[a-f0-9]{64}:[a-f0-9]{64}$/.test(x)).slice(-8):[];
    this.state.observationsSeen=Array.isArray(saved?.observationsSeen)?saved.observationsSeen.filter(x=>typeof x==='string'
      &&/^[A-Za-z0-9._:-]{1,160}:observation:[a-f0-9]{64}:[a-f0-9]{64}$/.test(x)).slice(-8):[];
    this.state.eventWaitsSeen=Array.isArray(saved?.eventWaitsSeen)?saved.eventWaitsSeen.filter(x=>typeof x==='string'
      &&/^[A-Za-z0-9._:-]{1,160}:event-wait:[a-f0-9]{64}$/.test(x)).slice(-8):[];
    this.state.readsSeen=Array.isArray(saved?.readsSeen)?saved.readsSeen.filter(x=>typeof x==='string'
      &&/^[A-Za-z0-9._:-]{1,160}:read-only:[a-f0-9]{64}:[a-f0-9]{64}$/.test(x)).slice(-8):[];
    const lease=saved?.lease;
    this.lease=lease&&typeof lease.sessionId==='string'&&Number.isSafeInteger(lease.selectionSeq)
      &&typeof lease.provider==='string'&&typeof lease.model==='string'
      &&['off','none'].includes(lease.originalEffort)&&typeof lease.temporaryEffort==='string'?lease:null;
    this.lastStep=null;this.lastChoice=null;
  }
  get needsIntent(){return this.enabled||this.lease!==null;}
  save(){this.write({...this.state,lease:this.lease});}
  select(base, snapshot, {turn,step,signal,intent}={}) {
    if(signal?.aborted)return base;
    // Request headers are durable: a programmatic Agent may inherit our low
    // effort on the next step. Restore only the override we own, and only if
    // no explicit model/selection event has superseded it (including reloads).
    const owned=this.lease&&intent?.sessionId===this.lease.sessionId
      &&intent.selectionSeq===this.lease.selectionSeq&&base.provider===this.lease.provider
      &&base.model===this.lease.model;
    if(this.lease&&!owned){this.lease=null;this.save();}
    let resolved=base;
    if(owned&&base.reasoningEffort===this.lease.temporaryEffort)
      resolved={...base,reasoningEffort:this.lease.originalEffort};
    else if(owned&&!['off','none'].includes(base.reasoningEffort)){
      this.lease=null;this.save(); // Another request-routing owner chose an explicit level.
    }
    if(!this.enabled)return resolved;
    const id=turn+':'+step;
    const sameIntent=this.lastChoice?.intent===JSON.stringify(intent??null);
    if(this.lastStep===id)return sameIntent&&this.lastChoice?.selected&&['off','none'].includes(resolved.reasoningEffort)
      ?{...resolved,reasoningEffort:this.effort}:resolved;
    this.lastStep=id;this.lastChoice={selected:false};this.state.requests++;
    // A human-selected thinking level must never be reduced or replaced.
    if(!['off','none'].includes(resolved.reasoningEffort))return resolved;
    const evidence=snapshot?.evidence??[];
    const task=[...evidence].reverse().find(x=>x.kind==='task'&&x.observation==='unchanged'&&x.attempts>=this.attempts);
    const method=[...evidence].reverse().find(x=>x.kind==='method'&&new Set(evidence.filter(y=>y.kind==='method'&&y.sourceHash===x.sourceHash).map(y=>y.methodId)).size>=2);
    const admission=[...evidence].reverse().find(x=>x.kind==='admission'&&x.dispatched===false
      &&x.rejectionKind==='repeat'&&x.attempts>=this.attempts);
    const signatureOf=item=>item.run+':'+(item.kind==='readback'?'readback:'+item.resourceHash+':'+item.revision
      :item.kind==='observation'?'observation:'+item.selection+':'+item.revision:item.kind==='eventWait'?'event-wait:'+item.revision
      :item.kind==='readOnly'?'read-only:'+item.selectorHash+':'+item.revision:item.taskId??item.sourceHash??item.requestId);
    const readback=[...evidence].reverse().find(x=>x.kind==='readback'&&x.historical===true&&x.attempts>=this.attempts
      &&!this.state.readbacksSeen.includes(signatureOf(x)));
    const observation=[...evidence].reverse().find(x=>x.kind==='observation'&&x.historical===false&&x.attempts>=this.attempts
      &&!this.state.observationsSeen.includes(signatureOf(x)));
    const eventWait=[...evidence].reverse().find(x=>x.kind==='eventWait'&&x.historical===false&&x.attempts>=this.attempts
      &&!this.state.eventWaitsSeen.includes(signatureOf(x)));
    const readOnly=[...evidence].reverse().find(x=>x.kind==='readOnly'&&x.knownIdle===true&&x.attempts>=this.attempts
      &&!this.state.readsSeen.includes(signatureOf(x)));
    const primary=task??method??admission;
    // Already-served action evidence cannot hide a new repeated historical
    // query; serving that query must not reactivate the old action evidence.
    const item=primary&&signatureOf(primary)!==this.state.lastEvidence?primary:readback??observation??eventWait??readOnly;if(!item)return resolved;
    const signature=signatureOf(item);
    const now=this.now();
    if(this.state.selections>0&&(now-this.state.lastAt<this.minIntervalMs||this.state.requests-this.state.lastRequest<this.minRequests))return resolved;
    const next={...this.state,selections:this.state.selections+1,lastAt:now,lastRequest:this.state.requests,
      lastEvidence:['readback','observation','eventWait','readOnly'].includes(item.kind)?this.state.lastEvidence:signature,
      readbacksSeen:item.kind==='readback'?[...this.state.readbacksSeen,signature].slice(-8):this.state.readbacksSeen,
      observationsSeen:item.kind==='observation'?[...this.state.observationsSeen,signature].slice(-8):this.state.observationsSeen,
      eventWaitsSeen:item.kind==='eventWait'?[...this.state.eventWaitsSeen,signature].slice(-8):this.state.eventWaitsSeen,
      readsSeen:item.kind==='readOnly'?[...this.state.readsSeen,signature].slice(-8):this.state.readsSeen};
    this.lease=intent?{...intent,provider:resolved.provider,model:resolved.model,
      originalEffort:resolved.reasoningEffort,temporaryEffort:this.effort}:null;
    this.write({...next,lease:this.lease});this.state=next;
    this.lastChoice={selected:true,intent:JSON.stringify(intent??null),reason:item.kind==='readOnly'?'repeated-unchanged-read-only-result':item.kind==='eventWait'?'repeated-events-without-current-execution':item.kind==='observation'?'repeated-unchanged-current-observation':item.kind==='readback'?'repeated-unchanged-historical-readback':item.kind==='admission'?'repeated-core-admission-rejection':item.kind==='method'?'repeated-method-error':item.phase==='completed'?'repeated-completed-without-observed-change':'repeated-blocked-without-observed-change'};
    return{...resolved,reasoningEffort:this.effort};
  }
  snapshot(){return{enabled:this.enabled,effort:this.effort,requestSelections:this.state.selections,requestsConsidered:this.state.requests,
    lastAt:this.state.lastAt,lastReason:this.lastChoice?.reason??null,minIntervalMs:this.minIntervalMs,minRequests:this.minRequests,
    note:'selection metadata; dispatched inference and usage are measured by the model client'};}
}

/** Public DSH hooks only. The initial exact observation recovers explicit
 * selection intent; subsequent event metadata keeps it current without
 * scanning history on every request or reading any message content. */
export function installEvidenceReflection(agentCtx,{reflection,retryEvidence,sessionQuery}) {
  let sessionId,selectionSeq=-1,hydrated=false;
  agentCtx.on('session/event',(session,event)=>{
    if(event.type==='model/selection'&&(sessionId===undefined||session.id===sessionId))
      selectionSeq=Math.max(selectionSeq,event.seq);
  });
  agentCtx.on('agent/request',async(payload,next)=>{
    const base=await next();
    if(!reflection.needsIntent||payload.signal?.aborted)return base;
    const session=payload.agent.session;
    if(!hydrated){
      sessionId=session.id;
      const observation=await sessionQuery.observeSession(session.id,{signal:payload.signal,projectionMode:'none'});
      try{
        if(observation.source!=='live'||observation.header.id!==session.id)throw Error('Reflection requires its exact live DSH session');
        const events=observation.events;
        for(let i=events.length-1;i>=0;i--)if(events[i].type==='model/selection'){
          selectionSeq=Math.max(selectionSeq,events[i].seq);break;
        }
        hydrated=true;
      }finally{observation[Symbol.dispose]();}
    }
    return reflection.select(base,retryEvidence.snapshot(),{...payload,intent:{sessionId:session.id,selectionSeq}});
  });
}
