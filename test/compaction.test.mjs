import test from 'node:test';import assert from 'node:assert/strict';
import {minecraftCheckpointInput,minecraftCompactionBackend} from '../src/harness-compaction.mjs';
test('domain checkpoint guidance appends to the full immutable prefix without truncating messages or tools',()=>{
 const messages=Object.freeze([{role:'system',content:[{type:'text',text:'owner rules'}]},{role:'tool',callId:'original',content:[{type:'text',text:'accepted, outcome unknown'}]}].map(Object.freeze));
 const tools=Object.freeze([{name:'original'}]);const input=Object.freeze({messages,tools});
 const next=minecraftCheckpointInput(input);
 assert.equal(next.messages.length,3);assert.equal(next.messages[0],messages[0]);assert.equal(next.messages[1],messages[1]);assert.equal(next.tools,tools);
 assert.match(next.messages[2].content[0].text,/accepted\/queued/);assert.match(next.messages[2].content[0].text,/continuous goal/);
 assert.match(next.messages[2].content[0].text,/unverified/);assert.equal(messages.length,2);
});
test('only the public summarize hook changes; native budget, cancellation, errors and result remain authoritative',async()=>{
 let seen;const result={summary:[{type:'text',text:'confirmed game checkpoint'}],maxTokens:6000,llmStreamCall:true};
 class Native {config={maxTokens:6000};async summarize(...args){seen=args;return result;}}
 const backend=new(minecraftCompactionBackend(Native))(),agent={id:'original'},signal=new AbortController().signal;
 assert.equal(await backend.summarize({messages:[]},agent,signal),result);
 assert.equal(seen[1],agent);assert.equal(seen[2],signal);assert.equal(backend.config.maxTokens,6000);
 const failure=Object.assign(new Error('native incomplete checkpoint'),{code:'MAX_TOKENS'});
 class Failing extends Native {async summarize(){throw failure;}}
 await assert.rejects(new(minecraftCompactionBackend(Failing))().summarize({messages:[]},agent,signal),x=>x===failure);
});
