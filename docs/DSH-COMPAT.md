# DSH 旧版加载修复

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

DSH 0.2.1-rc.2 misclassifies npm subpaths such as `process/` while resolving plugin dependencies. The optional doctor performs a read-only check by default. Fully exit the selected DSH/Desktop installation before explicitly using `--apply` or `--rollback`. Specify the directory containing `@deepseek-ai/dsh/package.json`. Both the main and Worker resolver are covered; exact known bytes, exclusive locking, verified backups and atomic replacement protect unrelated changes and shared-store hardlinks. Installation/import never applies the repair automatically. Unknown releases or modified files are left untouched. No service, model or game is started.
