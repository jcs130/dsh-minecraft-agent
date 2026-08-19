/**
 * mc-panel: per-agent visualization dashboard for transmigrators.
 *
 * A pure read-only observer: serves an HTTP dashboard from the SAME data
 * files other plugins already write (status-<user>.json, mystic-state.json,
 * wiki-<user>.jsonl, mc-memory.json, defects/, screenshots/). Zero coupling
 * with mc-loop/mc-mystic internals — no service injection, no hooks.
 *
 * This is the plugin-repo (A) counterpart of the world-side panel (:9090):
 * each transmigrator process exposes ITS OWN agent's situation, so any
 * player who joins a world with this plugin can watch their agent think,
 * act, starve, learn and file defect tickets.
 *
 * Endpoints:
 *   GET /          dashboard (zh-CN, dark, polls /api/all every 3s)
 *   GET /api/all   one JSON payload with everything below
 *   GET /shot/<u>/<file.jpg>  screenshots under data/screenshots (guarded)
 *
 * Config: MC_PANEL_HOST (default 127.0.0.1) / MC_PANEL_PORT (default 3200).
 */
import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { closeSync, existsSync, openSync, readSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

export const name = 'mc-panel'
export const inject: string[] = []

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  host: Schema.string().default('127.0.0.1'),
  port: Schema.number().default(3200),
  dataDir: Schema.string().default('./data'),
  /** which agent this panel shows; '' = auto-pick the freshest status-*.json */
  username: Schema.string().default(''),
})

export interface PanelConfig {
  enabled: boolean
  host: string
  port: number
  dataDir: string
  username: string
}

// ── data shapes (tolerant: all fields optional) ────────────────────────────
interface StatusSnapshot {
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
  recentSteps?: Array<{
    ts?: string
    step?: number
    thought?: string
    goal?: string
    tool?: string
    args?: Record<string, unknown>
    outcome?: string
    shot?: string
  }>
}

export interface PanelPayload {
  username: string
  status: StatusSnapshot | null
  staleMs: number | null
  online: boolean
  archive: { name?: string; epithet?: string; source?: string } | null
  mystic: { innateSkill?: string; level?: number } | null
  wiki: { total: number; cards: Array<{ topic: string; source: string; ts: number; content: string }> }
  memory: {
    base?: { x: number; y: number; z: number }
    publicChest?: { x: number; y: number; z: number }
    resourcePoints?: Record<string, Array<{ x: number; y: number; z: number }>>
    currentGoal?: string
  } | null
  defects: Array<Record<string, unknown> & { file: string; tool: string }>
  latestShot: string | null
  uptimeSec: number
  /** 俯视地形快照（mc-loop 每步写 map-<user>.json；2026-08-19 需求） */
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
  /** 编年史事件流（episodic 尾部）与击杀聚合 */
  events: Array<{ ts: string; text: string; kill: boolean }>
  kills: { recent: number; items: Array<{ ts: string; text: string }> }
}

/** 只读文件尾部 bytes 字节（episodic 会无限增长，全量读太重）。 */
function tailFile(file: string, bytes: number): string {
  const st = statSync(file)
  const start = Math.max(0, st.size - bytes)
  const buf = Buffer.alloc(st.size - start)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buf, 0, buf.length, start)
  } finally {
    closeSync(fd)
  }
  return buf.toString('utf-8')
}

const KILL_RE = /击杀|杀死|斩杀|斩了|killed|slain|defeated|击败/

const START_MS = Date.now()

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Pick which agent this panel is about: config.username or freshest status-*.json. */
export function resolveUsername(dataDir: string, configured: string): string {
  if (configured) return configured
  try {
    let best = ''
    let bestMtime = 0
    for (const f of readdirSync(dataDir)) {
      const m = /^status-(.+)\.json$/.exec(f)
      if (!m) continue
      const mt = statSync(join(dataDir, f)).mtimeMs
      if (mt > bestMtime) {
        bestMtime = mt
        best = m[1]
      }
    }
    return best
  } catch {
    return ''
  }
}

