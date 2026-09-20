# 执行层设计（快循环 · 环节③）+ 反馈层契约（环节④）

> 状态：草案 v1（2026-09-20，小智）
> 前置：`DESIGN-perception-layer.md`（感知）、`DESIGN-rsi-loop.md`（双循环总纲）
> 结论先行：**我们只有"动作原语"，没有执行层。** 40 个 `mc_*` 工具全是"薄封装 + await + 返回字符串"；
> 执行侧唯一的工程化词汇是 `timeoutMs`（全仓"验收/前置检查"只出现 1 次）。
> 本文把执行层补上，并把"反馈层"定义成**执行回执的下游消费**。

---

## 0. 家底审计（先说实话：哪层有、哪层没有）

| 层 | 现状 | 证据 |
|---|---|---|
| **感知** | ✅ 有（本周建成） | `mc-perception.ts`（具身八类、三档、事件 ~28、世界模型、解释层） |
| **决策** | ◐ 有主体，**缺仲裁** | 目标环=dsh `goal`+`goal-round-driver`+LLM；快决策=`mc-decider`+引导队列；但没有"谁能碰身体"的仲裁 |
| **执行** | ❌ **只有原语** | 40 个工具（`mc_goto/mc_dig/mc_place/mc_attack/mc_collect/...`）＝ await 一个动作 + 返回字符串；无生命周期/无验收/无回执契约/无中断来源/无受阻账 |
| **反馈** | ◐ 有原料，无对账 | 工具结果→episodic ✓、事件流 ✓、decision_trace ✓；但**没有"预期 vs 实际"的核验**，也没有把结果回喂执行层（重试/放弃决策） |
| **反思** | ◐ 有雏形 | 夜间复盘 + `mc_selftune` + 教训卡；尚未接指引队列的审计 |

---

## 1. 参考实现给了什么（逐条对应我们的缺项）

### 1.1 neko `src/agent/action_manager.js`（11KB）：**抢占式单执行位**
- **单执行位**：`executing` 布尔 + 新动作先 `await stop()` 打断旧的 ⇒ 动作串行化
- **统一回执**：`{ success, message, interrupted, timedout }` —— 每次执行都产出**结构化结果**，而不是一段文本
- **中断阶梯**：`stop()` 每 300ms `requestInterrupt()`，**最多等 15s**（软卡顿先脱困）；15s 仍不停 → 强制放行 + 重连，**绝不 `process.exit`**
- **升级豁免**：正在跑用户代码（`_newActionActive`）时**只强制放行、不重连**（"等码不算卡"）；真死锁的兜底是超时那条路显式 `stop(true)`
- **打转检测**：连两次动作间隔 <20ms 累计 >3 → `cancelResume()`；>5 → 再 cancel + 重连
- **动作级日志作用域**：动作前后 `clearBotLogs()`；输出**摘要**（前 250 + 后 250 字符）后随回执返回
- **超时**：分钟级（默认 10 min）；超时**写进 system 历史**，让模型知道

### 1.2 Cortico `src/worlds/minecraft/executor.ts`（204KB）：**作业队列 + 回执 + 核验**
- **作业 = 步骤序列**：`QueuedTask { id, steps: SkillCall[], enqueuedAt, startedAt, stepLog, frozenBy }`、`RunningTask.stepLog`
- **终态分类**：`TaskReport.kind = done | partial | blocked | superseded | reflex | cancelled`
  （`partial`=有成果但量未完成；`superseded`=被顶替；`reflex`=反射不属于任何任务）
- **每步下场账本**：`StepLanding { step, outcome, why }` → `各步下场:第 3/8 步 采掘:blocked(没有镐)`（有 `STEP_LANDING_CAP` 上限，超出写"前 N 步略"）
- **被切断补一条**：`CutLanding`（正在跑的那一步也要交代）
- **中断带来源**：`AbortFlag { aborted, by }` —— **谁抢的必须留痕**
- **仲裁用类型表达**：`QueueFreezeOwner = 'combat' | 'queue'`；环境危机与深坠各持自己的 `queueHold` 槽，**两槽都空队列才开闸**；战斗不持槽、走 `busyWith` 闸
- **后置状态核验（我们最缺的这块）**：`deriveExpect(bot, call)` → `Expectation`；执行后回读世界得 `ExpectVerdict { met, actual, measured }`（如 `包里铁锭×3`、`手上是铁镐`）；推不准就返回 `null` 交给技能裁决；`dryRun` 无后置状态
- **因果闸**：`skillProduces(call)` / `skillNeeds(call)` / `causalNeeds(steps, index)` —— 后面的步需要的东西，前面有没有步产出
- **先验结果记忆**：`PriorOutcome{blocked|partial|noop}` 15 分钟窗口 + `blockedHeadline`（1 小时 / ≥5 次才起报）
- **受理回执 vs 终态回执分开报**：`enqueuedAt` 与 `startedAt` 之差 = 排队等了多久
- **蓝图子系统**：`billForSteps()` 按步扣料（资源预算）、**回读核验** `classifyReadback(expected, actual)` + `summarizeReadback`（样本截断 + drift 漂在哪个属性）

