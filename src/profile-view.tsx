import {useState} from 'react';
import {NotebookView} from './notebook-view';
const defaults={address:'',username:'',auth:'offline',version:'auto',name:'',goal:'',personaPreset:'custom',personality:'',backstory:'',initialMemory:'',mineralVision:false,viewerEnabled:true,listenPublicChat:true,toolProfile:'lean',skinModel:'classic',useLocalSkin:false,notebookMode:'local-vector',embeddingEndpoint:'',embeddingModel:'',embeddingKeyEnv:'',dshPreset:'',newSession:false};
const tabs=[['connection','连接'],['perception','感知与工具'],['persona','角色与皮肤'],['notebook','服务器笔记'],['plugins','DSH 插件']];
export function QuickSetupView({state,onAction,onBack}: {state:any;onAction:(action:string,config?:any)=>Promise<any>;onBack?:()=>void}) {
  const [fields,setFields]=useState<any>(()=>({...defaults,...state.fields}));
  const [tab,setTab]=useState('connection'),[password,setPassword]=useState(''),[skin,setSkin]=useState<string>();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const opening=state.phase==='opening'||state.phase==='enabled';
  const field=(key:string)=>(e:any)=>setFields((v:any)=>({...v,[key]:e.target.type==='checkbox'?e.target.checked:e.target.value}));
  const action=async(kind:string)=>{if(busy)return;setBusy(true);setError('');setNotice('');
    try { const value=await onAction(kind,kind==='save'||kind==='configure'?{...fields,...password?{loginPassword:password}:{},...skin?{skinPngBase64:skin}:{}}:undefined);
      if(value?.fields)setFields({...defaults,...value.fields});if(kind==='save')setNotice('已保存，尚未连接游戏。');setSkin(undefined);
    }catch(e:any){setError(e.message||'操作未确认，请重试。');if(!fields.address||!fields.username)setTab('connection');}
    finally{setPassword('');setBusy(false);}};
  const upload=async(e:any)=>{const file=e.target.files?.[0];if(!file)return;setError('');
    try{if(file.size>256*1024||file.type!=='image/png')throw Error('请选择最大 256 KiB 的 PNG 皮肤。');
      const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(file);});
      const image=await createImageBitmap(file);const valid=image.width===64&&(image.height===64||image.height===32);image.close();
      if(!valid)throw Error('请选择 64×64 或 64×32 PNG。');setSkin(data.split(',')[1]);setFields((v:any)=>({...v,useLocalSkin:true}));
    }catch(e:any){setError(e.message||'无法读取皮肤。');}finally{e.target.value='';}};
  const choose=(id:string)=>{const p=state.personaPresets?.find((p:any)=>p.id===id);setFields((v:any)=>({...v,personaPreset:id,...p?{name:p.name,personality:p.personality,backstory:p.backstory}:{}}));};
  const preview=skin?'data:image/png;base64,'+skin:state.skinPreview;
  return <div className="mc-first-run"><style>{CSS}</style>
    <div className="mc-setup-heading"><div><span className="mc-setup-eyebrow">MINECRAFT × DSH</span><h1>角色、世界与随身笔记</h1></div>{onBack&&<button type="button" onClick={onBack}>返回游戏</button>}</div>
    <p>简单连接，按自己的方式生活。笔记随服务器和角色保存，不依赖透视。</p>
    <div className="mc-setup-model"><span>沿用 DSH 默认模型</span><strong>{state.model?`${state.model.provider} / ${state.model.model}`:'尚未配置，请先在 DSH 选择模型'}</strong><small>安装、配置与本地笔记不发起游戏推理。</small></div>
    <nav className="mc-setup-tabs" aria-label="Minecraft 配置分类">{tabs.map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {opening&&<div className="mc-setup-opening" role="status"><strong>{state.phase==='opening'?'正在载入 Agent…':'角色已启用'}</strong><span> 笔记可直接使用；修改角色和连接设置前先停止。</span><button type="button" disabled={busy} onClick={()=>action('stop')}>停止并修改配置</button></div>}
    {tab==='notebook'?state.fields?<NotebookView onAction={onAction} identity={`${state.fields.address} · ${state.fields.username}`} />:<p role="status">先填写服务器与角色并保存，就可以使用离线笔记，不必先连接游戏。</p>:
    <form onSubmit={e=>{e.preventDefault();void action('configure');}}><fieldset disabled={busy||opening}>
      {tab==='connection'&&<>
        <label>服务器地址<input required value={fields.address} onChange={field('address')} placeholder="mc.example.com:25565" maxLength={300}/></label>
        <div className="mc-setup-row"><label>登录方式<select value={fields.auth} onChange={field('auth')}><option value="offline">离线身份</option><option value="microsoft">微软正版</option></select></label><label>{fields.auth==='microsoft'?'正版账号标识':'游戏角色名'}<input required value={fields.username} onChange={field('username')} maxLength={fields.auth==='microsoft'?254:16} autoComplete="off" placeholder="游戏账号，与角色显示名分开"/></label></div>
        <label>第一次想让它做什么 <small>留空则先进入游戏</small><textarea value={fields.goal} onChange={field('goal')} rows={2} maxLength={3000}/></label>
        <details><summary>协议与服务器登录密码</summary><label>Java 协议版本 <small>默认自动识别服务器</small><input value={fields.version} onChange={field('version')} placeholder="auto，例如 1.21.11" maxLength={32}/></label>
          <label>服务器 /login 密码 <small>普通服务器留空</small><input type="password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={128} autoComplete="current-password" placeholder={state.fields?.hasLoginPassword?'已保存，留空沿用':'仅明确要求 /login 时填写'}/></label><small>未配置时不发送登录或注册命令。密码仅保存到当前 profile 的私有文件。</small>
          <p className="mc-setup-footnote"><a href="https://github.com/jcs130/dsh-minecraft-agent/blob/main/docs/qiandengji-invitation.md" target="_blank" rel="noopener noreferrer">可选：千灯纪邀请接入</a></p></details>
      </>}
      {tab==='perception'&&<>
        <label className="mc-toggle"><input type="checkbox" checked={fields.listenPublicChat} onChange={field('listenPublicChat')}/><span><strong>接收公屏聊天并判断是否回应</strong><small>默认开启。Agent 自行判断相关性，可在公屏 @人交流；关闭后仍会接收点名、私聊和危险消息。</small></span></label>
        <label className="mc-toggle"><input type="checkbox" checked={fields.mineralVision} onChange={field('mineralVision')}/><span><strong>矿物透视查询</strong><small>默认关闭。开启仅允许查询已加载、32 格内的遮挡矿物；不改变画面，也不放宽行动权限。关闭时依靠实际发现与笔记。</small></span></label>
        <label className="mc-toggle"><input type="checkbox" checked={fields.viewerEnabled} onChange={field('viewerEnabled')}/><span><strong>启用网页游戏画面</strong><small>关闭后仍可连接、执行任务并查看决策。</small></span></label>
        <p className="mc-setup-footnote">进入画面后，在「画质与特效」中分别关闭粒子、波纹／光环／技能提示、雨雪和动态阴影；即时生效并保存在当前浏览器。</p>
        <label>游戏工具集<select value={fields.toolProfile} onChange={field('toolProfile')}><option value="lean">简洁目录 · 按需读取帮助</option><option value="full">完整目录</option></select></label><p className="mc-setup-footnote">实体视线、未加载区域和身体动作的安全检查保持生效。矿透开关不提供完整矿脉真值。</p>
      </>}
      {tab==='persona'&&<>
        <label>角色预设</label><div className="mc-preset-grid"><button type="button" aria-pressed={fields.personaPreset==='custom'} onClick={()=>choose('custom')}>自定义</button>{state.personaPresets?.map((p:any)=><button key={p.id} type="button" title={p.description} aria-pressed={fields.personaPreset===p.id} onClick={()=>choose(p.id)}>{p.name}</button>)}</div>
        <label>显示名称<input value={fields.name} onChange={field('name')} placeholder="默认使用游戏角色名" maxLength={80}/></label>
        <label>性格与说话方式<textarea value={fields.personality} onChange={field('personality')} rows={5} maxLength={12000} placeholder="例如：好奇、谨慎，喜欢记录发现，习惯简短交流。"/></label>
        <label>背景故事<textarea value={fields.backstory} onChange={field('backstory')} rows={3} maxLength={12000}/><small>角色设定不代表已经发生的游戏经历，也不授予技能或权限。</small></label>
        <label>初始记忆与偏好<textarea value={fields.initialMemory} onChange={field('initialMemory')} rows={3} maxLength={6000} placeholder="例如：喜欢探索洞穴；遇到新矿点要记下来。"/><small>这是主人提供的背景记忆；矿点、路线等现场记录请放到服务器笔记。</small></label>
        <div className="mc-skin-row">{preview&&<img className="mc-skin-preview" src={preview} alt="所选 PNG 皮肤纹理"/>}<div><label>上传角色皮肤<input type="file" accept="image/png" onChange={upload}/><small>64×64 或 64×32 PNG，最大 256 KiB。</small></label><label>手臂模型<select value={fields.skinModel} onChange={field('skinModel')}><option value="classic">宽臂</option><option value="slim">细臂</option></select></label><label className="mc-toggle"><input type="checkbox" checked={fields.useLocalSkin} onChange={field('useLocalSkin')}/><span>使用本地预览皮肤</span></label></div></div>
        <small>本地皮肤只影响本人网页画面；其他玩家所见由服务器或正版账号皮肤决定，不自动发送换肤命令。</small>
        <label className="mc-toggle"><input type="checkbox" checked={fields.serverSkins!==false} onChange={field('serverSkins')}/><span><strong>同步服务端玩家皮肤</strong><small>默认开启。读取原版玩家资料，按 UUID 同步皮肤和手臂模型；本人本地皮肤优先。离线服没有提供皮肤资料时使用默认外观，不凭名字猜测。</small></span></label>
      </>}
      {tab==='plugins'&&<>
        <label>DSH 能力预设<select value={fields.dshPreset} onChange={field('dshPreset')}><option value="">仅 Minecraft 能力</option>{state.dshPresets?.map((p:any)=><option key={p.id} value={p.id} disabled={p.broken}>{p.name}{p.broken?'（不可用）':''}</option>)}</select></label>
        <p>复用已安装的记忆、搜索等 DSH 插件：先在 DSH 中组合成 Agent 能力预设，再在这里选择。</p><small>仅列出当前 DSH 已声明的预设，不安装插件，不修改全局配置。</small>
        {state.fields?.hasSession&&fields.dshPreset!==state.fields.dshPreset&&<label className="mc-toggle"><input type="checkbox" checked={fields.newSession} onChange={field('newSession')}/><span>为新的能力预设新建会话<small>保留原会话、同一角色与游戏笔记；新会话不自动重放旧任务。</small></span></label>}
        {state.dshPresets?.find((p:any)=>p.id===fields.dshPreset)?.description&&<p>{state.dshPresets.find((p:any)=>p.id===fields.dshPreset).description}</p>}
        <label style={{marginTop:20}}>内置服务器笔记检索<select value={fields.notebookMode} onChange={field('notebookMode')}><option value="local-vector">离线 CPU 词元向量 + 关键词</option><option value="local">仅关键词</option><option value="vector">自定义 embeddings 语义向量</option></select><small>本地笔记始终保留。内置 CPU 向量不下载模型，计算词元相似度，不冒充神经语义模型。</small></label>
        {fields.notebookMode==='vector'&&<><label>Embeddings 完整地址<input value={fields.embeddingEndpoint} onChange={field('embeddingEndpoint')} maxLength={1000} placeholder="http://127.0.0.1:端口/v1/embeddings"/></label><label>向量模型<input value={fields.embeddingModel} onChange={field('embeddingModel')} maxLength={200}/></label><label>密钥环境变量名<input value={fields.embeddingKeyEnv} onChange={field('embeddingKeyEnv')} maxLength={120} placeholder="可留空；不填写密钥本身"/></label><small>仅在显式记录、同步和查询笔记时调用该服务；故障回退关键词并报告。</small></>}
      </>}
    </fieldset>{!opening&&<div className="mc-setup-actions"><button type="button" disabled={busy} onClick={()=>action('save')}>仅保存配置</button><button className="mc-setup-connect" type="submit" disabled={busy||!state.model}>{busy?'处理中…':'保存并连接游戏'}</button></div>}</form>}
    {(error||state.error)&&<p className="mc-setup-error" role="alert">{error||state.error}</p>}{notice&&<p role="status">{notice}</p>}<p className="mc-setup-footnote">凭据留在本机。普通聊天默认公屏；实际入服以认证和世界就绪为准。</p>
  </div>;
}
const CSS=`.mc-first-run{max-width:780px;margin:auto;padding:26px 28px;color:#dcebe5;font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif}.mc-first-run *{box-sizing:border-box}.mc-first-run h1{margin:5px 0 8px;font-size:23px}.mc-first-run p{color:#aab9b0;margin:8px 0 16px}.mc-first-run label{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px;margin-bottom:14px;font-size:12px}.mc-first-run input,.mc-first-run select,.mc-first-run textarea{width:100%;min-width:0;border:1px solid #40564a;border-radius:7px;padding:8px 10px;background:#18231d;color:#e6f0e9;font:inherit}.mc-first-run :focus-visible{outline:2px solid #91c6a7;outline-offset:2px}.mc-first-run small{display:block;font-size:11px;color:#96aa9e;font-weight:normal}.mc-first-run button{border:1px solid #40564a;border-radius:7px;padding:7px 11px;background:#1d2b23;color:#dcebe5;font:inherit;cursor:pointer}.mc-first-run button:disabled{opacity:.5;cursor:default}.mc-first-run button[aria-pressed=true]{background:#315b46;border-color:#91c6a7}.mc-first-run fieldset{margin:0;padding:0;border:0;min-width:0}.mc-setup-heading,.mc-setup-row,.mc-setup-actions,.mc-skin-row{display:flex;gap:14px;align-items:flex-start}.mc-setup-heading{justify-content:space-between;align-items:center}.mc-setup-eyebrow{font-size:10px;letter-spacing:2px;color:#91c6a7}.mc-setup-model{border-left:3px solid #91c6a7;background:#18231d;border-radius:6px;padding:10px 13px;margin:16px 0;display:flex;flex-direction:column;overflow-wrap:anywhere}.mc-setup-model>span{font-size:10px;color:#91c6a7}.mc-setup-tabs{display:flex;gap:5px;flex-wrap:wrap;padding:0 0 16px;margin-bottom:8px;border-bottom:1px solid #35463b}.mc-setup-tabs button{font-size:12px;flex:1;white-space:nowrap}.mc-first-run .mc-toggle{flex-direction:row;align-items:flex-start;gap:10px;border:1px solid #35463b;padding:12px;border-radius:8px}.mc-first-run .mc-toggle input{width:16px;height:16px;flex:none;margin-top:3px}.mc-preset-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}.mc-skin-preview{width:112px;height:112px;object-fit:contain;image-rendering:pixelated;border:1px solid #40564a;background:#27342b}.mc-skin-row>div{flex:1;min-width:0}.mc-first-run details{border-top:1px solid #35463b;padding:10px 0 15px}.mc-first-run summary{cursor:pointer;margin-bottom:12px;font-size:12px}.mc-setup-actions{margin-top:20px;align-items:stretch}.mc-setup-actions button{flex:1}.mc-first-run .mc-setup-connect{background:#9bd0af;color:#14261b;font-weight:600}.mc-first-run .mc-setup-footnote{font-size:10px;margin:12px 0;color:#91a89a}.mc-setup-footnote a{color:#a7dbbd}.mc-first-run .mc-setup-error{color:#f1b6ac}.mc-setup-opening{padding:12px;border:1px solid #40564a;border-radius:8px;margin-bottom:16px}.mc-setup-opening button{display:block;margin-top:8px}@media(max-width:520px){.mc-first-run{padding:20px 14px}.mc-setup-row,.mc-setup-heading{flex-direction:column;gap:0}.mc-setup-tabs button{flex:1 0 30%}.mc-first-run h1{font-size:21px}.mc-skin-preview{width:80px;height:80px}.mc-setup-actions{flex-direction:column;gap:8px}}`;
