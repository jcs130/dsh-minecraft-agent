# 2026-10-21 核心跟进：rc.11 兼容修复

rc.11 精确消费核心 `0.5.7-rc.64`，源码提交 `9433a29d9a7c11ba712f3f8ae930d42fcd0373e7`，基于最新主干 rc.63。核心已合入主分支；源码、归档公开状态、DSH 修复后的运行、Desktop 原生画面及线上游戏分别记录。

修复两项实际阻塞：

- 核心编译版引擎与脚本子进程直接使用 Node，不再把 tsx/esbuild 的开发安装脚本带入生产依赖。源码开发仍解析自己的 tsx；训练 worker 同时编译，Python 模拟器优先使用编译版本，避免修安装却破坏训练入口。
- DSH 0.2.1-rc.2 将 `process/`、`buffer/` 的 npm 包查询误判为 Node 内置模块。已完成上游源码修复、五项新回归及完整构建；提供独立 [dsh-minecraft-doctor](DSH-COMPAT.md)，显式选择退出后的安装进行检查、修复或回滚。安装、导入和启用插件均不自动改写宿主。

最终核心归档 `agent-mc-world-0.5.7-rc.64.tgz`：59,150,580 字节，SHA256 `3d492011d61e0508ed8f8934ca4b6ef74bb5d75a1ffdc60b48e7eb502ce4063f`，完整性 `sha512-w9TNIrdtOeD9b1KLt1Fl3QStdHHvWDvfKJBerP1Z9F36F1jeElbg48HDFJq56b6VEtDtHtyt5caU2Dh8togs6Q==`。包含锁定的完整可视化、实验室与编译训练 worker，未替换为 engine-only 包。

验证结果：

- 核心完整回归 1856 通过、1 项可选跳过、0 失败；完整 release 构建、328 份公开声明、源码类型及隔离 NodeNext/Bundler 类型检查通过。
- 不安装 tsx 的全新消费端能启动真实引擎 IPC，保存游戏笔记，并在新 runtime 中读取；离线 Python 模拟器握手、重置通过，没有训练模型。
- 宿主回归 92 通过、1 项可选跳过、0 失败。另行开启的真实 Harness²/DSH 内置 DeepSeek 协议测试通过：4 次本机模拟响应、6 次离线物理试跑、写入原游戏记忆；付费模型调用和真实游戏连接均为 0。
- 官方 pnpm 11.28.5 默认保护下实际 `dsh plugin add` 成功。该次安装通过临时 profile 的 YAML override 读取未公开核心候选，不能称为 registry 下载；没有加 `--ignore-scripts`、构建许可或关闭 exotic 子依赖检查。
- 未修复的官方 DSH 仍复现 TypeError；显式修复后的实际 profile 能加载包及浏览器标签，所有者 RPC 200、其他会话拒绝、delegate 403、卸载后 404。回滚能恢复原始哈希和原故障。
- DSH 上游拥有的解析测试 Linux 238 全过，完整构建 9 项门禁、推送前类型检查 5 项门禁通过。Windows 文档同步保留两项既有失败：文件符号链接权限与原始 `python/sdk/uv.lock:113` 检查；Linux 文档/站点 151 项通过，没有改旧锁文件凑绿。

