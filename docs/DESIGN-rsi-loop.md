# 穿越者循环重设计：dsh = RSI 的快循环

> 状态：草案 v1（2026-09-20，小智）
> 定位：**取代** `DESIGN-session-agent.md` §3 的「定时 steer + 一步一 tick」模型，也**取代** 2026-08-20「闭环四环节」诊断的措辞。
> 结论先行：**快循环（感知→决策→行动→环境反馈→反思）交给 dsh 官方 agent-loop；自研循环、baseURL 劫持、把 state 压成散文喂第二个模型——三件事全部废弃。**
> 依据：dsh 0.1.5-rc.2 实机包（`@deepseek-ai/dsh` 内 ~300 个官方插件），本文所引接口均来自该版本的类型定义，不是文档摘抄。

---

## 0. 一句话

**穿越者只负责「活着并行动」，并且把每一步变成结构化记录；改成自己的事，交给另一个更慢的循环。**

RSI（递归自我改进）拆成两个时间尺度：

| | 快循环 | 慢循环 |
|---|---|---|
| 时间尺度 | 秒 ~ 分钟（episode 内） | 小时 ~ 天（跨 episode） |
| 目的 | 与世界接地：活下来、把事做成 | 改自己：参数 / 准则 / 技能 / 提示 / 工具 / 代码 |
| 载体 | **dsh agent-loop 原生** | 工程侧独立 agent + hook 脚本 + 审批 |
| 产物 | 动作 + `ReflectRecord`（结构化） | `Proposal → Trial → Verdict`（可回滚） |
| 本文重点 | §3 | §4 |

两圈之间只有**一条类型化边界**（§2.2）——这正是把 2026-09-20「state 语义不明确」的批评从根上消掉的地方：新设计里**不存在第二份 state**。

---

## 1. 为什么快循环必须（也只能）是 dsh

不是「dsh 也能做」，是「dsh 已经把五环节做成了引擎的一等公民」。我们要做的只是**挂上去**，而不是自己造一台。

| 环节 | dsh 原生承载（0.1.5-rc.2） | 我们的 MC 侧职责 |
|---|---|---|
| ① 感知 Percept | `systemPrompt.context({name,order,text:fn})`（每次组装动态求值，durable user-role 快照）；`agent.inject()`（不唤醒地投喂外部观察）；`agent/pre-step`（waterfall：可 reject / 替换进 step 的消息）；`dsh-time-context` 供时间 | 身体快照（见 §3.1，`perceive()` 已有）；**变化增量**；观察有效性 |
| ② 决策 Decide | `dsh-goal`（objective / phase / maxGoalRounds / revisioned CAS，投影 `goal`）+ `dsh-goal-round-driver`（idle 时自动接续 goal round）；`agent/request`（waterfall：**逐 step 替换 LlmCallConfig**）；tools = 候选动作集 | 目标文本；分级路由策略 |
| ③ 行动 Act | `ctx.tools.register`；`executeToolCalls` → `{concluded}`；工具结果带 `concludesTurn` 即**在该 step 关 turn**（= 一步一停的官方机制）；`maxParallelToolCalls:1` = 串行 | mc_* 工具集（已有 ~1900 行） |
| ④ 环境反馈 Feedback | 工具结果 → 下一步 inbox（`additionalContexts`）；`agent/assistant-stream`（帧级流）；session 事件（durable、可回放）；`agent/error`；`agent/turn-stopping` | **预期 vs 实际对账**（§3.4，新增） |
| ⑤ 反思 Reflect | `agent/turn-stopping`（serial；监听者 `steer()` 即再开一步 —— 官方设计的抗空转口）；`dsh-repeat-tool-reminder`；`dsh-session-query`（把自己日志当语料检索）；`dsh-tool-ralph`（固定脚本 + 每轮全新子体 + **有界结构化 handoff**）；subagent；`dsh-tool-todo` | 反思条目 schema；触发条件（§3.5） |

**顺带一条工程事实**：dsh 0.1.5 还有 `turnBoundary` 投影（`openTurnStartSeq` / `lastStepStartSeq` / `lastTurn`）与 `agent/inbox/{inserted,claimed,discarded}` 事件——「循环走到哪儿了」本身就是可读的数据，不需要我们另记一套账。

---

## 2. 总架构

### 2.1 双循环

