/** Official scoped presets carry other DSH plugins; there is no second plugin loader here. */
export function constrainMinecraftTools(agentCtx,composition) {
  // New DSH versions also filter ancestor preset layers. An explicitly selected
  // preset owns its capability policy; the default game-only Agent masks imports.
  if(!composition.composed)agentCtx.tools.restrict({allow:[]});
}
export async function composeMinecraftAgent(agentCtx,{dshPreset,persona,environment}) {
  if(!dshPreset){
    agentCtx.systemPrompt.section({name:'minecraft:persona',order:0,text:persona+'\n\n'+environment,complete:true,interpolate:false});
    return {composed:false,compaction:undefined};
  }
  const registry=agentCtx.get('agentPresets');
  if(!registry?.mount)throw Error('The selected DSH capability preset is unavailable');
  await registry.mount(agentCtx,dshPreset);
  // Shadow the deployment/preset identity, preserving other plugins' instructions and context.
  agentCtx.systemPrompt.section({name:'deployment:persona-prefix',order:0,text:persona,interpolate:false});
  agentCtx.systemPrompt.section({name:'deployment:persona-suffix',order:100000,text:'',interpolate:false});
  agentCtx.systemPrompt.section({name:'minecraft:environment',order:7000,text:environment,interpolate:false});
  return {composed:true,compaction:registry.serviceFor?.({ctx:agentCtx},'compaction')};
}
