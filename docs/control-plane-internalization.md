# 控制平面内聚化方案（产品级）

> 项目：dsh-minecraft-agent（穿越者客户端插件，A 仓）
> 一句话目标：把「观测 / 管理穿越者 agent 的控制台」从 **独立 HTTP 进程 + 散落文件轮询**，升级为 **dsh 进程内 RPC 服务 + SQLite 事务数据层**。

---

## 1. 定位与原则

本插件是 DeepSeek Harness（dsh）的插件，一切能力都必须挂在 dsh 的插件生命周期里，**不得在 dsh 之外再拉起任何独立进程或端口**。

三条产品级原则（本次拍板）：

1. **后端内聚**：控制台的数据源、读写逻辑收敛为一个内聚的数据服务层，不散落在各插件各自读文件。
2. **数据库管事务**：状态变更（编年史追加、账本 upsert、人物 / 皮肤注册表增删改）一律走 SQLite 事务，保证一致性。
3. **进程在 dsh 里**：客户端（browser）与主机（server）之间的数据通道走 dsh 官方的 `ctx.connection` RPC，复用 dsh 自己的 `/api` 路由，**不单独 `createServer`、不单独开端口、不用 iframe 套独立服务**。

---

## 2. 现状（待改造点）

| 现状 | 问题 |
| --- | --- |
| `src/mc-panel.ts` 用 `node:http createServer` 起独立 HTTP 服务（默认 `:3200`），每个穿越者进程各暴露一份 dashboard | 独立进程 / 独立端口，与 dsh 解耦，违反原则 3 |
| `src/client.tsx` 用 `<iframe src="/mc-panel/">` 把独立端口嵌进 dsh 的「MC面板」tab | iframe 套独立服务，数据不归 dsh 管 |
| 数据散落文件轮询：`status-<user>.json` / `mystic-state.json` / `wiki-<user>.jsonl` / `mc-memory.json` / `defects/` / `screenshots/` | 无事务、无统一读写口，违反原则 1、2 |
| `src/mc-store.ts` 已落地 SQLite（`data/client.db`），但只迁了 episodic + progress，面板的 status / map 快照仍走文件 | 数据层不完整 |

---

## 3. 目标架构

