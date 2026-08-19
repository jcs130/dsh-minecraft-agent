# 穿越者迁入 dsh session agent 形态 — 设计文档

> 状态：Phase 1 起草（2026-08-19）
> 目标：把穿越者从「进程级自研决策循环」迁到「dsh 原生 session agent」，让官方 agent-loop/llm/session 接管决策，穿越者只保留游戏专属薄 adapter。

---

## 1. 现状诊断（为什么现在不是 session agent）

当前穿越者有两条运行路径，**核心决策循环都是 mc-loop 自研的**：

| 路径 | 入口 | 决策机制 | dsh 核心装配 |
|---|---|---|---|
| A（生产） | `bootstrap-mc.mts`（docker 容器跑 kirito/naruto） | mc-loop 自己 fetch LLM + 组 prompt + 解析 JSON + 执行工具 | 只有 `Timer` + `SystemPrompt` + `ToolRuntime` 三个，**无 agent/llm/session/loop** |
| B（新铺） | `cordis.patch.yml` → `dsh --profile X "<task>"` | 同上 mc-loop 自研循环 | dsh 主进程自带完整 agent/llm/session/loop，但 mc-loop 没用它 |

**根源**：`bootstrap-mc.mts` 没装配 dsh-agent/dsh-agent-loop/dsh-session/dsh-llm，所以 mc-loop 被迫自己 fetch LLM。mc-loop 里 `decide()` 手搓 system prompt + OpenAI fetch + JSON 决策，`act()` 手动调 `ctx.tools.execute()`——整套绕开了 dsh 的 agent-loop 状态机。

**目标**：穿越者 = dsh 原生 session agent，决策（LLM 调用 + 工具执行 + session 事件溯源）全交给官方 agent-loop；mc-loop 退化为「session agent 驱动器」（创建 agent + Timer steer + 游戏上下文 section 提供者）。

---

## 2. 目标架构

```
dsh 主进程（dsh --profile mc "<task>" 或独立 boot）
├─ dsh-agent / dsh-agent-loop / dsh-session / dsh-llm（官方，原样直用）
├─ 穿越者插件（cordis.patch.yml 注入，13 个）
│   ├─ mc-bot          ← 待改造：全局单例 → 每 agent 实例
│   ├─ mc-tools        ← 待改造：工具执行后 exec.concludeTurn()（一步一 tick）
│   ├─ mc-transmigrator← persona 档案来源（不变）
│   ├─ mc-identity     ← anchor persona/backstory 常驻（可并入 persona section）
│   ├─ mc-memory/wiki/memos/adapt/village/mystic/evolve/panel（不变，薄 adapter）
│   └─ mc-loop         ← 核心改造：自研循环 → session agent 驱动器
│
└─ 穿越者 = dsh session agent（程序化创建，非 config agents[]）
    ├─ persona shadow  → systemPrompt.section({ name:'deployment:persona', order:0 })
    ├─ 游戏规则        → systemPrompt.section({ name:'mc:rules', order:100 })
    ├─ 感知快照        → systemPrompt.context({ name:'mc:status', order:100 })
    └─ Timer steer     → 每 intervalMs agent.steer(...) 唤醒一步
```

---

## 3. 核心机制映射（自研 → 官方）

| mc-loop 现状 | dsh session agent 目标 | 官方扩展点 |
|---|---|---|
| `schedule()` 每 intervalMs `step()` | Timer 每 intervalMs `agent.steer()` | `agent.steer(message)` |
| `decide()` 手搓 system prompt（persona + 天神说明 + 能力 + 记忆 + wiki/memos/adapt + JSON 格式） | persona → persona section；规则/检索 → mc:rules section；JSON 格式要求删除 | `ctx.systemPrompt.section({name,order,text})` |
| `perceive(bot)` 状态快照 + 卡住提示 + 看门狗 | 动态感知快照 | `ctx.systemPrompt.context({name,order,text:()=>...})` |
| `decide()` fetch LLM + 解析 JSON 决策 `{thought,goal,tool,args}` | dsh 原生 LLM + **原生 tool call**（不再是 JSON） | agent-loop 自动 |
| `act()` 手动 `ctx.tools.execute()` | dsh 原生工具执行 | agent-loop 自动 |
| 一步一 tick（每步一个动作） | 工具执行后 `concludeTurn`，turn 在该 step 结束 | `exec.concludeTurn()` / 结果 `concludesTurn:true` |
| 缺陷工单/位置看门狗/brain log/episodic | 看门狗提示 → context；缺陷工单/brain log → 工具执行后 hook | `agent/turn-stopping` 或 `agent/pre-step` |
| persona 从 transmigrator 档案读 | persona shadow 从档案读 | `systemPrompt.section({name:'deployment:persona',order:0})` 覆盖全局 |

---

## 4. 已调研的 dsh 官方 API（写骨架的参考）

