/** Native DSH tab; the shared core owns rendering, metrics and game controls. */
import { useEffect, useState } from 'react';
export const inject = ['slots', 'connection'];
export function localPanelUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}
export function apply(ctx: any) {
  function Panel({sessionId}: {sessionId:string}) {
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
      {current?.url ? <iframe title="Minecraft · 游戏与运行面板" src={current.url} referrerPolicy="no-referrer"
        allow="fullscreen" style={{width:'100%',flex:1,border:0,minHeight:0}} />
        : <p role="status" style={{padding:24}}>{current?.error ?? '正在读取 Minecraft 面板…'}</p>}
    </div>;
  }
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name:'conversation.view',id:'mc-panel',order:100,label:()=>'Minecraft',
  }, Panel));
}
