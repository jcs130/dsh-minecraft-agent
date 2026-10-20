# DSH Desktop 与实验室

> 当前 rc.8 的 URL 核心子依赖触发默认 pnpm 的 ERR_PNPM_EXOTIC_SUBDEP，Desktop 默认安装尚未就绪。下一版将使用 registry 依赖；无需、也不建议关闭保护。以下是目标使用流程，市场索引暂不提供此预览版的安装目标。

支持官方 DSH Desktop 0.2.1-rc.2 的共享 Web 插件入口，普通 Web 同一套构建。Java 1.21.1 是主维护版本，1.20.6 有独立资源兼容构建。不要混用 CLI 与 Desktop 的可执行依赖、profile 锁文件或 node_modules。

## 安装

在 Desktop 的插件管理中选择从 Git 安装：

```text
github:jcs130/dsh-minecraft-agent#v0.3.0-rc.8
```

或者使用本仓库发布页的 `jcs130-dsh-minecraft-agent-0.3.0-rc.8.tgz` 安装包。发行包已包含构建好的 lib/client.js 与宿主适配器；完整身体与可视化由校验锁定的独立核心发行包提供。普通 npm registry 的未发布包名不作为安装入口。

Desktop 的 profile 由桌面程序独占。需要 CLI 安装时，先启动 Desktop 一次以初始化 profile，完全退出后，用 **Desktop 随附**的 dsh 命令执行：

```sh
dsh plugin --profile desktop add github:jcs130/dsh-minecraft-agent#v0.3.0-rc.8
```

重新打开后，在该 profile 的配置中设置 mc-harness 的 `configFile` 为私有 Agent JSON 的绝对路径；参考 examples/harness/agent.json。安装本身不连接游戏，也不启动模型。密钥使用 DSH 已配置的 provider，不在插件内复制。普通服务器选 serverPack: none，千灯纪支持必须显式启用。

发行包包含画面、纹理、字体、原版声音目录和原创 BGM；体积较大的原版音频按需单独从 Mojang 下载。需要完整原版游戏音效时，显式执行安装包提供的 `dsh-minecraft-assets <私有缓存目录>`，将输出的目录写入 `minecraft.viewerAssetsDir`。也可用 Node 执行安装目录的 bin/prepare-assets.mjs。准备过程验证大小与哈希，可续用已验证缓存，不启动游戏或模型，不改写 node_modules。首次音频准备需要网络；未准备不能称为离线音频完整。

## 实验室

会话中打开 Minecraft → 实验室；本机面板同样支持 `http://127.0.0.1:<consolePort>/#experiments`。

配置 `harness2.enabled`、独立环境、明确的任务与预算后，Agent 通过 mc_practice 显式运行。页面展示阶段、心跳、预算、实际试跑、基线/候选对比、独立留出验证、用量覆盖、证据条数和游戏记忆投递。内置 physics 仅为离线平地碰撞物理，不能当成线上战斗、复杂地形或真实服务器验证。

页面只读取共享核心的白名单投影，宿主统一两秒缓存；多开网页不发起更多推理或游戏连接。任务失败、未决执行、过期心跳和缺失用量明确显示，验证通过仍标注未在线采用。未启用时显示空状态；旧版无心跳与作用域证据的账本不冒充新记录。

关闭 harness2.enabled 可停止新练习入口；保持同一任务配置和作用域时，仍可查看原来的结果元数据。不会删除历史、自动补跑或扩大采用权限。记忆投递失败只能显式补投记忆，不能重跑身体来补记录。

## 发现与收录

DSH 当前不附带默认官方市场源。可在 Plugins → More → Experimental plugins 启用 Custom plugin markets，在 Discover 添加：

```text
https://raw.githubusercontent.com/jcs130/dsh-minecraft-agent/main/market/index.json
```

本索引遵循 DSH format 1 并锁定实际发布的 Git commit。社区市场收录须由其维护者审核；提交不代表已经审核或上架。

## 兼容边界与回退

Desktop 采用精确的 dsh-app://app 来源；核心仅允许这个父页面嵌入，API/控制仍有本机 Host、来源、nonce 与会话校验。没有远程开放端口或跨域白名单通配。

安装与构建验收、桌面协议验收、真实客户端画面和线上游戏分别记录。无桌面浏览器的测试环境不能声称已经验证原生窗口画面。

升级前保留私有配置、profile、session-id.txt、目标、记忆和账本。回退到原先锁定的 Git commit 或本地发行包；不要把另一个发布者的无作用域 dsh-minecraft-agent 包当成本插件旧版。更换已运行的 profile 依赖需要先正常停止其 Agent，源码发布不授权打断正在运行的身体。