### 4.1 创建 agent（`ctx.agents.create`）
```ts
// packages/core/agent/src/index.ts（AgentManagerService）
const agent = await ctx.agents.create({
  sessionId: 'mc-kirito',            // SessionId，稳定名以便 resume
  agentOptions: { provider: 'qwen-local', model: 'qwen3.8-27b', maxTokens: 1024 },
  setup: (agentCtx) => {
    // 组合，不驱动。返回 AgentSetupCommit | void | Promise
    agentCtx.systemPrompt.section({ name: 'deployment:persona', order: 0, text: persona })
    agentCtx.systemPrompt.section({ name: 'mc:rules', order: 100, text: rules })
    agentCtx.systemPrompt.context({ name: 'mc:status', order: 100, text: () => perceive() })
  },
})
```
- `AgentOptions = { provider?, model?, maxTokens? }`（`packages/core/agent/src/runtime-types.ts`）。persona 属 system-prompt sections，config `agents[]` 无 per-agent persona 字段 → 独立人格必须程序化 `ctx.agents.create({setup})`。
- 返回 `Agent`：`{ id, options, session, inbox, status, ctx, cancel, whenIdle, runMaintenance, send, followup, steer, inject }`。

### 4.2 触发原语（agent 驱动）
- `agent.steer(message)` — steering，唤醒 driver 跑一步（idle 开 turn，running 下一步边界消费）
- `agent.followup(message)` — 普通 follow-up turn，唤醒
- `agent.inject(message)` — 注入 model-facing context，**不唤醒**
- `UserMessage` 来自 `@deepseek-ai/dsh-session`（含 `id`/`role`/`content`）

### 4.3 一步一 tick（控制 turn 节奏）⭐
- `ctx.systemPrompt.context()` 的 text 提供者每次 assembly 动态评估（放感知快照）。
- **`exec.concludeTurn()`**（`ToolRunContext` 方法，`packages/core/tools/src/index.ts:411`）标记本工具成功结果终结当前 turn；结果带 `concludesTurn:true`（`ToolExecutionSuccess`）。
- agent-loop 里 `concluded ||= result.concludesTurn === true`（`agent-loop/src/tool-calls.ts:157`）→ turn 在该 step 关闭。
- **这就是「每 tick 一步」的官方机制**：动作工具执行后 concludeTurn，agent 每个 steer 只做一次动作就停。

### 4.4 事件扩展点
- `agent/created`、`agent/session-start`（source: startup/resume/clear/compact，注释建议用 `agent.inject()` seed 上下文）
- `agent/pre-step`（waterfall，可 reject/replace 进 step 的消息）
- `agent/request`（waterfall，替换 LLM call config）
- `agent/turn-stopping`（serial，turn 关闭前，可反悔 steer）
- `agent/status`、`agent/error`（emit）

### 4.5 system prompt section 语义
- `section({name, order, text, complete?})`：order -100=harness identity，0=persona（`PERSONA_SECTION='deployment:persona'`），100-199=tool guidance。
- `complete:true` 独占（SOUL 全量模板用）。
- `context({name, order, text})`：作为 durable user-role snapshot 注入，动态评估。

---

## 5. 分阶段计划

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P1（本轮）** | 设计文档 + 骨架：mc-loop 改造为 session agent 驱动器（ctx.agents.create + persona shadow + context + Timer steer），单 bot 验证最小闭环 | 穿越者以 dsh agent 形态创建、steer 唤醒、原生 tool call 执行一步 |
| **P2** | mc-bot 多实例化（每 agent 独立 mineflayer 连接），mc-tools 的 bot 引用改 scoped | 多穿越者同进程各自独立 bot |
| **P3** | 决策循环迁移收尾：JSON 决策彻底移除、工具 concludeTurn、游戏逻辑（看门狗/缺陷工单/复盘）迁到 context/hook | 单穿越者全功能跑通，行为与旧 mc-loop 等价 |
| **P4** | 端到端：桐人/鸣人迁入、多 agent 并发、cwd/分组布局、web 入口 | 桐人+鸣人同服稳定运行 |

---

## 6. 决策（已拍板，2026-08-19 ~21:xx）

1. **多 agent 在线**：放宽「只允许一个 AI 玩家在线」约束，复用 dsh 原生多 agent 设计——每个穿越者 = 独立 dsh session agent（独立 session/scope/cwd/persona/记忆）。P2 mc-bot 多实例化（每 agent 独立 mineflayer 连接）势在必行。
2. **启动入口 = 官方 web profile**：`dsh --profile mc "<task>"` 内嵌形态为主（最「官方直用」）；同时保留 CLI/独立 boot 脚本让另一个 agent 拉起/管理（双轨）。需吃透 dsh boot/bundle 机制如何让 mc-session 在 ready 时程序化建 agent 而非默认 `<task>` agent。
3. **「新建智能体」web 入口本轮做**：统一 web 页面新建（名字/背景故事）→ 程序化 `ctx.agents.create`。
4. **对话页独立页面 + 游戏专属 web 控制台（拟 3081）本轮一并做**。

---

## 7. 关键文件索引

- `packages/core/agent/src/index.ts` — `ctx.agents.create`（AgentManagerService）
- `packages/core/agent/src/runtime-types.ts` — `Agent` 接口 + `AgentOptions` + 全部事件
- `packages/core/agent/src/inbox.ts` — Inbox（steer/inject/followup 的目标边界）
- `packages/core/agent-loop/src/agent.ts` — ReactLoopAgent 状态机（turn/step 循环）
- `packages/core/agent-loop/src/tool-calls.ts` — `concludesTurn` 传播
- `packages/core/tools/src/index.ts` — `ctx.tools` API + `concludeTurn()`（:411）+ `ToolExecutionSuccess.concludesTurn`（:565）
- `packages/core/system-prompt/src/index.ts` — `ctx.systemPrompt.section/context/variable/tools`
