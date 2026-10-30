import{test}from'node:test';import assert from'node:assert/strict';
import{installKnowledgeRecoveryContext,installImprovementContext}from'../src/harness-improvement.mjs';
import{composeMinecraftAgent}from'../src/harness-composition.mjs';
import{createRequire}from'node:module';import{pathToFileURL}from'node:url';import{resolve}from'node:path';
test('on-demand recovery advertises exposed skill help rather than tool-help with a different schema',()=>{
 const sections=[],ctx={systemPrompt:{section:s=>{sections.push(s);return()=>{};}}};
 installKnowledgeRecoveryContext(ctx,{tools:[{name:'mymc_knowledge'},{name:'mymc_tool_help',parameters:{properties:{name:{type:'string'}}}},{name:'mymc_help',inputSchema:{properties:{skill:{type:'string'}}}}]});
 assert.equal(sections.length,1);assert.equal(sections[0].name,'minecraft:knowledge-recovery');assert.equal(sections[0].interpolate,false);
 assert.match(sections[0].text,/mymc_knowledge/);assert.match(sections[0].text,/mymc_help/);assert.doesNotMatch(sections[0].text,/mymc_tool_help/);assert.ok(sections[0].text.length<700);
 assert.match(sections[0].text,/服务器自定义配方/);assert.match(sections[0].text,/不每轮重读/);
});
test('the real native assembler retains owner improvement guidance inside the complete game persona',async()=>{
 const req=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json')),load=n=>import(pathToFileURL(req.resolve(n)).href),[{Context},{SystemPrompt,renderPrompt},{createScope,scopeOf},{SkillRegistry}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-system-prompt'),load('@deepseek-ai/dsh-scope'),load('@deepseek-ai/dsh-skill')]);
 const root=new Context();let owner;const services=await root.plugin({name:'native-complete-recovery-services',apply(ctx){new SystemPrompt(ctx,{includeHarnessIdentity:false});new SkillRegistry(ctx);}}).await();
 const consumer=await root.plugin({name:'native-complete-recovery-owner',inject:['systemPrompt','skills'],apply(ctx){owner=ctx;}}).await(),scope=createScope(owner,{}),supplements=[];
 try{
  await composeMinecraftAgent(scope.ctx,{persona:'Original persona {{literal}}',environment:'Original game protocol',supplementalSections:supplements});
  const off=installImprovementContext(scope.ctx,{tools:[{name:'mymc_script',description:'api:"authoring"'},{name:'mymc_memory'},{name:'mymc_knowledge'},{name:'mymc_help',parameters:{properties:{skill:{type:'string'}}}}],completeSections:supplements});
  const assembled=await scope.ctx.systemPrompt.assemble({scope:scopeOf(scope.ctx)}),text=renderPrompt(assembled);
  assert.equal(assembled.sections.length,1);assert.equal(assembled.sections[0].name,'minecraft:persona');assert.match(text,/Original persona \{\{literal\}\}/);assert.match(text,/Original game protocol/);
  assert.match(text,/mymc_script/);assert.match(text,/mymc_knowledge/);assert.match(text,/mymc_help/);assert.match(text,/真实回执/);assert.ok(!assembled.contexts.some(x=>x.name==='minecraft:knowledge-recovery'));
  off();const restored=renderPrompt(await scope.ctx.systemPrompt.assemble({scope:scopeOf(scope.ctx)}));assert.equal(restored,'Original persona {{literal}}\n\nOriginal game protocol');
 }finally{await scope.dispose();await consumer.dispose();await services.dispose();}
});
test('the existing complete persona can receive bounded failure-gated context without replacing its sections',()=>{
 let value,on=false;const off=installKnowledgeRecoveryContext({systemPrompt:{context:v=>{value=v;return()=>{};}}},{tools:[{name:'mymc_knowledge'}],when:()=>on});
 assert.equal(value.required,true);assert.equal(value.text(),'');on=true;assert.match(value.text(),/mymc_knowledge/);off();
});
test('reference recovery works without a script tool and stays absent when neither read tool is exposed',()=>{
 const sections=[];let disposed=false;const ctx={systemPrompt:{section:s=>{sections.push(s);return()=>{disposed=true;};}}};
 const off=installImprovementContext(ctx,{tools:[{name:'mymc_knowledge'}]});assert.equal(sections.length,1);off();assert.equal(disposed,true);
 installKnowledgeRecoveryContext(ctx,{tools:[]});assert.equal(sections.length,1);
 installImprovementContext(ctx,{tools:[{name:'mymc_knowledge'}],enabled:false});assert.equal(sections.length,1);
});
