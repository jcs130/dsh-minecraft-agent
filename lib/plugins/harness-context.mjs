/** The core owns fact updates; this adapter owns native DSH admission/history. */
export class AppendOnlyFactsContext {
  constructor({core,facts,retire}) {
    this.stream=new core.FactUpdateStream();this.facts=facts;this.retire=retire;
    this.migrated=false;this.fault=null;this.pending=new Map();
    this.stats={snapshots:0,patches:0,originalBytes:0,sentBytes:0,sizeSamples:0,unmatchedSizeSamples:0,resets:0,retiredAtMigration:0};
  }
  preview() {
    // Match the existing JSON model boundary, including absent optional fields.
    const facts=JSON.parse(JSON.stringify(this.facts()));
    const frame=this.stream.preview(facts),text=JSON.stringify(frame);
    this.pending.set(text,Buffer.byteLength(JSON.stringify(facts)));
    while(this.pending.size>8)this.pending.delete(this.pending.keys().next().value);
    return text;
  }
  async prepare(payload) {
    if(this.fault)throw this.fault;
    if(this.migrated)return;
    const count=await this.retire(payload);
    this.stats.retiredAtMigration+=count;this.migrated=true;
  }
  install(agentCtx) {
    agentCtx.systemPrompt.context({name:'minecraft:fact-updates',order:9990,text:()=>this.preview(),interpolate:false});
    agentCtx.on('session/event',(_session,event)=>{
      if(event.type==='compaction/end'){
        if(!event.data?.error){this.stream.reset();this.pending.clear();this.stats.resets++;}
        return;
      }
      if(event.type!=='user/message')return;
      const message=event.data.message??event.data,source=message.source;
      if(source?.kind!=='runtime-context'||source.form!=='snapshot')return;
      for(const section of source.sections??[])if(section.name==='minecraft:fact-updates'){
        try{
          const frame=JSON.parse(section.text);this.stream.commit(frame);
          this.stats[frame.kind==='snapshot'?'snapshots':'patches']++;
          this.stats.sentBytes+=Buffer.byteLength(section.text);
          const full=this.pending.get(section.text);
          if(full!==undefined){this.stats.originalBytes+=full;this.stats.sizeSamples++;}
          else this.stats.unmatchedSizeSamples++;
          this.pending.clear();
        }catch{this.fault=Error('Minecraft fact-update admission failed; refusing to infer from an inconsistent baseline');}
      }
    });
    agentCtx.on('agent/request',async(_payload,next)=>{if(this.fault)throw this.fault;return next();});
  }
  snapshot(){return{mode:'append-only-fact-updates',...this.stats,fault:this.fault?.message??null,
    note:'UTF-8 presentation bytes, not token counts or a gameplay success metric'};}
}

/** Keep only actual model-visible read ends/errors through native compaction.
 * The core owns recovery semantics; this adapter only observes and presents. */
export function installTextReadRecovery(agentCtx,{book,run,sessionId}={}) {
  if(!book)return;
  const calls=new Map();
  const offEvents=agentCtx.on('session/event',(session,event)=>{
    if(session.id!==sessionId)return;
    const current=run();if(!current)return;
    if(event.type==='tool/call'){
      calls.set(event.data.callId??event.data.id,event.data.name);
      while(calls.size>128)calls.delete(calls.keys().next().value);return;
    }
    if(event.type!=='tool/result')return;
    const message=event.data.message,id=message?.toolCallId,name=calls.get(id);if(!name)return;calls.delete(id);
    let projected;
    for(const block of message.content??[])if(block.type==='text'){
      try{const v=JSON.parse(block.text);if(v&&typeof v==='object'){projected=v;break;}}catch{}
    }
    book.observe({run:current,requestId:id,name,result:{isError:message.isError===true,structuredContent:projected??{}}});
  });
  const offContext=agentCtx.systemPrompt.context({name:'minecraft:text-read-recovery',order:9995,interpolate:false,required:true,
    text:()=>{const value=book.context(run());return value?JSON.stringify(value):'';}});
  return()=>{offContext?.();offEvents?.();};
}
