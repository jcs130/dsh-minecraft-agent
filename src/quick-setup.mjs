/** Profile-local first-run setup. No model inference, session creation or game connection on install. */
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join,resolve,isAbsolute,basename} from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {clientRequestSchema} from '@deepseek-ai/dsh-client-connection';
import {connectionPreference} from './harness-panel.mjs';
import {personaPresets,profileSettings,readProfile,renderPersona,conversationDirectory} from './profile-settings.mjs';

const field=(value,label,max=200)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw Error(label);
  return value.trim();
};
export function setupFields(input,parseAddress) {
  let parsed;try{parsed=parseAddress(field(input?.address,'INVALID_ADDRESS',300));}catch{throw Error('INVALID_ADDRESS');}
  const {host,port}=parsed;
  const auth=input.auth??'offline';if(!['offline','microsoft'].includes(auth))throw Error('INVALID_AUTH');
  const username=field(input.username,'INVALID_USERNAME',254);
  if(auth==='offline'&&!/^[A-Za-z0-9_]{1,16}$/.test(username))throw Error('INVALID_USERNAME');
  const version=field(input.version??'auto','INVALID_VERSION',32);
  if(version!=='auto'&&!/^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/.test(version))throw Error('INVALID_VERSION');
  if(input.name!=null&&typeof input.name!=='string')throw Error('INVALID_NAME');
  const name=input.name?.trim()?field(input.name,'INVALID_NAME',80):username;
  if(input.goal!=null&&typeof input.goal!=='string')throw Error('INVALID_GOAL');
  const goal=input.goal?.trim()??'';
  if(goal.length>3000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(goal))throw Error('INVALID_GOAL');
  const password=input.loginPassword;
  if(password!==undefined&&(typeof password!=='string'||password.length>128||/\s/.test(password)))throw Error('INVALID_LOGIN_PASSWORD');
  return {host,port,auth,username,version,name,goal,...password?{loginPassword:password}:{}};
}
export async function freePort() {
  const server=createServer();
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
  const port=server.address().port;await new Promise((done,fail)=>server.close(e=>e?fail(e):done()));return port;
}
async function atomicJson(file,value) {
  const tmp=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,file);}
  finally{await unlink(tmp).catch(()=>{});}
}
const messages={INVALID_ADDRESS:'请填写有效的服务器地址，例如 mc.example.com:25565。',INVALID_USERNAME:'离线角色名需为 1–16 位字母、数字或下划线；正版账号请填账号标识。',
  INVALID_PROFILE:'角色或偏好配置无效；请检查长度、开关、预设及向量服务配置。',INVALID_SKIN:'皮肤须为可解码的 64×64 或 64×32 PNG，最大 256 KiB。',
  PRESET_UNAVAILABLE:'所选 DSH 能力预设当前不可用，请先在 DSH 插件设置中准备好。',
  PRESET_SESSION_LOCKED:'原会话已建立。更换能力预设时请勾选新建会话；原会话与游戏笔记会保留，不重放旧任务。',
  INVALID_AUTH:'请选择离线身份或微软正版。',INVALID_VERSION:'请填写实际 Java 协议版本，或选择 auto。',INVALID_NAME:'显示名称过长或含无效字符。',INVALID_GOAL:'首次任务过长或含无效字符。',
  INVALID_LOGIN_PASSWORD:'服务器登录密码不能含空白，最长 128 字符。',MODEL_NOT_CONFIGURED:'请先在 DSH 中选择可用的默认模型；插件沿用该配置，无需另填 API Key。',
  SETUP_BUSY:'连接正在加载或已启用；请先点击“停止并配置”，再调整配置。',SETUP_UNAVAILABLE:'当前宿主没有提供独立 profile 目录，请使用现有高级配置方式。',SAVE_FAILED:'配置未能保存；请检查输入及本机目录权限。'};
function cancellable(promise,signal) {
  if(signal.aborted)return Promise.reject(signal.reason);
  return new Promise((done,fail)=>{
    const abort=()=>fail(signal.reason);signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(done,fail).finally(()=>signal.removeEventListener('abort',abort));
  });
}