/** yaw (radians) → 中文方位。mineflayer 朝向向量 = (-sin,cos)；已用实测标定（yaw=-π/2 ↔ 东）. */
export function facingLabel(yaw: number | null | undefined): string {
  if (yaw == null || !Number.isFinite(yaw)) return '—'
  // heading: 从 +Z(南) 朝 +X(东) 顺时针的角度
  const heading = (((-yaw * 180) / Math.PI) % 360 + 360) % 360
  // vanilla 罗盘刻度：0=南, 90=西, 180=北, 270=东
  const compass = (360 - heading) % 360
  if (compass >= 315 || compass < 45) return '南 (+Z)'
  if (compass < 135) return '西 (-X)'
  if (compass < 225) return '北 (-Z)'
  return '东 (+X)'
}

/** Guarded screenshot path: only files strictly under <dataDir>/screenshots. */
export function resolveShotPath(dataDir: string, shot: string): string | null {
  if (!shot) return null
  const root = resolve(dataDir, 'screenshots')
  const full = resolve(root, shot)
  if (full !== root && !full.startsWith(root + sep)) return null
  return existsSync(full) ? full : null
}

/** Build the whole dashboard payload from disk. Never throws. */
export function collect(dataDir: string, username: string): PanelPayload {
  const u = resolveUsername(dataDir, username)
  const payload: PanelPayload = {
    username: u,
    status: null,
    staleMs: null,
    online: false,
    archive: null,
    mystic: null,
    wiki: { total: 0, cards: [] },
    memory: null,
    defects: [],
    latestShot: null,
    uptimeSec: Math.round((Date.now() - START_MS) / 1000),
    topo: null,
    events: [],
    kills: { recent: 0, items: [] },
  }
  if (!u) return payload
  const statusRaw = readJson(join(dataDir, `status-${u}.json`))
  const status = (statusRaw ?? {}) as StatusSnapshot
  payload.status = statusRaw ? status : null
  if (status.updatedAt) {
    const age = Date.now() - new Date(status.updatedAt).getTime()
    if (Number.isFinite(age)) {
      payload.staleMs = age
      payload.online = age < 60_000
    }
  }
  // transmigrator archive (persona name / epithet / IP source)
  const tr = readJson(join(dataDir, 'transmigrators.json'))
  const list = (tr?.transmigrators as Array<Record<string, unknown>> | undefined) ?? []
  const entry = list.find((t) => t.username === u)
  if (entry) payload.archive = { name: entry.name as string, epithet: entry.epithet as string, source: entry.source as string }
  // mystic state (level + innate skill)
  const mystic = readJson(join(dataDir, 'mystic-state.json'))
  const players = (mystic?.players as Record<string, Record<string, unknown>> | undefined) ?? {}
  if (players[u]) payload.mystic = { innateSkill: players[u].innateSkill as string, level: players[u].level as number }
  // wiki cards (JSONL, show last 8)
  try {
    const lines = readFileSync(join(dataDir, `wiki-${u}.jsonl`), 'utf-8').split('\n').filter(Boolean)
    payload.wiki.total = lines.length
    payload.wiki.cards = lines.slice(-8).reverse().map((l) => {
      try {
        const c = JSON.parse(l) as { topic?: string; source?: string; ts?: number; content?: string }
        return { topic: c.topic ?? '', source: c.source ?? '', ts: c.ts ?? 0, content: c.content ?? '' }
      } catch {
        return { topic: '(损坏行)', source: '', ts: 0, content: '' }
      }
    })
  } catch { /* no wiki yet */ }
  // long-term memory (base / chest / resource points / current goal)
  payload.memory = readJson(join(dataDir, 'mc-memory.json')) as PanelPayload['memory']
  // defect tickets
  try {
    const ddir = join(dataDir, 'defects')
    for (const f of readdirSync(ddir)) {
      if (!f.endsWith('.json')) continue
      const d = readJson(join(ddir, f))
      if (!d) continue
      const toolFromName = /^DEFECT-\d{14}-(.+)\.json$/.exec(f)?.[1] ?? f
      payload.defects.push({ ...d, file: f, tool: (d.tool as string) ?? toolFromName })
    }
    payload.defects.sort((a, b) => String(b.file).localeCompare(String(a.file)))
  } catch { /* no defects dir */ }
  // latest screenshot referenced by recentSteps
  for (let i = (status.recentSteps?.length ?? 0) - 1; i >= 0; i--) {
    const s = status.recentSteps![i]
    if (s.shot && resolveShotPath(dataDir, s.shot)) {
      payload.latestShot = s.shot
      break
    }
  }
  // 俯视地形快照（mc-loop writeMapSnapshot 每步更新）
  payload.topo = readJson(join(dataDir, `map-${u}.json`)) as PanelPayload['topo']
  // 编年史事件流（尾部 64KB ≈ 200+ 条）+ 击杀聚合
  try {
    const raw = tailFile(join(dataDir, `episodic-${u}.jsonl`), 64 * 1024)
    const lines = raw.split('\n').filter(Boolean)
    // 首行可能被截半，能解析就用
    const events: Array<{ ts: string; text: string; kill: boolean }> = []
    for (const l of lines.slice(-40)) {
      try {
        const e = JSON.parse(l) as { ts?: string; text?: string }
        const text = e.text ?? ''
        events.push({ ts: e.ts ?? '', text, kill: KILL_RE.test(text) })
      } catch { /* skip broken line */ }
    }
    payload.events = events.reverse()
    const kills = events.filter((e) => e.kill).slice(0, 10)
    payload.kills = { recent: events.filter((e) => e.kill).length, items: kills }
  } catch { /* no episodic yet */ }
  return payload
}