```
┌──────────────────────── 快循环（dsh agent-loop，秒~分钟）────────────────────────┐
│                                                                                │
│   ① 感知 ──▶ ② 决策 ──▶ ③ 行动 ──▶ ④ 环境反馈 ──┐                              │
│      ▲                                          │                              │
│      │                                          ▼                              │
│      └──────────── ⑤ 反思（微：每 turn 对账）◀───┘                              │
│                          │                                                      │
│                     scope = now / episode  →  立刻回到下一步（自纠）             │
└──────────────────────────┼──────────────────────────────────────────────────────┘
                           │  scope = habit / rule / skill / tool / code
                           ▼  （结构化条目，落库，不阻塞主线）
┌──────────────────────── 慢循环（工程侧 + hook + 审批，小时~天）──────────────────┐
│   聚合 ──▶ Proposal ──▶ Trial（带指标）──▶ Verdict（keep / rollback）            │
│     ▲                                            │                              │
│     └────────────── 改动落地：参数 / 准则 / 技能 / 提示 / 工具 / 代码 ◀──────────┘
└─────────────────────────────────────────────────────────────────────────────────┘
                                     │
                          （下一轮快循环因此变强 —— RSI 的复利在这里）
```

### 2.2 唯一边界：类型化记录，不是散文

```ts
// 每一步的完整证据（落 mc-store 单库；session 事件是一等来源，此表是对账视图）
type StepLedger = {
  stepId: string; sessionId: string; turn: number; step: number
  goal: { id: string; revision: number; objective: string }   // dsh 原生 goal 的 CAS 引用
  percept: { ts: number; version: number; summary: string; counts: Record<string, number> }
  intent:  { kind: 'tool' | 'observe' | 'speak' | 'wait'; tool?: string; argsHash?: string }
  outcome: { kind: 'ok' | 'fail' | 'noop' | 'interrupted' | 'timeout'
             evidence: Record<string, unknown>          // 坐标变化 / 库存增量 / 报错原文
             progress: boolean }                        // 对账结论：这步有没有让世界变样
  reflect?: ReflectRecord[]                             // 反思条目（可 0 条）
}

type ReflectRecord = {
  id: string; at: number; trigger: 'no-progress'|'repeat'|'death'|'fail-streak'|'goal-done'|'stagnation'|'scheduled'
  scope: 'now' | 'episode' | 'habit' | 'rule' | 'skill' | 'tool' | 'code'
  claim: string                 // 一句话断言（如「夜间沿河走会淹死」）
  evidence: string[]            // 指回 stepId / 死亡事件 / 会话 seq —— 必须有据可查
  suggest?: { kind: string; target: string; payload: unknown }   // 建议改动（habit 以上才填）
}
```

**为什么这是关键**：`scope` 决定这条反思回到哪一圈——`now/episode` 立刻作用于下一步（自纠，快）；`habit` 以上进慢循环（自改）。同一条记录同时喂两个圈，谁也不用去猜另一个在想什么。

### 2.3 废弃清单（明确说不要什么）

| 废弃 | 原因 |
|---|---|
| 自研循环（Timer steer + 静态 goal） | 2026-08-21 已删 ✓，本文确认不再回头 |
| **`:8010` decision-proxy 作为生产路径** | 把「决策」搬到引擎看不见的 HTTP 层：state 是我们自编的（用户 9/20 批评的正是这里）、无法与 goal/session 对账、无法回放、与取消/竞态语义打架。**降级为影子评估台** |
| 「同一请求拆两半：选工具给小模型 + 生成 args 给大模型」 | 一次 step = 一个 assistant message，拆两半违反引擎不变式，且拼接处必然产生第二份 state。**分级粒度改为 step**（§3.2） |
| 夜间 12h 固定冷却 = 唯一反思节奏 | 反思不该等 12 小时，也不该按点发生。改为**事件触发 + 周期兜底**（§3.5） |
| 把反思产物写成自由散文卡片 | 无法聚合、无法试验、无法回滚。改为 typed + evidence 引用 |

---

## 3. 快循环五环节逐段设计

### 3.1 感知 Percept

**已有**（`perceive()`，零 LLM 零工具调用）：位置 / 生命 / 饱食 / 聊天 / NPC 神谕 / 朝向 / 脚下 / **5×5 迷你地形** / 背包 / 昼夜 / 实体雷达（16 格、**视线遮挡剔除**、玩家**去名化**）。

**改三处**：

1. **分三档，而不是一股脑全塞**：
   - 底线（每步、极简）：位置 / 血 / 食 / 夜昼 / 卡住判定
   - 增量（变了才进）：新实体、聊天新句、血量骤降、天黑、物品增减 —— 即 2026-08-20 `buildNudge` 的**变化检测**，但降级为「感知增量」而不是「唤醒用的固定句子」
   - 按需（下沉为工具）：大地图 `mc_map`、截图 `mc_see`、库存细查 —— 让它**自己决定要不要看**
