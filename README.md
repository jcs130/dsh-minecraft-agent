# DSH Minecraft Agent

DeepSeek Harness 宿主适配器。DSH 负责人格、目标、会话和模型；独立 agent-mc-world 负责一个 Minecraft 身体、SDK/MCP 和现代可视化。可显式选择 agent-mc-qiandengji 服务器资料包。

## 核心归属

`agent-mc-world` 的唯一源码在 [minecraft-ai-friend/packages/agent-mc-world](https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world)。本插件直接依赖其版本化安装包；构建无需 Cortico World 源码。核心升级先用候选包通过宿主测试，再独立切换部署。

## 当前版本

0.2.0 本地试运行候选，基于 DSH 0.2.0-rc.2、核心 0.4.0，尚未发布到 npm。安装候选 tgz 时必须同时安装配套核心和服务器包，registry 版本尚不可用。

没有 Cortico/N.E.K.O 依赖，不迁入其他角色的人格或记忆。安装本插件不会自动连接。旧 0.1.x 身体只保留在源码及迁移资料，不进入默认构建或发行包。

## 配置

- Node.js 24，DSH profile 启用 mc-harness，configFile 指向私有 JSON。
- 私有配置显式设置 enabled、name、dataDir、personaFile、DSH provider/model、contextTokens/maxTokens、minecraft.host/port/username。
- serverPack 默认 none；千灯纪选择 qiandengji。以当前服务端回执作为事实来源。
- consolePort 启用本机管理页，/metrics 查看本 Agent 用量；minecraft.viewerPort/viewerAssetsDir 指定同一 bot 的现代画面。
- minecraft.hostDecisions.combat 显式设置 enabled、endpoint、model、mode、timeoutMs、minIntervalMs、maxAgeMs。当前 typed-decision 战术端口来自千灯纪包；默认关闭，不探测地址。模型不可用时保留规则控制。
- API key 由 DSH provider 环境变量提供，游戏密码按服务器及用户名独立配置；不要写入人格、聊天或仓库。

完整说明见 [迁移指南](docs/harness-migration.md)，旧版说明见 [0.1.x 文档](docs/legacy-0.1.md)。

## 开发

npm run build 只复制适配器，不抽取其他框架或核心源码。npm test 包含真实 DSH Session API 测试；外置安装可用 DSH_RUNTIME 指定其根目录。

MIT。data/transmigrators 中鸣人、桐人是第三方虚构角色的演示人格；不附带第三方 YSM 模型。