function accountDirectory(directory,fields){
  const key=createHash('sha256').update(JSON.stringify([fields.host.toLowerCase(),fields.port,fields.auth,fields.username])).digest('hex').slice(0,24);
  return join(directory,'agents',key);
}
/** Validate this first-run format, not arbitrary advanced Agent configuration. */
function readSaved(value,directory,parseAddress){
  if(!['dsh-mc-quick-setup/v1','dsh-mc-quick-setup/v2'].includes(value?.schema)||!value.fields||!value.config)throw Error('INVALID_SAVED');
  const fields=setupFields(value.fields,parseAddress),config=value.config,mc=config.minecraft,dataDir=accountDirectory(directory,fields);
  conversationDirectory(dataDir,config.sessionKey);
  if(typeof config.enabled!=='boolean'||config.dataDir!==dataDir||config.personaFile!==join(dataDir,'persona.md')||config.serverPack!=='none'
    ||!mc||mc.enabled!==true||mc.host!==fields.host||mc.port!==fields.port||mc.auth!==fields.auth||mc.username!==fields.username||mc.version!==fields.version
    ||(mc.loginConfigFile!==undefined&&mc.loginConfigFile!==join(dataDir,'server-login.json')))throw Error('INVALID_SAVED');
  return value;
}

export async function createQuickSetup({directory,parseAddress,selection,modelInfo,launch,notebook,listPresets,allocatePort=freePort}) {
  if(!isAbsolute(directory))throw Error('SETUP_UNAVAILABLE');
  directory=resolve(directory);const file=join(directory,'quick-setup.json');
  let saved=null,profile=profileSettings(),presets=[],phase='unconfigured',error=null,closed=false,changing=false,instance,pending=Promise.resolve(),epoch=0,cancel;
  try { saved=readSaved(JSON.parse(await readFile(file,'utf8')),directory,parseAddress);profile=readProfile(saved.config.dataDir,saved.config);phase='configured'; }
  catch(e){saved=null;if(e.code!=='ENOENT'){phase='failed';error='保存的配置无法读取；原数据已保留，请检查本机配置。';}}
  const publicFields=()=>saved?{address:saved.fields.address,username:saved.fields.username,auth:saved.fields.auth,version:saved.fields.version,name:saved.fields.name,goal:saved.fields.goal,
    ...profile,hasLoginPassword:!!saved.config.minecraft.loginConfigFile,
    hasSession:existsSync(join(conversationDirectory(saved.config.dataDir,saved.config.sessionKey),'session-id.txt')),
    hasStoredSkin:existsSync(join(saved.config.dataDir,'body','minecraft-skin-bot.png'))}:null;
  const snapshot=()=>{let model=null;try{const s=selection();if(s?.provider&&s?.model)model={provider:s.provider,model:s.model};}catch{}
    let skinPreview=null;try{const path=saved&&join(saved.config.dataDir,'body','minecraft-skin-bot.png');if(path&&existsSync(path)){
      const bytes=readFileSync(path);if(bytes.length<=256*1024)skinPreview='data:image/png;base64,'+bytes.toString('base64');}}catch{}
    return {phase,error,fields:publicFields(),model,skinPreview,personaPresets:personaPresets(),dshPresets:presets,dshPresetsAvailable:typeof listPresets==='function',gameReady:false,sampledAt:new Date().toISOString()};};
  const describe=async()=>{
    try{presets=(await listPresets?.()??[]).slice(0,50).map(p=>({id:String(p.id).slice(0,128),name:String(p.name??p.id).slice(0,160),
      description:String(p.description??'').slice(0,400),broken:!!p.broken}));}catch{presets=[];}
    return snapshot();
  };
  const start=()=>{
    const current=++epoch;cancel=new AbortController();const signal=AbortSignal.any([cancel.signal,AbortSignal.timeout(30000)]);
    const active=()=>!closed&&epoch===current;
    phase='opening';error=null;
    pending=Promise.resolve().then(async()=>{
      if(closed)return;
      const config=structuredClone(saved.config),route=selection();
      if(!route?.provider||!route?.model)throw Error('MODEL_NOT_CONFIGURED');
      const info=await cancellable(modelInfo(route.provider,route.model,signal),signal);
      if(!active())return;
      config.provider=route.provider;config.model=route.model;
      if(route.reasoningEffort!==undefined)config.reasoningEffort=String(route.reasoningEffort);
      const max=info?.context?.contextWindow;
      config.contextTokens=Number.isSafeInteger(max)&&max>0?max:131072;
      config.consolePort=await allocatePort();config.minecraft.viewerPort=profile.viewerEnabled?await allocatePort():0;
      for(let i=0;i<4&&config.minecraft.viewerPort&&config.consolePort===config.minecraft.viewerPort;i++)config.minecraft.viewerPort=await allocatePort();
      if(config.consolePort===config.minecraft.viewerPort)throw Error('PORT_UNAVAILABLE');
      if(!active())return;
      instance=await launch(config);
      if(!active()){await instance?.dispose();instance=undefined;return;}
      await cancellable(instance?.ready,signal); // Enabled is not evidence of authentication or a real world.
      if(active())phase='enabled';
    }).catch(async e=>{const old=instance;instance=undefined;await old?.dispose().catch(()=>{});
      if(active()){phase='failed';error=messages[e?.message]??'连接或会话未能启动。原身份与数据已保留，可重试；未确认真实游戏就绪。';}});
  };
  const persist=async(input,connect)=>{
      if(closed)throw Error('SETUP_UNAVAILABLE');
      if(changing||['opening','enabled'].includes(phase))throw Error('SETUP_BUSY');changing=true;
      try{
        const fields=setupFields(input,parseAddress),route=selection();
        if(connect&&(!route?.provider||!route?.model))throw Error('MODEL_NOT_CONFIGURED');
        const dataDir=accountDirectory(directory,fields),same=saved?.config?.dataDir===dataDir;
        const nextProfile=profileSettings(input,same?profile:{});
        if(input.newSession!==undefined&&typeof input.newSession!=='boolean')throw Error('INVALID_PROFILE');
        const changesPreset=same&&nextProfile.dshPreset!==profile.dshPreset;
        const oldSession=same&&existsSync(join(conversationDirectory(dataDir,saved.config.sessionKey),'session-id.txt'));
        if(changesPreset&&oldSession&&input.newSession!==true)throw Error('PRESET_SESSION_LOCKED');
        const sessionKey=changesPreset&&oldSession?randomUUID():same?saved.config.sessionKey:undefined;
        if(changesPreset&&oldSession)fields.goal=''; // Explicit new capability conversation never replays a previous task.
        if(nextProfile.dshPreset){await describe();if(!presets.some(p=>p.id===nextProfile.dshPreset&&!p.broken))throw Error('PRESET_UNAVAILABLE');}
        let skin,core;
        if(input.skinPngBase64!==undefined){try{
          core=await import('agent-mc-world/client'); // Only after the host's native-stream bootstrap; never a passive static SDK import.
          if(typeof input.skinPngBase64!=='string'||input.skinPngBase64.length>350000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.skinPngBase64))throw Error();
          skin=core.configuredPlayerSkin({bytes:Buffer.from(input.skinPngBase64,'base64'),model:nextProfile.skinModel});
          nextProfile.useLocalSkin=true;
        }catch{throw Error('INVALID_SKIN');}}
        if(nextProfile.useLocalSkin&&!skin&&!existsSync(join(dataDir,'body','minecraft-skin-bot.png')))throw Error('INVALID_SKIN');
        await mkdir(dataDir,{recursive:true,mode:0o700});
        const personaFile=join(dataDir,'persona.md');
        const temporary=personaFile+'.'+randomUUID()+'.tmp';
        try{await writeFile(temporary,renderPersona(fields.name,nextProfile),{mode:0o600,flag:'wx'});await rename(temporary,personaFile);}finally{await unlink(temporary).catch(()=>{});}
        await atomicJson(join(dataDir,'character.json'),nextProfile);
        if(skin)core.setStoredSkin(join(dataDir,'body'),'bot',skin.bytes);
        const minecraft={enabled:true,host:fields.host,port:fields.port,auth:fields.auth,username:fields.username,version:fields.version,
          perception:{mineralVision:nextProfile.mineralVision},localSkinEnabled:nextProfile.useLocalSkin,skinModel:nextProfile.skinModel,
          memoryAgentId:same?(saved.config.minecraft.memoryAgentId??saved.config.name):'dsh:'+basename(dataDir),
          memory:{mode:nextProfile.notebookMode,...nextProfile.notebookMode==='vector'?{endpoint:nextProfile.embeddingEndpoint,model:nextProfile.embeddingModel,apiKeyEnv:nextProfile.embeddingKeyEnv}:{}}};
        if(fields.loginPassword){
          const secret=join(dataDir,'server-login.password');await writeFile(secret,fields.loginPassword,{mode:0o600});
          minecraft.loginConfigFile=join(dataDir,'server-login.json');
          await atomicJson(minecraft.loginConfigFile,{enabled:true,accounts:[{server:`${fields.host}:${fields.port}`,username:fields.username,
            credentialFile:secret,credentialFormat:'file',command:'login',
            requestMarkers:['请使用 /login','请输入 /login','Please login','Please use /login'],successMarkers:['登录成功','成功登录','Successfully logged in','Login successful'],
            failureMarkers:['密码错误','登录失败','Wrong password','Invalid password']}]});
        }else if(saved?.config?.dataDir===dataDir&&saved.config.minecraft.loginConfigFile)minecraft.loginConfigFile=saved.config.minecraft.loginConfigFile;
        const config={enabled:connect,handleSignals:false,name:fields.name,dataDir,personaFile,serverPack:'none',maxTokens:6000,minStepIntervalMs:250,
          minecraft,tools:{profile:nextProfile.toolProfile},...(sessionKey?{sessionKey}:{}),...(nextProfile.dshPreset?{dshPreset:nextProfile.dshPreset}:{}),...(fields.goal?{goal:fields.goal}:{})};
        const next={schema:'dsh-mc-quick-setup/v2',fields:{address:`${fields.host.includes(':')?'['+fields.host+']':fields.host}:${fields.port}`,
          username:fields.username,auth:fields.auth,version:fields.version,name:fields.name,goal:fields.goal},config};
        await mkdir(directory,{recursive:true,mode:0o700});await atomicJson(file,next);
        connectionPreference(join(dataDir,'connection-state.json')).set(!connect);
        saved=next;profile=nextProfile;
        if(connect)start();else{phase='configured';error=null;}return snapshot();
      }catch(e){throw Error(messages[e.message]??messages.SAVE_FAILED);}finally{changing=false;}
  };
  return {snapshot,describe,configure:input=>persist(input,true),save:input=>persist(input,false),
    async notebook(args){
      if(closed||!saved||changing||phase==='opening')throw Error('SETUP_BUSY');
      if(!['help','search','get','remember','revise','archive'].includes(args?.action))throw Error('INVALID_PROFILE');
      if(['remember','revise'].includes(args.action))args={...args,source:{kind:'user_report',speaker:'owner',reference:'dsh-owner-notebook:'+randomUUID()}};
      return phase==='enabled'?instance.notebook(args):notebook(saved.config,args);
    },
    retry(){if(closed||!saved?.config.enabled||changing||['opening','enabled'].includes(phase))throw Error(messages.SETUP_BUSY);start();return snapshot();},
    async stop(){
      if(closed||changing)throw Error('SETUP_BUSY');changing=true;
      try{if(saved){saved.config.enabled=false;await atomicJson(file,saved);}epoch++;cancel?.abort();const old=instance;instance=undefined;await old?.dispose();await pending;
        phase=saved?'configured':'unconfigured';error=null;return snapshot();}finally{changing=false;}
    },
    resume(){if(saved?.config.enabled===true&&phase==='configured')start();},
    async close(){closed=true;epoch++;cancel?.abort();const old=instance;instance=undefined;await old?.dispose();await pending;},
  };
}