2. **每条感知带 `version/ts`**：反思才能说「我当时以为 X」（把「感知错误」与「决策错误」分开——现有死亡循环里两者是混的）
3. **观察有效性**：看不见就不该知道。LOS 剔除已做 ✓，再补「没见过的人不具名」（已做 ✓）与「长时间没看就当陈旧」

### 3.2 决策 Decide

**目标**：继续用 dsh 原生 `dsh-goal`（objective / phase / rounds / CAS revision），`goal-round-driver` 负责 idle 时自动接续 —— 这块 8/21 已接对 ✓，不动。

**决策分流搬家（本设计的核心修正）**：

- 现状：`cordis.patch.yml` 把 `llm-qwen-local.baseURL` 指到 `:8010` 代理 → 代理读 tools + 自编 state → 问 decider（`:8000`）→ 高置信直接合一个 tool_call 返回，低置信透传 27B。
- 问题：① state 是代理自己压的，无契约（用户批评点）；② 引擎看到的只是「一个 assistant message」，它不知道刚才有过一次分流，日志/回放/goal 对账里都没有；③ baseURL 被劫持后，`agent/request` 这个正规口子空着没人用。
- 改为**引擎内分级**：
  - 注册第二个 provider（如 `decider`，后端 `:8000`），或按 step 特征在 **`agent/request`** waterfall 里替换 `LlmCallConfig`；
  - **输入不再是自编 state** —— 换 provider 时，喂进去的是**引擎组装好的真实请求**（system sections + inbox 消息 + tools 清单）。第二份 state 从根上消失，批评随之消失；
  - 分级粒度 = **step**：短决策步（候选动作少、无需文本生成）走 decider；需要长上下文/生成 args/措辞的步走 27B。判据优先用**结构化信号**（tools 数量、goal phase、上一步 outcome、percept 增量大小），不依赖「小模型自报置信度」这一条；
  - 置信度门控保留，但作为**次要**判据，且记录在案（每步落 `StepLedger.routing`，可事后统计与校准）。
- `:8010` 转型：**影子评估台** —— 同一条真实请求离线跑 decider，记录命中率/置信度分布/延迟，只用于选型与校准，不参与生产。

### 3.3 行动 Act

不动。原生 tool call + `concludesTurn`（一步一停）+ `maxParallelToolCalls:1`（串行，因为一个身体）。

唯一要求：**动作要可对账** —— 每个有副作用的工具结果要带上「世界变了什么」（坐标/库存/方块差量），供 ④ 用。这条是 ④ 的前提，属工具侧小改。

### 3.4 环境反馈 Feedback

现状：工具结果进 transcript，仅此而已。缺的是**对账**：

```
预期（Intent）  ×  实际（Outcome）  →  progress: true | false
```

四种落空形态要能识别：`noop`（工具成功但世界没变，如挖了没掉、走了没动）、`fail`（报错）、`interrupted`（被打断/死亡）、`timeout`。落空的判定用**世界差量**，不用模型自述（自述会说「我成功了」而实际上没动）。

产出：`StepLedger.outcome` + 连续落空计数（喂 ⑤）。

### 3.5 反思 Reflect

分两级，**都在 dsh 原生口子上**：

**微反思（每 turn，无 LLM）** —— 挂在 `agent/turn-stopping`：
- 回看本 turn 的 `(intent, outcome)` 序列，判定：无进展 / 重复同一动作 / 失败连击 / 与目标无关；
- 命中 → 写 `ReflectRecord`（`scope: now`）并**可选 `agent.steer()` 追加一步**（官方语义正是「监听者反对就用 steer 让机器再读 inbox」）；
- **必须带预算**（连续 steer 上限、冷却），否则退化成空转。

**深反思（事件触发 + 周期兜底）**：
- 触发：死亡（已有 ✓）、目标完成 / 换目标、停滞（`mc-progress` 已有 ✓）、失败连击、每 N 分钟兜底、入睡（沿用现有夜间钩子，但改职责）；
- 执行形态：**subagent（fresh context）或 ralph 式有界多轮**（`dsh-tool-ralph` 的模式：固定脚本、每轮全新子体、只带 immutable objective + 上轮有界 handoff）—— 而不是把大复盘塞进穿越者自己的上下文（那份上下文属于「活着」）；
- 产物：`ReflectRecord[]`（typed）。**不再直出散文卡片**。

**触发条件优于固定心跳**：反思由「值得反思的事件」驱动，12h 冷却只作兜底。

