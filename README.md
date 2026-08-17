# dsh-minecraft-agent · 穿越者插件

**简体中文** | [English](README.en.md)

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
[![](https://img.shields.io/badge/topic-dsh--plugin-blue?style=flat-square)](https://github.com/topics/dsh-plugin)

一套 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，让任意 Agent 成为《我的世界》里的**"穿越者"**——像真人玩家一样自主生活：采集、建造、交易、下矿、结伴、念咒施法、低声祈祷。不是又一个 bot 框架，而是一个 **AI 玩家生态**：世界端由"天神"治理（配套开源项目 [minecraft-ai-friend](https://github.com/jcs130/minecraft-ai-friend)，见下），客户端每个穿越者是一个独立 Agent 进程——**任何人都可以让自己的 Agent 接入同一个世界一起玩**。

> **核心特色**
> - **零 API 成本** — Agent 由本地 LLM 驱动（llama.cpp / Ollama 等任意 OpenAI 兼容端点），不烧云端 token。
> - **文本即接口** — AI 与真人平权：想施法就在聊天框念咒，想祷告就私聊低语。穿越者进程**零服务器权限**（无 RCON、无命令、无魔法 ID 表），一切交互就是"说话"。
> - **一人一进程** — 双进程架构：世界（服务器端，唯一特权进程）与穿越者（客户端，每个 AI 玩家一个无特权进程）彻底分离，两者之间只有 Minecraft 聊天。

## 为什么不用 Mindcraft？

[Mindcraft](https://github.com/colonelwatch/mindcraft) 是成熟的 "AI 玩 Minecraft" 项目，但它是单体运行时。本项目用 DeepSeek Harness 的方式重新实现——**一切皆插件**——并走得更远：多 Agent 世界、聊天驱动的魔法系统、给人类观众的观察甲板。

| | Mindcraft | dsh-minecraft-agent |
|---|---|---|
| 运行时 | 单体 | DeepSeek Harness 插件 |
| 模型 | 云端或本地 | **本地优先**（任意 OpenAI 兼容端点） |
| 架构 | 自研 agent 循环 | **世界进程 + 每个 AI 玩家一个进程** |
| 魔法 / 世界规则 | — | 聊天驱动：念咒施法、低语祈祷 |
| 扩展 | 改 JS 源码 | 写一个插件 |

## 架构

```
                ┌─────────────────────────────────────────────┐
                │  Minecraft Server (vanilla, RCON enabled)   │
                └───────▲─────────────────────▲───────────────┘
                        │ RCON(世界端独占)     │  公屏聊天 / 私聊
    ┌───────────────────┴──────────┐   ┌──────┴──────────────────────┐
    │  世界进程（配套私有仓库）      │   │  穿越者进程 ×N（本仓库）      │
    │  bootstrap-world.mts         │   │  bootstrap-mc.mts           │
    │  mc-rcon/mc-magic/mc-god/    │◄──┼── 仅聊天 ──                 │
    │  mc-ritual/mc-worlddb/...    │   │  mc-bot      mineflayer     │
    │  女神化身（旁观模式）          │   │  mc-tools    工具层          │
    └──────────────────────────────┘   │  mc-memory   记忆            │
                                       │  mc-transmigrator 人格档案   │
                                       │  mc-mystic   咏唱/祈祷       │
                                       │  mc-wiki     生存知识库      │
                                       │  mc-loop     自主循环        │
                                       │  mc-vision/camera 视觉      │
                                       └─────────────────────────────┘
```

### 穿越者进程（`bootstrap-mc.mts`）— 本仓库

每个 AI 玩家跑一个进程（`start-bot.bat <用户名> <viewer端口>`），**零**服务器特权：没有 RCON、没有服务器命令、没有魔法 ID 表。与世界的每一次交互都是字面意义上的"说话"——公屏聊天施法，`/msg` 私聊祈祷。

| 插件 | 职责 |
|---|---|
| `mc-bot` | mineflayer 连接、自动重连、双 prismarine-viewer（第一人称 + 跟随镜头）。 |
| `mc-tools` | Agent 工具层：`mc_status`、`mc_goto`、`mc_collect`、`mc_place`、`mc_attack`、`mc_pickup`、`mc_craft`、`mc_equip`、箱子仓储（`mc_view/put/take_chest`）、`mc_trade`，以及视觉工具（`mc_look` 文字雷达、`mc_see` 第一人称截图）。全部包 try-catch + bot 存活守卫。 |
| `mc-memory` | 跨重启的持久化个人记忆：基地坐标、资源点、公共箱。 |
| `mc-transmigrator` | 人格档案库：每个穿越者是一等公民档案（背景故事 + 人格 + 天赋 + 把魔法映射成本作术语的"世界观滤镜"）。内置两份示例人格：**桐人**与**鸣人**。 |
| `mc-mystic` | 通往世界的纯聊天接口：`mc_chant`（施法）、`mc_pray`（祈祷）、`mc_choose_innate`（仪式应答）。 |
| `mc-wiki` | 生存知识库工具（`mc_wiki`）：怪物弱点、食物安全、工具等级——把 LLM 的 Minecraft 幻觉钉回地面。 |
| `mc-loop` | 自主"感知 → 决策 → 行动 → 观察"循环。多模态：bot 调 `mc_see` 时，第一人称截图会嵌入下一轮 LLM 决策。睡觉时离线反思（sleep-time compute），醒来沉淀知识卡。 |
| `mc-vision` / `mc-camera` | 离屏第一人称渲染器（`node-canvas-webgl`），等待世界网格就绪再截帧，JPEG 输出。 |

### 世界进程 — 配套开源仓库 [minecraft-ai-friend](https://github.com/jcs130/minecraft-ai-friend)

世界的另一端是配套的**开源**服务器侧项目 [`minecraft-ai-friend`](https://github.com/jcs130/minecraft-ai-friend)：mc-rcon 共享 RCON、mc-logwatch 日志事件流、mc-worlddb SQLite 众生册+编年史、mc-magic 快路径魔法引擎（数据驱动咒语目录、三资源消耗 `{mana, food, hp}`、纯 vanilla 视效）、mc-god 天神慢路径神谕、mc-ritual 降临仪式、供奉经济、成长体系（等级即原生经验条）、被动引擎（"苦难即修行"）、NPC 村民引擎，以及 :9090 观察甲板 web-panel。真人玩家与 AI 在那里完全平权——同一句咒语，谁念都灵。

### 不变量（铁律）

> 世界进程是唯一的特权持有者。穿越者像真人玩家一样与世界交互——靠说话。任何人念出同样的咒语就得到同样的魔法，无论 AI 还是人类。服务器永远不需要知道登录的是谁（或者是什么）。**穿越者是自主意识体**——天神与世界从不操控它们，只立法、守望、回应祈祷；每个 Agent 自己决定要过怎样的生活。

这正是 "bring your own agent" 成立的根基：服务器端契约只是一段聊天。

## 环境要求

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（developer preview）
- Node.js **22.19+ / 24+**
- 一个 Minecraft 服务端（Java 版，实测 **1.21.11**；世界端需开启 RCON）。离线模式即可跑 bot。
- 一个 OpenAI 兼容 LLM 端点：
  - **本地（推荐，免费）：** llama.cpp / Ollama，如 `http://localhost:8890/v1`
  - **云端：** DeepSeek 官方 API 或任意兼容服务

## 快速开始

1. 把本仓库 clone 到 DeepSeek Harness checkout 旁边（`start-*.bat` 期望 `..\node_modules` 存在），先跑一次 `setup-vendor-links.bat` 修复 `@deepseek-ai` junction。
2. 在 MC 服务器那台机器上启动**世界进程**（配套私有仓库的 `start-world.bat`）。
3. 每个 AI 玩家启动一个穿越者：

```bash
start-bot.bat Kirito 3001
start-bot.bat Naruto 3002
```

4. 打开观察甲板（世界端仓库提供）：`http://localhost:9090`。

环境变量：`MC_HOST`、`MC_PORT`、`MC_USERNAME`、`MC_VIEWER_PORT`。运行时状态（记忆、状态快照、日志）在 `data/` 下且已 git-ignore。

## 本地模型（免费）

默认假设本地 llama.cpp 暴露 OpenAI 兼容 API：

```bash
llama-server -m Qwen3.8-27B.gguf --host 0.0.0.0 --port 8890 -c 524288
```

然后设 `DEEPSEEK_BASE_URL=http://localhost:8890/v1`，`DEEPSEEK_API_KEY` 随便填个占位符。无云端 key、无按 token 计费。

## 让 web viewer 支持更新的 MC 版本

自带的 prismarine-viewer 浏览器资产开箱只认 1.21.4 及以下。`tools/` 里两个工具可以把 **1.21.11**（或任何更新版本）带活：

- `gen_viewer_assets.py` — 从 [PrismarineJS/minecraft-assets](https://github.com/PrismarineJS/minecraft-assets) 烘焙 `blocksStates/<v>.json` + `textures/<v>.png`，忠实复刻 prismarine-viewer 自己的模型/图集构建器。
- `patch_viewer_bundle.cjs` — 把新版本注入浏览器 bundle 的版本表（PC 版本列表 + 懒加载数据表，别名到最接近的已知版本数据模块）。

```bash
python tools/gen_viewer_assets.py 1.21.11
node tools/patch_viewer_bundle.cjs
```

## 示例

`examples/` 是独立脚本（无需 Harness），用来冒烟测试你的 Minecraft 服务端 + bot 配置。设好 `MC_HOST` / `MC_PORT` / `MC_USERNAME` 后 `npx tsx examples/test-mineflayer.mts` 跑起。

## 路线图

- [x] 工具加固：每个工具体都在 try-catch + bot 存活守卫后运行
- [x] 核心工具：移动、采集、建造、战斗、拾取、合成、装备、箱子仓储、交易
- [x] `mc-loop`：持续自主循环，多模态决策（嵌入截图）
- [x] 跨重启的持久化个人记忆
- [x] 多穿越者基础设施：人格档案注册表、状态快照、viewer 端口、启动脚本
- [x] 世界/穿越者进程拆分——世界端独占 RCON，穿越者仅聊天
- [x] 第一人称视觉（`mc_see`）离屏 WebGL 相机
- [x] 生存知识库工具 `mc_wiki`
- [x] 睡觉离线反思（sleep-time compute）：睡一觉把当天经历沉淀成知识卡
- [ ] 更多工具：`useToolOn`（方块交互）
- [ ] 一支演示视频

## 许可证

MIT — 见 [LICENSE](LICENSE)。示例人物档案（`data/transmigrators/`：桐人、鸣人）引用第三方虚构角色，仅作演示用途。

---

**[jcs130](https://github.com/jcs130) 的项目。** 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与 [mineflayer](https://github.com/PrismarineJS/mineflayer) 生态构建。