// ── HTTP server ─────────────────────────────────────────────────────────────
function json(res: ServerResponse, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body), 'utf-8')
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length })
  res.end(buf)
}

function handleShot(dataDir: string, req: IncomingMessage, res: ServerResponse): void {
  const rel = decodeURIComponent(req.url!.slice('/shot/'.length))
  const full = resolveShotPath(dataDir, rel)
  if (!full) {
    res.writeHead(404).end('not found')
    return
  }
  try {
    const img = readFileSync(full)
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length, 'Cache-Control': 'no-cache' })
    res.end(img)
  } catch {
    res.writeHead(404).end('gone')
  }
}

export function apply(ctx: Context, config: PanelConfig): void {
  if (!config.enabled) return
  const dataDir = resolve(config.dataDir)
  const server = createServer((req, res) => {
    try {
      const url = req.url ?? '/'
      if (url === '/api/all') return json(res, collect(dataDir, config.username))
      if (url.startsWith('/shot/')) return handleShot(dataDir, req, res)
      if (url === '/' || url.startsWith('/?')) {
        const html = Buffer.from(dashboardHtml(), 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length })
        return res.end(html)
      }
      res.writeHead(404).end('not found')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try { res.writeHead(500).end(msg) } catch { /* socket gone */ }
    }
  })
  server.on('error', (err) => console.error(`[mc-panel] server error: ${(err as Error).message}`))
  server.listen(config.port, config.host, () => {
    console.log(`[mc-panel] dashboard: http://${config.host}:${config.port}/ (data=${dataDir}, user=${config.username || 'auto'})`)
  })
  // cordis 语义：ctx.effect(fn) 的 fn 是立即执行的 setup，其【返回值】才是清理器。
  ctx.effect(() => () => {
    server.close()
  })
}

