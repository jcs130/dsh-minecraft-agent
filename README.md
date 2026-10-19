# DSH Minecraft Agent

DeepSeek Harness 宿主适配器。DSH 负责人格、目标、会话和模型；独立 agent-mc-world 负责一个 Minecraft 身体、SDK/MCP 和现代可视化。可显式选择 agent-mc-qiandengji 服务器资料包。

## 核心归属

`agent-mc-world` 的唯一源码在 [minecraft-ai-friend/packages/agent-mc-world](https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world)。本插件直接依赖其版本化安装包；构建无需 Cortico World 源码。核心升级先用候选包通过宿主测试，再独立切换部署。

## 当前版本

0.3.0-rc.3 本地试运行候选，基于 DSH 0.2.0-rc.2、核心 0.5.7-rc.43，可选千灯纪包 0.5.0-dev.20261019.5；主维护版本为 Minecraft Java 1.21.1。配套核心、服务器包尚未发布到 npm，安装时须同时提供经过校验的候选 tgz，不能直接从 registry 安装此候选。

没有 Cortico/N.E.K.O 依赖，不迁入其他角色的人格或记忆。安装本插件不会自动连接。旧 0.1.x 身体只保留在源码及迁移资料，不进入默认构建或发行包。

## 配置

- Node.js 24，DSH profile 启用 mc-harness，configFile 指向私有 JSON。
- 私有配置显式设置 enabled、name、dataDir、personaFile、DSH provider/model、contextTokens/maxTokens、minecraft.host/port/username。
- `reasoningEffort` 显式传给 DSH 的创建与恢复入口；`off` 表示本轮关闭思考，其他等级以 provider 声明为准。未配置时沿用 DSH 的选择，不暗中降低模型质量。
- serverPack 默认 none；千灯纪选择 qiandengji。以当前服务端回执作为事实来源。
- consolePort 启用本机管理页；DSH 会话中的 Minecraft 标签内嵌同一个共享面板，包含游戏画面、连接与账号、系统一/系统二指标。/metrics 仍可独立打开。minecraft.viewerPort/viewerAssetsDir 指定同一 bot 的现代画面。
- 可用 startPaused 设置首次启动暂不连接；之后操作员的连接/断开选择保存在 dataDir/connection-state.json，重启沿用。暂停期间保留会话、目标和记忆，连接后才恢复目标及待投递的操作员指令。
- minecraft.hostDecisions.combat 显式设置 enabled、endpoint、model、mode、timeoutMs、minIntervalMs、maxAgeMs。快决策状态、候选与驱动来自共享核心，可选服务器包仅转出同一契约；默认关闭，不探测地址。模型不可用时保留核心的规则控制。
- API key 由 DSH provider 环境变量提供，游戏密码按服务器及用户名独立配置；不要写入人格、聊天或仓库。

官方 DeepSeek 云端的显式无思考配置见 [provider 示例](examples/harness/deepseek.patch.yml) 和 [Agent 示例](examples/harness/agent.json)。示例安装时不启用，须先填自己的路径、账号与预算。完整说明见 [迁移指南](docs/harness-migration.md)，旧版说明见 [0.1.x 文档](docs/legacy-0.1.md)。

## 开发

准备 `candidate-sources.json` 对应的两个候选文件到被忽略的 `vendor/`，再执行 `npm ci`。锁文件保留相对候选路径和完整性校验，不依赖维护者的绝对路径。`npm run build` 生成薄适配器及 DSH 浏览器入口；通用页面、渲染和控制由核心消费的 mc-visual-console 提供。`npm test` 包含真实 DSH Session API、DeepSeek/Qwen 请求格式、取消、回合、动作归因、会话面板绑定及暂停持久化测试；外置安装可用 `DSH_RUNTIME` 指定其根目录。

主模型工具动作携带真实 session/turn/step 的 `system2` 归因；不把规则动作或影子建议冒充学习策略采用。状态文件显示实际安装的核心和适配器版本、请求的思考等级；流耗时与首字延迟不等于引擎执行耗时。

MIT。data/transmigrators 中鸣人、桐人是第三方虚构角色的演示人格；不附带第三方 YSM 模型。
