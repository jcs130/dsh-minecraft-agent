# 一键安装（已有 dsh 的用户）

dsh-minecraft-agent 是一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 组合包（bundle）。
它让你的 AI 以"穿越者"身份进入任意 Minecraft Java 服务器（1.21.x）自主生存——挖矿、建造、社交、
施法、睡觉、记日记，全程零 RCON、零服务器端修改。

## 前置要求

- 已安装 dsh CLI（含 pnpm）
- Node.js ≥ 22
- 一个 MC Java 服务器地址（正版或离线模式均可）
- 一个 OpenAI 兼容的本地/远程模型端点（vLLM / Ollama / 云 API 都行）

## 安装

### 方式 A：git 直装（推荐先体验）

```sh
dsh plugin --profile mc add github:jcs130/dsh-minecraft-agent#<commit-sha>
```

首次 add 会因 pnpm ≥10 构建授权失败。把 pnpm 提示的确切包键加进
`$DSH_HOME/profiles/mc/pnpm-workspace.yaml`：

```yaml
allowBuilds:
  dsh-minecraft-agent: true   # 允许 prepare 脚本运行（仅 esbuild 打包，无网络动作）
```

重新执行 add 即可。

### 方式 B：tarball（免构建授权）

作者侧 `npm pack` 产出 `dsh-minecraft-agent-0.1.0.tgz`（已含 lib/ 预构建产物）：

```sh
dsh plugin --profile mc add ./dsh-minecraft-agent-0.1.0.tgz
```

### 方式 C：npm 发布后（最顺滑）

```sh
dsh plugin --profile mc add dsh-minecraft-agent
```

## 启动一个穿越者

每个 AI 玩家一个进程。装好依赖后直接跑 CLI：

```sh
# 面板 :3200，3D 视角 :3001
MC_USERNAME=Asuna \
MC_HOST=<你的服务器IP> \
MC_PANEL_PORT=3200 \
MC_VIEWER_PORT=3001 \
MC_LLM_BASE_URL=http://<模型端点>/v1 \
MC_LLM_MODEL=qwen3.8 \
MC_LLM_API_KEY=sk-xxx \
npx dsh-minecraft-agent
```

或用 flag 等价形式：`npx dsh-minecraft-agent --username Asuna --host <ip> --panel-port 3200`。

打开 `http://127.0.0.1:3200` 看观察面板（状态 / 3D 游戏视角三模式 / 编年史 / 击杀 / wiki / 缺陷流）。

## 关键环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `MC_USERNAME` | （必填） | MC 用户名，一个名字一个穿越者 |
| `MC_HOST` / `MC_PORT` | localhost / 25565 | 服务器地址 |
| `MC_PANEL_PORT` | 3200 | 观察面板端口 |
| `MC_VIEWER_PORT` | 3001 | prismarine-viewer 3D 视角端口 |
| `MC_LLM_BASE_URL` | http://localhost:8890/v1 | OpenAI 兼容端点 |
| `MC_LLM_MODEL` | qwen3.8 | 模型名 |
| `MC_REASONING_EFFORT` | none | 思考档位 none/low/medium |
| `MC_MEMOS_URL` | http://127.0.0.1:8002 | MemOS 长期记忆（可选，挂了自动降级） |
| `MC_EVOLVE` / `MC_ADAPT` / `MC_DIARY` | 1 | 夜间进化/自适应/日记开关 |

## 为什么不需要 Docker？

Docker 只是作者侧的一种部署形态。插件本体是纯 Node 包：
mineflayer/prismarine 全是 JS 实现，`better-sqlite3` 由 pnpm 自动拉预编译产物。
`dsh plugin add` 装完即跑，跟装任何 npm 包一样。

## 卸载

```sh
dsh plugin --profile mc remove dsh-minecraft-agent
```
