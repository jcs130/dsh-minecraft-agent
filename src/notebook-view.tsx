import {useEffect,useState} from 'react';
const blank={kind:'resource',summary:'',content:'',dimension:'overworld',tags:''};
const kinds:any={resource:'矿点与资源',place:'兴趣点／据点',relationship:'人物关系',task:'任务线索',method:'方法',lesson:'经验',note:'其他笔记'};
const sources:any={agent_note:'Agent 笔记',user_report:'主人报告',hypothesis:'推测',runtime_observation:'运行观测'};
const date=(value:any)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'时间未记录';
export function NotebookView({onAction,identity}:{onAction:(action:string,args?:any)=>Promise<any>;identity:string}){
  const [query,setQuery]=useState(''),[dimension,setDimension]=useState('*'),[page,setPage]=useState<any>(),[editing,setEditing]=useState<any>({...blank}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const request=(args:any)=>onAction('notebook',args);
  const load=async(offset=0)=>{setBusy(true);setError('');try{setPage({...await request({action:'search',query,dimension,limit:10,offset}),offset});}catch(e:any){setError(e.message||'笔记暂不可用。');}finally{setBusy(false);}};
  useEffect(()=>{void load();},[identity]);
  const field=(key:string)=>(e:any)=>setEditing((v:any)=>({...v,[key]:e.target.value}));
  const open=async(id:string)=>{setBusy(true);setError('');try{const {entry:p}=await request({action:'get',id});setEditing({id:p.id,revision:p.revision,kind:p.kind,summary:p.summary,content:p.content,dimension:p.dimension??'overworld',tags:p.tags.join(', '),source:p.source,recordedAt:p.recordedAt});}catch(e:any){setError(e.message||'读取失败。');}finally{setBusy(false);}};
  const save=async(e:any)=>{e.preventDefault();setBusy(true);setError('');setNotice('');try{
    const note={kind:editing.kind,summary:editing.summary,content:editing.content,dimension:editing.dimension,tags:editing.tags.split(/[,，]/).map((s:string)=>s.trim()).filter(Boolean),source:{kind:'user_report',speaker:'owner'}};
    await request({action:editing.id?'revise':'remember',...editing.id?{id:editing.id,expectedRevision:editing.revision}:{},...note});
    setNotice('已保存。Agent 可通过 mc_memory 查询；这是历史记录，不是当前现场事实。');setEditing({...blank});await load();
  }catch(e:any){setError(e.message||'保存未确认，请刷新后核对版本。');}finally{setBusy(false);}};
  const archive=async()=>{if(!editing.id)return;setBusy(true);setError('');try{await request({action:'archive',id:editing.id,expectedRevision:editing.revision});setEditing({...blank});await load();setNotice('已归档，原版本仍保留。');}catch(e:any){setError(e.message||'归档未确认。');}finally{setBusy(false);}};
  return <section className="mc-notebook"><style>{CSS}</style><strong>{identity}</strong><p>每个服务器、角色独立保存，维度分开查询。记下坐标、发现时间、来源和未确定之处；挖完或环境变化后更新。</p>
    <div className="mc-setup-row"><label>查找笔记<input value={query} onChange={e=>setQuery(e.target.value)} maxLength={200} placeholder="例如：西山 铁矿、洞口、村庄"/></label><label>查询维度<select value={dimension} onChange={e=>setDimension(e.target.value)}><option value="*">所有维度</option><option value="overworld">主世界</option><option value="the_nether">下界</option><option value="the_end">末地</option></select></label></div>
    <button type="button" disabled={busy} onClick={()=>load()}>查询／刷新</button><span className="mc-note-count">{page?`${page.total} 条历史笔记`:'尚未读取'}</span>
    {page?.retrieval&&<small>{page.retrieval.mode==='local-vector'?'离线 CPU 词元向量与关键词混合':page.retrieval.mode==='vector'?'Embeddings 向量混合':'关键词检索'}{page.retrieval.requested?' · 外部服务降级':''}</small>}
    <div className="mc-note-list">{page?.entries?.map((p:any)=><button type="button" key={p.id} disabled={busy} onClick={()=>open(p.id)}><strong>{p.summary}</strong><small>{kinds[p.kind]??p.kind} · {p.dimension??'维度未注明'} · v{p.revision} · 历史／需复核</small><small>{sources[p.source?.kind]??'来源详见原记录'} · {date(p.recordedAt)}</small></button>)}{page?.total===0&&<p>暂无匹配笔记。可以先记下一处亲自发现的矿点或兴趣点。</p>}</div>
    {page&&<div className="mc-note-pages"><button type="button" disabled={busy||!page.offset} onClick={()=>load(Math.max(0,page.offset-10))}>上一页</button><button type="button" disabled={busy||page.nextOffset==null} onClick={()=>load(page.nextOffset??page.offset)}>下一页</button></div>}
    <form onSubmit={save}><h2>{editing.id?'编辑笔记':'新建笔记'}</h2>{editing.id&&<p className="mc-setup-footnote">原记录：{sources[editing.source?.kind]??'来源未知'} · {date(editing.recordedAt)}。本次修改另存为主人报告，保留旧版本。</p>}<div className="mc-setup-row"><label>类别<select value={editing.kind} onChange={field('kind')}>{Object.entries(kinds).map(([id,label])=><option key={id} value={id}>{label as string}</option>)}</select></label><label>记录维度<input value={editing.dimension} onChange={field('dimension')} maxLength={120} placeholder="overworld 或实际维度 ID"/></label></div>
      <label>标题<input required value={editing.summary} onChange={field('summary')} maxLength={180}/></label><label>记录<textarea required rows={4} value={editing.content} onChange={field('content')} maxLength={6000} placeholder="例如：主世界 (-12,40,35)，10 月 25 日挖开洞壁发现两格铁矿。还没采完，深处数量未知。"/></label>
      <label>标签 <small>逗号分隔，最多 12 个</small><input value={editing.tags} onChange={field('tags')} maxLength={580}/></label><div className="mc-note-pages"><button type="submit" disabled={busy}>保存笔记</button><button type="button" disabled={busy} onClick={()=>{setEditing({...blank});setNotice('');}}>新建／取消编辑</button>{editing.id&&<button type="button" disabled={busy} onClick={archive}>归档</button>}</div>
    </form>{error&&<p role="alert" className="mc-setup-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>;
}
const CSS=`.mc-notebook h2{font-size:15px;margin:22px 0 12px}.mc-note-count{margin-left:12px;color:#96aa9e;font-size:11px}.mc-note-list{display:grid;gap:6px;margin:12px 0}.mc-note-list>button{text-align:left;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}.mc-note-pages{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.mc-notebook>small{margin-top:8px}`;