---

## 4. 慢循环：Reflection → Proposal → Trial → Verdict

### 4.1 四段

| 段 | 输入 | 产出 | 谁做 |
|---|---|---|---|
| **聚合** | 一天/一任务的 `ReflectRecord` | 主题聚类 + 证据打包（"夜间沿河走→淹死"×3 次） | 工程侧 agent（定时/触发） |
| **提案 Proposal** | 聚类结果 | `{kind, target, payload, expected, evidence[], trial:{duration, metrics}, rollback}` | 同上；`rule/rule-like` 需**审批** |
| **试验 Trial** | Proposal | 生效 N 步 / M 小时，期间照常记 `StepLedger` | 穿越者照常跑，慢循环只观测 |
| **判定 Verdict** | Trial 期指标 vs 基线 | keep / rollback + 对照数字 | 慢循环；`rule` 级留人类/女神签字 |

`kind` 覆盖六类改动：**param**（自调参数）/ **rule**（行为准则）/ **skill**（新技能或改技能）/ **prompt**（persona / 规则段）/ **tool**（工具增改）/ **code**（A 仓代码）。

### 4.2 现状映射（已有的别重造）

| 现状 | 新位置 | 缺什么 |
|---|---|---|
| 死亡热点 `death-hotspots.json` + `mc:guidance` 注入 | 感知增量 + 微反思材料 | 与 `StepLedger` 打通（哪一步导致的死） |
| `mc_selftune`（L2，改自己参数） | **param Proposal** | trial 期、指标、verdict、回滚 |
| `mc_evolve_propose`（L3，提案给女神） | **rule Proposal** | 证据引用、trial、verdict |
| 夜间复盘（12h 冷却，出教训卡） | **聚合器**（不再产出散文卡片） | typed 产物、按 scope 分派 |
| `mc_reflect_skills`（能力自省） | 微反思的一种（skill scope） | 证据引用 |
| `mc-progress` 停滞诊断 | 深反思触发器 | — |
| `mc-memory` / `mc-memos` / `mc-store`(sqlite) | 落库地（新表：`step_ledger` / `reflect` / `proposal` / `verdict`） | 统一 schema |

**一句话**：现状把 RSI 的零件都做了，但是**散着、无指标、无法回滚**；本轮把它们收进「四段 + 一条类型化边界」。

### 4.3 刹车（RSI 的安全阀）

- 快循环：`maxGoalRounds=512`（已有 ✓）、连 steer 上限、每 turn 工具预算；
- 慢循环：`rule`/`code` 级必须人工（用户或女神）签字；**任何改动必须带 trial 与回滚方式**，没有回滚方式的提案直接拒绝；
- 全部改动留 `Verdict` 记录 —— 改坏了要能说清是哪一条、依据什么、什么时候。

---

## 5. 迁移计划

| 步 | 内容 | 验收（可观测，不打折） |
|---|---|---|
| **1. 契约先行** | `StepLedger` / `ReflectRecord` / `Proposal` schema 落 `mc-store`（node:sqlite）；工具结果补「世界差量」；写**无 LLM 的对账器**挂在 `agent/turn-stopping` | 让 Edward 跑 30 分钟：库里能查到 intent/outcome 配对，`progress:false` 的判定在日志里可复核 |
| **2. 反思分层** | 夜间复盘降为聚合器；深反思改事件触发（死亡/目标完成/停滞/失败连击），执行体用 subagent 或 ralph 形态；产出 typed `ReflectRecord` | 一次死亡能自动生成一条带 evidence 的反思记录；一天后能聚合出主题，而不是一段散文 |
| **3. 分流搬进引擎** | 注册 decider provider（或 `agent/request` 分级规则）；`:8010` 转影子评估台；卸载 baseURL 劫持 | 同一场景对照：FAST/LOW 命中率与延迟，两条路径都在 session 里可见可回放；代理不参与生产 |
| **4. 慢循环闭环** | 先只做 `param` + `rule` 两类：Proposal → Trial（指标：死亡频次 / 停滞率 / 目标完成率 / token 成本）→ Verdict | 一条参数改动走完 trial，产出「改前 vs 改后」对照数字，并可回滚 |

**顺序不能颠倒**：没有 §1 的对账，§2 的反思就是猜；没有 §2 的记录，§4 的 trial 就没有基线。

---

## 6. 待拍板

