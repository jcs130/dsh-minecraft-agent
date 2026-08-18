#!/usr/bin/env node
// mc-join —— 穿越者（AI 玩家）接入 CLI。
//
// 面向「局域网里任何一台装了 Docker 的电脑」：一条命令把自己的 Agent
// 玩家接入 MC 世界服务器，不碰服务器、不需要 RCON、不需要本仓库源码
// （只需镜像 mc-transmigrator + 本文件）。
//
// 快速上手：
//   node mc-join.mjs join --name XiaoP --host 192.168.3.133
//   node mc-join.mjs ls
//   node mc-join.mjs logs XiaoP
//   node mc-join.mjs stop XiaoP && node mc-join.mjs rm XiaoP
//   node mc-join.mjs webui                 # 浏览器图形化接入面板 http://localhost:9100
//
// join 可选参数：
//   --host    MC 服务器地址（默认 host.docker.internal = 本机）
//   --port    MC 服务器端口（默认 25565）
//   --llm     LLM OpenAI 兼容端点（默认 http://<host>:8890/v1）
//   --model   模型名（默认 qwen3.8）
//   --memos   MemOS 记忆服务（默认 http://<host>:8002；传 none 关闭）
//   --panel   本机面板端口（默认 3200，被占自动 +1）
//   --persona / --backstory / --epithet   自定义人设（缺省自动生成「旅人」档案）
//   --image   镜像名（默认 mc-transmigrator:latest）
//   --fg      前台运行（看实时日志，Ctrl+C 退出容器）
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'

const IMAGE_DEFAULT = 'mc-transmigrator:latest'

// ---------- 小工具 ----------
function docker(args, opts = {}) {
  const r = spawnSync('docker', args, { stdio: opts.stdio ?? 'inherit', encoding: 'utf8' })
  if (r.error) {
    console.error(`✗ 找不到 docker 命令：${r.error.message}（请先安装 Docker Desktop）`)
    process.exit(1)
  }
  return r
}
function dockerOut(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8' })
  return r.status === 0 ? (r.stdout || '') : ''
}
function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const v = argv[i + 1]
      out[a.slice(2)] = v && !v.startsWith('--') ? ((i++, v)) : true
    } else out._.push(a)
  }
  return out
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9_-]/g, '')
const containerName = (name) => `mc-agent-${slug(name) || 'agent'}`
function portBusy(port) {
  return dockerOut(['ps', '--format', '{{.Ports}}']).split('\n').some((l) => l.includes(`:${port}->`))
}
function pickPort(base) {
  let p = base
  while (portBusy(p)) p++
  return p
}

// ---------- join：核心接入 ----------
function join(a) {
  const name = a._[0] || a.name
  if (!name) {
    console.error('用法：mc-join.mjs join --name <玩家名> [--host 服务器IP] [选项]')
    process.exit(1)
  }
  const host = a.host || 'host.docker.internal'
  const llm = a.llm || (host === 'host.docker.internal' ? undefined : `http://${host}:8890/v1`)
  const memos = a.memos === 'none' ? 'http://127.0.0.1:1' : a.memos || (host === 'host.docker.internal' ? undefined : `http://${host}:8002`)
  const panel = pickPort(Number(a.panel) || 3200)
  const cname = containerName(name)
  const vol = `${cname}-data`

  // 幂等：同名容器先清场
  if (dockerOut(['ps', '-a', '--format', '{{.Names}}']).includes(cname)) {
    console.log(`↻ 已存在 ${cname}，先移除旧容器（volume ${vol} 保留，记忆不丢）`)
    docker(['rm', '-f', cname], { stdio: 'pipe' })
  }

  const env = [
    '-e', `MC_USERNAME=${name}`,
    '-e', `MC_HOST=${host}`,
    '-e', `MC_PORT=${a.port || 25565}`,
  ]
  if (llm) env.push('-e', `MC_LLM_BASE_URL=${llm}`, '-e', `MC_LLM_URL=${llm}`)
  if (a.model) env.push('-e', `MC_LLM_MODEL=${a.model}`)
  if (memos) env.push('-e', `MC_MEMOS_URL=${memos}`)
  if (a.persona && a.persona !== true) env.push('-e', `MC_PERSONA=${a.persona}`)
  if (a.backstory && a.backstory !== true) env.push('-e', `MC_BACKSTORY=${a.backstory}`)
  if (a.epithet && a.epithet !== true) env.push('-e', `MC_EPITHET=${a.epithet}`)

  console.log(`▶ 接入 ${name} @ ${host}:${a.port || 25565}（LLM=${llm || '镜像默认'}，面板=:${panel}）`)
  const run = ['run', ...(a.fg ? ['--rm', '-it'] : ['-d', '--restart', 'unless-stopped']),
    '--name', cname, '--add-host', 'host.docker.internal:host-gateway',
    ...env, '-p', `${panel}:3200`, '-v', `${vol}:/app/data`,
    a.image || IMAGE_DEFAULT]
  const r = docker(run, { stdio: 'pipe' })
  if (r.status !== 0) {
    console.error(r.stderr || 'docker run 失败')
    process.exit(1)
  }
  console.log(`✅ ${name} 已加入世界！`)
  console.log(`   面板  → http://localhost:${panel}`)
  console.log(`   日志  → node mc-join.mjs logs ${name}`)
  console.log(`   停止  → node mc-join.mjs stop ${name}`)
}

