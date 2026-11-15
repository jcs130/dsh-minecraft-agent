import{test}from'node:test';import assert from'node:assert/strict';
import{installTextReadRecovery}from'../src/harness-context.mjs';

test('native text recovery consumes the rendered model receipt and exact session, without calling tools',()=>{
 const handlers=new Map(),observed=[];let section,context=null,disposed=0;
 const ctx={on:(name,fn)=>{handlers.set(name,fn);return()=>disposed++;},systemPrompt:{context:s=>{section=s;return()=>disposed++;}}};
 const book={observe:v=>observed.push(v),context:run=>run==='original-run'?context:null};
 const off=installTextReadRecovery(ctx,{book,sessionId:'owner',run:()=> 'original-run'}),emit=handlers.get('session/event');
 assert.equal(section.required,true);assert.equal(section.text(),'');
 emit({id:'other'},{type:'tool/call',data:{callId:'foreign',name:'mc_read_text'}});
 emit({id:'other'},{type:'tool/result',data:{message:{toolCallId:'foreign',content:[]}}});assert.equal(observed.length,0);
 emit({id:'owner'},{type:'tool/call',data:{callId:'original',name:'mc_read_text'}});
 const projected={failed:false,text:'final visible part',meta:{textPage:{hasMore:false,nextOffset:null,totalChars:100}}};
 emit({id:'owner'},{type:'tool/result',data:{message:{toolCallId:'original',content:[{type:'text',text:JSON.stringify(projected)}]}}});
 assert.deepEqual(observed,[{run:'original-run',requestId:'original',name:'mc_read_text',result:{isError:false,structuredContent:projected}}]);
 context={protocol:'agent-mc-text-read-recovery/v1',originalCallId:'original'};assert.deepEqual(JSON.parse(section.text()),context);
 emit({id:'owner'},{type:'tool/result',data:{message:{toolCallId:'original',content:[]}}});assert.equal(observed.length,1);
 off();assert.equal(disposed,2);
});

test('a failed typed read is preserved for the core and unsupported old cores remain optional',()=>{
 const handlers=new Map(),observed=[];const ctx={on:(n,f)=>{handlers.set(n,f);},systemPrompt:{context:()=>()=>{}}};
 assert.equal(installTextReadRecovery(ctx,{sessionId:'owner',run:()=> 'r'}),undefined);
 installTextReadRecovery(ctx,{book:{observe:v=>observed.push(v),context:()=>null},sessionId:'owner',run:()=> 'r'});
 const emit=handlers.get('session/event');emit({id:'owner'},{type:'tool/call',data:{callId:'bad-range',name:'mc_read_text'}});
 const projected={failed:true,data:{protocol:'agent-mc-text-read-error/v1',totalChars:12890,requestedOffset:13540}};
 emit({id:'owner'},{type:'tool/result',data:{message:{toolCallId:'bad-range',isError:true,content:[{type:'text',text:JSON.stringify(projected)}]}}});
 assert.equal(observed[0].result.isError,true);assert.deepEqual(observed[0].result.structuredContent,projected);
});
