#!/usr/bin/env node
// dsh-minecraft-agent 一键部署 —— 把一个"穿越者"AI 玩家部署到任意 MC 服务器。
//
// 用法（在仓库根目录）：
//   node deploy.mjs --mc-host 192.168.1.10 --username Kirito \
//     --llm-base-url http://127.0.0.1:8890/v1 --llm-model qwen3.8
//
// 前置拓扑：本仓库必须放在 deepseek-harness 检出目录内（@deepseek-ai/* 包
// 不在 npm 上，靠 vendor 链接从 harness 取）。首次部署标准姿势：
//   git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git
//   cd deepseek-harness
//   git clone https://github.com/jcs130/dsh-minecraft-agent.git
//   cd dsh-minecraft-agent && node deploy.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---------- args ----------
const args = process.argv.slice(2)
const opt = {}
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--yes' || a === '--no-viewer' || a === '--skip-install' || a === '--skip-check') opt[a.slice(2)] = true
  else if (a.startsWith('--')) opt[a.slice(2)] = args[++i]
}
const cfg = {
  mcHost: opt['mc-host'] ?? 'localhost',
  mcPort: Number(opt['mc-port'] ?? 25565),
  username: opt.username ?? 'Kirito',
  viewerPort: Number(opt['viewer-port'] ?? 3001),
  panelPort: Number(opt['panel-port'] ?? 3200),
  viewer: !opt['no-viewer'],
  llmBaseUrl: opt['llm-base-url'] ?? 'http://127.0.0.1:8890/v1',
  llmApiKey: opt['llm-api-key'] ?? 'sk-local',
  llmModel: opt['llm-model'] ?? 'qwen3.8',
}

const log = (s) => console.log(s)
const ok = (s) => console.log(`  ✓ ${s}`)
const die = (s) => { console.error(`✗ ${s}`); process.exit(1) }

log('╔══════════════════════════════════════════════════╗')
log('║   dsh-minecraft-agent 穿越者部署                  ║')
log('╚══════════════════════════════════════════════════╝')

// ---------- 1. node 版本 ----------
const [maj] = process.versions.node.split('.').map(Number)
if (maj < 20) die(`需要 Node.js >= 20（当前 ${process.versions.node}）`)
ok(`Node ${process.versions.node}`)

// ---------- 2. 定位 harness ----------
const isHarness = (p) => existsSync(path.join(p, 'vendor', 'cordis', 'package.json'))
let harness = opt.harness ? path.resolve(opt.harness) : path.resolve(here, '..')
if (!isHarness(harness)) {
  // 尝试常见兄弟目录名
  for (const cand of [path.resolve(here, '..', 'deepseek-harness'), path.resolve(here, '..', 'harness')]) {
    if (isHarness(cand)) { harness = cand; break }
  }
}
if (!isHarness(harness)) {
  console.error('✗ 没找到 deepseek-harness（@deepseek-ai/* 包住在里面，必须先有它）。')
  console.error('  标准姿势：')
  console.error('    git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git')
  console.error('    cd deepseek-harness')
  console.error('    git clone https://github.com/jcs130/dsh-minecraft-agent.git')
  console.error('    cd dsh-minecraft-agent && node deploy.mjs')
  console.error('  （或用 --harness <path> 指定已存在的 harness 目录，且本仓库须位于其内）')
  process.exit(1)
}
ok(`harness: ${harness}`)
if (path.dirname(here) !== harness) {
  die('本仓库必须直接位于 harness 目录内（node_modules 解析依赖 ../node_modules）。\n  请把仓库 clone 到 harness 里面再跑 deploy。')
}

// ---------- 3. 依赖安装 ----------
const run = (cmd, cwdArgs, cwd, label) => {
  log(`▶ ${label} ...`)
  const r = spawnSync(cmd, cwdArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) die(`${label} 失败（exit ${r.status}）`)
  ok(label)
}
if (!opt['skip-install']) {
  if (!existsSync(path.join(harness, 'node_modules', '.bin'))) {
    run('npm', ['install', '--legacy-peer-deps'], harness, 'harness 依赖安装')
  } else ok('harness 依赖已就绪')
  if (!existsSync(path.join(here, 'node_modules', 'mineflayer'))) {
    run('npm', ['install', '--legacy-peer-deps'], here, '插件依赖安装')
  } else ok('插件依赖已就绪')
}

// ---------- 4. vendor 链接 ----------
run('node', ['setup-vendor-links.mjs'], here, '@deepseek-ai vendor 链接')

