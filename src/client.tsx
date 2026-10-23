/** Native DSH tab; the shared core owns rendering, metrics and game controls. */
import { useEffect, useState } from 'react';
import { DecisionView, Workbench, usePanelSession } from './decision-view';
import {QuickSetupView} from './setup-view';
export { retainPanelSession } from './decision-view';
export const inject = ['slots', 'connection', 'sessions'];
export function localPanelUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}
export function apply(ctx: any) {
  const sessions=ctx.sessions;
  function Dashboard({SessionProvider,renderSlot}: any) {
    const [binding, setBinding] = useState<{sessionId:string;url:string}>();
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    const [setup,setSetup]=useState<any>();
    const session=usePanelSession(sessions,binding?.sessionId);
    useEffect(() => {
      const controller = new AbortController();
      let timer:ReturnType<typeof setTimeout>|undefined;
      let revision = 0;
      const refresh = async () => {
        clearTimeout(timer);
        const currentRevision = ++revision;
        setBinding(undefined);setError('');
        try {
          let result;
          try{result=await ctx.connection.rpc.call('/api','mc-harness/panel-info',{},controller.signal);}catch{}
          if (controller.signal.aborted || currentRevision !== revision) return;
          const value = result?.ok && result.value;
          const url = value && localPanelUrl(value.url);
          if (url && typeof value.sessionId === 'string' && value.sessionId.length > 0) {
            setBinding({sessionId:value.sessionId,url});
            try{const response=await ctx.connection.rpc.call('/api','mc-harness/setup',{action:'state'},controller.signal);
              if(!controller.signal.aborted&&currentRevision===revision&&response.ok)setSetup(response.value);
            }catch{} // Advanced configs do not have the optional first-run service.
          }
          else {
            const response=await ctx.connection.rpc.call('/api','mc-harness/setup',{action:'state'},controller.signal);
            if(controller.signal.aborted||currentRevision!==revision)return;
            if(response.ok){setSetup(response.value);setError('');
              if(['opening','enabled'].includes(response.value.phase))timer=setTimeout(refresh,1500);
            }else setError('Minecraft 面板尚未启用。');
          }
        } catch {
          if (!controller.signal.aborted && currentRevision === revision){setSetup(undefined);setError('Minecraft 面板暂未连接。');}
        }
      };
      void refresh();
      const stop = ctx.on('connection/reset',refresh);
      return () => { controller.abort();clearTimeout(timer);stop(); };
    },[attempt]);
    if (binding && session?.reference) return <SessionProvider session={session.reference}>
      {renderSlot('minecraft.panel',{embeddedComposer:true,onConfigure:setup?.fields?async()=>{
        const result=await ctx.connection.rpc.call('/api','mc-harness/setup',{action:'stop'});
        if(result.ok){setBinding(undefined);setSetup(result.value);}else throw Error('暂时无法确认停止结果。');
      }:undefined})}
    </SessionProvider>;
    if(setup&&!binding)return <div style={{height:'100%',overflow:'auto',background:'#10151b'}}><QuickSetupView state={setup} onAction={async(action,config)=>{
      const result=await ctx.connection.rpc.call('/api','mc-harness/setup',{action,config});
      if(!result.ok)throw Error(result.error?.message||'首次配置暂不可用。');
      setSetup(result.value);setAttempt(value=>value+1);
    }}/></div>;
    return <div style={{height:'100%',boxSizing:'border-box',padding:32,overflow:'auto',background:'#10151b',color:'#dcebe5'}}>
      <h1 style={{fontSize:22,marginTop:0}}>Minecraft 控制台</h1>
      <p role="status">{error || session?.error || (binding?'正在读取 Agent 的原会话…':'正在读取 Minecraft 面板…')}</p>
      {(error || session?.error) && <>
        <p>插件界面已加载。配置并启用 Minecraft Agent 后，这里会显示游戏画面、连接管理、运行指标和实验室。</p>
        <p>请检查插件的 configFile，以及 Agent 配置中的 consolePort。打开此页面不会启动模型或连接游戏。</p>
        <button type="button" onClick={() => setAttempt(value => value + 1)}>重新检查面板</button>{' '}
        <a href="https://github.com/jcs130/dsh-minecraft-agent/blob/main/docs/desktop.md" target="_blank" rel="noopener noreferrer" style={{color:'#98d6b4'}}>查看配置说明</a>
      </>}
    </div>;
  }
  function Panel({sessionId,renderFactorySlot,embeddedComposer=false,onConfigure}: {sessionId:string;renderFactorySlot:any;embeddedComposer?:boolean;onConfigure?:()=>void|Promise<void>}) {
    const [state, setState] = useState<{sessionId:string;url?:string;error?:string}>();
    const [access, setAccess] = useState<{sessionId:string;value?:any;error?:string}>();
    const [querying, setQuerying] = useState(false);
    useEffect(() => {
      const controller = new AbortController();
      let accessTimer: ReturnType<typeof setInterval> | undefined;
      let revision = 0;
      const readAccess = async () => {
        const currentRevision=revision;
        try {
          const status = await ctx.connection.rpc.call('/api','mc-harness/access',{sessionId,action:'state'},controller.signal);
          if (!controller.signal.aborted && currentRevision === revision && status.ok && status.value.sessionId === sessionId) {
            setAccess({sessionId,value:status.value.access});return true;
          }
        } catch { /* Optional server access; never call the remote API from a refresh. */ }
        return false;
      };
      const refresh = async () => {
        const currentRevision=++revision;
        clearInterval(accessTimer);
        setState(undefined);
        setAccess(undefined);
        try {
          const result = await ctx.connection.rpc.call('/api', 'mc-harness/panel', {sessionId}, controller.signal);
          if (controller.signal.aborted || currentRevision !== revision) return;
          const url = result.ok && result.value.sessionId === sessionId && localPanelUrl(result.value.url);
          setState(url ? {sessionId,url} : {sessionId,error:result.ok ? '面板地址不可用。' : result.error.message});
          if (url) {
            // Local snapshot only. Opening tabs never logs in to the website or polls its API.
            const supported=await readAccess();
            if (supported && !controller.signal.aborted && currentRevision === revision) accessTimer=setInterval(readAccess,5000);
          }
        } catch { if (!controller.signal.aborted) setState({sessionId,error:'Minecraft 面板暂不可用，请检查插件配置。'}); }
      };
      void refresh();
      const stop = ctx.on('connection/reset', refresh);
      return () => { controller.abort();clearInterval(accessTimer);stop(); };
    }, [sessionId]);
    const current = state?.sessionId === sessionId ? state : undefined;
    const invitation = access?.sessionId === sessionId ? access : undefined;
    const accessLabel: Record<string,string> = {missing:'未准备身份',identity_saved:'身份已保存',not_created:'尚未激活',
      ready:'建号结果未确认',pending:'等待建号',unknown:'结果未确认',awaiting_game_bridge:'等待建号桥'};
    const query = async () => {
      setQuerying(true);
      try {
        const result = await ctx.connection.rpc.call('/api','mc-harness/access',{sessionId,action:'query'});
        setAccess(result.ok && result.value.sessionId === sessionId ? {sessionId,value:result.value.access}
          : {sessionId,value:invitation?.value,error:'接入状态未确认，保留原身份后重试查询。'});
      } catch { setAccess({sessionId,value:invitation?.value,error:'暂时无法查询；没有重新建号或连接游戏。'}); }
      finally { setQuerying(false); }
    };
    return <div style={{height:'100%',minHeight:320,width:'100%',display:'flex',flexDirection:'column',background:'#10151b',color:'#dcebe5'}}>
      {invitation?.value && <div style={{padding:'10px 14px',borderBottom:'1px solid #314239',fontSize:13}}>
        <strong>千灯纪 · {invitation.value.username ?? '身份待准备'}</strong>{' · '}
        <span>API 建号：{invitation.value.state === 'ready' && invitation.value.gameAccountCreated ? '已就绪' : accessLabel[invitation.value.state] ?? '结果未确认'}</span>{' · '}
        <span>游戏：{invitation.value.gameReady ? '认证及世界已就绪' : '尚未确认就绪'}</span>{' '}
        <button type="button" disabled={querying} onClick={query}>{querying ? '查询中…' : '查询原身份'}</button>{' '}
        <a href="https://mc.kangqiang.site/join" target="_blank" rel="noopener noreferrer" style={{color:'#98d6b4'}}>邀请接入说明</a>
        <div style={{opacity:0.75}}>网站状态核对：{invitation.value.checkedAt ?? '尚未查询'}；查询只核对原请求，进服仍需游戏认证。</div>
        {invitation.error && <div role="status">{invitation.error}</div>}
      </div>}
      {current?.url ? embeddedComposer
        ? <Workbench game={<iframe title="Minecraft · 游戏与运行面板" src={current.url} referrerPolicy="no-referrer" allow="fullscreen" />}
          decision={renderFactorySlot('minecraft.decision',{})} onConfigure={onConfigure} />
        : <><p style={{fontSize:11,margin:'6px 12px',color:'#a4b3ab'}}>使用下方会话输入框；侧栏 Minecraft 可并排查看推理与行动。</p>
          <iframe title="Minecraft · 游戏与运行面板" src={current.url} referrerPolicy="no-referrer" allow="fullscreen" style={{flex:1,minHeight:0,width:'100%',border:0}} /></>
        : <p role="status" style={{padding:24}}>{current?.error ?? '正在读取 Minecraft 面板…'}</p>}
    </div>;
  }
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name:'conversation.view',id:'mc-panel',order:100,label:()=>'Minecraft',
  }, Panel));
  // Root navigation remains visible when DSH hides blank-session views.
  // Both entries render the same shared console; neither creates a body/session.
  ctx.slots.inject('main', () => ctx.slots.register({name:'main',key:'minecraft',children:{'minecraft.panel':{kind:'single',scope:'session'}}}, Dashboard));
  ctx.slots.inject('minecraft.panel',()=>ctx.slots.register({name:'minecraft.panel'},Panel));
  ctx.slots.registerFactory({name:'minecraft.decision',scope:'session'},DecisionView);
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name:'sidebar.panellist',id:'minecraft',order:100,label:()=>'Minecraft',
  }, ({size = 18}: {size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 0v9m-9-4 9 4 9-4m-9 4v9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>));
}
