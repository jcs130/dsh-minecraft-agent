import test from 'node:test';
import assert from 'node:assert/strict';
import {RetryEvidenceContext} from '../src/harness-bridge.mjs';
import {EvidenceReflection} from '../src/harness-reflection.mjs';
const spec={name:'mc_observe',inputSchema:{type:'object',properties:{bounds:{type:'array',items:{type:'integer',minimum:-16,maximum:16}}}}};
const args={bounds:[0,-3,20,40,3,50]},base={provider:'original',model:'original',reasoningEffort:'off',maxTokens:6000};
const failure=()=>({isError:true,structuredContent:{protocol:'agent-mc/v1',failed:true,data:{
  status:'invalid_arguments',reason:'schema_validation',executed:false,tool:spec.name,
  message:'untrusted game prose',minimal_legal_example:{private:'do not retain examples'},
  errors:[{path:'/bounds/2',expected:{rule:'maximum',comparison:'<=',limit:16,private:'do not retain values'},problem:'untrusted prose'}]}}});
const record=(context,n,options={})=>context.observeValidation({run:'run',requestId:'call-'+n,spec,args,result:failure(),...options});

test('typed repeated schema rejection selects one existing reflection and restores the original request',()=>{
  const context=new RetryEvidenceContext(),reflection=new EvidenceReflection({enabled:true,attempts:2});
  record(context,1);assert.equal(reflection.select(base,context.snapshot(),{turn:1,step:1}),base);
  record(context,2);const snapshot=context.snapshot(),row=snapshot.evidence[0];
  assert.equal(row.attempts,2);assert.equal(row.kind,'validation');assert.equal(row.dispatched,false);
  assert.deepEqual(row.errors,[{path:'/bounds/2',expected:{rule:'maximum',comparison:'<=',limit:16}}]);
  const intent={sessionId:'same-session',selectionSeq:1};
  const selected=reflection.select(base,snapshot,{turn:1,step:2,intent});
  assert.deepEqual(selected,{...base,reasoningEffort:'low'});
  assert.equal(reflection.snapshot().lastReason,'repeated-core-schema-rejection');
  record(context,3);
  assert.deepEqual(reflection.select(selected,context.snapshot(),{turn:1,step:3,intent}),base);
  assert.equal(reflection.state.selections,1);
  assert.equal(JSON.stringify(snapshot).includes('untrusted'),false);
  assert.equal(JSON.stringify(snapshot).includes('private'),false);
  assert.equal(JSON.stringify(snapshot).includes('20,40'),false);
});

test('duplicate delivery, property order, changed arguments/schema, run and TTL have exact scopes',()=>{
  let now=100;const context=new RetryEvidenceContext({now:()=>now,ttlMs:10});
  record(context,1);record(context,2);record(context,1);
  assert.equal(context.snapshot().evidence[0].attempts,2);
  record(context,3,{args:{bounds:[0,-3,1,2,3,50]}});assert.equal(context.snapshot().evidence[0].attempts,1);
  record(context,4,{spec:{...spec,inputSchema:{...spec.inputSchema,additionalProperties:false}}});
  assert.equal(context.snapshot().evidence[0].attempts,1);
  record(context,5,{run:'new-run'});assert.equal(context.snapshot().evidence[0].attempts,1);
  now=111;assert.equal(context.snapshot(),null);record(context,6,{run:'new-run'});
  assert.equal(context.snapshot().evidence[0].attempts,1);
});

test('only structured pre-dispatch core validation counts; successful corrected calls clear it',()=>{
  const context=new RetryEvidenceContext();
  for(const mutate of [v=>{v.structuredContent.data.executed=true;},v=>{delete v.structuredContent.data.executed;},
    v=>{v.structuredContent.data.reason='body_error';},v=>{delete v.structuredContent.protocol;},
    v=>{v.structuredContent.data.tool='other_tool';},v=>{delete v.isError;}]){
    const result=failure();mutate(result);record(context,Math.random(),{result});assert.equal(context.snapshot(),null);
  }
  record(context,1);record(context,2);assert.equal(context.snapshot().evidence[0].attempts,2);
  record(context,3,{result:{structuredContent:{protocol:'agent-mc/v1',failed:false}}});assert.equal(context.snapshot(),null);
});

test('explicit reasoning, disabled reflection, request budgets and existing cooldown are preserved',()=>{
  const context=new RetryEvidenceContext();record(context,1);record(context,2);
  assert.equal(new EvidenceReflection().select(base,context.snapshot(),{turn:1,step:1}),base);
  const p=new EvidenceReflection({enabled:true,attempts:2,minIntervalMs:1000,minRequests:2},{now:()=>0});
  const high={...base,reasoningEffort:'high'};
  assert.equal(p.select(high,context.snapshot(),{turn:1,step:1}),high);
  assert.deepEqual(p.select(base,context.snapshot(),{turn:1,step:2}),{...base,reasoningEffort:'low'});
  record(context,3,{args:{bounds:[100]}});record(context,4,{args:{bounds:[100]}});
  assert.equal(p.select(base,context.snapshot(),{turn:1,step:3}),base);
});

test('argument and schema fingerprints are stable and evidence storage remains bounded',()=>{
  const context=new RetryEvidenceContext({limit:1});
  record(context,1,{args:{bounds:[20],mode:'voxels'}});
  record(context,2,{args:{mode:'voxels',bounds:[20]},spec:{name:spec.name,inputSchema:{properties:spec.inputSchema.properties,type:'object'}}});
  assert.equal(context.snapshot().evidence[0].attempts,2);
  for(let n=0;n<80;n++){
    const other={...spec,name:'tool_'+n},result=failure();result.structuredContent.data.tool=other.name;
    record(context,'other-'+n,{spec:other,result});
  }
  assert.equal(context.snapshot().evidence.length,1);assert.ok(context.validationSeen.size<=32);
});