### 1.3 Cortico `until.ts`（早停）+ `receipt.ts`（回执渲染）
- **早停条件**：技能声明 `until: ['#ores','lava']`，执行中**按段巡检**（行军半径 16 / 挖通道半径 4），命中即收工
- **认不出的名字不许静默吃掉**：落进回执点名（原文注释：「**静默吃掉参数是这条链上最贵的一类失败**」）
- **视线规则随执行模式变**：行军用"只认看得见的"，挖通道不设视线闸（坑壁上贴脸的那面视线判据无意义）
- **回执渲染集中在 `receipt.ts`**：只有一个模块负责把事实说成话（一件事只说一遍）

---

## 2. 我们的执行层设计

### 2.1 定位：dsh 已经免费给了我们一半
dsh 是一步一工具、`maxParallelToolCalls:1`、工具结果可带 `concludesTurn` ⇒ **动作天然串行、一步一动作**。
所以 neko 那套"抢占式单执行位"对 **LLM 路径是免费的**（不需要轮询 stop）。
真正需要它的是**反射层（L0）**：它跑在 LLM 步之外，会和 LLM 的工具调用抢身体 ⇒ 必须有租约与闸。

### 2.2 执行层五段（前置闸 → 执行 → 回读核验 → 回执 → 账本）

| 段 | 做什么 | 借鉴 |
|---|---|---|
| **① 前置闸 precheck** | 工具在手？料够？目标可达？——**在执行前**用**具名理由**拒绝，而不是做到一半才失败；跨步再做**因果闸**（后面的步需要的东西前面有没有产出） | Cortico `precheck.ts` / `causalNeeds` |
| **② 执行 run** | 单个动作；带**动作级日志作用域**（动作前后分段）与**输出摘要**（前后各截 250 字符）；接受 **`until` 早停条件**（危险/条件达成即收工） | neko `ActionManager` / Cortico `until.ts` |
| **③ 回读核验 verify** | 执行完**回读世界**得到 `ExpectVerdict { met, actual, measured }`；未达标 → 依 `partial` 语义报"有成果但量未完成" | Cortico `deriveExpect` + `classifyReadback` |
| **④ 回执 receipt** | 结构化：`{ id, skill, ms, outcome, expect, why, evidence, by? }`；`outcome ∈ done·partial·blocked·noop·interrupted·timeout` | neko 的 `{success,interrupted,timedout}` + Cortico 的终态分类 |
| **⑤ 账本 ledger** | 受阻账（原因 + 出处）+ **头名统计**（窗口内某原因 ≥N 次才起报）+ **先验结果记忆**（同类任务近期未达成 → 重试前先提醒） | Cortico `blockedHeadline` / `PriorOutcome` |

### 2.3 新增的两个"工程词汇"
- **`noop`（世界没变）**：工具"成功"但世界没变（挖了没掉、走了没动）—— 我们的审计早就发现这类现象（`looksStuck` vs `looksDefective` 的区分），把它提升成**一等终态**
- **`by`（谁打断的）**：任何 `interrupted` 必须记录抢占来源（反射/队列/停机）—— neko §8「五类控制流抢身体」的教训：**不留痕就查不出是谁在抢**

### 2.4 身体仲裁（契约化，消掉 battle）
```
bodyLease = { owner: 'goal' | 'reflex' | 'queue' | null, by, at, ttlMs }
闸（freeze slots）：'crisis'（环境危机/深坠）与 'queue'（队列停摆）各一槽，两槽皆空才放行队列
硬规则：反射层只有【安全类】才能抢（溺水/濒死/贴脸苦力怕/着火/坠落）；
        抢占必须 agent.cancel() 或等价物收掉在跑的 LLM 步，且写 AbortFlag.by；
        目标环与观众影响永远不能抢占，只能排队
```

### 2.5 反馈层 = 回执的下游消费（定义清楚，避免又是一个模糊层）
```
执行回执 ──┬─→ 感知层（下一步的 input）：把 outcome/expect 差异并进「最近动作」与资产位
           ├─→ 指引队列：blocked/noop 连击 → 生成一条 warning 指引（"这招没用，换法子"）
           ├─→ decision_trace / episodic：可重放的证据（慢环复盘用）
           └─→ 受阻账/先验记忆：下次同类动作前先看这里
```
**"反馈"不是一个新模块，而是回执的四个消费者** —— 这样就不会出现"反馈层里再编一套状态"的问题。

---

## 3. 分阶段落地（每步都可独立验收）

