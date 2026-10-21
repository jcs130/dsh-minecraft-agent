# DSH Minecraft Agent

> 源码候选 rc.10：跟进共享工作/移动能力，并消费方法终态唤醒修复。按用户要求，本轮仅同步源码和验证；核心 rc.61 与适配器均未发布。候选锁文件中的核心归档须先在本地显式准备。官方 DSH 的 `process/` 加载问题仍存在，未恢复市场入口。见[本轮记录](docs/core-update-20261021.md)。

DeepSeek Harness 宿主适配器。DSH 负责人格、目标、会话和模型；独立 agent-mc-world 负责一个 Minecraft 身体、SDK/MCP 和现代可视化。可显式选择 agent-mc-qiandengji 服务器资料包。

## 核心归属

`agent-mc-world` 的唯一源码在 [minecraft-ai-friend/packages/agent-mc-world](https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world)。本插件直接依赖其版本化安装包；构建无需 Cortico World 源码。核心升级先用候选包通过宿主测试，再独立切换部署。

## 当前版本

**0.3.0-rc.10 发布候选**，消费核心 0.5.7-rc.61 和可选千灯纪包 0.5.0-rc.3。主维护 Minecraft Java 1.21.1，显式兼容构建 1.20.6。计划通过固定 Git 标签与 GitHub Release 分发，当前核心和适配器候选均未发布，须用已核验的本地核心归档做开发验证。[桌面与实验室指南](docs/desktop.md)中的安装流程仍待框架兼容修复，实际状态以[发布记录](docs/registry-release.md)为准。

新增可选的 [Harness² 练习接入](docs/harness2.md)，复用 DSH 内置模型路由；默认关闭。显式配置后通过 mc_practice 比较原版、候选及留出场景，结果进入核心的方法库和现有游戏记忆，不自动采用或恢复线上 Agent。

没有 Cortico/N.E.K.O 依赖，不迁入其他角色的人格或记忆。安装本插件不会自动连接。旧 0.1.x 身体只保留在源码及迁移资料，不进入默认构建或发行包。

## 配置

- Node.js 24，DSH profile 启用 mc-harness，configFile 指向私有 JSON。
- 私有配置显式设置 enabled、name、dataDir、personaFile、DSH provider/model、contextTokens/maxTokens、minecraft.host/port/username。
- `reasoningEffort` 显式传给 DSH 的创建与恢复入口；`off` 表示本轮关闭思考，其他等级以 provider 声明为准。未配置时沿用 DSH 的选择，不暗中降低模型质量。
- serverPack 默认 none；千灯纪选择 qiandengji。以当前服务端回执作为事实来源。
- consolePort 启用本机管理页；DSH 会话中的 Minecraft 标签内嵌同一个共享面板，包含游戏画面、连接与账号、系统一/系统二指标和只读实验室。/#experiments 可直达实验页，/metrics 仍可独立打开。minecraft.viewerPort/viewerAssetsDir 指定同一 bot 的现代画面。
- 可用 startPaused 设置首次启动暂不连接；之后操作员的连接/断开选择保存在 dataDir/connection-state.json，重启沿用。暂停期间保留会话、目标和记忆，连接后才恢复目标及待投递的操作员指令。
- minecraft.hostDecisions.combat 显式设置 enabled、endpoint、model、mode、timeoutMs、minIntervalMs、maxAgeMs。快决策状态、候选与驱动来自共享核心，可选服务器包仅转出同一契约；默认关闭，不探测地址。模型不可用时保留核心的规则控制。
- 上下文预算：`contextTokens` 默认 131072（128k）。压缩在 `contextTokens × compaction.triggerRatio`（默认 0.55）时触发，不再按模型 1M 窗口计算；旧的 `compaction.thresholdRatio` 若越过预算会在启动时报错。超预算的请求会先压缩再重试本轮，压缩后仍超出则道别并下线，不会挂机。
- 省上下文：`*_script` 默认保留，用于按需发现共享工作/移动脚本和自己的方法库；可用 `tools.exclude` 显式关闭。默认 `tools.profile: "lean"` 隐藏少用工具（蓝图、铁路、摄影、战术等，可用 `tools.include` 单独加回或 `profile: "full"` 全开），工具说明压缩到 `tools.descriptionChars`（默认 300 字），参数细节用 `*_tool_help` 按需查；每步事件快照只保留最近 `context.events`（默认 10）条，回执给模型时截到 `context.receiptChars`（默认 1500 字），完整内容仍在会话日志。`node scripts/measure-context.mjs qiandengji 人设.md` 可测固定提示大小。
- 防打转：连续 6 次只走动/张望且停在约 24 格范围内（或没到新地方）时，给模型提示；到 12 次时当前目标自动完成（`progress.window/radius/closeAfter`）。每个目标最多 `maxGoalCalls`（默认 30）次模型调用。目标完成后，排队中的该目标回执直接丢弃，不再唤醒。退出道别结果写在 status.json 的 `goodbye`。
- 唤醒：只有私聊、点名（`minecraft.username`、`name`、`wake.names`）、危险和连接变化会唤醒模型；目标进行中另加本身任务回执。其他玩家之间的聊天、插件提示、状态条倒计时只进下一次现场快照。可用 `wake.on` 覆盖类别。分类逻辑来自核心 `classifyWake`（agent-mc-world 新版），旧核心用同等的本地实现。
- 目标：游戏内目标（`*_goal done`）结案会同时结束 DSH 会话目标；连续 `noopRoundLimit`（默认 3）轮没有游戏动作也会结束目标；`maxGoalRounds` 默认 40。
- 聊天：`chat.maxPublicLines`（默认 4）在代码里限制公屏句数，`chat.minIntervalMs`（默认 20000）限制连续发言；配置 `chat.goodbye` 时预留 1 句，在真正下线（SIGINT/SIGTERM 或卸载）时由宿主发送，并在 status.json 写 `stopped: true`。私聊（/msg）不计入。
- API key 由 DSH provider 环境变量提供，游戏密码按服务器及用户名独立配置；不要写入人格、聊天或仓库。

官方 DeepSeek 云端的显式无思考配置见 [provider 示例](examples/harness/deepseek.patch.yml) 和 [Agent 示例](examples/harness/agent.json)。示例安装时不启用，须先填自己的路径、账号与预算。完整说明见 [迁移指南](docs/harness-migration.md)，旧版说明见 [0.1.x 文档](docs/legacy-0.1.md)。

## 开发

候选分支的核心尚未发布，先按[本地候选步骤](docs/core-update-20261021.md)安装核验归档；不能直接把在线 `npm ci` 当作已可用的分发流程。锁文件保留预期 registry 地址与已核验归档的完整性校验，不引入 Git/URL 子依赖。验证未发布的本地候选 tgz 见 [安装说明](README-INSTALL.md#可选本地候选-tgz)。`npm run build` 生成薄适配器及 DSH 浏览器入口；通用页面、渲染和控制由核心消费的 mc-visual-console 提供。`npm test` 包含真实 DSH Session API、DeepSeek/Qwen 请求格式、取消、回合、动作归因、会话面板绑定及暂停持久化测试；外置安装可用 `DSH_RUNTIME` 指定其根目录。

主模型工具动作携带真实 session/turn/step 的 `system2` 归因；不把规则动作或影子建议冒充学习策略采用。状态文件显示实际安装的核心和适配器版本、请求的思考等级；流耗时与首字延迟不等于引擎执行耗时。

MIT。data/transmigrators 中鸣人、桐人是第三方虚构角色的演示人格；不附带第三方 YSM 模型。
