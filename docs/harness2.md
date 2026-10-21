# 可选 Harness² 练习

`@jcs130/dsh-minecraft-agent/harness2` 直接消费核心的 Harness²、隔离执行、方法版本和记忆契约。模型通过 DSH 注册的 `ctx.llm.stream` 调用，沿用其 provider、鉴权、会话头、思考等级及最终 usage，不新增模型 HTTP 客户端。默认关闭，无启动任务、定时器、自动采用或权重训练。

本次预览为适配器 rc.9 + 核心 rc.57；适配器使用固定 Git 标签 / GitHub 归档，核心使用固定 npm 版本，不要求本地 vendor 候选。发布与默认安装状态见[发布记录](registry-release.md)，源码、安装包、部署加载与线上验证分别记录。Desktop 安装及只读实验页见[指南](desktop.md)。

在私有 Agent 配置中显式添加 `harness2`，示例见 [harness2.json](../examples/harness/harness2.json)。`enabled:true` 后只注册 `mc_practice {jobId}`，由 Agent 显式执行已配置任务。安装和注册均不发起推理。jobId 去重且绑定完整配置；改变任务、模型、预算或原方法时使用新 ID，未决动作先查原账本。

内置 `backend:"physics"` 使用核心的 Java 1.21.1 平地碰撞练习；每个 job 指定 train fixture ID 与不同的 holdout ID。它可测试接线和受限方法改进，不代表在线 Minecraft 世界、战斗或真实游戏顺畅度。请把 baseline 换成要改进的真实方法；示例的只读 baseline 仅用于接线自检。

`worker` 使用显式安装的 Linux Python/WSL及固定 Harness² 版本。`model` 可覆盖 DSH provider/model/reasoningEffort/maxTokens，未覆盖沿用 Agent 路由与思考选择。会话 ID 使用独立的 `harness2:<宿主会话>`，与正在游戏的会话分离。每次返回 JSON 方法产物，思考正文不保存；无完成帧、截断或错误时不自动补发推理。

工具结果给出隔离比较、原版/候选复测结论、精确方法引用和证据 ID，不自动导入源世界或选择技能。方法与负例保存在 `dataDir/practice/methods`；任务及去重账本位于 `dataDir/practice/jobs`。游戏经验写回已有的、按服务器/账号/Agent 隔离的 `mc_memory`，不是新增个人记忆库。记忆失败时保留结果与 pending，不能为补记忆重跑动作。

自定义专用 Minecraft 练习实例可调用公开工厂：

```js
import { createDshHarness2Runner } from '@jcs130/dsh-minecraft-agent/harness2';
const runner = await createDshHarness2Runner({
  llm: ctx.llm, model: { provider, model, reasoningEffort, maxTokens: 4096, sessionId: 'harness2:my-session' },
  directory, worker, practice, memory, metrics,
});
const report = await runner.run(job, signal);
```

practice 必须是核心 `PracticeExecutionPort` 的专用实例，不能复用正在直播的身体。memory.call 必须进入现有正确作用域的 mc_memory，并返回解包后的 JSON 记录。可用 `dshPracticeTool(runner,jobs,lifetimeSignal)` 将受限任务注册到自己的 DSH Agent；不把生产世界、人格、密钥或私人会话复制到练习目录。

详见[核心设计与安装](https://github.com/jcs130/minecraft-ai-friend/blob/main/packages/agent-mc-world/docs/harness2.md)。关闭 harness2.enabled 停止后续任务；现役暂停状态不会被本集成改变。回退依赖需恢复之前的包和锁文件，保留未决账本与原方法历史。本次验收覆盖离线物理和 DSH 本地协议模拟，不宣称真实模型或线上胜率提升。

## 独立 DSH Harness² 实验室

安装独立的 `@jcs130/dsh-harness2` 后，本适配器会把已配置的核心实验监测注册到原生“实验室”子页。该注册仅作元数据投影，不启动游戏、模型或新试跑；会话不匹配时返回空列表。核心仍持有 `Harness2Runner`、物理执行、验收、MethodLibrary 与游戏记忆，启动实验仍使用既有 `mc_practice` 工具。

未安装实验室插件时不增加依赖，原有 Minecraft 实验页保持可用。源码集成不代表新包已经发布、市场已上架或现役进程已加载。
