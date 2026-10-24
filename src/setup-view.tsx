import {useState} from 'react';

export function QuickSetupView({state,onAction}: {state:any;onAction:(action:string,config?:any)=>Promise<void>}) {
  const [fields,setFields]=useState(()=>({address:'',username:'',auth:'offline',version:'auto',name:'',goal:'',...state.fields}));
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const opening=state.phase==='opening'||state.phase==='enabled';
  const field=(key:string)=>(event:any)=>setFields((value:any)=>({...value,[key]:event.target.value}));
  const submit=async(event:any)=>{
    event.preventDefault();if(busy||opening)return;setBusy(true);setError('');
    try{await onAction('configure',{...fields,...password?{loginPassword:password}:{}});}
    catch(e:any){setError(e.message||'配置未能提交，请重试。');}
    finally{setPassword('');setBusy(false);}
  };
  const refreshModel=async()=>{if(busy)return;setBusy(true);setError('');
    try{await onAction('state');}catch{setError('暂时无法读取 DSH 模型配置，请重试。');}finally{setBusy(false);}};
  return <div className="mc-first-run"><style>{CSS}</style>
    <span className="mc-setup-eyebrow">MINECRAFT × DSH</span><h1>让你的 Agent 进入游戏</h1>
    <p>填写服务器与角色，复用 DSH 的模型。连接后在同一页面查看游戏、模型推理与行动回执。</p>
    <div className="mc-setup-model"><span>沿用 DSH 默认模型</span><strong>{state.model?`${state.model.provider} / ${state.model.model}`:'尚未配置，请先在 DSH 选择模型'}</strong><small>使用现有凭据，插件不需要另填 API Key。</small></div>
    {!state.model&&<button type="button" disabled={busy} onClick={refreshModel}>重新读取 DSH 默认模型</button>}
    {opening?<div className="mc-setup-opening" role="status"><strong>{state.phase==='opening'?'正在载入 Agent 和游戏连接…':'Agent 已启用，正在读取面板…'}</strong><p>模型尚未返回内容时不会补写推理。是否真正进服，以连接与账号中的认证和世界就绪状态为准。</p></div>:
    <form onSubmit={submit}>
      <label>服务器地址<input required value={fields.address} onChange={field('address')} placeholder="mc.example.com:25565" autoComplete="off" maxLength={300}/></label>
      <div className="mc-setup-row"><label>登录方式<select value={fields.auth} onChange={field('auth')}><option value="offline">离线身份</option><option value="microsoft">微软正版</option></select></label>
        <label>{fields.auth==='microsoft'?'正版账号标识':'游戏角色名'}<input required value={fields.username} onChange={field('username')} placeholder={fields.auth==='microsoft'?'用于授权缓存的邮箱或标识':'1–16 位字母、数字、下划线'} maxLength={fields.auth==='microsoft'?254:16} autoComplete="off"/></label></div>
      <label>第一次想让它做什么 <small>可留空，先进入游戏</small><textarea value={fields.goal} onChange={field('goal')} rows={2} maxLength={3000} placeholder="例如：熟悉附近环境，寻找安全的落脚处。"/></label>
      <details><summary>可选设置：角色名称、版本与登录服密码</summary>
        <div className="mc-setup-row"><label>显示名称<input value={fields.name} onChange={field('name')} placeholder="默认使用角色名" maxLength={80}/></label>
        <label>Java 协议版本 <small>默认自动识别服务器</small><input value={fields.version} onChange={field('version')} placeholder="auto，例如 1.21.11" maxLength={32}/></label></div>
        <label>服务器 /login 密码 <small>多数服务器不需要，默认不配置</small><input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" maxLength={128} placeholder={state.fields?.hasLoginPassword?'已保存，留空沿用':'仅明确要求 /login 的服务器填写'}/></label>
        <small>未配置时不发送登录或注册命令。填写后仅登录已有角色，密码保存到当前 profile 的私有文件，不回传、不写入会话。</small>
        <p className="mc-setup-footnote">邀请制服务器请先准备已激活的身份。<a href="https://github.com/jcs130/dsh-minecraft-agent/blob/main/docs/qiandengji-invitation.md" target="_blank" rel="noopener noreferrer">可选：千灯纪邀请接入说明</a></p>
      </details>
      {(error||state.error)&&<p className="mc-setup-error" role="alert">{error||state.error}</p>}
      <button className="mc-setup-connect" type="submit" disabled={busy||!state.model}>{busy?'正在保存…':'保存并连接游戏'}</button>
      <p className="mc-setup-footnote">安装和查看面板不调用游戏模型。点击连接才建立身体；填写任务后会按 DSH 配置调用模型。正版账号首次连接需要微软授权。</p>
    </form>}
  </div>;
}
const CSS=`.mc-first-run{max-width:640px;margin:auto;padding:30px 28px;color:#dcebe5;font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif}.mc-first-run *{box-sizing:border-box}.mc-setup-eyebrow{font-size:10px;letter-spacing:2px;color:#91c6a7}.mc-first-run h1{margin:6px 0 8px;font-size:24px}.mc-first-run p{color:#aab9b0;margin:8px 0 18px}.mc-first-run label{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px;margin-bottom:14px;font-size:12px}.mc-first-run input,.mc-first-run select,.mc-first-run textarea{width:100%;min-width:0;border:1px solid #40564a;border-radius:7px;padding:9px 11px;background:#18231d;color:#e6f0e9;font:inherit}.mc-first-run input:focus-visible,.mc-first-run textarea:focus-visible,.mc-first-run select:focus-visible{outline:2px solid #91c6a7;outline-offset:2px}.mc-first-run small{font-size:11px;color:#96aa9e;font-weight:normal}.mc-setup-row{display:flex;gap:14px}.mc-setup-model{border:1px solid #40564a;border-left:3px solid #91c6a7;border-radius:8px;padding:12px 14px;margin:20px 0;display:flex;flex-direction:column;gap:3px;overflow-wrap:anywhere}.mc-setup-model>span{font-size:11px;color:#91c6a7}.mc-setup-model strong{font-size:13px}.mc-first-run details{border-top:1px solid #35463b;padding:10px 0 16px}.mc-first-run summary{cursor:pointer;margin-bottom:12px;font-size:12px;color:#b4c9bc}.mc-setup-connect{width:100%;padding:11px;border:1px solid #a2d6b6;border-radius:7px;background:#9bd0af;color:#14261b;font:600 13px system-ui;cursor:pointer}.mc-setup-connect:disabled{opacity:.45;cursor:wait}.mc-first-run .mc-setup-footnote{font-size:10px;margin:10px 0;color:#91a89a}.mc-setup-footnote a{color:#a7dbbd}.mc-first-run .mc-setup-error{color:#f1b6ac}.mc-setup-opening{padding:20px;border:1px solid #40564a;border-radius:8px}.mc-setup-opening p{font-size:12px;margin-bottom:0}@media(max-width:520px){.mc-first-run{padding:22px 16px}.mc-setup-row{flex-direction:column;gap:0}.mc-first-run h1{font-size:21px}}`;
