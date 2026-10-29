# 连接状态、重复反馈与有界思考

宿主状态同时保留原生目标和实际游戏连接。目标为 active/armed，但 SDK 明确未 ready 时，持续运行显示 `waiting-connection`；缺少连接信息保持未知。暂停、停止、未知动作回执和原生任务所有权不被这个显示状态越过。

显式开启的 evidence reflection 继续使用现有请求，不另起模型调用。除原生重复失败外，还可识别多次读取同一历史资源版本；仅接受原生 readback 元数据，不从回答正文猜测。资源及版本只保留摘要，分别限制失败证据、读取证据和已处理版本的数量。新的读取证据不会重新激活已处理的旧失败。

只有当前无思考、重复证据达到门槛，并同时满足请求间隔和时间间隔时，才临时选择配置的思考等级；下一次恢复自己覆盖的等级。人工选择的思考等级保持优先。选择次数不代表实际推理完成次数，实际消耗以模型客户端的 usage 为准。

共享核心 rc.118 修复了一个不同的问题：已经到达的位置原本每次都立即返回成功，重复检查被提前绕过。现在首次仍如实报告已到达、没有移动、没有新任务；短时间停留原地重复请求才给出明确的重复反馈。真实位置变化或原有时间窗到期后允许重新确认。宿主不另写一套导航规则，也不会因此取消正在执行的身体任务。

本次核心源码为 `d4d294ac17e4233e98a6789eb422d8b72c2a1807`，完整核心回归 2449 项通过、6 项条件跳过。固定 rc.118 的隔离 DSH 消费验证 214 项通过、1 项跳过；跳过的是未公开候选的 registry 一致性，不是默认公开安装验收。额外核对可选服务器包与公开 SDK 解析到同一份核心。

公开插件依赖仍保留已发布的核心版本；rc.118 仅在私有验收配置中精确锁定。加载时必须同时检查宿主包版本、实际解析的核心版本及配置覆盖，不能将包安装成功等同于新核心已生效。此次没有 npm 发布、Release 或市场提交。

实时验收与上述离线验证分开记录。服务器维护或未连接期间不应通过额外推理制造样本；缓存命中、思考 token、客户端耗时和游戏效果分别统计，缺失值保持未知。回滚应在原生任务与模型请求空闲后恢复原私有依赖和插件包，保留原会话、目标、账号、记忆及账本。

## 当前空间读取

核心 rc.120 新增 `agent-mc-spatial-read/v1`。模型可见回执先保留原生覆盖说明、控制信息及已观察材料，再呈现密集几何；完全相同的 JSON text/data 只展示一次。完整原始 MCP 值、历史查询及真实未知值保持不变。扫描已结束且仍有不可见格，与排队任务、下一页分别表达。

宿主只消费明确只读工具返回的原生 `meta.observation`。相同选择范围和内容版本的多次当前读取可以触发已启用的有界思考；请求去重、范围/版本变化、采样过期和运行切换分别处理。当前读取与历史回读独立于负面动作证据，不冒充任务失败或游戏进展。已服务的观察版本跨宿主加载保留，不因时间过去而周期性启用思考。

无进展检查使用原生内容版本，不删除坐标或方块状态数字后再比较。缺少该契约的旧核心保持旧的兼容路径，不伪造新元数据。实际思考次数及耗时以调用端请求和最终 usage 验收；选择 low 本身不证明模型已经生成思考 token，也不证明策略变好。
# Event-only continuation after a body reload

Core rc.123 also materializes MCP results with actual JSON wire semantics on
in-memory links. The real DSH lossless-value validator runs before the renderer:
optional `undefined` event fields must not reach that boundary. The packed-core
consumer regression includes such native event fields and uses DSH's public
`snapshotJsonValue` validator, in addition to checking the visible projection.

The private preview.24 consumer uses the core execution-state/event-read
contracts. Model-visible receipt limits preserve valid JSON, typed metadata,
control and execution identities; partial bodies are labelled with their
original character count. The full SDK/MCP value and original core request/event
archive remain complete; `dsh_history` preserves the model-visible projection,
not a promise that an already-capped message can recover its omitted body.
Critical metadata has a soft limit when it cannot fit the configured
receipt budget, rather than being cut into an invalid envelope.

Consecutive explicit event reads with no registered current or detached work
can select one existing request at the configured reflection effort. Advancing
chat/cursor numbers do not count as task progress. The original effort restores
on the next request, including after process recovery; the same state cannot
repeatedly select thinking. Background event polling is excluded. Earlier-run
unknown work remains outside the snapshot and must never be replayed merely
because a new runtime has no registered pending task.