```
┌────────────────────────── dsh 进程内（唯一宿主）──────────────────────────┐
│                                                                          │
│  server 半（cordis 插件）                                                 │
│   ┌────────────────────────────────────────────────────────────┐        │
│   │  mc-store（数据层）                                         │        │
│   │   node:sqlite → data/client.db（WAL，事务）                 │        │
│   │   · episodic / progress（已完成）                           │        │
│   │   · agents / skins / transmigrators / status / map（待迁）  │        │
│   │   · memory_chunks + memory_vec（语义记忆，阶段 3）           │        │
│   └────────────────────────────────────────────────────────────┘        │
│                        ▲ ctx.get('mcStore') 提供读写口                     │
│   ┌────────────────────────────────────────────────────────────┐        │
│   │  mc-panel（server 半 = 控制平面）                           │        │
│   │   ctx.connection.rpc.intercept('/api', …) 注册 endpoint     │        │
│   │   · mc-panel/snapshot · agents · skins · connection · shot  │        │
│   └────────────────────────────────────────────────────────────┘        │
│                                                                          │
├────────────────────── dsh 官方 /api RPC（ctx.connection）─────────────────┤
│                                                                          │
│  client 半（browser）                                                     │
│   ┌────────────────────────────────────────────────────────────┐        │
│   │  client.tsx → conversation.view「MC面板」tab                │        │
│   │   React 组件直接渲染，ctx.connection.rpc.call 取数          │        │
│   │   （不再 iframe，不再碰 :3200）                              │        │
│   └────────────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 关键技术依据（dsh 官方机制，已核实签名）

来自 `@deepseek-ai/dsh-client-connection`：

- **server 半**：`ctx.connection` 是 `HostConnectionHandle`。
  - `ctx.connection.rpc.intercept('/api', matches, handler, { authority: 'loopback' })`
    在共享 `/api` channel 上认领自己拥有的 endpoint，返回异步 disposer。
  - `handler(endpoint, payload, signal) => Promise<RpcResult<unknown>>`。
- **client 半**：`ctx.connection.rpc.call('/api', 'mc-panel/snapshot', payload, signal)`。

即：**server 插件注册 RPC 端点、client 插件调用 RPC 端点**，数据在 dsh 的 `/api` 路由内闭环，天然内聚、无独立端口。浏览器信任栅栏（loopback / trustedHosts）由 dsh 统一处理，本插件无需自建。

---

## 5. 数据层（data/client.db，node:sqlite）

「索引进库、本体留文件」：结构化小数据全量进库，大块本体（语义记忆正文、截图）留文件、库存路径 + 摘要 + 时间戳。

| 表 | 用途 | 状态 |
| --- | --- | --- |
| `episodic` | 编年史事件流（id / username / ts / text） | ✅ 阶段 1 已迁 |
| `progress` | 学习进度账本（username PK / state_json / updated_at） | ✅ 阶段 1 已迁 |
| `agents` | 人物注册表（username 唯一） | 待迁 |
| `skins` | 皮肤注册表 | 待迁 |
| `transmigrators` | 穿越者档案 | 待迁 |
| `status` / `map` | 面板状态快照 + 小地图 | 待迁（取代 status-*.json / 地图文件） |
| `memory_chunks` + `memory_vec` | 语义记忆（vec0 向量，sqlite-vec） | 阶段 3 |

**事务约束**：episodic 追加、progress upsert、agents/skins 增删改，均包在 `BEGIN` / `COMMIT` 里；面板快照读走一致性读（同一事务内取完整 payload）。

---

## 6. 分阶段计划

### 阶段 1 —— 数据层底座（✅ 已完成）
- `src/mc-store.ts`：`node:sqlite` 打开 `data/client.db`（WAL），`ctx.provide('mcStore')` 暴露读写口。
- episodic（1144 行）+ progress（1 用户 Edward）迁库；4 个消费方（mc-tools / mc-progress / mc-session / mc-panel）收口到 `ctx.get('mcStore')`。
- 跨插件共享必须走 cordis `provide/get`，禁用模块级单例（esbuild 各 bundle 独立副本）。
- 旧 jsonl / json 保留作回滚锚，未删。

### 阶段 2 —— 控制面板内聚化（本次核心，待做）
1. **废弃独立 HTTP**：`mc-panel.ts` 删掉 `createServer` / `MC_PANEL_PORT` 逻辑，改为在 `apply` 里 `ctx.connection.rpc.intercept('/api', …)` 注册端点。
2. **数据源收口进 SQLite**：status / map 快照不再写文件，改由数据生产方（mc-session / mc-bot）写 `mcStore`，面板经 `mcStore` 读。
3. **client 半直连 RPC**：`client.tsx` 去掉 `<iframe>`，`McPanelView` 改为 React 组件，`ctx.connection.rpc.call('/api', 'mc-panel/snapshot', …)` 拉数据、本地轮询刷新。
4. **端点清单**（内聚后）：`mc-panel/snapshot`（全量快照，替代 `/api/all`）、`mc-panel/agents`（人物 CRUD）、`mc-panel/skins`（皮肤列表）、`mc-panel/connection`（服务器地址覆盖 + reset）、`mc-panel/shot`（截图，本体留文件、索引进库）。
5. 验证：dsh web 内「MC面板」tab 正常渲染、无独立端口监听、数据来自 SQLite、重启后数据一致。

### 阶段 3 —— 语义记忆入库（待做）
- `memory_chunks`（正文留文件）+ `memory_vec`（vec0 向量，sqlite-vec），KNN 查询 `ORDER BY vec_distance_cosine(embedding, ?) LIMIT k`。
- embedding 仍走 bge-m3，int8 量化；不再依赖 memos（Neo4j + Qdrant）。

### 阶段 4 —— 注册表迁库（待做）
- agents / skins / transmigrators 迁入 `client.db`，加唯一约束（username 唯一）。

---

## 7. 边界与约束（当前有效）

- 服务端与客户端**严格物理隔离**：客户端（本仓）零 RCON、零服务端内部结构依赖，只走 mineflayer 协议 + MC 聊天 + skin-proxy 的 25565。
- 本仓只处理客户端；服务端（bootstrap-world / skin-proxy / web-panel / skins.json 源）不碰。
- `skins.json` 归本仓（A 仓），skin-proxy / web-panel 只读。
- 构建铁律：改 `src/` 后必须 `node scripts/build.mjs`（esbuild 打包生成 lib）；tsc 存在历史类型告警，与运行时无关，不必处理。
- 日志走 stderr，stdout 留给 MCP 协议。