/** Owner-only carrier, deliberately separate from model metrics and public game/OBS views. */
export function attachQuickSetup(ctx,setup) {
  let closed=false;
  ctx.inject(['connection','webServer'],scoped=>{
    scoped.connection.fetch.register({path:'/api/mc-harness/setup',methods:['POST'],requestBody:'buffered',fetch:async request=>{
      if(closed)return new Response('Disposed',{status:410});
      let body;try{const text=await request.text();if(text.length>400000)throw Error();body=JSON.parse(text);}catch{return new Response('Invalid request',{status:400});}
      const parsed=clientRequestSchema.safeParse(body);
      if(!parsed.success||parsed.data.method!=='mc-harness/setup')return new Response('Invalid setup envelope',{status:400});
      const {payload,rpcId}=parsed.data;let result;
      if(!['state','configure','save','retry','stop','notebook'].includes(payload?.action))return new Response('Invalid setup action',{status:400});
      try{result={ok:true,value:payload.action==='state'?await setup.describe():payload.action==='configure'?await setup.configure(payload.config):payload.action==='save'?await setup.save(payload.config):payload.action==='notebook'?await setup.notebook(payload.config):payload.action==='stop'?await setup.stop():setup.retry()};}
      catch(e){result={ok:false,error:{code:'setup-unavailable',message:payload.action==='notebook'?'笔记操作未确认；请刷新并核对最新版本后重试，原记录已保留。':messages[e.message]??(Object.values(messages).includes(e.message)?e.message:'配置暂不可用；原身份与数据已保留，请重试。'),details:{}}};}
      return Response.json({type:'server-response',rpcId,result},{headers:{'cache-control':'no-store'}});
    }});
  });
  ctx.effect(()=>async()=>{closed=true;await setup.close();});
  setup.resume();
}