// ---------- 其余子命令 ----------
function ls() {
  const out = dockerOut(['ps', '-a', '--filter', 'name=mc-agent-', '--format',
    '{{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}'])
  if (!out.trim()) return console.log('（暂无 AI 玩家。用 join 接入第一个）')
  console.log('CONTAINER                  STATUS                    PORTS                 IMAGE')
  for (const l of out.trim().split('\n')) {
    const [n, s, p, i] = l.split('\t')
    console.log(`${(n || '').padEnd(26)}${(s || '').padEnd(26)}${(p || '').padEnd(22)}${i || ''}`)
  }
}
function withName(a, fn) {
  const name = a._[0] || a.name
  if (!name) { console.error('缺玩家名：node mc-join.mjs <子命令> <name>'); process.exit(1) }
  fn(containerName(name), name)
}
function logs(a) { withName(a, (c) => docker(a.f ? ['logs', '-f', '--tail', '100', c] : ['logs', '--tail', '100', c])) }
function stop(a) { withName(a, (c, n) => { docker(['stop', c]); console.log(`⏹ ${n} 已下线（volume 保留）`) }) }
function restart(a) { withName(a, (c, n) => { docker(['restart', c]); console.log(`↻ ${n} 已重启`) }) }
function rm(a) {
  withName(a, (c, n) => {
    docker(['rm', '-f', c])
    if (a.volumes) docker(['volume', 'rm', `${c}-data`])
    console.log(`🗑 ${n} 已移除${a.volumes ? '（含记忆 volume）' : '（记忆 volume 保留，rm --volumes 可彻底删）'}`)
  })
}

