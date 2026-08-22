/**
 * dsh-minecraft-agent 客户端插件（browser 半）。
 *
 * 阶段 2（2026-08-21）：控制面板内聚化。废弃独立 HTTP iframe（server 半 mc-panel
 * 已删 :3200 createServer），改走 dsh 官方 ctx.connection RPC：
 *   - 在 conversation.view 槽位注册「MC面板」tab（与「对话」「轨迹」并列）；
 *   - 视图内 React 直渲染完整 dashboard（不再 iframe 套独立端口）；
 *   - 数据经 `ctx.connection.rpc.call('/mc-panel', 'snapshot', …)` 取 PanelPayload；
 *   - 服务器地址覆盖/复位经 `connection.set` / `connection.reset` 端点；
 *   - 截图二进制走 `/mc-panel/shot/<file>`（同一 dsh web 服务器路由，非独立端口）。
 *
 * 作用域收窄（仅 Minecraft 客户端项目会话可见）：conversation.view 是全局槽位，
 * 官方无 per-session 过滤能力，故订阅 sessions.list，仅当当前会话 cwd 落在
 * scratch-plugin 目录时才 register/卸载 tab。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// type-only：把 `conversation.view` 的 SlotMap 声明（ui-conversation）拉进本程序。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useEffect, useRef, useState } from 'react'

/** view 依赖：slots（注册）+ sessions（判作用域）+ connection（RPC 取数）。 */
export const inject = ['slots', 'sessions', 'connection']

/** Minecraft 客户端项目工作区目录名（穿越者插件工程目录 `scratch-plugin`）。 */
const MC_PROJECT_DIR_NAME = 'scratch-plugin'

function cwdInMcProject(cwd: string | undefined): boolean {
  if (!cwd) return false
  const normalized = cwd.replace(/[\\/]+$/, '')
  const segments = normalized.split(/[\\/]/)
  return segments[segments.length - 1] === MC_PROJECT_DIR_NAME
}

// ── RPC 形状（结构对齐 dsh-client-connection ClientConnectionRpc.call）──────
interface PanelRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<
    { ok: true; value: unknown } | { ok: false; error: { message?: string } }
  >
}

// ── data shapes（tolerant，与 server 半 PanelPayload 对齐）───────────────────
interface Payload {
  username: string
  status: {
    updatedAt?: string
    bot?: {
      username?: string
      personaName?: string
      viewerPort?: number
      position?: { x: number; y: number; z: number } | null
      yaw?: number | null
      health?: number
      food?: number
      sleeping?: boolean
      heldItem?: string | null
      inventory?: Array<{ name: string; count: number }>
    }
    context?: { cards?: Array<{ id: string; remain: number }> }
    recentSteps?: Array<{ ts?: string; step?: number; thought?: string; goal?: string; tool?: string; outcome?: string }>
  } | null
  online: boolean
  archive: { name?: string; epithet?: string; source?: string } | null
  mystic: { innateSkill?: string; level?: number } | null
  wiki: { total: number; cards: Array<{ topic: string; source: string; ts: number; content: string }> }
  memory: {
    base?: { x: number; y: number; z: number }
    publicChest?: { x: number; y: number; z: number }
    resourcePoints?: Record<string, Array<{ x: number; y?: number; z: number }>>
    currentGoal?: string
  } | null
  defects: Array<{ file: string; tool: string; count?: number; lastSample?: string; lastAt?: string }>
  latestShot: string | null
  uptimeSec: number
  topo: {
    updatedAt?: string
    r?: number
    cx?: number
    cy?: number
    cz?: number
    yaw?: number | null
    cells?: string
    heights?: number[]
    entities?: Array<{ name: string; dx: number; dz: number }>
  } | null
  events: Array<{ ts: string; text: string; kill: boolean }>
  kills: { recent: number; items: Array<{ ts: string; text: string }> }
  connection: {
    override: { host?: string; port?: number } | null
    runtime: { host: string; port: number; connected: boolean; source?: 'override' | 'default'; updatedAt: string } | null
  }
}

