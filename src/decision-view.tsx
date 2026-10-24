/** DSH owns the transcript. The Minecraft adapter only places its native Chat view. */
import { useEffect, useState } from 'react';


/** One reference to an existing session, never a session/Agent creation or selection. */
export function retainPanelSession(sessions: any, sessionId: string, ready: (reference: any, error?: string) => void) {
  const controller = new AbortController();
  let reference: any, released = false;
  const release=()=>{if(released)return;released=true;controller.abort();reference?.release();};
  try {
    reference = sessions.retain(sessionId,{source:'minecraftPanel',signal:controller.signal});
    void reference.ready.then(() => {if(!released) ready(reference);},() => {
      if(!released){release();ready(undefined,'无法读取这个 Agent 的会话，请重新检查连接。');}
    });
  } catch { ready(undefined,'这个 Agent 的会话尚未就绪，请重新检查连接。'); }
  return release;
}

export function usePanelSession(sessions: any, sessionId?: string) {
  const [state,setState] = useState<{id:string;reference?:any;error?:string}>();
  useEffect(() => {
    setState(undefined);
    if(sessionId) return retainPanelSession(sessions,sessionId,(reference,error)=>setState({id:sessionId,reference,error}));
  },[sessions,sessionId]);
  return state?.id===sessionId ? state : undefined;
}

function FixedChat({renderSlot}:any){return renderSlot('conversation.session',{view:'chat'});}
export function DecisionView({renderFactorySlot,useSession,useProjection}: any) {
  const session = useSession((value: any)=>value);
  const projection = useProjection('goal');
  const goal = projection?.goal;
  return <div className="mc-decision-view">
    <div className="mc-decision-heading"><div><span className="mc-eyebrow">AGENT ACTIVITY</span><h2>决策与行动</h2></div>
      <span className="mc-live-state">{session.openState==='error'?'会话读取失败':session.running?'会话运行中':'等待下一轮'}</span></div>
    <div className="mc-goal"><span>当前目标</span><p>{goal?.objective || (projection===undefined?'目标信息未提供':'尚未设置目标')}</p>
      {goal?.phase && <small>{({active:'进行中',paused:'已暂停',blocked:'已受阻',complete:'已结束'} as any)[goal.phase]??'状态未知'}</small>}</div>
    <p className="mc-disclosure-note">推理内容仅在模型实际返回时显示，可展开查看；未返回时只显示回答和工具。这里是原会话，不会额外调用模型。</p>
    <div className="mc-transcript">
      {renderFactorySlot('conversation.content',{variant:'embedded',phase:session.openState==='loading'?'settling':'active',hero:false},{slots:{views:FixedChat}})}
    </div>
  </div>;
}

export function Workbench({game,decision,onConfigure,onSettings}: {game:any;decision:any;onConfigure?:()=>void|Promise<void>;onSettings?:()=>void}) {
  const [mode,setMode]=useState('split');
  const [configuring,setConfiguring]=useState(false),[configureError,setConfigureError]=useState('');
  const configure=async()=>{if(configuring||!onConfigure)return;setConfiguring(true);setConfigureError('');
    try{await onConfigure();}catch{setConfigureError('暂时无法确认停止结果，请核对连接后重试。');}finally{setConfiguring(false);}};
  return <div className="mc-agent-workbench" data-mode={mode}>
    <style>{WORKBENCH_CSS}</style>
    <div className="mc-workbench-bar"><div className="mc-view-switch" aria-label="面板布局">
      {[['split','游戏 + 决策'],['game','只看游戏'],['decision','只看决策']].map(([id,label])=>
        <button key={id} type="button" aria-pressed={mode===id} onClick={()=>setMode(id)}>{label}</button>)}
    </div><span className="mc-private-note">本人会话 · 直播时可切换只看游戏</span>{onSettings&&<button className="mc-configure" type="button" onClick={onSettings}>角色与笔记</button>}{onConfigure&&<button className="mc-configure" type="button" disabled={configuring} onClick={configure}>{configuring?'正在停止…':'停止并配置'}</button>}</div>
    {configureError&&<p role="alert" className="mc-configure-error">{configureError}</p>}
    <div className="mc-workbench-content">
      {mode!=='decision'&&<div className="mc-game-seat">{game}</div>}
      {mode!=='game'&&<aside className="mc-decision-seat" aria-label="Agent 决策与行动">{decision}</aside>}
    </div>
  </div>;
}