DSH 修复源码已推送 [fix/npm-builtin-subpaths](https://github.com/jcs130/deepseek-harness/tree/fix/npm-builtin-subpaths)，提交 `d336362d78b2802a9ce1908a2493a4cefa7de2a5`。当前 GitHub 凭据/集成不能向官方仓库创建 PR（API 404/403），因此不声称已提交 PR、合入或发行。官方旧版和手动修复版仍是不同验收状态。

回滚插件时恢复升级前的 profile 依赖及锁文件；解析器单独按兼容指南 `--rollback`。本轮未重载现役 Cortico、World、客户端或服务器，未启动鸣人，未修改人格、会话、目标、记忆和账本。公开制品的匿名校验结果以 [registry 记录](registry-release.md) 和 Release 页面为准。

## rc.10 历史记录

本轮按用户要求只完成源码同步与验证，不发布 npm/GitHub 安装版本，不更新市场，不加载现役服务。候选位于 `codex/core61-dsh-sync-20261021`，主分支仍保留原来已公开的依赖。核心自身的共用修复已合入 `minecraft-ai-friend` 主分支。

## 变更

- 跟进核心 main 的工作/移动增量：十种内置 routine、单格收割补种、水下绕障与氧气预算、鞘翅与指定载具、连续穿门。具体条件、参数和后端能力全部从核心的 `*_script routine list/read` 查询，宿主没有复制实现。
- 默认精简工具列表保留 `*_script`；显式 `tools.exclude` 仍可关闭它。脚本目录、自己的方法库和底层 API 都按需读取，不把整份知识库塞进固定上下文。
- 修复核心 `classifyWake` 忽略 `minecraft.method` 真实终态的问题。有活动目标时，终态按 `task` 唤醒 DSH；子步骤的 `piggyback`、归档事件、仅受理/未知终态和空闲默认保持静默。受阻也要继续评估，不能把脚本 `completed` 或一次唤醒当成游戏目标完成。
- SDK/MCP 的原始回执、session/turn/step 归因和显式采用机制保持。系统一与 Harness² 不因更新而启用，不自动训练或采用技能。

## 版本与归档

适配器候选 `0.3.0-rc.10` 精确锁定 `agent-mc-world@0.5.7-rc.61`。这包含主干 rc.60 的共享能力及本轮终态唤醒修复，源码提交 `e24273decc638c7f5caee224a0157165cf59082c`；核心证据提交 `bed4c21c`。候选均未发布，锁文件中的 registry 地址仅是发布后的目标，当前不能据此执行全新在线 `npm ci`。

已验证的核心归档：

- 文件：`agent-mc-world-0.5.7-rc.61.tgz`，59,141,148 字节。
- SHA256：`7957ac9abfefff61efdc7e044fea47b612b1e78b4df3d7bf3df1947d851f8a73`。
- 完整性：`sha512-T3pCvPhblfevJZC1UCMbxB/RNE+soxiOXn4NHNVbzxFkUdzohH6nEnKVcMUB+Mn3dNMv6HP4k0i57fdgaMGpvA==`。
- 含锁定的 Java 1.21.1 可视化、1.20.6 兼容资源和实验室页面；没有换成缺少画面的 engine-only 包。可选声音资源仍按原显式准备流程。

归档只保存在本机验证目录，未提交或上传。拿到同一核验归档后，可在临时开发检出中使用：

```sh
npm install --ignore-scripts --no-save --package-lock=false ./vendor/agent-mc-world-0.5.7-rc.61.tgz
npm run build
npm test
```

不要把临时安装产生的路径、配置或锁文件变更合入仓库。本轮的干净安装使用了已核验归档的本机内容缓存，未运行依赖安装脚本；不能冒称从 npm 下载了未发布版本。

## 验证与边界

核心完整回归 1848 项通过、1 项可选测试跳过、0 失败；327 份公开声明、类型检查、带完整 viewer 的构建，以及独立打包消费端的 NodeNext/Bundler 检查通过。保留首轮并发下两项计时失败；两项串行复查及随后完整受限并发回归通过。旧编译产物对同一方法终态不唤醒，新包能唤醒，空闲和 piggyback 对照仍静默。

DSH 用公开 SDK/MCP 和实际核心 handler 验证默认目录、十个 routine 的参数 schema/sourceHash、错误参数拒绝、原会话归因、可选服务器包共用核心，以及终态进入宿主 inbox；没有连接真实游戏或调用付费模型。完整宿主回归与归档结果见 `candidate-sources.json` 和本地证据。

官方 DSH 0.2.1-rc.2 的真实 profile 解析复测仍在 npm `process/` 请求处抛出 TypeError。上轮的隔离补丁不等于官方框架已修复，见 [上游解析记录](upstream/dsh-profile-resolver.md)。不宣称默认 GUI 安装、原生 Desktop 画面或长期游戏流畅度已验收。

后续发布需要先公开同一核心归档，再从 registry 做干净消费验证，并解决官方 DSH 加载阻塞。源码、候选包、市场、部署及实服效果分别留证。回滚候选时切回升级前的源码及锁文件即可；本轮没有修改原配置、会话、目标、记忆或账本，也没有启动任何角色。
