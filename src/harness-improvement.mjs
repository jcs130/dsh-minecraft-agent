/** Host guidance only. Core owns authoring, versions, execution and assessment. */
import{readFileSync}from'node:fs';
export function registerImprovementSkill(agentCtx) {
 if(typeof agentCtx.inject!=='function')return;
 let raw;
 for(const path of ['../skills/minecraft-self-improvement/SKILL.md','../../skills/minecraft-self-improvement/SKILL.md']){
  try{raw=readFileSync(new URL(path,import.meta.url),'utf8');break;}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 if(typeof raw!=='string'||raw.length>16000)throw Error('Bundled Minecraft improvement skill unavailable');
 const skill={name:'minecraft-self-improvement',source:'bundled',description:'Minecraft 中需要自己写脚本、改进战术、反思失败并复用经验时，使用真实回执驱动的方法改进流程。',
  content:raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u,'').trim()};
 const fork=agentCtx.inject(['skills'],scoped=>{if(typeof scoped.skills.register!=='function')return;const off=scoped.skills.register(skill);scoped.effect(()=>off,'Minecraft improvement skill');});
 return()=>fork.dispose();
}
export function improvementGuidance({script,memory,practice,reason,authoring=true}={}) {
 if(!script)return '';
 const text=[
  '需要自我改进：遇到重复失败、低效操作或反射只能勉强保命时，先核对真实回执与当前任务；未决动作先查原结果，不重复执行。找出一个可验证的原因并改变方案，不以“我会改进”或增加思考量代替实际改动。',
  `已有固定动作不够表达反馈控制时，主动用 ${script} ${authoring?'{api:"authoring"}':'的完整工具帮助与 API 索引'} 查自写方法流程，按需查 API。不是只能调用预制脚本；可以自行写有界条件、计算和循环，validate 后保存带 parent 的新版本。按条件在自然任务中运行精确版本，用 executionId 查真实效果、review 成功/失败/未知，证据支持后才 adopt；失败保留反例并修订，保留旧版可回退。反射保命不是已学会战术，程序完成也不是目标达成。`,
  memory&&`相关经验按需从 ${memory} 取用；把方法版本、原执行/复盘证据与适用条件写回游戏记忆。缺少新证据不重复反思、读目录或空转试验。`,
  practice&&`确有需要时用 ${practice} {op:"help"} 核对当前隔离练习能力，再自行选一个已保存方法与精确 revision 发起对照试验。status/result/compare/stage 延续原 job；练习通过不证明线上有效。当前物理练习只覆盖平地移动碰撞，不用它冒充战斗或法术测试。`,
 ];
 if(typeof reason==='string'&&/^[a-z-]{1,100}$/.test(reason))text.unshift(`本次反思触发：${reason}。这一轮要给出与证据对应的下一步修正；若已发现可重复的方法缺口，走自写/复盘流程。不要原样重试。`);
 return text.filter(Boolean).join('\n');
}

/** Discover only exposed read tools; knowledge stays on demand and out of the changing tail. */
function fixedSection(agentCtx,section,completeSections) {
 if(!completeSections)return agentCtx.systemPrompt.section(section);
 if(completeSections.some(s=>s.name===section.name))throw Error('Duplicate Minecraft supplemental section');
 completeSections.push(section);const off=()=>{const i=completeSections.indexOf(section);if(i>=0)completeSections.splice(i,1);};
 agentCtx.effect?.(()=>off);return off;
}
export function installKnowledgeRecoveryContext(agentCtx,{tools=[],completeSections,when}={}) {
 const knowledge=tools.find(t=>t.name.endsWith('_knowledge'))?.name,
  help=tools.find(t=>t.name.endsWith('_help')&&!t.name.endsWith('_tool_help')&&(t.inputSchema??t.parameters)?.properties?.skill)?.name;
 if(!knowledge&&!help)return;
 const text=[
  '规则或设备用法不确定、同类操作失败时，先核对原生失败原因，再按需查一小段对应说明；不要只凭同伴说过就重复尝试。',
  knowledge&&`配方、食物风险和生存知识用 ${knowledge} {action:"search",query:"物品英文ID或问题",limit:3}，再 get 返回的精确 id。这是版本化原版参考，服务器自定义配方仍须核验，未收录不代表服务端绝无配方。`,
  help&&`操作字段和交互含义用 ${help} {skill:"当前技能名"}。装料、拿着使用物品、走到NPC旁、发出命令都不是制作、放置、交易或交付已经成功；按实际效果判断。`,
  '不确定才补查相关片段，不每轮重读整份攻略；记录有原执行引用的教训后继续原目标。',
 ].filter(Boolean).join('\n');
 if(typeof when==='function')return agentCtx.systemPrompt.context({name:'minecraft:knowledge-recovery',order:9994,interpolate:false,required:true,text:()=>when()?text:''});
 return fixedSection(agentCtx,{name:'minecraft:knowledge-recovery',order:7002,interpolate:false,text},completeSections);
}

export function installImprovementContext(agentCtx,{tools,reflection,practice,enabled=true,completeSections}={}) {
 if(!enabled)return;
 const offKnowledge=installKnowledgeRecoveryContext(agentCtx,{tools,completeSections});
 const scriptSpec=tools.find(t=>t.name.endsWith('_script')),script=scriptSpec?.name,memory=tools.find(t=>t.name.endsWith('_memory'))?.name;
 if(!script)return offKnowledge;
 const offSkill=registerImprovementSkill(agentCtx),authoring=scriptSpec.description?.includes('api:"authoring"')===true;
 // Keep the workflow in the fixed prefix; only a selected reflection adds a
 // short changing cue at the request tail. Do not append full lessons per step.
 const offPrefix=fixedSection(agentCtx,{name:'minecraft:self-improvement',order:7001,interpolate:false,
  text:improvementGuidance({script,memory,practice,authoring})},completeSections);
 const offCue=agentCtx.systemPrompt.context({name:'minecraft:reflection-intent',order:9993,interpolate:false,text:()=>{
  const reason=reflection?.snapshot().lastReason;
  return typeof reason==='string'&&/^[a-z-]{1,100}$/.test(reason)
   ?JSON.stringify({reason,next:'依据当前证据纠正计划；方法缺口可自写、验证、试用与复盘。不要原样重试，不把增加思考当作改善。'})
   :'{}';
 }});
 return()=>{offCue?.();offPrefix?.();offSkill?.();offKnowledge?.();};
}
