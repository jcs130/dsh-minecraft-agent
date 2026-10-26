# DSH Desktop 与实验室

当前发行版为 **0.3.0-rc.24**，精确依赖核心 **0.5.7-rc.99**，已发布到 npm 和 [GitHub Release](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.24)。Mineflayer 默认自动协商协议；网页缺少对应版本的预制材质时自动显示兼容画面，未知素材局部占位，无需用户先准备资源才能连接。DSH 显示 Agent 账号和同连接网页画面，侧栏保留原生推理、工具与回答。

> 官方 DSH **0.2.1-rc.2 / rc.3** 的默认 pnpm registry 安装、主进程／Worker 加载、37 个 MCP 工具与本地知识库查询已验证，见 [npm 验收记录](npm-publish-rc24.json)。共享 Web 页面与隔离原版 1.21.11 画面有独立验证；**尚未实测 Desktop 原生窗口画面**，不把这些结果当成完整桌面端验收。详见[发布记录](registry-release.md)。

采用 DSH Desktop 与 Web 共用的插件契约和同一套构建。插件在同步引导中使用依赖的 Node 原生流模式，无需修改 Desktop 应用归档。Java 1.21.1 是主维护版本，其他协议版本由已安装 Mineflayer 的实际支持决定，不按预制材质包限制连接。不要混用 CLI 与 Desktop 的可执行依赖、profile 锁文件或 node_modules。

## 安装

在 **Desktop 应用内 → 插件 → 添加插件** 输入：

```text
@jcs130/dsh-minecraft-agent@0.3.0-rc.24
```

registry 选择 `https://registry.npmjs.org`。支持安装归档 URL 的版本也可使用同字节的固定发行包：

```text
https://github.com/jcs130/dsh-minecraft-agent/releases/download/v0.3.0-rc.24/jcs130-dsh-minecraft-agent-0.3.0-rc.24.tgz
```

发行包包含构建好的 lib/client.js 与宿主适配器；身体与可视化由精确锁定的核心发行包提供。通常直接安装 npm 包即可，无需自行编译。

Desktop 的 profile 由桌面程序管理，使用应用内插件管理器安装。不要套用普通 Web 的 CLI 安装命令，也不要向 desktop profile 强行写入依赖或关闭宿主保护。

安装后，侧栏 Minecraft 提供首次接入表单：复用 DSH 默认模型，填写服务器与账号，再显式保存并连接。普通离线服无需密码；正版走微软授权；仅登录服需要可选 `/login` 密码。端口和数据目录由插件分配，同账号保留原会话。游戏与决策并排，推理和工具使用 DSH 原生组件，可切换只看游戏。详见[快速接入](quick-start.md)。

高级部署仍可设置 mc-harness 的 `configFile` 为私有 Agent JSON 的绝对路径；参考 examples/harness/agent.json。新邀请接入见[千灯纪邀请接入](qiandengji-invitation.md)。安装本身不连接游戏，也不启动模型。密钥使用 DSH 已配置的 provider，不在插件内复制。普通服务器选 serverPack: none，千灯纪支持必须显式启用。

发行包包含画面、纹理、字体、原版声音目录和原创 BGM；体积较大的原版音频按需单独从 Mojang 下载。需要完整原版游戏音效时，显式执行安装包提供的 `dsh-minecraft-assets <私有缓存目录>`，将输出的目录写入 `minecraft.viewerAssetsDir`。也可用 Node 执行安装目录的 bin/prepare-assets.mjs。准备过程验证大小与哈希，可续用已验证缓存，不启动游戏或模型，不改写 node_modules。首次音频准备需要网络；未准备不能称为离线音频完整。

## 实验室

常驻侧栏 Minecraft 入口和原会话标签使用同一个核心面板，不创建额外账号、身体或模型请求。DSH 会隐藏空白会话中的视图区域，侧栏入口不受这个限制；未配置时显示首次接入表单。高级配置的面板不可用时仍可显式重新检查。

侧栏或会话中打开 Minecraft → 实验室；本机面板同样支持 `http://127.0.0.1:<consolePort>/#experiments`。

配置 `harness2.enabled`、独立环境、明确的任务与预算后，Agent 通过 mc_practice 显式运行。页面展示阶段、心跳、预算、实际试跑、基线/候选对比、独立留出验证、用量覆盖、证据条数和游戏记忆投递。内置 physics 仅为离线平地碰撞物理，不能当成线上战斗、复杂地形或真实服务器验证。

页面只读取共享核心的白名单投影，宿主统一两秒缓存；多开网页不发起更多推理或游戏连接。任务失败、未决执行、过期心跳和缺失用量明确显示，验证通过仍标注未在线采用。未启用时显示空状态；旧版无心跳与作用域证据的账本不冒充新记录。

关闭 harness2.enabled 可停止新练习入口；保持同一任务配置和作用域时，仍可查看原来的结果元数据。不会删除历史、自动补跑或扩大采用权限。记忆投递失败只能显式补投记忆，不能重跑身体来补记录。

## 发现与收录

不同桌面发行版预装的市场不同。支持 DSH Discover 的版本可在「插件 → 发现 → 管理索引源」添加下面的自有源；若「发现」尚未启用，先在 Plugins → More → Experimental plugins 启用 Custom plugin markets：

```text
https://raw.githubusercontent.com/jcs130/dsh-minecraft-agent/main/market/index.json
```

本索引遵循 DSH format 1，当前提供已通过默认安装验证的 rc.24。更多入口及审核状态见[市场收录记录](marketplaces.md)。社区收录、索引同步、npm 发布和实际安装是不同状态；提交不等于审核通过。无需为了安装本插件同时装多个市场。

## 兼容边界与回退

Desktop 采用精确的 dsh-app://app 来源；核心仅允许这个父页面嵌入，API/控制仍有本机 Host、来源、nonce 与会话校验。没有远程开放端口或跨域白名单通配。

安装与构建验收、桌面协议验收、真实客户端画面和线上游戏分别记录。无桌面浏览器的测试环境不能声称已经验证原生窗口画面。

升级前保留私有配置、profile、session-id.txt、目标、记忆和账本。回退到原先锁定的 Git commit 或本地发行包；不要把另一个发布者的无作用域 dsh-minecraft-agent 包当成本插件旧版。更换已运行的 profile 依赖需要先正常停止其 Agent，源码发布不授权打断正在运行的身体。