// ── dashboard HTML ──────────────────────────────────────────────────────────
function dashboardHtml(): string {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>穿越者面板</title><style>'
    + ':root{--bg:#0f1115;--card:#1a1d24;--line:#262a33;--fg:#d7dce4;--dim:#8a93a3;--acc:#4f8cff;--ok:#3fb96f;--bad:#e0564f;--warn:#d9a03f}'
    + '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 "Segoe UI",system-ui,"Microsoft YaHei",sans-serif}'
    + 'a{color:var(--acc);text-decoration:none}'
    + '.wrap{max-width:1280px;margin:0 auto;padding:14px}'
    + '.top{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;padding:10px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:12px}'
    + '.top h1{font-size:18px;margin:0}.top .sub{color:var(--dim);font-size:12px}'
    + '.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--line)}'
    + '.badge.on{color:var(--ok);border-color:var(--ok)}.badge.off{color:var(--bad);border-color:var(--bad)}'
    + '.grid{display:grid;grid-template-columns:1fr 340px;gap:12px}'
    + '@media(max-width:900px){.grid{grid-template-columns:1fr}}'
    + '.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px}'
    + '.card h2{font-size:13px;color:var(--dim);margin:0 0 8px;font-weight:600;letter-spacing:.05em}'
    + '.viewer{position:relative;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden}'
    + '.viewer iframe{position:absolute;inset:0;width:100%;height:100%;border:0}'
    + '.fs{position:absolute;right:8px;top:8px;background:#0009;color:#fff;border:0;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px}'
    + '.shotwrap{position:relative}.shotwrap img{width:100%;border-radius:8px;display:block;background:#000}'
    + '.vrow{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:13px}'
    + '.bar{flex:1;height:9px;background:#0b0d10;border-radius:6px;overflow:hidden}.bar i{display:block;height:100%}'
    + '.hp i{background:linear-gradient(90deg,#c0392b,#e0564f)}.fd i{background:linear-gradient(90deg,#b9770e,#d9a03f)}'
    + '.steps{max-height:520px;overflow:auto;display:flex;flex-direction:column;gap:8px}'
    + '.step{border-left:3px solid var(--acc);padding:6px 10px;background:#141821;border-radius:0 8px 8px 0}'
    + '.step.err{border-left-color:var(--bad)}'
    + '.step .meta{color:var(--dim);font-size:11px;display:flex;gap:8px;flex-wrap:wrap}'
    + '.step .th{margin:3px 0}.step .out{font-size:12px;color:#aab3c2;word-break:break-all}'
    + '.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:#141821;border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:12px}'
    + '.item{font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}.item:last-child{border-bottom:0}'
    + '.item .t{color:var(--dim);font-size:11px}'
    + '.bottom{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:12px}'
    + '@media(max-width:1000px){.bottom{grid-template-columns:1fr}}'
    + 'canvas{width:100%;border-radius:8px;background:#0b0d10}'
    + '.empty{color:var(--dim);font-size:12px;padding:6px 0}'
    + '.vtab{font-size:11px;padding:2px 8px;border:1px solid #2a3346;border-radius:9px;background:transparent;color:var(--dim);cursor:pointer}'
    + '.vtab:hover{color:#fff}'
    + '</style></head><body><div class="wrap">'
    + '<div class="top"><h1 id="title">…</h1><span class="sub" id="sub"></span>'
    + '<span style="flex:1"></span><span class="badge" id="live">…</span>'
    + '<span class="badge" id="lv">—</span><span class="badge" id="skill">—</span>'
    + '<span class="badge" id="kills">⚔ —</span></div>'
    + '<div class="grid">'
    + '<div><div class="card"><h2>游戏视角 <span style="float:right">'
    + '<button class="vtab" id="vt-3" style="background:var(--acc)">轨道</button> '
    + '<button class="vtab" id="vt-smooth">第一人称</button> '
    + '<button class="vtab" id="vt-map">俯视地图</button></span></h2>'
    + '<div class="viewer" id="vwrap"><iframe id="vframe" src="about:blank"></iframe>'
    + '<button class="fs" onclick="fs()">⛶ 全屏</button></div></div>'
    + '<div class="card"><h2>最近所见（agent 截图）</h2><div class="shotwrap" id="shot"></div></div></div>'
    + '<div><div class="card"><h2>状态</h2><div id="vitals">…</div></div>'
    + '<div class="card"><h2>周围地形（实时俯视 33×33）</h2><canvas id="topo" width="330" height="330"></canvas>'
    + '<div class="sub" id="toposub" style="color:var(--dim);font-size:11px;margin-top:4px">等待地形数据…</div></div>'
    + '<div class="card"><h2>生存知识库</h2><div id="wiki">…</div></div>'
    + '<div class="card"><h2>缺陷工单</h2><div id="defects">…</div></div></div></div>'
    + '<div class="card"><h2>思考与行动流</h2><div class="steps" id="steps">…</div></div>'
    + '<div class="card"><h2>编年史事件流（⚔ 战斗击杀高亮）</h2><div class="steps" id="events" style="max-height:300px">…</div></div>'
    + '<div class="bottom">'
    + '<div class="card"><h2>背包</h2><div class="chips" id="inv">…</div></div>'
    + '<div class="card"><h2>已知资源点</h2><canvas id="mm" width="380" height="280"></canvas></div>'
    + '<div class="card"><h2>档案</h2><div id="archive">…</div></div>'
    + '</div></div>'
    + '<script>'
    + 'let viewerSet=false,lastShot=null;'
    + 'function fs(){var w=document.getElementById("vwrap");if(document.fullscreenElement){document.exitFullscreen()}else{w.requestFullscreen&&w.requestFullscreen()}}'
    + 'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;"}[c]})}'
    + 'function hhmmss(ts){try{return new Date(ts).toLocaleTimeString("zh-CN",{hour12:false})}catch(e){return ""}}'
    + 'function fmtUptime(s){var h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h>0?h+"小时"+m+"分":m+"分"+(s%60)+"秒"}'
    + 'function drawMap(p){var c=document.getElementById("mm");if(!c)return;var g=c.getContext("2d");g.clearRect(0,0,c.width,c.height);'
    + 'var mem=p.memory||{},pts=[],COL={base:"#f5d76e",publicChest:"#c39a6b",coal_ore:"#5d6d7e",iron_ore:"#dfe4ea",cobblestone:"#aab7b8",oak_log:"#52be80",spruce_log:"#1e8449"};'
    + 'function push(k,arr){(arr||[]).forEach(function(q){pts.push({x:q.x,z:q.z,c:COL[k]||"#889",r:2.5})})}'
    + 'var st=p.status&&p.status.bot?p.status.bot:null;var me=st&&st.position?st.position:null;'
    + 'if(mem.base)pts.push({x:mem.base.x,z:mem.base.z,c:COL.base,r:4,label:"基地"});'
    + 'if(mem.publicChest)pts.push({x:mem.publicChest.x,z:mem.publicChest.z,c:COL.publicChest,r:4,label:"公共箱"});'
    + 'Object.keys(mem.resourcePoints||{}).forEach(function(k){push(k,mem.resourcePoints[k])});'
    + 'if(!pts.length&&!me){g.fillStyle="#8a93a3";g.font="12px sans-serif";g.fillText("暂无坐标数据",12,24);return}'
    + 'var xs=pts.map(function(q){return q.x}),zs=pts.map(function(q){return q.z});if(me){xs.push(me.x);zs.push(me.z)}'
    + 'var minx=Math.min.apply(null,xs),maxx=Math.max.apply(null,xs),minz=Math.min.apply(null,zs),maxz=Math.max.apply(null,zs);'
    + 'var pad=28,w=c.width-pad*2,h=c.height-pad*2,dx=Math.max(maxx-minx,8),dz=Math.max(maxz-minz,8);'
    + 'function X(x){return pad+(x-minx)/dx*w}function Z(z){return pad+(z-minz)/dz*h}'
    + 'g.strokeStyle="#1f2430";for(var i=0;i<=4;i++){g.beginPath();g.moveTo(pad+i*w/4,pad);g.lineTo(pad+i*w/4,pad+h);g.stroke();g.beginPath();g.moveTo(pad,pad+i*h/4);g.lineTo(pad+w,pad+i*h/4);g.stroke()}'
    + 'pts.forEach(function(q){g.fillStyle=q.c;g.beginPath();g.arc(X(q.x),Z(q.z),q.r,0,7);g.fill()});'
    + 'if(me){g.fillStyle="#4f8cff";g.beginPath();g.arc(X(me.x),Z(me.z),5,0,7);g.fill();g.strokeStyle="#9cc0ff";g.lineWidth=2;g.beginPath();g.arc(X(me.x),Z(me.z),8,0,7);g.stroke();g.lineWidth=1}'
    + 'g.fillStyle="#8a93a3";g.font="11px sans-serif";g.fillText("N ↑",6,14);g.fillText(Math.round(minx)+","+Math.round(minz),pad,c.height-8);var rt=Math.round(maxx)+","+Math.round(maxz);g.fillText(rt,c.width-pad-g.measureText(rt).width,c.height-8)}'
    + 'function shade(hex,f){var n=parseInt(hex.slice(1),16),r=(n>>16)&255,gr=(n>>8)&255,b=n&255;r=Math.min(255,Math.round(r*(1+f)));gr=Math.min(255,Math.round(gr*(1+f)));b=Math.min(255,Math.round(b*(1+f)));return "rgb("+r+","+gr+","+b+")"}'
    + 'function drawTopo(m){var c=document.getElementById("topo");if(!c)return;var g=c.getContext("2d");var sub=document.getElementById("toposub");'
    + 'if(!m||!m.cells){sub.textContent="等待地形数据…";return}'
    + 'var R=m.r||16,N=2*R+1,SZ=Math.floor(c.width/N);'
    + 'var COL={g:"#4a7c3f",d:"#7a5b3a","#":"#6e6e6e",s:"#d9c07a","~":"#3a6ea5",L:"#e07020",w:"#8a6236",l:"#3a6b35",c:"#8f8f8f",o:"#f0c94a",T:"#ffcc44",b:"#e0564f",C:"#c39a6b",F:"#d9a03f",G:"#9fc6e8","?":"#556070",".":"#10141b"};'
    + 'var hs=m.heights||[];for(var i=0;i<m.cells.length&&i<N*N;i++){var ch=m.cells[i],h=hs[i]||0;var base=COL[ch]||COL["?"];'
    + 'g.fillStyle=shade(base,Math.max(-0.4,Math.min(0.4,h*0.06)));g.fillRect((i%N)*SZ,Math.floor(i/N)*SZ,SZ,SZ)}'
    + '(m.entities||[]).forEach(function(e){var px=(e.dx+R)*SZ+SZ/2,pz=(e.dz+R)*SZ+SZ/2;var isP=/player/.test(e.name);'
    + 'g.fillStyle=isP?"#4fd8ff":"#ff5a5a";g.beginPath();g.arc(px,pz,3,0,7);g.fill();'
    + 'if(isP){g.fillStyle="#bfeaff";g.font="10px sans-serif";g.fillText(e.name.replace("(player)",""),px+5,pz+3)}});'
    + 'var mx=R*SZ+SZ/2,mz=R*SZ+SZ/2;var yaw=m.yaw||0,ax=-Math.sin(yaw),az=Math.cos(yaw);'
    + 'g.fillStyle="#fff";g.beginPath();g.arc(mx,mz,4,0,7);g.fill();'
    + 'g.strokeStyle="#fff";g.lineWidth=2;g.beginPath();g.moveTo(mx,mz);g.lineTo(mx+ax*12,mz+az*12);g.stroke();g.lineWidth=1;'
    + 'g.fillStyle="#8a93a3";g.font="11px sans-serif";g.fillText("N ↑",6,14);'
    + 'sub.textContent="中心 "+(m.cx!=null?"("+m.cx+","+m.cy+","+m.cz+")":"—")+" · "+(m.entities||[]).length+" 实体 · "+hhmmss(m.updatedAt)}'
    + 'function render(p){var st=p.status&&p.status.bot?p.status.bot:null;'
    + 'document.title="穿越者面板 · "+((p.archive&&p.archive.name)||p.username||"?");'
    + 'document.getElementById("title").textContent="⚔ "+((p.archive&&p.archive.name)||st&&st.personaName||p.username||"未知穿越者");'
    + 'document.getElementById("sub").textContent=((p.archive&&p.archive.epithet)?p.archive.epithet+" · ":"")+(p.username||"")+(p.archive&&p.archive.source?" · "+p.archive.source:"");'
    + 'var live=document.getElementById("live");live.textContent=p.online?"🟢 在线":"🔴 失联/离线";live.className="badge "+(p.online?"on":"off");'
    + 'var lv=document.getElementById("lv"),sk=document.getElementById("skill");'
    + 'lv.textContent=p.mystic&&p.mystic.level!=null?"Lv."+p.mystic.level:"Lv.—";'
    + 'sk.textContent=p.mystic&&p.mystic.innateSkill?"天赋「"+p.mystic.innateSkill+"」":"天赋未定";'
    + 'var v=document.getElementById("vitals");if(!st){v.innerHTML="\\<div class=empty>暂无状态数据（等待 agent 连接服务器…）\\</div>"}else{'
    + 'var hp=st.health==null?0:st.health,fd=st.food==null?0:st.food,pos=st.position;'
    + 'var dirs=["南","西","北","东"],yaw=st.yaw==null?0:st.yaw,deg=((yaw*180/Math.PI)+360)%360,di=Math.round(deg/90)%4;'
    + 'v.innerHTML="\<div class=vrow\>❤ 生命 \<div class=bar hp\>\<i style=width:"+(hp/20*100)+"%\>\</i\>\</div\> "+hp+"/20\</div\>"'
    + '+"\<div class=vrow\>🍗 饱食 \<div class=bar fd\>\<i style=width:"+(fd/20*100)+"%\>\</i\>\</div\> "+fd+"/20\</div\>"'
    + '+"\<div class=vrow\>📍 坐标 "+(pos?pos.x+", "+pos.y+", "+pos.z:"—")+"\</div\>"'
    + '+"\<div class=vrow\>🧭 朝向 "+dirs[di]+" · ✋ 手持 "+(st.heldItem||"空手")+(st.sleeping?" · 😴 睡眠中":"")+"\</div\>"'
    + '+"\<div class=vrow\>🎯 目标 "+esc((p.memory&&p.memory.currentGoal)||(p.status&&p.status.recentSteps&&p.status.recentSteps.length?p.status.recentSteps[p.status.recentSteps.length-1].goal:"—"))+"\</div\>"'
    + '+"\<div class=vrow\>⏱ 进程 "+fmtUptime(p.uptimeSec)+" · 更新 "+hhmmss(p.status&&p.status.updatedAt)+"\</div\>"'
    + '+ "\<div class=vrow\>🧠 上下文提示卡 "+((p.status&&p.status.context&&p.status.context.cards||[]).length?(p.status.context.cards).map(function(k){return k.id+"×"+k.remain}).join(" "):"无（按需披露中）")+"\</div\>"}'
    + 'var f=document.getElementById("vframe"),curPv="3";'
    + 'function setPv(pv){curPv=pv;if(st&&st.viewerPort){f.src="http://"+location.hostname+":"+st.viewerPort+"/?pv="+pv;}["3","smooth","map"].forEach(function(k){var b=document.getElementById("vt-"+k);if(b){b.style.background=k===pv?"var(--acc)":"transparent";b.style.color=k===pv?"#0d1117":"var(--dim)"}})}'
    + 'if(st&&st.viewerPort&&!viewerSet){setPv(curPv);viewerSet=true}'
    + '["3","smooth","map"].forEach(function(k){var b=document.getElementById("vt-"+k);if(b)b.onclick=function(){setPv(k)}})'
    + 'var sh=document.getElementById("shot");if(p.latestShot&&p.latestShot!==lastShot){lastShot=p.latestShot;sh.innerHTML="\<img src=/shot/"+encodeURIComponent(p.latestShot)+"?t="+Date.now()+"\>"}else if(!p.latestShot){sh.innerHTML="\<div class=empty\>暂无截图\</div\>"}'
    + 'var steps=(p.status&&p.status.recentSteps)||[];var se=document.getElementById("steps");'
    + 'se.innerHTML=steps.length?steps.slice(-30).reverse().map(function(s){var bad=/error|could not|failed|timeout/i.test(s.outcome||"");'
    + 'return "\<div class=step"+(bad?" err":"")+"\>\<div class=meta\>#"+(s.step||"?")+" · "+hhmmss(s.ts)+" · ⚒ "+esc(s.tool||"")+"\</div\>"'
    + '+"\<div class=th\>💭 "+esc(s.thought||"")+"\</div\>\<div class=meta\>🎯 "+esc(s.goal||"")+"\</div\>"'
    + '+"\<div class=out\>"+esc((s.outcome||"").slice(0,300))+"\</div\>\</div\>"}).join(""):"\<div class=empty\>暂无行动记录\</div\>";'
    + 'var inv=(st&&st.inventory)||[],agg={};inv.forEach(function(i){agg[i.name]=(agg[i.name]||0)+i.count});'
    + 'var keys=Object.keys(agg).sort(function(a,b){return agg[b]-agg[a]});'
    + 'document.getElementById("inv").innerHTML=keys.length?keys.map(function(k){return "\<span class=chip\>"+esc(k)+" ×"+agg[k]+"\</span\>"}).join(""):"\<div class=empty\>背包空空如也\</div\>";'
    + 'var w=p.wiki,wd=document.getElementById("wiki");'
    + 'wd.innerHTML=w.total?"\<div class=item\>共 "+w.total+" 张知识卡（展示最近 "+w.cards.length+" 张）\</div\>"+w.cards.map(function(c){return "\<div class=item\>\<div\>"+esc(c.topic)+"\</div\>\<div class=t\>"+esc(c.source)+" · "+hhmmss(c.ts)+" · "+esc((c.content||"").slice(0,80))+"…\</div\>\</div\>"}).join(""):"\<div class=empty\>还没学会任何教训\</div\>";'
    + 'var ds=p.defects,dd=document.getElementById("defects");'
    + 'dd.innerHTML=ds.length?ds.slice(0,6).map(function(d){return "\<div class=item\>\<div\>⚒ "+esc(d.tool)+" ×"+(d.count!=null?d.count:"?")+"\</div\>\<div class=t\>"+esc(d.lastSample||d.lastAt||d.file)+"\</div\>\</div\>"}).join(""):"\<div class=empty\>无未决工单，运行健康\</div\>";'
    + 'var ar=p.archive,ad=document.getElementById("archive");'
    + 'ad.innerHTML=ar?"\<div class=item\>名字："+esc(ar.name)+"\</div\>\<div class=item\>称号："+esc(ar.epithet||"—")+"\</div\>\<div class=item\>来自："+esc(ar.source||"—")+"\</div\>\<div class=item\>MC 用户名："+esc(p.username)+"\</div\>":"\<div class=empty\>未注册穿越者档案\</div\>";'
    + 'var kb=document.getElementById("kills");kb.textContent=p.kills&&p.kills.recent?"⚔ 近期击杀 "+p.kills.recent:"⚔ 0";'
    + 'var ev=document.getElementById("events");'
    + 'ev.innerHTML=p.events&&p.events.length?p.events.slice(0,25).map(function(e){return "\<div class=step"+(e.kill?" err":"")+"\>\<div class=meta\>"+hhmmss(e.ts)+(e.kill?" · ⚔ 战斗":"")+"\</div\>\<div class=out\>"+esc(e.text.slice(0,260))+"\</div\>\</div\>"}).join(""):"\<div class=empty\>暂无编年史\</div\>";'
    + 'drawTopo(p.topo);drawMap(p)}'
    + 'function tick(){fetch("/api/all").then(function(r){return r.json()}).then(render).catch(function(){})}'
    + 'tick();setInterval(tick,3000);'
    + '</script></body></html>'
}