1. **微反思能不能自动追加步**（`turn-stopping` + `steer`）？更紧的闭环 vs 更多 token 与「话多」。建议：默认开，带连 steer 上限与冷却，只在「无进展/失败连击」时触发。
2. **决策分流的落点**：注册 decider provider 好，还是 `agent/request` 里按 step 选 provider 好？（前者更干净、可整体替换；后者更灵活、可逐步灰度）。建议：先 `agent/request` 分级，跑稳后固化成一个 provider。
3. **慢循环谁签字**：`habit` 级自决（穿越者自己改参数），`rule` 级女神/用户审批，`code` 级小智改 —— 这个分级可以吗？trial 期默认多久（建议：参数 200 步或 6 小时；准则 1 天）。
4. **反思产物落哪儿**：统一进 `mc-store` 单库（推荐，可 SQL 聚合、可对照）还是继续散在 `data/*.json`？现有散文件要不要一次性迁移（`death-hotspots.json` 40KB、`self-tuning-Edward.json` 等）。

---

## 8. 三层速率落地状态（2026-09-20）

用户的原始设想：「LLM 比如 2 秒一次，在这个过程中都是 Jev 在做快决策」。
现在三层都有了具体形状，且**共用一套类型化词汇**（指引等级 L0–L3 / 效用分 / 回执终态 / 危险度 0–4）：

| 层 | 周期 | 载体 | 感知形态 | 状态 |
|---|---|---|---|---|
| **L0 反射** | 300ms 巡检 | `mc-reflex.ts`（三条保命反射：上浮/躲开/进食）+ 身体租约 | 只要最少几项（氧气/血量/最近威胁/苦力怕距离）+ 模式与危险度 | ✅ 已落地 |
| **L1 目标环** | 2–10s（**随危险自适应**） | dsh `goal`+`goal-round-driver`+LLM；`mc-mode` 给模式与节奏 | 【处境】行 + 事件 + 按需工具 + 指引队列 | ✅ 已落地 |
| **L2 慢环** | 分钟~小时 | 夜间复盘 / 教训 / 自调 / 提案（`decision_trace`+`execution.jsonl` 做证据） | 全量回执与快照 | ◐ 有雏形，未接线 |

### 8.1 快决策的第二个用法：模式与态势（用户 2026-09-20 提出的）
不只问"做什么动作"，还问"**现在算什么局面**"——一问三题（照那篇 Jev 自驾实测：除选动作外还并列判断"是否被堵死"）：

| 问题 | 原语 | 用途 |
|---|---|---|
| `mode` | Choice（**九种模式**：探索/采集/赶路/避险/逃跑/战斗/复原/社交/待命） | 决定当前行为体制；进指引队列常驻位 |
| `danger` | Score（**五档**：安全/留意/中度/高危/危急） | 决定**节奏**（2s → 500ms）与返险豁免 |
| `stalled` | Noul | **并列判断"是不是卡住了"**（那篇文章的"是否被堵死"） |

- **迟滞**：模式切换要过驻留下限（20s）+ 分布余量（0.2）；**但危险 ≥ 高危可无视驻留**（保命不排队）
- **降级**：分类器不可用 → 确定性启发式（用世界模型的威胁分级/瘫痪三态/防御姿态撑起来），并记下原因（不静默）
- **节奏**：`tickFor(danger)` = 2000/1500/1000/600/500ms —— 危险越高问得越勤

### 8.2 L0 反射的三条纪律（都是别的项目用血换的）
1. **只做安全类**：不动作就会死才动手（neko §8：五类控制流抢身体 → 调度陷阱家族）
2. **不拔河**：`agentBusy`（dsh `agent/status`）时只有危险=危急才插手，否则排队等它这一步结束
3. **留痕**：每次插手写 `reflex.jsonl`（反射 id / 原因 / 时长 / 是否抢到身体），并过**身体租约**（`ownerKind='reflex'`，生存分 ≥5 才抢得到别人的）

### 8.3 跨插件共享：租约走 cordis 服务
身体租约由 **mc-tools 创建并 `provide('mcBodyLease')`**（它先加载），mc-session 的反射层运行时 `ctx.get` 取同一实例。
理由就是仓库自己的铁律：每个插件独立 bundle，**模块级变量在各自 bundle 里是互不相干的副本**。

### 8.4 顺带修掉的一个"静默定时炸弹"
新代码里 `collectHostiles` / `appendJsonl` 用了却漏了导入 —— **JS 不报错**，
只在运行期抛 ReferenceError，而我当时的 `catch {}` 把它吞掉 ⇒ **反射层会整层静默失效**。
已补导入，并把这两处 catch 改成**出声**（记日志）。教训：**静默吞异常正是这类 bug 的藏身处**。