| 阶段 | 内容 | 验收（可观测） |
|---|---|---|
| **E1** | 回执契约 + `expect` 回读核验（包住现有 40 个工具，不改语义） | 跑 30 分钟：`decision_trace.jsonl` 里每个动作都有 outcome+expect（`met/actual`），`noop` 能被识别出来 |
| **E2** | 受阻账 + 头名统计 + 先验结果记忆 | 同一堵墙连撞 3 次后，下一步的指引里出现"这个做法最近失败过"；头名统计能报出"最近最常卡在哪" |
| **E3** | 前置闸 + 因果闸 + `until` 早停 | 故意让 agent 用坏工具/缺料开工 → 被**具名理由**拒绝；挖到危险方块自动早停 |
| **E4** | 身体租约 + 冻结槽（与反射层同期） | 反射抢占后，LLM 步被正确取消且留 `by` 痕迹；查不到"谁在抢身体"的 bug |

**为什么这个顺序**：E1 是所有东西的地基（没有回执就没有反馈、没有账本就没有先验、没有核验就分不清"做成了"和"跑完了"）。E1 不需要任何新流程，纯加固。

---

## 4. 明确不做（以及为什么）

- **不自研"动作调度器"**：dsh 的 turn/step 已经是调度器；我们只在工具执行的前后加闸与核验（铁律：能用原生就不造轮子）
- **不做代码执行（`!newAction` 那类）**：neko 为此付出了"等码不算卡"整套豁免逻辑的复杂度；我们不给穿越者写码能力
- **不做强制重连**：那是 neko 在"动作拒停"下的兜底；我们的动作有超时且一步一工具，不需要用重连来解卡
- **不做蓝图/施工计划器**：那是建筑类任务的特化（Cortico 的 31KB+21KB+8KB），等真有盖房需求再说

---

## 5. 待拍板

1. **E1 先做吗**？（纯加固、不改现有行为；做完就知道每天有多少动作其实是 `noop`）
2. **`expect` 由谁声明**：工具自己推导（像 Cortico 的 `deriveExpect`，零改动）还是让模型在调用时显式给（更准但要改提示）？我建议**先推导、后显式**。
3. **受阻账落哪**：`mc-store` 单库新表 vs JSONL（我建议 JSONL 追加 + 头名统计在内存，理由：高频写、不需要 SQL 聚合）。
4. **`until` 的默认早停名单**：我建议默认带 `lava/water/fire` 与"脚下悬空"，其余按需。

---

## 6. 实现状态（E1–E4 已落地，2026-09-20）

| 阶段 | 落地物 | 验证 |
|---|---|---|
| **E1** 回执 + 回读核验 | `mc-execution.ts`：`ActionReceipt`（终态 `done/partial/blocked/noop/interrupted/timeout`）、`deriveExpect`（只推确知的动作）、`readExpectation`（回读世界 + **本步增量**）、`shortVerdict`（≤10 字核验标记） | 测试 [20] 段：达成/未到量/无增量三态、`noop` 抓取、`readAt` 时刻 |
| **E2** 受阻账 + 先验记忆 | `createBlockedLedger`：`priorFailure`（15min 窗口）、`headline`（1h/≥5 次起报）、`streak`（连击 → 喂指引） | 测试：窗口内/外、门槛内不出声、连击计数 |
| **E3** 前置闸 + 早停 | `precheckAction`（**hard 优先 soft、只报否定**：包满→hard，包将满/工具快坏/缺物→soft）、`resolveUntil`（**认不出的名字要点名**）、`UNtilTravelRadius/UntilDigRadius` 常量照抄 | 测试：hard 拒执行、soft 只提醒、未知早停名点名 |
| **E4** 身体租约 | `mc-body-lease.ts`：效用评分（权重照抄）、租约 2.5s、**抢占需超 4 分**（0..10 量纲）、代次/到期失效、`reason` 与事件流、**反射层仅安全类可抢** | 测试 [21] 段：acquire/renew/hysteresis/preempt/reflex-not-safety/换代次/释放 |

**接线**：mc-tools 的 23 处 `ctx.tools.register(defineTool(...))` 统一改走 `reg()`，
一个咽喉点完成 闸→执行→核验→回执→账本；**非字符串结果（`mc_see` 的图块对象）原样透传**，一个字符都不加。

### 取长补短时踩到并记下的一件事（量纲）
Cortico 的 `BODY_PREEMPT_MARGIN = 4` 反推出它们的效用因子是 **0..10 量纲**：
权重和只有 0.84，若因子取 0..1，满分 0.84 **永远够不到 4**，抢占将永不触发。
我们照抄常量并**在代码注释里写明这个量纲约定**（这是从常量反推出来的隐含契约，不写下来后人必踩）。

### 本轮有意没做的
- **因果闸**（`causalNeeds`）：我们一次一动作、没有跨步计划，闸无处可施 —— 等有了 `mc_plan` 再上（写下来免得被当成漏项）
- **工具内部的 `until` 巡检**：契约与解析已就绪，但"行军每段扫 16 格 / 挖通道每格扫 4 格"要改到 `mc_goto/mc_tunnel/mc_collect` 的执行循环里；本轮先把**声明与点名**做好
- **反射层作为竞争者**：租约已接线但当前无竞争者 ⇒ 不会拒绝任何动作；等 L0 落地，抢占与 `by` 留痕自动生效
