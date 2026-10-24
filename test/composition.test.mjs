import {test} from 'node:test';
import assert from 'node:assert/strict';
import {composeMinecraftAgent} from '../src/harness-composition.mjs';
import {personaPresets,profileSettings,renderPersona} from '../src/profile-settings.mjs';

test('all three bundled personas are discoverable and editable without inventing current game memories',()=>{
  assert.deepEqual(personaPresets().map(p=>p.id),['naruto','kirito','edward']);
  for(const p of personaPresets()){
    const values=profileSettings({personaPreset:p.id});assert.equal(values.personality,p.personality);
    const edited=profileSettings({personality:'自定义性格',initialMemory:'主人报告的一处旧矿点'},values);
    assert.equal(edited.personality,'自定义性格');assert.match(renderPersona(p.name,edited),/未经当前现场核验/);
  }
  for(const v of [{embeddingEndpoint:'https://user:secret@example.test/embeddings'}, {embeddingKeyEnv:'Bearer secret'}, {notebookMode:'vector'}, {mineralVision:1}])assert.throws(()=>profileSettings(v));
});

test('DSH composition preserves plugin prompt sections and reuses its compaction service while changing only the Agent identity',async()=>{
  const sections=[],calls=[],existing={provider:'fixture-compaction'};
  const ctx={systemPrompt:{section:row=>sections.push(row)},get:()=>({mount:async(c,id)=>{assert.equal(c,ctx);calls.push(id);sections.push({name:'other-plugin:memory',text:'Memory tools guidance'});},serviceFor:()=>existing})};
  const composed=await composeMinecraftAgent(ctx,{dshPreset:'installed-memory',persona:'Agent identity {{literal}}',environment:'Stable game protocol'});
  assert.deepEqual(calls,['installed-memory']);assert.equal(composed.compaction,existing);
  assert.ok(sections.some(s=>s.name==='other-plugin:memory'));assert.ok(sections.every(s=>!s.complete));
  assert.equal(sections.find(s=>s.name==='deployment:persona-prefix').interpolate,false);
  const basic=[];await composeMinecraftAgent({systemPrompt:{section:s=>basic.push(s)}},{persona:'plain',environment:'protocol'});
  assert.equal(basic[0].complete,true);assert.equal(basic[0].text,'plain\n\nprotocol');
});
