/** Host-owned identity settings. Generic game notes and retrieval remain in agent-mc-world. */
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
export function conversationDirectory(directory,key){
  if(key===undefined)return directory;
  if(typeof key!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(key))throw Error('INVALID_PROFILE');
  return join(directory,'conversations',key);
}

const files=new URL(import.meta.url.includes('/lib/plugins/')?'../../data/transmigrators/':'../data/transmigrators/',import.meta.url);
const text=(value,max=12000)=>{
  if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw Error('INVALID_PROFILE');
  return value.trim();
};
const boolean=(value,fallback)=>{if(value===undefined)return fallback;if(typeof value!=='boolean')throw Error('INVALID_PROFILE');return value;};
export function personaPresets(){return [
  ['naruto','鸣人','热血、直率，重视同伴'],['kirito','桐人','冷静、简洁，先观察再行动'],['edward','爱德华','好奇、理性，重视代价与规律'],
].map(([id,name,description])=>({id,name,description,personality:text(readFileSync(new URL(id+'.persona.md',files),'utf8')),
  backstory:text(readFileSync(new URL(id+'.backstory.md',files),'utf8'))}));}
export function profileSettings(input={},previous={}) {
  const value={...previous,...Object.fromEntries(Object.entries(input).filter(([,v])=>v!==undefined))};
  const personaPreset=value.personaPreset??'custom';
  if(!['custom','naruto','kirito','edward'].includes(personaPreset))throw Error('INVALID_PROFILE');
  const preset=personaPreset!=='custom'&&personaPreset!==previous.personaPreset?personaPresets().find(p=>p.id===personaPreset):null;
  const personality=text(input.personality??preset?.personality??previous.personality??'');
  const backstory=text(input.backstory??preset?.backstory??previous.backstory??'');
  const initialMemory=text(value.initialMemory??'',6000);
  const dshPreset=text(value.dshPreset??'',128);
  if(dshPreset&&!/^[\w][\w:.-]*$/.test(dshPreset))throw Error('INVALID_PROFILE');
  const notebookMode=value.notebookMode??'local-vector';
  if(!['local','local-vector','vector'].includes(notebookMode))throw Error('INVALID_PROFILE');
  const embeddingEndpoint=text(value.embeddingEndpoint??'',1000),embeddingModel=text(value.embeddingModel??'',200),embeddingKeyEnv=text(value.embeddingKeyEnv??'',120);
  if(embeddingKeyEnv&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(embeddingKeyEnv))throw Error('INVALID_PROFILE');
  if(embeddingEndpoint){const u=new URL(embeddingEndpoint);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('INVALID_PROFILE');}
  if(notebookMode==='vector'&&(!embeddingEndpoint||!embeddingModel))throw Error('INVALID_PROFILE');
  const toolProfile=value.toolProfile??'lean',skinModel=value.skinModel??'classic';
  if(!['lean','full'].includes(toolProfile)||!['classic','slim'].includes(skinModel))throw Error('INVALID_PROFILE');
  return {personaPreset,personality,backstory,initialMemory,dshPreset,notebookMode,embeddingEndpoint,embeddingModel,embeddingKeyEnv,
    toolProfile,skinModel,mineralVision:boolean(value.mineralVision,false),viewerEnabled:boolean(value.viewerEnabled,true),
    useLocalSkin:boolean(value.useLocalSkin,false)};
}
export function renderPersona(name,p) {
  return [`你在 Minecraft 中使用显示名称「${name}」。`,
    '以下是主人设定的人格与故事，不是现场事实。人设中的法术、能力、人物与约定不证明当前服务器存在或可用；真实地点、矿物、技能和权限只依据当前观测、帮助及执行回执。',
    p.personality||'理解用户任务后行动，保留已有目标与经验。依据真实观测和执行回执判断结果，未知结果先核对，不重复提交。',
    p.backstory&&`角色背景（属于设定，不证明当前服务器的经历、技能或权限）：\n${p.backstory}`,
    p.initialMemory&&`主人提供的初始记忆（未经当前现场核验）：\n${p.initialMemory}`,
    '游戏中的矿点、兴趣点、据点与经验使用 mc_memory 笔记本记录和按需查询。附维度、坐标、发现时间与来源；采完、变化或失败后更新。历史笔记不等于当前事实，不扫描未见矿脉冒充发现。'].filter(Boolean).join('\n\n')+'\n';
}
export function readProfile(dataDir,config={}) {
  const file=dataDir+'/character.json';
  if(existsSync(file))return profileSettings(JSON.parse(readFileSync(file,'utf8')));
  // Legacy hand-written persona is retained as custom text until the owner explicitly saves edits.
  return profileSettings({personality:config.personaFile&&existsSync(config.personaFile)?readFileSync(config.personaFile,'utf8'):'',
    mineralVision:config.minecraft?.perception?.mineralVision??false,viewerEnabled:config.minecraft?.viewerPort!==0,
    notebookMode:config.minecraft?.memory?.mode==='local-vector'?'local-vector':'local',dshPreset:config.dshPreset??'',
    toolProfile:config.tools?.profile??'lean',skinModel:config.minecraft?.skinModel??'classic',useLocalSkin:config.minecraft?.localSkinEnabled??false});
}