// ---------- webui：图形化接入面板 ----------
const PAGE = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MC 穿越者接入台</title><style>
body{font-family:system-ui,"Segoe UI",sans-serif;background:#0f1216;color:#e8e6e3;margin:0;padding:32px}
.card{max-width:560px;margin:0 auto;background:#171c22;border:1px solid #2a323c;border-radius:12px;padding:24px}
h1{font-size:20px;margin:0 0 4px}p.sub{color:#8b949e;margin:0 0 20px;font-size:13px}
label{display:block;font-size:12px;color:#8b949e;margin:12px 0 4px}
input{width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #2a323c;border-radius:8px;color:#e8e6e3;padding:8px 10px;font-size:14px}
button{margin-top:20px;width:100%;padding:11px;border:0;border-radius:8px;background:#4f8cff;color:#fff;font-size:15px;cursor:pointer}
button:hover{background:#3d7bf5}#msg{margin-top:14px;font-size:13px;white-space:pre-wrap}
.agents{margin-top:22px;border-top:1px solid #2a323c;padding-top:14px;font-size:13px}
.agents a{color:#4f8cff;text-decoration:none}.agents .off{color:#8b949e}
</style></head><body><div class="card">
<h1>⚔ MC 穿越者接入台</h1>
<p class="sub">把你的 Agent 玩家接入局域网 MC 世界（零 RCON，纯聊天协议）</p>
<label>玩家名（Agent 在世界里的名字）</label><input id="name" placeholder="XiaoP">
<label>MC 服务器 IP</label><input id="host" placeholder="192.168.3.133">
<label>人设一句话（可选，默认「旅人」）</label><input id="persona" placeholder="例：沉默寡言的剑客，惜字如金">
<button onclick="join()">加入世界</button><div id="msg"></div>
<div class="agents" id="agents">加载中…</div>
</div><script>
async function refresh(){const r=await fetch('/api/agents');const j=await r.json();
document.getElementById('agents').innerHTML='<b>在线穿越者</b><br>'+(
j.length?j.map(x=>x.running?x.name+' <span class="off">· 面板</span> <a href="http://localhost:'+x.port+'" target="_blank">打开</a><br>'
:'<span class="off">'+x.name+' · 已停止</span><br>').join(''):'（暂无）')}
async function join(){const b=document.getElementById('msg');b.textContent='接入中…';
const r=await fetch('/api/join',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({name:name.value.trim()||'Agent'+(Math.random()*900+100|0),host:host.value.trim()||'host.docker.internal',persona:persona.value.trim()})});
const j=await r.json();b.textContent=j.ok?('✅ '+j.name+' 已加入！面板 → '+j.panel):('✗ '+j.error);refresh()}
refresh();setInterval(refresh,5000)
</script></body></html>`

function webui(a) {
  const port = Number(a.port) || 9100
  createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(PAGE)
    }
    if (req.url === '/api/agents') {
      const out = dockerOut(['ps', '-a', '--filter', 'name=mc-agent-', '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}'])
      const agents = out.trim().split('\n').filter(Boolean).map((l) => {
        const [name, status, ports] = l.split('\t')
        const m = /0\.0\.0\.0:(\d+)->/.exec(ports || '')
        return { name: name.replace(/^mc-agent-/, ''), running: /Up /.test(status), port: m ? m[1] : null }
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(agents))
    }
    if (req.method === 'POST' && req.url === '/api/join') {
      let body = ''
      req.on('data', (c) => (body += c))
      return req.on('end', () => {
        try {
          const j = JSON.parse(body || '{}')
          const host = j.host || 'host.docker.internal'
          const cname = containerName(j.name || '')
          if (dockerOut(['ps', '-a', '--format', '{{.Names}}']).includes(cname)) docker(['rm', '-f', cname], { stdio: 'pipe' })
          const panel = pickPort(3200)
          const env = ['-e', `MC_USERNAME=${j.name}`, '-e', `MC_HOST=${host}`]
          if (host !== 'host.docker.internal') {
            env.push('-e', `MC_LLM_BASE_URL=http://${host}:8890/v1`, '-e', `MC_LLM_URL=http://${host}:8890/v1`,
              '-e', `MC_MEMOS_URL=http://${host}:8002`)
          }
          if (j.persona) env.push('-e', `MC_PERSONA=${j.persona}`)
          const r = docker(['run', '-d', '--restart', 'unless-stopped', '--name', cname,
            '--add-host', 'host.docker.internal:host-gateway', ...env,
            '-p', `${panel}:3200`, '-v', `${cname}-data:/app/data`, IMAGE_DEFAULT], { stdio: 'pipe' })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(r.status === 0
            ? JSON.stringify({ ok: true, name: j.name, panel: `http://localhost:${panel}` })
            : JSON.stringify({ ok: false, error: r.stderr || 'docker run 失败' }))
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }))
        }
      })
    }
    res.writeHead(404); res.end()
  }).listen(port, () => console.log(`⚔ 接入台已开：http://localhost:${port}`))
}

// ---------- main ----------
const [cmd, ...rest] = process.argv.slice(2)
const a = parseArgs(rest)
const cmds = { join, ls, logs, stop, restart, rm, webui }
if (!cmd || !cmds[cmd]) {
  console.log('mc-join —— MC 穿越者（AI 玩家）接入 CLI\n\n用法：')
  console.log('  node mc-join.mjs join --name <名> [--host IP] [--llm URL] [--panel 端口] [--persona 人设] [--fg]')
  console.log('  node mc-join.mjs ls | logs <名> [-f] | stop <名> | restart <名> | rm <名> [--volumes]')
  console.log('  node mc-join.mjs webui [--port 9100]')
  process.exit(cmd ? 1 : 0)
}
cmds[cmd](a)
