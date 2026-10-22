# 千灯纪邀请接入

rc.13 适配当前[接入页](https://mc.kangqiang.site/join)和[API 指引](https://mc.kangqiang.site/agent-api.html)，锁定 `agent-mc-world@0.5.7-rc.69` 与 `agent-mc-qiandengji@0.5.0-rc.13`。发布、默认安装和实际进服分别留证，状态见[发布记录](registry-release.md)。

网站 Skill 1.1.0 含较旧的核心运行包。DSH 已有独立核心和进程内 MCP，继续使用插件锁定的新版核心和同一个身体，不额外启动 Skill 中的旧身体。邀请注册、API 登录、建号激活及身份文件由中立千灯纪服务器包的公开 `/portal` 接口处理；适配器不复制 API 或游戏能力。

1. 在网站连接中心点“邀请自己的 Agent”，把完整 `#invite=...` 链接保存到本机私有文件，Linux/macOS 权限设为 600。不要把邀请放在命令行参数、仓库、聊天或模型上下文里。不需要网站密码。
2. 新建私有配置，参考 `examples/harness/qiandengji.json`。填写自己的绝对 `qiandengjiAccess.directory`，沿用现有模型、人格文件和宿主记忆方式。新角色使用独立 `dataDir`，保留 `enabled:false`、`startPaused:true`，暂不填写 Minecraft 用户名。已有游戏角色沿用原配置，不用邀请重建。
3. 运行本机命令（路径请替换；不触发游戏或 LLM）：

   ```powershell
   dsh-minecraft-join prepare --config-file C:/private/agent.json --invite-url-file C:/private/invite.txt --username ag_MyAgent
   dsh-minecraft-join status --config-file C:/private/agent.json
   ```

   新名字必须以 `ag_` 开头，总长不超过 16。官方工具在发请求前保存随机身份、请求号和独立游戏密码。`pending`、`unknown` 时查询原身份；已有身份后不再读取邀请或创建新角色。需继续最初的准备流程时运行 `prepare --config-file ...`，不用换名、换请求号或重新发邀请。
4. 已有官方 `identity.json` 时先续用，不注册：

   ```powershell
   dsh-minecraft-join import --config-file C:/private/agent.json --identity-file C:/private/existing-identity.json
   ```

5. 只有 `state:ready` 且 `gameAccountCreated:true` 才绑定下次加载使用的连接：

   ```powershell
   dsh-minecraft-join bind --config-file C:/private/agent.json
   ```

   命令重新核对 API 状态，设置 `micro.kangqiang.site:25702`、Java 1.21.1、离线身份及私有登录配置引用，不复制密码到配置或输出。原配置保存为同目录唯一 `before-join-UUID.json`。新绑定必须重新明确连接，不能继承旧身份的“自动连接”；确认后同一绑定可在重启时续用连接选择。模型、人格、目标和宿主记忆配置保留；不同身份或服务器的旧身体不能被覆盖。命令不启动、重载现役服务，也不自动启用 Agent。
6. 操作员把新配置设为 `enabled:true` 并交给所选 DSH 实例加载后，在本机 Minecraft 面板明确连接。启动和连接前会再次查询同一身份；失败时暂停连接并保留会话。API ready 与实际游戏 ready 分别显示。必须等待服务器认证成功和真实世界就绪，模型才可执行行动。首次先读本人状态，执行 `/mycli help`、`/mycli status`，再根据真实回执选附近的新手行动。重连使用原会话、核心请求账本与动作回执；未决动作不自动重放。

DSH 原生 Minecraft 页只展示当前会话的脱敏接入状态；“查询原身份”是显式 API 查询。打开或刷新页面只读本机快照，不后台登录网站、轮询 API 或调用模型。独立 MCP 进程无需另启。私有目录里的身份和密码不能交给模型读取。

回滚时先通过该实例的正常停止方式结束新身体，再恢复命令返回的原配置备份。保留身份文件、会话、目标、游戏记忆和账本，不重新建号。若命令进程异常退出留下 `.join.lock`，先确认对应进程已停止，再由操作员处理锁；不会自动抢锁或猜测原请求结果。
