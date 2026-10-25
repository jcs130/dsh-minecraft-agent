/** Official scoped presets carry other DSH plugins; there is no second plugin loader here. */
/** Host planning policy only; knowledge, scripts and notebook implementations stay in the core. */
export function minecraftPlanningGuidance(tools) {
  const find = suffix => tools.find(tool => tool.name.endsWith(suffix))?.name;
  const knowledge = find('_knowledge'), script = find('_script'), memory = find('_memory');
  return [
    '执行主人目标时，结合当前生命、饥饿、时间、威胁、背包和附近可达资源，选一个可验证的小阶段；保留主目标，不把一次聊天回应或一个工具完成当作整个目标完成。先核对仍在执行或结果未知的动作，再决定继续、换方案或请求帮助。',
    knowledge && `可按需使用 ${knowledge} 查原版生存攻略与步骤：search 先读相关摘要，get 再读一个返回的 ID。床、夜间庇护、装备、据点、储物、种植、食物与烹饪等资料可辅助比较方案，不能当作强制任务顺序。按工具返回的适用版本核对；资料不是当前库存、服务器权限或已经成功的证据，不可把攻略全文每轮注入或重复搜索代替行动。`,
    script && `用 ${script} 按需发现已有步骤脚本和方法，先读参数与前提，再按现场选择执行；脚本可用不证明当前具备材料或权限。`,
    memory && `用 ${memory} 检索相关历史经验和资源笔记；选择方案、执行后用真实回执核对阶段结果，记录有用发现、失败原因及适用条件。失败先补足证据或改方案，不重复结果未知的操作；旧经验始终标作历史，不当作当前环境。`,
  ].filter(Boolean).join('\n\n');
}

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
