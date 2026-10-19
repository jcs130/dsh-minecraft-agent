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
    useEffect(() => {
      const controller = new AbortController();
      const refresh = async () => {
        setState(undefined);
        try {
          const result = await ctx.connection.rpc.call('/api', 'mc-harness/panel', {sessionId}, controller.signal);
          if (controller.signal.aborted) return;
          const url = result.ok && result.value.sessionId === sessionId && localPanelUrl(result.value.url);
          setState(url ? {sessionId,url} : {sessionId,error:result.ok ? '面板地址不可用。' : result.error.message});
        } catch { if (!controller.signal.aborted) setState({sessionId,error:'Minecraft 面板暂不可用，请检查插件配置。'}); }
      };
      void refresh();
      const stop = ctx.on('connection/reset', refresh);
      return () => { controller.abort(); stop(); };
    }, [sessionId]);
    const current = state?.sessionId === sessionId ? state : undefined;
    return <div style={{height:'100%',minHeight:320,width:'100%',display:'flex',flexDirection:'column',background:'#10151b',color:'#dcebe5'}}>
      {current?.url ? <iframe title="Minecraft · 游戏与运行面板" src={current.url} referrerPolicy="no-referrer"
        allow="fullscreen" style={{width:'100%',flex:1,border:0,minHeight:320}} />
        : <p role="status" style={{padding:24}}>{current?.error ?? '正在读取 Minecraft 面板…'}</p>}
    </div>;
  }
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name:'conversation.view',id:'mc-panel',order:100,label:()=>'Minecraft',
  }, Panel));
}
