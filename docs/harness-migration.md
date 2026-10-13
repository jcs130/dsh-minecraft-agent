# 从 0.1.x 迁移到独立 Minecraft 核心

| 能力 | 现在的维护位置 | 迁移方式 |
|---|---|---|
| 人格、主目标、模型调用、会话整理 | DSH | 原人格作为稳定前缀，原会话 ID 保留；不导入 Cortico 记忆 |
| 库存、导航、动作校验、队列终态 | agent-mc-world | 唯一身体；不并行启动旧身体 |
| 编号、去重、屏障、取消、事件、事实 | agent-mc/v1 SDK/MCP | MCP 内存传输保留结构化回执 |
| 真实回合 | DSH turn/end | 多次模型调用和 RPC 属于同一回合 |
| 目标完成 | DSH goals + 现场证据 | 接单和脚本结束均不自动完成目标 |
| 技能、魔力、保护报警、大背包 | 可选 agent-mc-qiandengji | 显式启用；当前能力读服务端 |
| 快战术 | 显式宿主服务 | 独立配置；无模型/超时保留规则控制 |
| 可视化 | mc-visual-console | 同一 bot 的现代 viewer |
| 用量 | 实际 DSH llm/stream + SDK 测量 | 输入含缓存，输出、TTFT、失败/取消；未知不填零 |

## 现场与预算

人格和环境指令一次装配，动态事实和合并事件位于请求尾部。下一步通过 DSH 正式 surface replacement 退役旧 minecraft:* 快照，保留其他生产者内容和永久玩家指令。原始事件仍在追加式日志；dsh_history(offset,limit) 可回查，SDK archive/archive_runs 保存游戏回执。

显式启用 DSH 官方 compaction-basic（网页 profile 默认关闭）。用 tokenMeter 测量含工具描述的请求，再预留输出，不把 UTF-8 字节当 token。整理属于宿主功能；核心没有隐藏模型循环。

若模型网关用请求头维持会话缓存，可在 DSH provider 的 `headers` 中显式配置自己的稳定 `x-litellm-session-id`。不同 Agent 使用不同标识，不在每轮随机更换，也不把凭据写进人格。该配置只影响支持此约定的网关，不保证命中率；用实测首字延迟及服务端用量验证。

## 生命周期

认证和 spawn 就绪后才进入决策。真实 turn/end 才关闭 SDK 回合。停止先解除目标驱动、取消当轮并 flush 会话，再断开身体。管理页断开也暂停目标和事件唤醒，重新连接才恢复。重载保留 session-id.txt，恢复失败报错，不悄悄创建新会话。

完成一个目标仅停止该目标的续写，仍会响应后续游戏事件。模型忙碌时合并保留最多 64 条唤醒通知，空闲后只投递一次；原文始终在游戏日志中。操作员断开会清空待唤醒通知，不能因此自行恢复。

主调用输出上限用 `maxTokens`。可通过 `compaction.thresholdRatio` 提前整理历史、`compaction.retainTokens` 设置保留近期上下文的预算、`compaction.maxTokens` 限制摘要输出；这些属于 DSH 宿主配置，模型及游戏核心不变。整理后原始日志仍可查询，不能靠裁剪抹掉未完成目标。

操作员明确需要下一阶段工作时，可配置 `operatorRequest: {id,text}`；宿主向同一会话投递一次并保存已投递 ID，重启不重复投递，也不把旧目标改回未完成。新指令必须来自操作员授权，不能由巡检凭空生成任务。
如需持续目标，可同时提供 `operatorRequest.goal`，由宿主在原目标已经完成后建立。DSH 的模型工具仍要求真人回合才能创建目标；游戏事件保持 notice 身份，不提升权限。已有活动、暂停或受阻目标时此配置报错，须先明确处理原目标。

Qwen 的 `chatTemplateKwargs.enable_thinking: false` 单独配置并不会发包：当前 pi-ai 要求 `thinkingFormat: chat-template` 且模型声明支持推理（例如 `reasoningEfforts: {off: null, low: low}`）。关闭推理由该格式下明确的 `enable_thinking: false` 控制；不要用 `reasoningEfforts: false` 期待服务端自动停思考。建议用本地模拟端点检查实际请求。摘要上限独立于主调用；出现 `incomplete checkpoint` 时摘要没有成功，不能宣称历史已压缩。

目标完成后停止该目标的自动续跑，已连接且未暂停的 Agent 仍可被新的聊天或任务结果唤醒。事件通知保留 `mc-harness` 来源，不冒充人类，也不重建或重新激活已完成目标。暂停、阻塞、生命周期解除激活的未完成目标仍保留原来的恢复约束。

## 旧数据

先备份 profile、会话、人格及配置。保留 cordis.legacy.patch.yml 供核对；启用 mc-harness 时关闭旧身体/会话插件，不叠装。旧笔记由宿主选择迁入并标明来源日期，不覆盖新 Agent 身份和账号。世界历史可用核心迁移入口导入。

## 验收边界

真实 DSH Session API 测试覆盖现场替换、原文引用、永久指令保留。另有真实回合、MCP 受理、取消、缓存用量和失败分类测试。核心另做无框架安装/源码的离线构建、公开类型、SDK/MCP 一致性和禁网测试。在线试运行仍需验证认证、YSM、动作与净进展；测试通过不代表战斗或长期学习有效。
