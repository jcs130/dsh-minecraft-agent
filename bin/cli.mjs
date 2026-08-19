#!/usr/bin/env node
// dsh-minecraft-agent CLI —— 拉起一个穿越者（AI 玩家）进程。
// 用法：dsh-minecraft-agent [--username Asuna] [--host 127.0.0.1] [--port 25565]
// 全部参数可被同名环境变量覆盖（MC_USERNAME / MC_HOST / MC_PORT / MC_PANEL_PORT / MC_VIEWER_PORT …）。
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null
}
if (flag('username')) process.env.MC_USERNAME = flag('username')
if (flag('host')) process.env.MC_HOST = flag('host')
if (flag('port')) process.env.MC_PORT = flag('port')
if (flag('panel-port')) process.env.MC_PANEL_PORT = flag('panel-port')
if (flag('viewer-port')) process.env.MC_VIEWER_PORT = flag('viewer-port')
if (args.includes('--help') || args.includes('-h')) {
  console.log(`dsh-minecraft-agent — AI 玩家（穿越者）进程
  --username <name>   MC 用户名（必填或 MC_USERNAME）
  --host <ip>         MC 服务器地址（默认 localhost）
  --port <n>          MC 服务器端口（默认 25565）
  --panel-port <n>    观察面板端口（默认 3200）
  --viewer-port <n>   3D 视角端口（默认 3001）
环境变量：MC_LLM_BASE_URL / MC_LLM_MODEL / MC_LLM_API_KEY（模型端点）等，见 README-INSTALL.md`)
  process.exit(0)
}
if (!process.env.MC_USERNAME) {
  console.error('[cli] 缺用户名：--username <name> 或环境变量 MC_USERNAME')
  process.exit(1)
}
await import('../lib/bootstrap.mjs')
