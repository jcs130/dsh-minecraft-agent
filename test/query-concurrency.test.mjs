import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gameToolConcurrencySafe, PROTOCOL} from '../src/harness-bridge.mjs';
import {minecraftPlanningGuidance} from '../src/harness-composition.mjs';

const spec = name => ({name, annotations:{readOnlyHint:true},
  _meta:{[PROTOCOL]:{tags:['read'],barrierAfter:false,endsTurn:false}}});

for(const name of ['mc_query','mymc_query'])test(`declared non-body ${name} can overlap navigation without enabling other commands`,()=>{
  assert.equal(gameToolConcurrencySafe(spec(name)),true);
});

test('query spelling alone, missing contracts and mutating or turn-ending metadata stay serialized',()=>{
  for(const value of [undefined,{}, {name:'mc_query'},
    {name:'mc_query',annotations:{readOnlyHint:true}},
    {...spec('mc_query'),annotations:{readOnlyHint:false}},
    {...spec('mc_query'),_meta:{[PROTOCOL]:{barrierAfter:true,endsTurn:false}}},
    {...spec('mc_query'),_meta:{[PROTOCOL]:{barrierAfter:false,endsTurn:true}}},
    {...spec('mc_query'),_meta:{[PROTOCOL]:{}}},
    spec('mc_do'),spec('mc_protocol'),spec('mc_messages'),spec('mc_scout')])
    assert.equal(gameToolConcurrencySafe(value),false,JSON.stringify(value));
});

test('planning guidance discovers queries only from the current core catalogue and preserves unknown outcomes',()=>{
  assert.ok(!minecraftPlanningGuidance([]).includes('requestId'));
  for(const name of ['mc_query','mymc_query']){
    const text=minecraftPlanningGuidance([{name}]);
    for(const part of [name,'{}','requestId','sent','超时仍未知','不自动重发','有序行动'])assert.ok(text.includes(part),part);
  }
});
