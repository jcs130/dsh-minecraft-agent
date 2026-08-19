// src/mc-panel.ts
import Schema from "@deepseek-ai/schemastery";
import { createServer } from "node:http";
import { closeSync, existsSync, openSync, readSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
var name = "mc-panel";
var inject = [];
var Config = Schema.object({
  enabled: Schema.boolean().default(true),
  host: Schema.string().default("127.0.0.1"),
  port: Schema.number().default(3200),
  dataDir: Schema.string().default("./data"),
  /** which agent this panel shows; '' = auto-pick the freshest status-*.json */
  username: Schema.string().default("")
});
function tailFile(file, bytes) {
  const st = statSync(file);
  const start = Math.max(0, st.size - bytes);
  const buf = Buffer.alloc(st.size - start);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  return buf.toString("utf-8");
}
var KILL_RE = /击杀|杀死|斩杀|斩了|killed|slain|defeated|击败/;
var START_MS = Date.now();
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}
function resolveUsername(dataDir, configured) {
  if (configured) return configured;
  try {
    let best = "";
    let bestMtime = 0;
    for (const f of readdirSync(dataDir)) {
      const m = /^status-(.+)\.json$/.exec(f);
      if (!m) continue;
      const mt = statSync(join(dataDir, f)).mtimeMs;
      if (mt > bestMtime) {
        bestMtime = mt;
        best = m[1];
      }
    }
    return best;
  } catch {
    return "";
  }
}
function facingLabel(yaw) {
  if (yaw == null || !Number.isFinite(yaw)) return "\u2014";
  const heading = (-yaw * 180 / Math.PI % 360 + 360) % 360;
  const compass = (360 - heading) % 360;
  if (compass >= 315 || compass < 45) return "\u5357 (+Z)";
  if (compass < 135) return "\u897F (-X)";
  if (compass < 225) return "\u5317 (-Z)";
  return "\u4E1C (+X)";
}
function resolveShotPath(dataDir, shot) {
  if (!shot) return null;
  const root = resolve(dataDir, "screenshots");
  const full = resolve(root, shot);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return existsSync(full) ? full : null;
}
function collect(dataDir, username) {
  const u = resolveUsername(dataDir, username);
  const payload = {
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
    uptimeSec: Math.round((Date.now() - START_MS) / 1e3),
    topo: null,
    events: [],
    kills: { recent: 0, items: [] }
  };
  if (!u) return payload;
  const statusRaw = readJson(join(dataDir, `status-${u}.json`));
  const status = statusRaw ?? {};
  payload.status = statusRaw ? status : null;
  if (status.updatedAt) {
    const age = Date.now() - new Date(status.updatedAt).getTime();
    if (Number.isFinite(age)) {
      payload.staleMs = age;
      payload.online = age < 6e4;
    }
  }
  const tr = readJson(join(dataDir, "transmigrators.json"));
  const list = tr?.transmigrators ?? [];
  const entry = list.find((t) => t.username === u);
  if (entry) payload.archive = { name: entry.name, epithet: entry.epithet, source: entry.source };
  const mystic = readJson(join(dataDir, "mystic-state.json"));
  const players = mystic?.players ?? {};
  if (players[u]) payload.mystic = { innateSkill: players[u].innateSkill, level: players[u].level };
  try {
    const lines = readFileSync(join(dataDir, `wiki-${u}.jsonl`), "utf-8").split("\n").filter(Boolean);
    payload.wiki.total = lines.length;
    payload.wiki.cards = lines.slice(-8).reverse().map((l) => {
      try {
        const c = JSON.parse(l);
        return { topic: c.topic ?? "", source: c.source ?? "", ts: c.ts ?? 0, content: c.content ?? "" };
      } catch {
        return { topic: "(\u635F\u574F\u884C)", source: "", ts: 0, content: "" };
      }
    });
  } catch {
  }
  payload.memory = readJson(join(dataDir, "mc-memory.json"));
  try {
    const ddir = join(dataDir, "defects");
    for (const f of readdirSync(ddir)) {
      if (!f.endsWith(".json")) continue;
      const d = readJson(join(ddir, f));
      if (!d) continue;
      const toolFromName = /^DEFECT-\d{14}-(.+)\.json$/.exec(f)?.[1] ?? f;
      payload.defects.push({ ...d, file: f, tool: d.tool ?? toolFromName });
    }
    payload.defects.sort((a, b) => String(b.file).localeCompare(String(a.file)));
  } catch {
  }
  for (let i = (status.recentSteps?.length ?? 0) - 1; i >= 0; i--) {
    const s = status.recentSteps[i];
    if (s.shot && resolveShotPath(dataDir, s.shot)) {
      payload.latestShot = s.shot;
      break;
    }
  }
  payload.topo = readJson(join(dataDir, `map-${u}.json`));
  try {
    const raw = tailFile(join(dataDir, `episodic-${u}.jsonl`), 64 * 1024);
    const lines = raw.split("\n").filter(Boolean);
    const events = [];
    for (const l of lines.slice(-40)) {
      try {
        const e = JSON.parse(l);
        const text = e.text ?? "";
        events.push({ ts: e.ts ?? "", text, kill: KILL_RE.test(text) });
      } catch {
      }
    }
    payload.events = events.reverse();
    const kills = events.filter((e) => e.kill).slice(0, 10);
    payload.kills = { recent: events.filter((e) => e.kill).length, items: kills };
  } catch {
  }
  return payload;
}
function json(res, body) {
  const buf = Buffer.from(JSON.stringify(body), "utf-8");
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": buf.length });
  res.end(buf);
}
function handleShot(dataDir, req, res) {
  const rel = decodeURIComponent(req.url.slice("/shot/".length));
  const full = resolveShotPath(dataDir, rel);
  if (!full) {
    res.writeHead(404).end("not found");
    return;
  }
  try {
    const img = readFileSync(full);
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": img.length, "Cache-Control": "no-cache" });
    res.end(img);
  } catch {
    res.writeHead(404).end("gone");
  }
}
function apply(ctx, config) {
  if (!config.enabled) return;
  const dataDir = resolve(config.dataDir);
  const server = createServer((req, res) => {
    try {
      const url = req.url ?? "/";
      if (url === "/api/all") return json(res, collect(dataDir, config.username));
      if (url.startsWith("/shot/")) return handleShot(dataDir, req, res);
      if (url === "/" || url.startsWith("/?")) {
        const html = Buffer.from(dashboardHtml(), "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": html.length });
        return res.end(html);
      }
      res.writeHead(404).end("not found");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        res.writeHead(500).end(msg);
      } catch {
      }
    }
  });
  server.on("error", (err) => console.error(`[mc-panel] server error: ${err.message}`));
  server.listen(config.port, config.host, () => {
    console.log(`[mc-panel] dashboard: http://${config.host}:${config.port}/ (data=${dataDir}, user=${config.username || "auto"})`);
  });
  ctx.effect(() => () => {
    server.close();
  });
}
function dashboardHtml() {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>\u7A7F\u8D8A\u8005\u9762\u677F</title><style>:root{--bg:#0f1115;--card:#1a1d24;--line:#262a33;--fg:#d7dce4;--dim:#8a93a3;--acc:#4f8cff;--ok:#3fb96f;--bad:#e0564f;--warn:#d9a03f}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 "Segoe UI",system-ui,"Microsoft YaHei",sans-serif}a{color:var(--acc);text-decoration:none}.wrap{max-width:1280px;margin:0 auto;padding:14px}.top{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;padding:10px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:12px}.top h1{font-size:18px;margin:0}.top .sub{color:var(--dim);font-size:12px}.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--line)}.badge.on{color:var(--ok);border-color:var(--ok)}.badge.off{color:var(--bad);border-color:var(--bad)}.grid{display:grid;grid-template-columns:1fr 340px;gap:12px}@media(max-width:900px){.grid{grid-template-columns:1fr}}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px}.card h2{font-size:13px;color:var(--dim);margin:0 0 8px;font-weight:600;letter-spacing:.05em}.viewer{position:relative;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden}.viewer iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.fs{position:absolute;right:8px;top:8px;background:#0009;color:#fff;border:0;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px}.shotwrap{position:relative}.shotwrap img{width:100%;border-radius:8px;display:block;background:#000}.vrow{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:13px}.bar{flex:1;height:9px;background:#0b0d10;border-radius:6px;overflow:hidden}.bar i{display:block;height:100%}.hp i{background:linear-gradient(90deg,#c0392b,#e0564f)}.fd i{background:linear-gradient(90deg,#b9770e,#d9a03f)}.steps{max-height:520px;overflow:auto;display:flex;flex-direction:column;gap:8px}.step{border-left:3px solid var(--acc);padding:6px 10px;background:#141821;border-radius:0 8px 8px 0}.step.err{border-left-color:var(--bad)}.step .meta{color:var(--dim);font-size:11px;display:flex;gap:8px;flex-wrap:wrap}.step .th{margin:3px 0}.step .out{font-size:12px;color:#aab3c2;word-break:break-all}.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:#141821;border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:12px}.item{font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}.item:last-child{border-bottom:0}.item .t{color:var(--dim);font-size:11px}.bottom{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:12px}@media(max-width:1000px){.bottom{grid-template-columns:1fr}}canvas{width:100%;border-radius:8px;background:#0b0d10}.empty{color:var(--dim);font-size:12px;padding:6px 0}.vtab{font-size:11px;padding:2px 8px;border:1px solid #2a3346;border-radius:9px;background:transparent;color:var(--dim);cursor:pointer}.vtab:hover{color:#fff}</style></head><body><div class="wrap"><div class="top"><h1 id="title">\u2026</h1><span class="sub" id="sub"></span><span style="flex:1"></span><span class="badge" id="live">\u2026</span><span class="badge" id="lv">\u2014</span><span class="badge" id="skill">\u2014</span><span class="badge" id="kills">\u2694 \u2014</span></div><div class="grid"><div><div class="card"><h2>\u6E38\u620F\u89C6\u89D2 <span style="float:right"><button class="vtab" id="vt-3" style="background:var(--acc)">\u8F68\u9053</button> <button class="vtab" id="vt-smooth">\u7B2C\u4E00\u4EBA\u79F0</button> <button class="vtab" id="vt-map">\u4FEF\u89C6\u5730\u56FE</button></span></h2><div class="viewer" id="vwrap"><iframe id="vframe" src="about:blank"></iframe><button class="fs" onclick="fs()">\u26F6 \u5168\u5C4F</button></div></div><div class="card"><h2>\u6700\u8FD1\u6240\u89C1\uFF08agent \u622A\u56FE\uFF09</h2><div class="shotwrap" id="shot"></div></div></div><div><div class="card"><h2>\u72B6\u6001</h2><div id="vitals">\u2026</div></div><div class="card"><h2>\u5468\u56F4\u5730\u5F62\uFF08\u5B9E\u65F6\u4FEF\u89C6 33\xD733\uFF09</h2><canvas id="topo" width="330" height="330"></canvas><div class="sub" id="toposub" style="color:var(--dim);font-size:11px;margin-top:4px">\u7B49\u5F85\u5730\u5F62\u6570\u636E\u2026</div></div><div class="card"><h2>\u751F\u5B58\u77E5\u8BC6\u5E93</h2><div id="wiki">\u2026</div></div><div class="card"><h2>\u7F3A\u9677\u5DE5\u5355</h2><div id="defects">\u2026</div></div></div></div><div class="card"><h2>\u601D\u8003\u4E0E\u884C\u52A8\u6D41</h2><div class="steps" id="steps">\u2026</div></div><div class="card"><h2>\u7F16\u5E74\u53F2\u4E8B\u4EF6\u6D41\uFF08\u2694 \u6218\u6597\u51FB\u6740\u9AD8\u4EAE\uFF09</h2><div class="steps" id="events" style="max-height:300px">\u2026</div></div><div class="bottom"><div class="card"><h2>\u80CC\u5305</h2><div class="chips" id="inv">\u2026</div></div><div class="card"><h2>\u5DF2\u77E5\u8D44\u6E90\u70B9</h2><canvas id="mm" width="380" height="280"></canvas></div><div class="card"><h2>\u6863\u6848</h2><div id="archive">\u2026</div></div></div></div><script>let viewerSet=false,lastShot=null;function fs(){var w=document.getElementById("vwrap");if(document.fullscreenElement){document.exitFullscreen()}else{w.requestFullscreen&&w.requestFullscreen()}}function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}function hhmmss(ts){try{return new Date(ts).toLocaleTimeString("zh-CN",{hour12:false})}catch(e){return ""}}function fmtUptime(s){var h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h>0?h+"\u5C0F\u65F6"+m+"\u5206":m+"\u5206"+(s%60)+"\u79D2"}function drawMap(p){var c=document.getElementById("mm");if(!c)return;var g=c.getContext("2d");g.clearRect(0,0,c.width,c.height);var mem=p.memory||{},pts=[],COL={base:"#f5d76e",publicChest:"#c39a6b",coal_ore:"#5d6d7e",iron_ore:"#dfe4ea",cobblestone:"#aab7b8",oak_log:"#52be80",spruce_log:"#1e8449"};function push(k,arr){(arr||[]).forEach(function(q){pts.push({x:q.x,z:q.z,c:COL[k]||"#889",r:2.5})})}var st=p.status&&p.status.bot?p.status.bot:null;var me=st&&st.position?st.position:null;if(mem.base)pts.push({x:mem.base.x,z:mem.base.z,c:COL.base,r:4,label:"\u57FA\u5730"});if(mem.publicChest)pts.push({x:mem.publicChest.x,z:mem.publicChest.z,c:COL.publicChest,r:4,label:"\u516C\u5171\u7BB1"});Object.keys(mem.resourcePoints||{}).forEach(function(k){push(k,mem.resourcePoints[k])});if(!pts.length&&!me){g.fillStyle="#8a93a3";g.font="12px sans-serif";g.fillText("\u6682\u65E0\u5750\u6807\u6570\u636E",12,24);return}var xs=pts.map(function(q){return q.x}),zs=pts.map(function(q){return q.z});if(me){xs.push(me.x);zs.push(me.z)}var minx=Math.min.apply(null,xs),maxx=Math.max.apply(null,xs),minz=Math.min.apply(null,zs),maxz=Math.max.apply(null,zs);var pad=28,w=c.width-pad*2,h=c.height-pad*2,dx=Math.max(maxx-minx,8),dz=Math.max(maxz-minz,8);function X(x){return pad+(x-minx)/dx*w}function Z(z){return pad+(z-minz)/dz*h}g.strokeStyle="#1f2430";for(var i=0;i<=4;i++){g.beginPath();g.moveTo(pad+i*w/4,pad);g.lineTo(pad+i*w/4,pad+h);g.stroke();g.beginPath();g.moveTo(pad,pad+i*h/4);g.lineTo(pad+w,pad+i*h/4);g.stroke()}pts.forEach(function(q){g.fillStyle=q.c;g.beginPath();g.arc(X(q.x),Z(q.z),q.r,0,7);g.fill()});if(me){g.fillStyle="#4f8cff";g.beginPath();g.arc(X(me.x),Z(me.z),5,0,7);g.fill();g.strokeStyle="#9cc0ff";g.lineWidth=2;g.beginPath();g.arc(X(me.x),Z(me.z),8,0,7);g.stroke();g.lineWidth=1}g.fillStyle="#8a93a3";g.font="11px sans-serif";g.fillText("N \u2191",6,14);g.fillText(Math.round(minx)+","+Math.round(minz),pad,c.height-8);var rt=Math.round(maxx)+","+Math.round(maxz);g.fillText(rt,c.width-pad-g.measureText(rt).width,c.height-8)}function shade(hex,f){var n=parseInt(hex.slice(1),16),r=(n>>16)&255,gr=(n>>8)&255,b=n&255;r=Math.min(255,Math.round(r*(1+f)));gr=Math.min(255,Math.round(gr*(1+f)));b=Math.min(255,Math.round(b*(1+f)));return "rgb("+r+","+gr+","+b+")"}function drawTopo(m){var c=document.getElementById("topo");if(!c)return;var g=c.getContext("2d");var sub=document.getElementById("toposub");if(!m||!m.cells){sub.textContent="\u7B49\u5F85\u5730\u5F62\u6570\u636E\u2026";return}var R=m.r||16,N=2*R+1,SZ=Math.floor(c.width/N);var COL={g:"#4a7c3f",d:"#7a5b3a","#":"#6e6e6e",s:"#d9c07a","~":"#3a6ea5",L:"#e07020",w:"#8a6236",l:"#3a6b35",c:"#8f8f8f",o:"#f0c94a",T:"#ffcc44",b:"#e0564f",C:"#c39a6b",F:"#d9a03f",G:"#9fc6e8","?":"#556070",".":"#10141b"};var hs=m.heights||[];for(var i=0;i<m.cells.length&&i<N*N;i++){var ch=m.cells[i],h=hs[i]||0;var base=COL[ch]||COL["?"];g.fillStyle=shade(base,Math.max(-0.4,Math.min(0.4,h*0.06)));g.fillRect((i%N)*SZ,Math.floor(i/N)*SZ,SZ,SZ)}(m.entities||[]).forEach(function(e){var px=(e.dx+R)*SZ+SZ/2,pz=(e.dz+R)*SZ+SZ/2;var isP=/player/.test(e.name);g.fillStyle=isP?"#4fd8ff":"#ff5a5a";g.beginPath();g.arc(px,pz,3,0,7);g.fill();if(isP){g.fillStyle="#bfeaff";g.font="10px sans-serif";g.fillText(e.name.replace("(player)",""),px+5,pz+3)}});var mx=R*SZ+SZ/2,mz=R*SZ+SZ/2;var yaw=m.yaw||0,ax=-Math.sin(yaw),az=Math.cos(yaw);g.fillStyle="#fff";g.beginPath();g.arc(mx,mz,4,0,7);g.fill();g.strokeStyle="#fff";g.lineWidth=2;g.beginPath();g.moveTo(mx,mz);g.lineTo(mx+ax*12,mz+az*12);g.stroke();g.lineWidth=1;g.fillStyle="#8a93a3";g.font="11px sans-serif";g.fillText("N \u2191",6,14);sub.textContent="\u4E2D\u5FC3 "+(m.cx!=null?"("+m.cx+","+m.cy+","+m.cz+")":"\u2014")+" \xB7 "+(m.entities||[]).length+" \u5B9E\u4F53 \xB7 "+hhmmss(m.updatedAt)}function render(p){var st=p.status&&p.status.bot?p.status.bot:null;document.title="\u7A7F\u8D8A\u8005\u9762\u677F \xB7 "+((p.archive&&p.archive.name)||p.username||"?");document.getElementById("title").textContent="\u2694 "+((p.archive&&p.archive.name)||st&&st.personaName||p.username||"\u672A\u77E5\u7A7F\u8D8A\u8005");document.getElementById("sub").textContent=((p.archive&&p.archive.epithet)?p.archive.epithet+" \xB7 ":"")+(p.username||"")+(p.archive&&p.archive.source?" \xB7 "+p.archive.source:"");var live=document.getElementById("live");live.textContent=p.online?"\u{1F7E2} \u5728\u7EBF":"\u{1F534} \u5931\u8054/\u79BB\u7EBF";live.className="badge "+(p.online?"on":"off");var lv=document.getElementById("lv"),sk=document.getElementById("skill");lv.textContent=p.mystic&&p.mystic.level!=null?"Lv."+p.mystic.level:"Lv.\u2014";sk.textContent=p.mystic&&p.mystic.innateSkill?"\u5929\u8D4B\u300C"+p.mystic.innateSkill+"\u300D":"\u5929\u8D4B\u672A\u5B9A";var v=document.getElementById("vitals");if(!st){v.innerHTML="\\<div class=empty>\u6682\u65E0\u72B6\u6001\u6570\u636E\uFF08\u7B49\u5F85 agent \u8FDE\u63A5\u670D\u52A1\u5668\u2026\uFF09\\</div>"}else{var hp=st.health==null?0:st.health,fd=st.food==null?0:st.food,pos=st.position;var dirs=["\u5357","\u897F","\u5317","\u4E1C"],yaw=st.yaw==null?0:st.yaw,deg=((yaw*180/Math.PI)+360)%360,di=Math.round(deg/90)%4;v.innerHTML="<div class=vrow>\u2764 \u751F\u547D <div class=bar hp><i style=width:"+(hp/20*100)+"%></i></div> "+hp+"/20</div>"+"<div class=vrow>\u{1F357} \u9971\u98DF <div class=bar fd><i style=width:"+(fd/20*100)+"%></i></div> "+fd+"/20</div>"+"<div class=vrow>\u{1F4CD} \u5750\u6807 "+(pos?pos.x+", "+pos.y+", "+pos.z:"\u2014")+"</div>"+"<div class=vrow>\u{1F9ED} \u671D\u5411 "+dirs[di]+" \xB7 \u270B \u624B\u6301 "+(st.heldItem||"\u7A7A\u624B")+(st.sleeping?" \xB7 \u{1F634} \u7761\u7720\u4E2D":"")+"</div>"+"<div class=vrow>\u{1F3AF} \u76EE\u6807 "+esc((p.memory&&p.memory.currentGoal)||(p.status&&p.status.recentSteps&&p.status.recentSteps.length?p.status.recentSteps[p.status.recentSteps.length-1].goal:"\u2014"))+"</div>"+"<div class=vrow>\u23F1 \u8FDB\u7A0B "+fmtUptime(p.uptimeSec)+" \xB7 \u66F4\u65B0 "+hhmmss(p.status&&p.status.updatedAt)+"</div>"+ "<div class=vrow>\u{1F9E0} \u4E0A\u4E0B\u6587\u63D0\u793A\u5361 "+((p.status&&p.status.context&&p.status.context.cards||[]).length?(p.status.context.cards).map(function(k){return k.id+"\xD7"+k.remain}).join(" "):"\u65E0\uFF08\u6309\u9700\u62AB\u9732\u4E2D\uFF09")+"</div>"}var f=document.getElementById("vframe"),curPv="3";function setPv(pv){curPv=pv;if(st&&st.viewerPort){f.src="http://"+location.hostname+":"+st.viewerPort+"/?pv="+pv;}["3","smooth","map"].forEach(function(k){var b=document.getElementById("vt-"+k);if(b){b.style.background=k===pv?"var(--acc)":"transparent";b.style.color=k===pv?"#0d1117":"var(--dim)"}})}if(st&&st.viewerPort&&!viewerSet){setPv(curPv);viewerSet=true}["3","smooth","map"].forEach(function(k){var b=document.getElementById("vt-"+k);if(b)b.onclick=function(){setPv(k)}})var sh=document.getElementById("shot");if(p.latestShot&&p.latestShot!==lastShot){lastShot=p.latestShot;sh.innerHTML="<img src=/shot/"+encodeURIComponent(p.latestShot)+"?t="+Date.now()+">"}else if(!p.latestShot){sh.innerHTML="<div class=empty>\u6682\u65E0\u622A\u56FE</div>"}var steps=(p.status&&p.status.recentSteps)||[];var se=document.getElementById("steps");se.innerHTML=steps.length?steps.slice(-30).reverse().map(function(s){var bad=/error|could not|failed|timeout/i.test(s.outcome||"");return "<div class=step"+(bad?" err":"")+"><div class=meta>#"+(s.step||"?")+" \xB7 "+hhmmss(s.ts)+" \xB7 \u2692 "+esc(s.tool||"")+"</div>"+"<div class=th>\u{1F4AD} "+esc(s.thought||"")+"</div><div class=meta>\u{1F3AF} "+esc(s.goal||"")+"</div>"+"<div class=out>"+esc((s.outcome||"").slice(0,300))+"</div></div>"}).join(""):"<div class=empty>\u6682\u65E0\u884C\u52A8\u8BB0\u5F55</div>";var inv=(st&&st.inventory)||[],agg={};inv.forEach(function(i){agg[i.name]=(agg[i.name]||0)+i.count});var keys=Object.keys(agg).sort(function(a,b){return agg[b]-agg[a]});document.getElementById("inv").innerHTML=keys.length?keys.map(function(k){return "<span class=chip>"+esc(k)+" \xD7"+agg[k]+"</span>"}).join(""):"<div class=empty>\u80CC\u5305\u7A7A\u7A7A\u5982\u4E5F</div>";var w=p.wiki,wd=document.getElementById("wiki");wd.innerHTML=w.total?"<div class=item>\u5171 "+w.total+" \u5F20\u77E5\u8BC6\u5361\uFF08\u5C55\u793A\u6700\u8FD1 "+w.cards.length+" \u5F20\uFF09</div>"+w.cards.map(function(c){return "<div class=item><div>"+esc(c.topic)+"</div><div class=t>"+esc(c.source)+" \xB7 "+hhmmss(c.ts)+" \xB7 "+esc((c.content||"").slice(0,80))+"\u2026</div></div>"}).join(""):"<div class=empty>\u8FD8\u6CA1\u5B66\u4F1A\u4EFB\u4F55\u6559\u8BAD</div>";var ds=p.defects,dd=document.getElementById("defects");dd.innerHTML=ds.length?ds.slice(0,6).map(function(d){return "<div class=item><div>\u2692 "+esc(d.tool)+" \xD7"+(d.count!=null?d.count:"?")+"</div><div class=t>"+esc(d.lastSample||d.lastAt||d.file)+"</div></div>"}).join(""):"<div class=empty>\u65E0\u672A\u51B3\u5DE5\u5355\uFF0C\u8FD0\u884C\u5065\u5EB7</div>";var ar=p.archive,ad=document.getElementById("archive");ad.innerHTML=ar?"<div class=item>\u540D\u5B57\uFF1A"+esc(ar.name)+"</div><div class=item>\u79F0\u53F7\uFF1A"+esc(ar.epithet||"\u2014")+"</div><div class=item>\u6765\u81EA\uFF1A"+esc(ar.source||"\u2014")+"</div><div class=item>MC \u7528\u6237\u540D\uFF1A"+esc(p.username)+"</div>":"<div class=empty>\u672A\u6CE8\u518C\u7A7F\u8D8A\u8005\u6863\u6848</div>";var kb=document.getElementById("kills");kb.textContent=p.kills&&p.kills.recent?"\u2694 \u8FD1\u671F\u51FB\u6740 "+p.kills.recent:"\u2694 0";var ev=document.getElementById("events");ev.innerHTML=p.events&&p.events.length?p.events.slice(0,25).map(function(e){return "<div class=step"+(e.kill?" err":"")+"><div class=meta>"+hhmmss(e.ts)+(e.kill?" \xB7 \u2694 \u6218\u6597":"")+"</div><div class=out>"+esc(e.text.slice(0,260))+"</div></div>"}).join(""):"<div class=empty>\u6682\u65E0\u7F16\u5E74\u53F2</div>";drawTopo(p.topo);drawMap(p)}function tick(){fetch("/api/all").then(function(r){return r.json()}).then(render).catch(function(){})}tick();setInterval(tick,3000);</script></body></html>';
}
export {
  Config,
  apply,
  collect,
  facingLabel,
  inject,
  name,
  resolveShotPath,
  resolveUsername
};
