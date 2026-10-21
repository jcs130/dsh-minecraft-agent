# DSH npm 子路径解析兼容记录

状态：已复现并在隔离副本验证修复，尚未提交或合入 DSH 上游，也不是官方 DSH 发布版。Minecraft 插件 rc.9 因此仍未发布、未恢复市场安装入口；没有修改现役框架。

2026-10-21 跟进：适配器 rc.10 与核心 rc.61 的全新打包消费端，在官方 profile 解析钩子下仍复现同一 `routeScoped` TypeError。本轮按用户要求只同步源码和验证，没有重新发布、修改框架或应用隔离补丁。见 [本轮记录](../core-update-20261021.md)。

基线为 DSH 0.2.1-rc.2 / `687f282e8625c6b8d11ff58211a90524be2e4317`、Node.js 24.19.0、pnpm 11.28.5、agent-mc-world 0.5.7-rc.57。独立 profile 的 Git 安装与本地归档安装会先被 `esbuild@0.28.2` 的未批准安装脚本阻断。显式使用 `--ignore-scripts` 的 Git 安装通过，所有安装脚本均未执行；TypeScript 子进程烟测也通过，没有添加构建许可或关闭子依赖来源校验。这个命令尚不能解决下面的官方加载器问题。

实际插件加载时，`readable-stream@4.8.0` 请求 npm 包 `process/`。DSH 将请求裁成包名 `process` 后查询 `createRequire(parent).resolve.paths(name)`，Node 将这个名字识别为内置模块并返回 `null`，导致遍历抛出 TypeError。该问题发生在身体和模型启动之前；不能用安装完成或普通 SDK 导入通过代替实际 DSH 加载验收。

[修复建议](dsh-profile-resolver.patch)保留完整请求来查找 profile/linked 作用域中的路径，独立包目录查询使用 `<name>/package.json`，避免把 npm 同名包当作内置模块。内置请求的现有分类与优先级保持不变。补丁需要上游自己的回归、类型和构建检查，目前没有宣称这些检查已完成；也未自动应用到用户的 DSH 或 Desktop。

隔离验证只复制 app-boot 模块并修改这三处解析调用，依赖通过只读目录连接复用。已安装 Minecraft 插件能在真实 PluginPackages 解析下加载，预构建客户端注册 `mc-panel`，两个默认 bundle 入口保持空配置；所有者 RPC 返回 200，其他会话被拒绝，delegate 返回 403，卸载后返回 404。未启动模型、游戏连接或原生 Desktop 窗口。

待完成：上游修复的正式交付与标准发行版复测、默认 GUI 安装、原生 Desktop 画面验收；再发布 Minecraft 插件并恢复市场入口。不能把隔离修补副本的通过结果标为官方 DSH 已兼容。