const WORKBENCH_CSS=`
.mc-configure{border:1px solid #405448;border-radius:6px;background:transparent;color:#b8cbbf;padding:6px 9px;font:12px system-ui;cursor:pointer}.mc-configure:disabled{opacity:.5;cursor:wait}.mc-configure-error{color:#f1b6ac;margin:6px 12px}
.mc-agent-workbench{container-type:inline-size;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:360px;overflow:hidden;background:var(--dsw-alias-bg-base,#10151b);color:var(--dsw-alias-text-primary,#dcebe5);font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif}
.mc-agent-workbench *{box-sizing:border-box}.mc-workbench-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:9px 12px;border-bottom:1px solid #35453d;flex:none}.mc-view-switch{display:flex;gap:5px}.mc-view-switch button{border:1px solid #405448;border-radius:6px;background:transparent;color:inherit;padding:6px 9px;font:inherit;font-size:12px;cursor:pointer}.mc-view-switch button[aria-pressed=true]{background:#263c32;border-color:#85c6a5;color:#b9f1d5}.mc-view-switch button:focus-visible{outline:2px solid #85c6a5;outline-offset:2px}.mc-private-note{margin-left:auto;color:#9eaaa5;font-size:11px}.mc-workbench-content{display:flex;flex:1;min-height:0;min-width:0}.mc-game-seat{flex:1;min-width:0;min-height:0}.mc-game-seat>iframe{height:100%;width:100%;border:0;display:block}.mc-decision-seat{display:flex;flex-direction:column;flex:0 0 38%;min-width:320px;max-width:500px;min-height:0;border-left:1px solid #35453d}.mc-agent-workbench[data-mode=decision] .mc-decision-seat{flex:1;max-width:none;border-left:0}.mc-decision-view{display:flex;flex-direction:column;min-height:0;height:100%;overflow:hidden}.mc-decision-heading{display:flex;align-items:center;gap:8px;padding:15px 15px 8px}.mc-decision-heading h2{font-size:16px;margin:1px 0;font-weight:650}.mc-eyebrow{font-size:9px;letter-spacing:1.4px;color:#8aba9f}.mc-live-state{margin-left:auto;white-space:nowrap;color:#b5d8c4;font-size:11px}.mc-goal{margin:0 15px;padding:9px 11px;border:1px solid #35453d;border-radius:7px;background:#1b2922}.mc-goal>span,.mc-goal small{font-size:10px;color:#a4c3b1}.mc-goal p{margin:3px 0;font-size:12px;overflow-wrap:anywhere;line-height:1.6;max-height:100px;overflow:auto;color:#dcebe5}.mc-disclosure-note{margin:9px 15px;color:#a4b3ab;font-size:10px;line-height:1.6}.mc-transcript{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;padding:0 6px 12px;border-top:1px solid #35453d;--dsh-composer-side-clearance:0px}.mc-transcript>div{min-width:0}.mc-agent-workbench[data-mode=split] .mc-game-seat{flex-basis:62%}
@container(max-width:820px){.mc-workbench-content{flex-direction:column;overflow:auto}.mc-agent-workbench[data-mode=split] .mc-game-seat{flex:1 0 320px;min-height:320px}.mc-agent-workbench[data-mode=split] .mc-decision-seat{flex:1 0 360px;min-height:360px;max-width:none;width:100%;border-left:0;border-top:1px solid #35453d}.mc-private-note{margin-left:0}.mc-workbench-bar{gap:6px}.mc-agent-workbench[data-mode=game] .mc-game-seat{min-height:320px}}
`;
