# DSH 直接兼容与旧版修复回滚

从适配器 `0.3.0-rc.12` 起，直接支持未修补的官方 DSH `0.2.1-rc.2`。安装与启用无需运行 doctor，也不需要改写 CLI 或 Desktop 的程序文件。公开状态见[分发记录](registry-release.md)。Node.js 24、共享 Web 插件入口、SDK/MCP 和可选千灯纪包沿用同一套构建。

DSH 的原始问题是 npm `process/` 子路径解析失败。插件现在在异步导入游戏 SDK 前，同步初始化精确依赖 `readable-stream@4.8.0` 自带的 Node 原生流模式；初始化期间临时设置 `READABLE_STREAM=disable`，并在同一同步调用的 `finally` 中恢复原值。不存在跨 `await` 的环境修改，不修改解析器或依赖文件，也不会将临时值传入模型、游戏或子进程。普通插件入口和独立 Harness² 入口均包含这个初始化。

回归使用未经修补的官方主入口和 Worker 引导入口：先复现原有错误，再验证两个插件入口顺序、实际 SDK/MCP、离线引擎 IPC、游戏记忆、物理练习和独立 Worker；前后校验官方文件 SHA256 与解析器函数引用。Worker 显式使用官方 profile 引导，并确认原始错误仍存在于宿主解析器，避免用未启用解析器的 Worker 得到假通过。安装本身不启动游戏或模型。

本修复属于 DSH 宿主引导，通用 Minecraft 核心保持 `0.5.7-rc.64`，可选千灯纪包保持 `0.5.0-rc.10`。不复制游戏能力、不修改 Cortico 主项目。Desktop 原生画面和实服游玩效果仍单独记录。

## 曾经手工修复过的安装

下面仅保留 rc.11 的历史工具说明，供明确修复过旧安装的用户检查或回滚。rc.12 不需要执行 `--apply`。若要回到原始官方文件，先退出所选 DSH，再用原先保留的备份执行 `--rollback`；源码发布不会替用户重启任何程序。

DSH 0.2.1-rc.2 会把 npm 包 `process/` 的包名当作 Node 内置模块，导致 Minecraft 插件在模型和游戏连接之前加载失败。修复已在 DSH 源码、完整构建与主进程/Worker 编译产物中验证。官方版本更新前，提供独立的 `dsh-minecraft-doctor` 工具；它不在插件安装、导入或启用时自动运行。

先完全退出要修复的 DSH 或 Desktop，选择包含 `@deepseek-ai/dsh/package.json` 的实际安装目录。它不是 profile、游戏目录，也不是 Minecraft 插件目录。默认只读检查：

```sh
dsh-minecraft-doctor --dsh-root "<DSH安装目录>"
```

需要修复时，明确执行：

```sh
dsh-minecraft-doctor --dsh-root "<DSH安装目录>" --apply
```

工具只接受已核验的 DSH 0.2.1-rc.2 原始或同一修复后的文件，覆盖 `dsh-app-boot` 的主入口与 Worker 解析入口。先检查全部文件，再加独占锁；保留带 SHA256 的原始备份，以原子替换避免修改共享依赖存储的硬链接。未知内容、损坏备份、其他版本或只读应用归档会拒绝写入。工具不启动服务、不修改 profile、会话或凭据，也不连接模型和游戏。完成后自行启动 DSH。

若要撤销，先退出 DSH，再运行：

```sh
dsh-minecraft-doctor --dsh-root "<DSH安装目录>" --rollback
```

回滚只使用本工具保留且哈希匹配的备份；不会覆盖后续未知修改。已修复但没有本工具备份的安装不能由它接管回滚。官方已包含修复的新版本不需要此工具，仍可直接使用 Minecraft 插件。

此兼容步骤与插件发布、官方 DSH 修复的合并/发行、Desktop 原生画面和实服长期游玩分别记录。不要把手动修复后的通过结果称为未修补旧版 DSH 已正常加载。

## English

Adapter rc.12 supports stock DSH 0.2.1-rc.2 directly. Before dynamically importing the game SDK, each independent entry synchronously initializes readable-stream's supported native Node backend and restores the original environment in the same call. It never patches host/dependency files or the resolver, leaves no persistent environment change and starts no game/model connection. Actual official profile and Worker resolution, SDK/MCP, offline IPC/game memory and physics initialization are regression-tested; host file hashes and resolver identities remain unchanged. The older explicit doctor remains solely for checking/rolling back installations previously repaired by an operator. Native Desktop pixels and live gameplay are separate evidence.
