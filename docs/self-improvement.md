# Agent 自写方法与反思

游戏 Agent 默认使用受限工具集。显式配置 `hostTools:["skill"]` 可以继承 DSH 原生的只读技能加载器；不会连带开放终端、文件写入或其他宿主工具。包内自我改进技能直接注册到本人原生技能层，按需加载，不依赖文件系统提供器恰好扫描某个目录。使用能力预设的 Agent 继续由其预设决定可见工具。

反思选择仍沿用用户已有模型、上下文、输出预算及短时低思考策略，不额外启动模型。自写流程放在固定提示前缀，只有反思触发原因放入短尾部提示，避免逐轮塞入完整教训。它关联核对、写方法、验证、真实试用、复盘与采用，不把增加 thinking 当作学习结果。`selfImprovement.enabled:false` 可关闭这段指导。

核心现有 `*_script` 提供 authoring、语法验证、不可变方法版本、实际执行、evidence/review/adopt；`*_memory` 记录有证据引用的游戏经验。插件只接宿主，不复制这些实现。

方法进度保留最多八条未完成/近期版本引用，每轮仅提示最近三条。异步校验受理后保留原运行编号，明确下一步是查原终态、保存、自然试用还是复盘，避免候选被新事件冲掉。仅保存源码哈希、原调用/执行 ID、版本与状态；不保存代码正文、聊天或思考。不自动执行、重试或采用。身体运行代次改变后，旧本地编号不能用于新身体。

## 动态 Harness²

旧 `harness2.jobs` 的固定 jobId 契约保留。新配置省略 jobs 时，使用共享核心的 Harness2PracticeService，让 Agent 自选已保存的方法、任务和精确版本：

```json
{"hostTools":["skill"],"harness2":{"enabled":true,"backend":"physics","seeds":[1,2],"worker":{"command":"/absolute/python","workspace":"/absolute/isolated-workspace"},"budget":{"modelCalls":8,"trials":6,"wallMs":180000,"trialMs":10000,"contextBytes":100000}}}
```

要求核心公开导出动态练习与候选 staging 契约。`mc_practice op:help/start/status/result/compare/stage/cancel` 直接使用共享 schema；start 立即受理，原 job 继续异步试跑。对比结束不自动采用。stage 通过原脚本接口保存候选并保留 parent，真实试用、评估和采用仍由 Agent 决定。作用域来自当前核心 facts，不从主机地址猜测。

内置练习只验证平地移动，不证明实服战斗或施法改善。没有后端或不适用时，Agent 仍可正常写脚本并在实际适用的小任务中核验。关闭新练习不清除已有证据，失败或取消不自动重放。模型用量由现有 DSH 路由与指标记录；技能保存数、练习通过数和真实胜率分别统计。
