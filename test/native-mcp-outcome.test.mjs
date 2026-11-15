import test from'node:test';import assert from'node:assert/strict';
import{minecraftMcpFailed,installNativeMcpOutcome}from'../src/native-mcp-outcome.mjs';
function fixture(options={}){let handler,disposed=false;const off=installNativeMcpOutcome({on(name,fn){assert.equal(name,'tools/post-execute');handler=fn;return()=>{disposed=true;};}},options);return{run:(value,next={kind:'accept'},name='mc_cast',agent={id:'a'})=>handler({name,agent},{isError:false,value,content:[{type:'text',text:'Original receipt.'}]},async()=>next),off,disposed:()=>disposed};}
test('MCP failure becomes a Native block while retaining its factual receipt',async()=>{
 const f=fixture();for(const value of[{isError:true},{structuredContent:{failed:true}},{failed:true}]){const r=await f.run(value);assert.equal(r.kind,'block');assert.equal(r.feedback[1].text,'Original receipt.');assert.match(r.feedback[0].text,/unknown outcomes/);}
 f.off();assert.equal(f.disposed(),true);
});

test('concluding game failures keep the native success envelope and explicit failure feedback',async()=>{
 const f=fixture(),value={isError:true,structuredContent:{failed:true,control:{endTurnRequested:true}}};
 const result=await f.run(value);assert.equal(result.kind,'accept');
 assert.match(result.content[0].text,/action FAILED/);assert.equal(result.content[1].text,'Original receipt.');
 assert.equal(Object.hasOwn(result,'value'),false);assert.equal(value.isError,true);
});
test('missing, false and unknown outcomes do not become fabricated failures',async()=>{
 const f=fixture();for(const value of[null,{}, {isError:false},{structuredContent:{failed:false,execution:{phase:'unknown'}}}]){assert.equal(minecraftMcpFailed(value),false);assert.deepEqual(await f.run(value),{kind:'accept'});}
});
test('scopes to the selected Minecraft tools and preserves downstream policy decisions',async()=>{
 const f=fixture({agentId:'a',names:['mymc_cast']});
 assert.deepEqual(await f.run({isError:true},{kind:'accept'},'other_tool'),{kind:'accept'});
 assert.deepEqual(await f.run({isError:true},{kind:'accept'},'mymc_cast',{id:'b'}),{kind:'accept'});
 const blocked={kind:'block',feedback:[{type:'text',text:'Permission denied.'}]};assert.equal(await f.run({isError:true},blocked,'mymc_cast'),blocked);
 const r=await f.run({isError:true},{kind:'accept',value:{failed:false}},'mymc_cast');assert.equal(r.kind,'accept');
});
test('keeps newly observed contexts on a failed call in their original order',async()=>{
 let handler;installNativeMcpOutcome({on(_name,fn){handler=fn;return()=>{};}});
 const first={id:'first'},second={id:'second'};
 const result=await handler({name:'mc_cast'},{isError:false,value:{isError:true},content:[],additionalContexts:[first]},async()=>({kind:'accept',additionalContexts:[second]}));
 assert.deepEqual(result.additionalContexts,[first,second]);
});
