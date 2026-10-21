# Registry 分发与 rc.9 验收

本页记录 rc.9 的分发修复与验收顺序，包内文档是打包时快照；实际公开发布状态以 [GitHub Release](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.9) 的验证记录为准。源码提交、npm/GitHub 发布、默认 DSH 安装、Desktop 画面及现役加载分别记录。不要在聊天、仓库或 profile 中保存 npm token。

2026-10-21 发布进度：核心 agent-mc-world@0.5.7-rc.57 已公开发布到 npm，匿名下载与 GitHub 归档的字节、SHA256 和 dist.integrity 一致。适配器 rc.9 的全新依赖安装、83 项常规宿主测试及单独的真实 Harness² 物理/本地协议测试已通过；实际安装/加载验收发现新的框架兼容阻塞，rc.9 尚未在 GitHub 或 npm 发布，市场 PR18 和发现入口继续暂缓。

实际阻塞：[DSH 子路径解析记录](upstream/dsh-profile-resolver.md)。不加参数的 Git 与归档安装均报告 ERR_PNPM_IGNORED_BUILDS（esbuild@0.28.2）；加 --ignore-scripts 的 Git 安装与 TypeScript 子进程烟测通过，没有执行安装脚本。官方 DSH 在加载 readable-stream 的 process/ npm 依赖时仍抛出 TypeError。隔离修补 app-boot 后，所有者 200、其他会话拒绝、delegate 403、卸载 404 均通过；该副本不等于官方 DSH 已兼容。没有自动应用补丁，也没有修改现役框架。

rc.8 的 npm 干净安装能够通过，但真实 `dsh plugin add` 在默认 pnpm11 下报告 ERR_PNPM_EXOTIC_SUBDEP，原因是核心的 GitHub URL 子依赖。官方 Desktop 0.2.1-rc.2 源码锁定 pnpm11.28.5。本次修复把核心依赖改成 registry SemVer 0.5.7-rc.57，并检查完整锁文件均来自 registry.npmjs.org；不关闭 blockExoticSubdeps，不加宽泛 allowBuilds，不降级包管理器。

核心的已验证 tgz 保持不变：SHA256 317ff114bf73dc2570009ff1e6cacf4127bd9020b430d413ae27bbfa306b59a1，来源提交 e4f18f6ecd4e28a6d3ad7b2657514b8aec959a3a。npm 与 GitHub 必须使用相同字节，不能用重新打包的制品覆盖原版本。

发布与安装的验收顺序：

1. `npm whoami --registry=https://registry.npmjs.org` 确认当前账号；读取现有维护者权限，沿用已验证的核心 tgz 发布到 next 标签，不重新生成不同的核心字节。
2. 从 npm 读取 agent-mc-world@0.5.7-rc.57 的 dist.integrity，核对为 sha512-hdsCyamWN6+ZW1IpKCrGQLzBsMsqVaNlR3Fr7hM3w6T744ZcpfOQL8ki//5D4rMyvgGV15Geg1Zldky0N4ka6A==。
3. 在全新目录进行 registry-only npm ci、完整宿主测试、安装包检查与一次可选 Harness2 本地协议/物理验证。准备阶段复用旧安装目录的离线测试不能当成这一步的通过证据。
4. 更新 candidate-sources 中的实际 registry 验证状态，再打包并发布 @jcs130/dsh-minecraft-agent@0.3.0-rc.9 至 next 标签；发布与 tag/源码、哈希分别记录。
5. 使用隔离 DSH_HOME、Node24 和官方匹配的 pnpm11.28.5，在默认保护下实际执行 dsh plugin add，确认 bundle patch、客户端入口与会话绑定；保持安装不启动模型或身体。
6. 默认安装验收完成后，再移除 rc.8 安装阻塞提醒、恢复市场索引为 rc.9，更新社区 PR18 的条目/生成索引并转为待审核。原生 Desktop 窗口像素验收仍需可用的桌面浏览器通道，不能由协议测试代替。

市场 PR：https://github.com/ydhrdh/dsh-marketplace/pull/18，由维护者审核；提交或转为待审核都不等于已上架社区主索引。rc.8 Release 保留原失败与阻塞说明，新的预览版完成安装验收后再更新当前发现入口。现役 Agent、模型、World 和客户端不因发布重载。
