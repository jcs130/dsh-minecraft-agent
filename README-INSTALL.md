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

### 方式 A：git 直装（推荐，零构建脚本）

```sh
dsh plugin --profile mc add github:jcs130/dsh-minecraft-agent
```

lib/ 预构建产物已随仓库分发（无 prepare 脚本、无原生编译依赖），
pnpm ≥10/11 无需任何 allowBuilds 配置，直接装完。

> 可选：视觉栈（mc-camera 第一人称截图）依赖 node-canvas-webgl + canvas，
> 缺失时自动降级（不影响工具/记忆/咏唱等主功能）。需要的话自行
> `pnpm add node-canvas-webgl canvas`（Windows 需预编译版，Linux 可源码编译）。

### 方式 B：tarball（离线分发）

作者侧 `npm pack` 产出 `dsh-minecraft-agent-0.1.0.tgz`（已含 lib/ 预构建产物）：

```sh
dsh plugin --profile mc add ./dsh-minecraft-agent-0.1.0.tgz
```

### 方式 C：npm 发布后（最顺滑）

```sh
dsh plugin --profile mc add dsh-minecraft-agent
```

## 启动一个穿越者

安装后，组合包 `cordis.patch.yml` 会把穿越者侧插件注入 dsh 主进程。启动
`dsh --profile mc "<任务>"` 即得一个 Minecraft 穿越者 agent（默认用户名
`HarnessBot`）。

在 profile 的 `cordis.patch.yml` 里覆盖 `mc-session` 的配置即可定制（名字 /
人设 / 目标 / 模型 / 心跳间隔 / 服务器地址）：

```yaml
- insert:
    - id: mc-session
      name: 'dsh-minecraft-agent/lib/plugins/mc-session.mjs'
      config:
        username: 'Kirito'
        goal: '砍树、挖矿、活下去，别死。'
```

控制面板（MC 面板）以会话视图 tab 内嵌在 dsh web 里（与「对话」「轨迹」同行），
显示实时状态 / 3D 游戏视角（第三人称 / 第一人称 / 俯视地图）/ 编年史 / 击杀 /
wiki / 缺陷流，并可在页面直接改服务器连接地址。

## 卸载

```sh
dsh plugin --profile mc remove dsh-minecraft-agent
```