// ── helpers（自旧 dashboardHtml 逐字移植）───────────────────────────────────
function hhmmss(ts?: string): string {
  if (!ts) return ''
  try { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) } catch { return '' }
}
function fmtUptime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}小时${m}分` : `${m}分${s % 60}秒`
}
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.round(((n >> 16) & 255) * (1 + f)))
  const g = Math.min(255, Math.round(((n >> 8) & 255) * (1 + f)))
  const b = Math.min(255, Math.round((n & 255) * (1 + f)))
  return `rgb(${r},${g},${b})`
}

function drawTopo(c: HTMLCanvasElement, p: Payload | null, setSub: (s: string) => void): void {
  const g = c.getContext('2d')
  if (!g) return
  g.clearRect(0, 0, c.width, c.height)
  const m = p?.topo ?? null
  if (!m || !m.cells) { setSub('等待地形数据…'); return }
  const R = m.r || 16
  const N = 2 * R + 1
  const SZ = Math.floor(c.width / N)
  const COL: Record<string, string> = {
    g: '#4a7c3f', d: '#7a5b3a', '#': '#6e6e6e', s: '#d9c07a', '~': '#3a6ea5', L: '#e07020',
    w: '#8a6236', l: '#3a6b35', c: '#8f8f8f', o: '#f0c94a', T: '#ffcc44', b: '#e0564f',
    C: '#c39a6b', F: '#d9a03f', G: '#9fc6e8', '?': '#556070', '.': '#10141b',
  }
  const hs = m.heights || []
  for (let i = 0; i < m.cells.length && i < N * N; i++) {
    const ch = m.cells[i]
    const h = hs[i] || 0
    const base = COL[ch] || COL['?']
    g.fillStyle = shade(base, Math.max(-0.4, Math.min(0.4, h * 0.06)))
    g.fillRect((i % N) * SZ, Math.floor(i / N) * SZ, SZ, SZ)
  }
  // 资源点叠加（绝对坐标 → 相对玩家中心；超出 33×33 窗口的不画）
  const cx = m.cx ?? 0
  const cz = m.cz ?? 0
  const mem = p?.memory ?? null
  const RCOL: Record<string, string> = {
    base: '#f5d76e', publicChest: '#c39a6b', coal_ore: '#5d6d7e', iron_ore: '#dfe4ea',
    cobblestone: '#aab7b8', oak_log: '#52be80', spruce_log: '#1e8449',
  }
  const drawPt = (x: number, z: number, color: string, r: number) => {
    const dx = x - cx
    const dz = z - cz
    if (Math.abs(dx) > R || Math.abs(dz) > R) return
    g.fillStyle = color
    g.beginPath(); g.arc((dx + R) * SZ + SZ / 2, (dz + R) * SZ + SZ / 2, r, 0, 7); g.fill()
    g.strokeStyle = '#0b0d10'; g.lineWidth = 1; g.stroke()
  }
  if (mem?.base) drawPt(mem.base.x, mem.base.z, RCOL.base, 4)
  if (mem?.publicChest) drawPt(mem.publicChest.x, mem.publicChest.z, RCOL.publicChest, 4)
  Object.keys(mem?.resourcePoints || {}).forEach((k) => {
    ;(mem?.resourcePoints?.[k] || []).forEach((q) => drawPt(q.x, q.z, RCOL[k] || '#889', 2.5))
  })
  ;(m.entities || []).forEach((e) => {
    const px = (e.dx + R) * SZ + SZ / 2
    const pz = (e.dz + R) * SZ + SZ / 2
    const isP = /player/.test(e.name)
    g.fillStyle = isP ? '#4fd8ff' : '#ff5a5a'
    g.beginPath(); g.arc(px, pz, 3, 0, 7); g.fill()
    if (isP) { g.fillStyle = '#bfeaff'; g.font = '10px sans-serif'; g.fillText(e.name.replace('(player)', ''), px + 5, pz + 3) }
  })
  const mx = R * SZ + SZ / 2
  const mz = R * SZ + SZ / 2
  const yaw = m.yaw || 0
  const ax = -Math.sin(yaw)
  const az = Math.cos(yaw)
  g.fillStyle = '#fff'; g.beginPath(); g.arc(mx, mz, 4, 0, 7); g.fill()
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(mx, mz); g.lineTo(mx + ax * 12, mz + az * 12); g.stroke(); g.lineWidth = 1
  g.fillStyle = '#8a93a3'; g.font = '11px sans-serif'; g.fillText('N ↑', 6, 14)
  // 资源点图例（右上角）
  const legend: Array<[string, string]> = [['#f5d76e', '基地'], ['#c39a6b', '公共箱'], ['#5d6d7e', '矿'], ['#52be80', '木']]
  g.font = '10px sans-serif'
  legend.forEach(([col, lab], i) => {
    const ly = 12 + i * 13
    g.fillStyle = col; g.fillRect(c.width - 62, ly - 8, 8, 8)
    g.fillStyle = '#8a93a3'; g.fillText(lab, c.width - 50, ly)
  })
  setSub(`中心 ${m.cx != null ? '(' + m.cx + ',' + m.cy + ',' + m.cz + ')' : '—'} · ${(m.entities || []).length} 实体 · ${hhmmss(m.updatedAt)}`)
}

// ── scoped CSS（旧 dashboardHtml 样式，全部收进 .mcp 命名空间防全局泄漏）────
const CSS = `
.mcp{--bg:#0f1115;--card:#1a1d24;--line:#262a33;--fg:#d7dce4;--dim:#8a93a3;--acc:#4f8cff;--ok:#3fb96f;--bad:#e0564f;--warn:#d9a03f;background:var(--bg);color:var(--fg);font:14px/1.5 "Segoe UI",system-ui,"Microsoft YaHei",sans-serif;height:100%;overflow:auto}
.mcp *{box-sizing:border-box}
.mcp a{color:var(--acc);text-decoration:none}
.mcp .wrap{max-width:1280px;margin:0 auto;padding:14px}
.mcp .top{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;padding:10px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:12px}
.mcp .top h1{font-size:18px;margin:0}.mcp .top .sub{color:var(--dim);font-size:12px}
.mcp .badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--line)}
.mcp .badge.on{color:var(--ok);border-color:var(--ok)}.mcp .badge.off{color:var(--bad);border-color:var(--bad)}
.mcp .grid{display:grid;grid-template-columns:1fr 340px;gap:12px}
@media(max-width:900px){.mcp .grid{grid-template-columns:1fr}}
.mcp .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px}
.mcp .card h2{font-size:13px;color:var(--dim);margin:0 0 8px;font-weight:600;letter-spacing:.05em}
.mcp .viewer{position:relative;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden}
.mcp .viewer iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.mcp .fs{position:absolute;right:8px;top:8px;background:#0009;color:#fff;border:0;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px}
.mcp .shotwrap{position:relative}.mcp .shotwrap img{width:100%;border-radius:8px;display:block;background:#000}
.mcp .vrow{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:13px}
.mcp .bar{flex:1;height:9px;background:#0b0d10;border-radius:6px;overflow:hidden}.mcp .bar i{display:block;height:100%}
.mcp .hp i{background:linear-gradient(90deg,#c0392b,#e0564f)}.mcp .fd i{background:linear-gradient(90deg,#b9770e,#d9a03f)}
.mcp .steps{max-height:520px;overflow:auto;display:flex;flex-direction:column;gap:8px}
.mcp .step{border-left:3px solid var(--acc);padding:6px 10px;background:#141821;border-radius:0 8px 8px 0}
.mcp .step.err{border-left-color:var(--bad)}
.mcp .step .meta{color:var(--dim);font-size:11px;display:flex;gap:8px;flex-wrap:wrap}
.mcp .step .th{margin:3px 0}.mcp .step .out{font-size:12px;color:#aab3c2;word-break:break-all}
.mcp .chips{display:flex;flex-wrap:wrap;gap:6px}.mcp .chip{background:#141821;border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:12px}
.mcp .item{font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}.mcp .item:last-child{border-bottom:0}
.mcp .item .t{color:var(--dim);font-size:11px}
.mcp .bottom{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:1000px){.mcp .bottom{grid-template-columns:1fr}}
.mcp canvas{width:100%;border-radius:8px;background:#0b0d10}
.mcp .empty{color:var(--dim);font-size:12px;padding:6px 0}
.mcp .vtab{font-size:11px;padding:2px 8px;border:1px solid #2a3346;border-radius:9px;background:transparent;color:var(--dim);cursor:pointer}
.mcp .vtab:hover{color:#fff}
.mcp .conn{background:#141821;border:1px solid var(--line);border-radius:6px;color:var(--fg);padding:4px 8px;font-size:13px;flex:1;min-width:0}
.mcp .btn{background:var(--acc);border:0;border-radius:6px;color:#fff;padding:4px 12px;font-size:12px;cursor:pointer}
.mcp .btn:hover{filter:brightness(1.15)}
.mcp .btn.ghost{background:transparent;border:1px solid var(--line);color:var(--dim)}
`

const VTABS = [
  { id: '3', label: '轨道' },
  { id: 'smooth', label: '第一人称' },
  { id: 'map', label: '俯视地图' },
]

function McPanelView({ rpc }: { rpc: PanelRpc | undefined }) {
  const [p, setP] = useState<Payload | null>(null)
  const [pv, setPv] = useState('3')
  const [viewerSrc, setViewerSrc] = useState('about:blank')
  const [shotSrc, setShotSrc] = useState<string | null>(null)
  const [topoSub, setTopoSub] = useState('等待地形数据…')
  const [connHost, setConnHost] = useState('')
  const [connPort, setConnPort] = useState('')
  const [connEdited, setConnEdited] = useState(false)
  const [connMsg, setConnMsg] = useState('')

  const lastShotRef = useRef<string | null>(null)
  const topoRef = useRef<HTMLCanvasElement | null>(null)
  const viewerMapRef = useRef<HTMLCanvasElement | null>(null)
  const vwrapRef = useRef<HTMLDivElement | null>(null)

  // 轮询 snapshot（3s）
  useEffect(() => {
    if (!rpc) { setP(null); return }
    let alive = true
    const tick = async () => {
      try {
        const res = await rpc.call('/mc-panel', 'snapshot', {})
        if (alive && res.ok) setP(res.value as Payload)
      } catch { /* 瞬时失败忽略，下轮重试 */ }
    }
    void tick()
    const t = setInterval(tick, 3000)
    return () => { alive = false; clearInterval(t) }
  }, [rpc])

  // 两个 canvas 重绘（统一地图：「俯视地图」tab 大图 + 侧栏小图，均叠加资源点）
  useEffect(() => {
    if (topoRef.current) drawTopo(topoRef.current, p, setTopoSub)
    if (viewerMapRef.current) drawTopo(viewerMapRef.current, p, () => {})
  }, [p, pv])

  // 截图仅在 latestShot 变化时更新（避免每 3s 重复拉图）
  useEffect(() => {
    const ls = p?.latestShot ?? null
    if (ls && ls !== lastShotRef.current) {
      lastShotRef.current = ls
      setShotSrc('/mc-panel/shot/' + encodeURIComponent(ls) + '?t=' + Date.now())
    } else if (!ls) {
      lastShotRef.current = null
      setShotSrc(null)
    }
  }, [p?.latestShot])

  // 3D 视角 iframe：viewer 是双端口架构（viewerPort=第三人称，viewerPort+100=第一人称），
  // firstPerson 由启动端口决定、不读 URL 参数，故按 pv 切端口而非传 ?pv=。
  const viewerPort = p?.status?.bot?.viewerPort
  useEffect(() => {
    if (!viewerPort) return
    const port = pv === 'smooth' ? viewerPort + 100 : viewerPort
    setViewerSrc(`http://${location.hostname}:${port}/`)
  }, [viewerPort, pv])

  // 连接配置输入框：未编辑时跟随 runtime 上报值
  const rtHost = p?.connection?.runtime?.host
  const rtPort = p?.connection?.runtime?.port
  useEffect(() => {
    if (connEdited) return
    if (rtHost) setConnHost(rtHost)
    setConnPort(rtPort ? String(rtPort) : '')
  }, [rtHost, rtPort, connEdited])

  const onSaveConn = async () => {
    if (!rpc) return
    setConnMsg('保存中…')
    const body: { host: string; port?: number } = { host: connHost.trim() }
    const pp = connPort.trim()
    if (pp) body.port = parseInt(pp, 10)
    try {
      const res = await rpc.call('/mc-panel', 'connection.set', body)
      setConnMsg(res.ok ? '已保存，bot 重连中（约 2-5 秒）' : '失败：' + (res.error.message || '未知错误'))
    } catch (e) {
      setConnMsg('请求失败：' + String(e))
    }
  }
  const onResetConn = async () => {
    if (!rpc) return
    setConnMsg('恢复中…')
    setConnEdited(false)
    try {
      const res = await rpc.call('/mc-panel', 'connection.reset', {})
      setConnMsg(res.ok ? '已恢复配置默认（bot 重连中）' : '失败')
    } catch (e) {
      setConnMsg('请求失败：' + String(e))
    }
  }

  const fs = () => {
    const w = vwrapRef.current
    if (!w) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void w.requestFullscreen?.()
  }

  const st = p?.status?.bot ?? null
  const titleName = p?.archive?.name || st?.personaName || p?.username || '未知穿越者'
  const subText = (p?.archive?.epithet ? p.archive.epithet + ' · ' : '') + (p?.username || '') + (p?.archive?.source ? ' · ' + p.archive.source : '')
  const hp = st?.health ?? 0
  const fd = st?.food ?? 0
  const pos = st?.position
  const yaw = st?.yaw ?? 0
  const dirs = ['南', '西', '北', '东']
  const di = Math.round((((yaw * 180) / Math.PI + 360) % 360) / 90) % 4
  const goal = (p?.memory?.currentGoal) || (p?.status?.recentSteps?.length ? p.status.recentSteps[p.status.recentSteps.length - 1].goal : '—')
  const cards = p?.status?.context?.cards ?? []
  const steps = (p?.status?.recentSteps ?? []).slice(-30).reverse()
  const rt = p?.connection?.runtime ?? null
  const cAge = rt ? Date.now() - new Date(rt.updatedAt).getTime() : 0
  const inv = st?.inventory ?? []
  const agg: Record<string, number> = {}
  inv.forEach((i) => { agg[i.name] = (agg[i.name] || 0) + i.count })
  const invKeys = Object.keys(agg).sort((a, b) => agg[b] - agg[a])

  return (
    <div className="mcp">
      <style>{CSS}</style>
      <div className="wrap">
        <div className="top">
          <h1>⚔ {titleName}</h1>
          <span className="sub">{subText}</span>
          <span style={{ flex: 1 }} />
          <span className={'badge ' + (p?.online ? 'on' : 'off')}>{p?.online ? '🟢 在线' : '🔴 失联/离线'}</span>
          <span className="badge">{p?.mystic?.level != null ? 'Lv.' + p.mystic.level : 'Lv.—'}</span>
          <span className="badge">{p?.mystic?.innateSkill ? '天赋「' + p.mystic.innateSkill + '」' : '天赋未定'}</span>
          <span className="badge">{p?.kills?.recent ? '⚔ 近期击杀 ' + p.kills.recent : '⚔ 0'}</span>
        </div>

        <div className="grid">
          <div>
            <div className="card">
              <h2>
                游戏视角
                <span style={{ float: 'right' }}>
                  {VTABS.map((t) => (
                    <button
                      key={t.id}
                      className="vtab"
                      onClick={() => setPv(t.id)}
                      style={pv === t.id ? { background: 'var(--acc)', color: '#0d1117' } : undefined}
                    >
                      {t.label}
                    </button>
                  ))}
                </span>
              </h2>
              <div className="viewer" ref={vwrapRef}>
                {pv === 'map' ? (
                  <canvas ref={viewerMapRef} width={512} height={512} style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', height: '100%', aspectRatio: '1 / 1' }} />
                ) : (
                  <iframe src={viewerSrc} title="3D 视角" />
                )}
                <button className="fs" onClick={fs}>⛶ 全屏</button>
              </div>
            </div>
            <div className="card">
              <h2>最近所见（agent 截图）</h2>
              <div className="shotwrap">
                {shotSrc ? <img src={shotSrc} alt="截图" /> : <div className="empty">暂无截图</div>}
              </div>
            </div>
          </div>

          <div>
            <div className="card">
              <h2>服务器连接（页面可配）</h2>
              <div className="vrow">
                {rt ? (
                  <>
                    生效 <b>{rt.host}:{rt.port}</b> · {rt.source === 'override' ? '页面设置' : '配置默认'} ·{' '}
                    <span className={'badge ' + (rt.connected ? 'on' : 'off')}>
                      {rt.connected ? '已连接' : cAge < 30000 ? '重连中…' : '未连接'}
                    </span>
                  </>
                ) : (
                  <span className="empty">等待 bot 上报连接状态…</span>
                )}
              </div>
              <div className="vrow">
                <input
                  className="conn"
                  placeholder="服务器地址（IP/域名）"
                  spellCheck={false}
                  value={connHost}
                  onChange={(e) => { setConnEdited(true); setConnHost(e.target.value) }}
                />
                <input
                  className="conn"
                  placeholder="端口"
                  inputMode="numeric"
                  style={{ width: 76, flex: 'none' }}
                  value={connPort}
                  onChange={(e) => { setConnEdited(true); setConnPort(e.target.value) }}
                />
              </div>
              <div className="vrow">
                <button className="btn" onClick={() => void onSaveConn()}>保存并重连</button>
                <button className="btn ghost" onClick={() => void onResetConn()}>恢复默认</button>
                <span className="sub" style={{ fontSize: 11 }}>{connMsg}</span>
              </div>
              <div className="sub" style={{ fontSize: 11, color: 'var(--dim)' }}>改动约 2-5 秒内自动生效：bot 用新地址重建连接，无需重启</div>
            </div>

            <div className="card">
              <h2>状态</h2>
              {st ? (
                <>
                  <div className="vrow">❤ 生命 <div className="bar hp"><i style={{ width: (hp / 20) * 100 + '%' }} /></div> {hp}/20</div>
                  <div className="vrow">🍗 饱食 <div className="bar fd"><i style={{ width: (fd / 20) * 100 + '%' }} /></div> {fd}/20</div>
                  <div className="vrow">📍 坐标 {pos ? `${pos.x}, ${pos.y}, ${pos.z}` : '—'}</div>
                  <div className="vrow">🧭 朝向 {dirs[di]} · ✋ 手持 {st.heldItem || '空手'}{st.sleeping ? ' · 😴 睡眠中' : ''}</div>
                  <div className="vrow">🎯 目标 {goal}</div>
                  <div className="vrow">⏱ 进程 {fmtUptime(p?.uptimeSec ?? 0)} · 更新 {hhmmss(p?.status?.updatedAt)}</div>
                  <div className="vrow">🧠 上下文提示卡 {cards.length ? cards.map((k) => k.id + '×' + k.remain).join(' ') : '无（按需披露中）'}</div>
                </>
              ) : (
                <div className="empty">暂无状态数据（等待 agent 连接服务器…）</div>
              )}
            </div>

            <div className="card">
              <h2>周围地形（实时俯视 33×33）</h2>
              <canvas ref={topoRef} width={330} height={330} />
              <div className="sub" style={{ color: 'var(--dim)', fontSize: 11, marginTop: 4 }}>{topoSub}</div>
            </div>

            <div className="card">
              <h2>生存知识库</h2>
              {p?.wiki?.total ? (
                <>
                  <div className="item">共 {p.wiki.total} 张知识卡（展示最近 {p.wiki.cards.length} 张）</div>
                  {p.wiki.cards.map((c, i) => (
                    <div className="item" key={i}>
                      <div>{c.topic}</div>
                      <div className="t">{c.source} · {hhmmss(String(c.ts))} · {(c.content || '').slice(0, 80)}…</div>
                    </div>
                  ))}
                </>
              ) : (
                <div className="empty">还没学会任何教训</div>
              )}
            </div>

            <div className="card">
              <h2>缺陷工单</h2>
              {p?.defects?.length ? (
                p.defects.slice(0, 6).map((d, i) => (
                  <div className="item" key={i}>
                    <div>⚒ {d.tool} ×{d.count != null ? d.count : '?'}</div>
                    <div className="t">{d.lastSample || d.lastAt || d.file}</div>
                  </div>
                ))
              ) : (
                <div className="empty">无未决工单，运行健康</div>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <h2>思考与行动流</h2>
          <div className="steps">
            {steps.length ? (
              steps.map((s, i) => {
                const bad = /error|could not|failed|timeout/i.test(s.outcome || '')
                return (
                  <div className={'step' + (bad ? ' err' : '')} key={i}>
                    <div className="meta">#{s.step ?? '?'} · {hhmmss(s.ts)} · ⚒ {s.tool || ''}</div>
                    <div className="th">💭 {s.thought || ''}</div>
                    <div className="meta">🎯 {s.goal || ''}</div>
                    <div className="out">{(s.outcome || '').slice(0, 300)}</div>
                  </div>
                )
              })
            ) : (
              <div className="empty">暂无行动记录</div>
            )}
          </div>
        </div>

        <div className="card">
          <h2>编年史事件流（⚔ 战斗击杀高亮）</h2>
          <div className="steps" style={{ maxHeight: 300 }}>
            {p?.events?.length ? (
              p.events.slice(0, 25).map((e, i) => (
                <div className={'step' + (e.kill ? ' err' : '')} key={i}>
                  <div className="meta">{hhmmss(e.ts)}{e.kill ? ' · ⚔ 战斗' : ''}</div>
                  <div className="out">{e.text.slice(0, 260)}</div>
                </div>
              ))
            ) : (
              <div className="empty">暂无编年史</div>
            )}
          </div>
        </div>

        <div className="bottom">
          <div className="card">
            <h2>背包</h2>
            <div className="chips">
              {invKeys.length ? invKeys.map((k) => <span className="chip" key={k}>{k} ×{agg[k]}</span>) : <div className="empty">背包空空如也</div>}
            </div>
          </div>
          <div className="card">
            <h2>档案</h2>
            {p?.archive ? (
              <>
                <div className="item">名字：{p.archive.name}</div>
                <div className="item">称号：{p.archive.epithet || '—'}</div>
                <div className="item">来自：{p.archive.source || '—'}</div>
                <div className="item">MC 用户名：{p.username}</div>
              </>
            ) : (
              <div className="empty">未注册穿越者档案</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as { rpc?: PanelRpc } | undefined
  const rpc = connection?.rpc

  ctx.slots.inject('conversation.view', () => {
    let disposeEntry: (() => void) | null = null

    const sync = () => {
      const state = ctx.sessions.list.getSnapshot()
      const currentId = state.current
      const current = currentId === undefined ? undefined : state.byId[currentId]
      const inMc = cwdInMcProject(current?.cwd)

      if (inMc && disposeEntry === null) {
        const View = () => <McPanelView rpc={rpc} />
        disposeEntry = ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'mc-panel',
            order: 100,
            label: () => 'MC面板',
          },
          View,
        )
      } else if (!inMc && disposeEntry !== null) {
        disposeEntry()
        disposeEntry = null
      }
    }

    sync()
    const unsubscribe = ctx.sessions.list.subscribe(sync)
    return () => {
      unsubscribe()
      if (disposeEntry !== null) {
        disposeEntry()
        disposeEntry = null
      }
    }
  })
}