// ---------- 5. native 渲染（可选） ----------
if (cfg.viewer && !opt['skip-install'] && !existsSync(path.join(here, 'node_modules', 'node-canvas-webgl'))) {
  log('▶ 安装 native 渲染模块（viewer 用；失败可改 --no-viewer 重跑）...')
  const r = spawnSync('npm', ['i', '--no-save', '--legacy-peer-deps', 'node-canvas-webgl', 'canvas@3.2.3', 'gl'],
    { cwd: here, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    console.log('  ⚠ native 渲染模块装不上（缺编译环境很常见）——bot 仍可无头运行，')
    console.log('    启动脚本已设 MC_VIEWER=0；想看 3D 视角再补装。')
    cfg.viewer = false
  } else ok('native 渲染模块')
}

// ---------- 6. LLM 连通性 ----------
if (!opt['skip-check']) {
  log(`▶ 检查 LLM 端点 ${cfg.llmBaseUrl} ...`)
  try {
    const res = await fetch(cfg.llmBaseUrl.replace(/\/$/, '') + '/models',
      { headers: { Authorization: `Bearer ${cfg.llmApiKey}` }, signal: AbortSignal.timeout(5000) })
    // 有些兼容端点没有 /models 路由，能建立连接就算通
    ok(`LLM 端点可达（HTTP ${res.status}）`)
  } catch (e) {
    console.log(`  ⚠ LLM 端点暂不可达（${e.message}）——bot 启动后会重试，但请确认地址/服务`)
  }
}

// ---------- 7. 生成启动脚本 ----------
mkdirSync(path.join(here, 'data'), { recursive: true })
const envLines = () => [
  `set "MC_HOST=${cfg.mcHost}"`,
  `set "MC_PORT=${cfg.mcPort}"`,
  `set "MC_VIEWER=${cfg.viewer ? '1' : '0'}"`,
  `set "MC_VIEWER_PORT=${cfg.viewerPort}"`,
  `set "MC_PANEL_PORT=${cfg.panelPort}"`,
  `set "MC_LLM_BASE_URL=${cfg.llmBaseUrl}"`,
  `set "MC_LLM_API_KEY=${cfg.llmApiKey}"`,
  `set "MC_LLM_MODEL=${cfg.llmModel}"`,
]
const bat = [
  '@echo off',
  `rem 由 deploy.mjs 生成于 ${new Date().toISOString()}`,
  'rem 用法: start-transmigrator.bat [用户名]（默认 ' + cfg.username + '）',
  'cd /d %~dp0',
  'setlocal',
  `if "%1"=="" (set "MC_USERNAME=${cfg.username}") else set "MC_USERNAME=%1"`,
  ...envLines(),
  `echo ===== transmigrator %MC_USERNAME% boot %date% %time% ===== >> data\\bot-%MC_USERNAME%.log`,
  `..\\node_modules\\.bin\\tsx.CMD bootstrap-mc.mts >> data\\bot-%MC_USERNAME%.log 2>> data\\bot-%MC_USERNAME%.err.log`,
  'endlocal',
].join('\r\n')
writeFileSync(path.join(here, 'start-transmigrator.bat'), bat, 'utf8')

const sh = [
  '#!/bin/sh',
  `# 由 deploy.mjs 生成于 ${new Date().toISOString()}`,
  '# 用法: ./start-transmigrator.sh [用户名]',
  'cd "$(dirname "$0")"',
  'MC_USERNAME="${1:-' + cfg.username + '}"; export MC_USERNAME',
  `MC_HOST=${cfg.mcHost}; export MC_HOST`,
  `MC_PORT=${cfg.mcPort}; export MC_PORT`,
  `MC_VIEWER=${cfg.viewer ? '1' : '0'}; export MC_VIEWER`,
  `MC_VIEWER_PORT=${cfg.viewerPort}; export MC_VIEWER_PORT`,
  `MC_PANEL_PORT=${cfg.panelPort}; export MC_PANEL_PORT`,
  `MC_LLM_BASE_URL=${cfg.llmBaseUrl}; export MC_LLM_BASE_URL`,
  `MC_LLM_API_KEY=${cfg.llmApiKey}; export MC_LLM_API_KEY`,
  `MC_LLM_MODEL=${cfg.llmModel}; export MC_LLM_MODEL`,
  `mkdir -p data`,
  `echo "===== transmigrator $MC_USERNAME boot $(date) =====" >> data/bot-$MC_USERNAME.log`,
  `../node_modules/.bin/tsx bootstrap-mc.mts >> data/bot-$MC_USERNAME.log 2>> data/bot-$MC_USERNAME.err.log`,
].join('\n')
writeFileSync(path.join(here, 'start-transmigrator.sh'), sh, { mode: 0o755 })

// .env.example（手动玩家的参考手册）
writeFileSync(path.join(here, '.env.example'), [
  '# dsh-minecraft-agent 环境变量手册（deploy.mjs 会把它们烤进 start-transmigrator.*）',
  'MC_HOST=localhost            # MC 服务器地址',
  'MC_PORT=25565                # MC 服务器端口',
  'MC_USERNAME=Kirito           # bot 用户名（离线服任意名；正版服须已购）',
  'MC_GOD_NAME=Goddess          # 女神化身名（须与世界侧一致）',
  'MC_VIEWER=1                  # 0=无头跑（不装 native 渲染模块）',
  'MC_VIEWER_PORT=3001          # 第三人称观察端口（第一人称=+100）',
  'MC_PANEL_PORT=3200           # 本 bot 观察面板端口',
  'MC_LLM_BASE_URL=http://127.0.0.1:8890/v1   # OpenAI 兼容端点',
  'MC_LLM_API_KEY=sk-local',
  'MC_LLM_MODEL=qwen3.8',
  'QWENPAW_CONSOLE_URL=http://127.0.0.1:8088/api/console/chat  # 可选：缺陷上报',
  ''].join('\n'), 'utf8')

ok('生成 start-transmigrator.bat / .sh / .env.example')

// ---------- 8. 收尾 runbook ----------
log('')
log('部署完成 🎉 启动顺序：')
log(`  1. 确认 MC 服务器 ${cfg.mcHost}:${cfg.mcPort} 在线（离线模式或已购账号）`)
log(`  2. .\\start-transmigrator.bat        # *nix: ./start-transmigrator.sh`)
log(`  3. 观察面板 http://localhost:${cfg.panelPort}${cfg.viewer ? ` ，3D 视角 http://localhost:${cfg.viewerPort}` : '（无头模式）'}`)
log('  4. 进服后 bot 会自动参加降临仪式、选出生天赋，然后开始自主生存')
log('')
log('提醒：若世界侧部署了 minecraft-ai-friend（女神/魔法/仪式），MC_GOD_NAME 须两侧一致。')
