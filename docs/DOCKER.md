# Docker 部署与局域网接入指南

本仓的穿越者（AI 玩家客户端）已容器化：**每个 AI 玩家一个容器**，无头运行、
零 RCON（镜像里根本不存在世界侧文件）、自带 Web 观察面板（:3200）。
任何一台装了 Docker 的电脑（Windows / macOS / Linux）都能一条命令接入世界。

## 一图流

```
你的电脑（如局域网小 P）                     世界服务器（如 192.168.3.133）
┌──────────────────────────┐               ┌─────────────────────────────┐
│  mc-join CLI / webui     │               │  MC 服 :25565（离线模式）     │
│   └─ docker 容器          │──MC 协议────▶ │  世界进程（天神，唯一 RCON）  │
│      穿越者 bot           │◀──公屏聊天─── │  LLM :8890 / MemOS :8002     │
│      面板 :3200           │──LLM/记忆───▶ │  （均开放局域网访问）          │
└──────────────────────────┘               └─────────────────────────────┘
```

穿越者与世界**只通过 MC 聊天协议通信**（公屏咏唱/私聊祈愿），LLM 与记忆服务
走 HTTP 指回世界服务器。穿越者容器不持有任何服务器权限。

## 服务器侧（一次性，给接入者准备好环境）

1. MC 服开启离线模式（`online-mode=false`），25565 对局域网开放。
2. LLM 端点（OpenAI 兼容，如 vLLM :8890）与 MemOS（:8002）监听 `0.0.0.0`，
   防火墙放行局域网。
3. 世界进程按 [minecraft-ai-friend](https://github.com/jcs130/minecraft-ai-friend)
   的 `docker-compose.yml` 起好（天神会自动接待新穿越者的降临仪式）。

## 接入者侧（小 P 电脑，三步）

### 1. 拿镜像（二选一）

```bash
# a) 局域网文件分发（服务器已导出到 M:\docker-images\）：
docker load -i mc-transmigrator-20260818.tar

# b) 自己构建（需要本仓 + deepseek-harness 平级 checkout）：
docker build -f deepseek-harness/scratch-plugin/Dockerfile -t mc-transmigrator .
```

### 2. 拿 CLI（只需一个文件）

从本仓拷 `cli/mc-join.mjs`（仅依赖本机已装的 node + docker）。

### 3. 接入

```bash
node mc-join.mjs join --name XiaoP --host 192.168.3.133
# ✅ XiaoP 已加入世界！
#    面板  → http://localhost:3200      ← 浏览器打开看它的一举一动
#    日志  → node mc-join.mjs logs XiaoP
```

进服后 60 秒内，世界侧天神会主持**降临仪式**（公屏宣读出生天赋候选，AI 自己选），
之后就是一个活生生的穿越者：采集、建造、念咒、社交，全自动。

不喜欢默认「旅人」人设？一句话定制：

```bash
node mc-join.mjs join --name XiaoP --host 192.168.3.133 \
  --persona "沉默寡言的剑客，惜字如金" --epithet "断剑客"
```

### 图形界面（可选）

```bash
node mc-join.mjs webui          # 打开 http://localhost:9100
```

浏览器里填玩家名 + 服务器 IP，点「加入世界」，一样的效果。

## CLI 速查

| 命令 | 作用 |
|---|---|
| `join --name X [--host IP] [--llm URL] [--persona 文案] [--fg]` | 接入/重接入（记忆 volume 保留） |
| `ls` | 列出本机所有 AI 玩家容器 |
| `logs X [-f]` | 看运行日志（`-f` 跟随） |
| `stop X` / `restart X` | 下线 / 重启 |
| `rm X [--volumes]` | 移除容器（`--volumes` 连记忆一起删） |
| `webui [--port 9100]` | 图形化接入台 |

## 环境变量（docker run 直接用时）

CLI 只是 `docker run` 的糖。手动跑时的关键变量（镜像内已有默认值）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `MC_USERNAME` | HarnessBot | 玩家名（世界内的身份） |
| `MC_HOST` / `MC_PORT` | host.docker.internal / 25565 | MC 服务器地址 |
| `MC_LLM_BASE_URL` / `MC_LLM_URL` | http://host.docker.internal:8890/v1 | LLM 端点（两套变量分别供 loop/evolve 用） |
| `MC_LLM_MODEL` | qwen3.8 | 模型名 |
| `MC_MEMOS_URL` | http://host.docker.internal:8002 | 长期记忆服务 |
| `MC_PERSONA` / `MC_BACKSTORY` / `MC_EPITHET` | 自动生成「旅人」 | 首启人设种子（之后改 volume 里的档案） |
| `MC_PANEL_PORT` / `MC_PANEL_HOST` | 3200 / 0.0.0.0 | 自带观察面板 |

## 已知边界（无头部署）

- **无 3D 视角**：容器内没有 canvas/WebGL 全家桶（`mc_see` 的进程内相机与
  playwright 截图均不可用，工具返回错误文本，bot 会绕开）。观察走 :3200 面板。
- **同机部署用 `host.docker.internal`**：Docker Desktop 下容器访问宿主发布的
  docker 端口（LLM/MemOS）走 `host.docker.internal`；直接写宿主 LAN IP 会有
  hairpin 问题。**跨机部署则直接写服务器 LAN IP**（CLI 已自动处理）。
- 首次启动自动生成 `transmigrators.json` + persona/backstory；后续人格润色直接
  改 volume（`docker volume inspect mc-agent-<名>-data` 找路径）。
