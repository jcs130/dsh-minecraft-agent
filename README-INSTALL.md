# 安装 DSH Minecraft Agent

[rc.17 GitHub Release](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.17) 已公开，提供首次配置表单和游戏旁的原生决策会话。npm rc.17 已公开且 `latest` 指向该版；新安装使用下方固定 npm 版本。邀请接入步骤见[指南](docs/qiandengji-invitation.md)，渠道状态见[发布记录](docs/registry-release.md)。

> rc.17 在未经修补的官方 DSH 0.2.1-rc.2 / rc.3 中通过默认安装验证，无需执行 doctor。发行归档包含构建后的前端和适配器。实现和曾手工修复安装的回滚见[兼容指南](docs/DSH-COMPAT.md)。

需要 Node.js 24，官方 DSH 0.2.1-rc.2 / rc.3 已验证，Java 1.21.1 主维护。rc.17 锁定 agent-mc-world@0.5.7-rc.84 与 agent-mc-qiandengji@0.5.0-rc.22。生产引擎、脚本与训练模拟器使用编译版，不要求 tsx。

通过 DSH 从官方 registry 安装已验证的固定版本：

```sh
dsh plugin --profile web add @jcs130/dsh-minecraft-agent@0.3.0-rc.17 --registry=https://registry.npmjs.org
```

安装包的匿名下载与已验证归档字节一致，运行文件与审阅源码一致，见 [GitHub 分发验收](https://github.com/jcs130/dsh-minecraft-agent/releases/download/v0.3.0-rc.17/github-release-verification.json)。包内 README 和状态文件是构建时快照，当前分发状态以 Release 与本仓库记录为准；不重新打包同一版本。npm 归档与 GitHub 归档完全一致，官方 DSH rc.2 / rc.3 的默认 registry 安装、SDK/MCP 和主进程/Worker 验证均通过，见 [npm 分发验收](https://github.com/jcs130/dsh-minecraft-agent/releases/download/v0.3.0-rc.17/npm-registry-verification.json)。也可安装相同字节的 [GitHub 归档](https://github.com/jcs130/dsh-minecraft-agent/releases/download/v0.3.0-rc.17/jcs130-dsh-minecraft-agent-0.3.0-rc.17.tgz)。本仓库的市场索引已更新为 rc.17；社区市场仍需维护者审核。首次配置与决策旁栏用法见[快速接入](docs/quick-start.md)。

如果镜像源报 `ERR_PNPM_NO_MATCHING_VERSION`，先确认其是否同步了插件锁定的核心及可选服务器包。镜像尚未同步时，显式使用上面的官方 registry；这不会改写全局 registry、放宽 pnpm 安全配置或更换依赖版本。不要通过降级核心、关闭安装保护或混用现役 profile 来绕过镜像未同步。

源码开发：

```sh
git clone https://github.com/jcs130/dsh-minecraft-agent
cd dsh-minecraft-agent
npm ci
npm run build
npm test
```

插件同步初始化 Node 原生流依赖后，正常导入共享核心；不改写 DSH/依赖文件或解析器，不保留临时环境变量。安装本身不开游戏或模型。Desktop 使用其自身的插件管理和 profile，不混用其他 CLI 的 node_modules。此前手工使用过 doctor 的用户可按兼容指南自行检查或回滚备份，升级不要求再次修复框架。详见[桌面与实验室指南](docs/desktop.md)。

国内网络可以只在本机使用镜像，不要提交 `.npmrc`，也不要用镜像重新生成锁文件：

```sh
npm ci --registry=https://registry.npmmirror.com
# 或写入用户级 ~/.npmrc：registry=https://registry.npmmirror.com
```

### 无模型试跑（不需要 API key）

```sh
npm run dry-run                     # 离线：构建真实身体与 MCP 桥，列出工具、读取工具说明，不联网
MC_HOST=... MC_PORT=... MC_USERNAME=... npm run dry-run -- --connect
                                    # 连接服务器，读取背包/声音/风险快照后断开，不发聊天、不调用模型
```

`--connect` 还读取 `MC_VERSION`（默认 1.21.1）和可选的 `MC_LOGIN_CONFIG`，参见 `.env.example`。

### 无头运行

`dsh web` 默认会打开浏览器，并把带访问令牌的地址打印到终端。服务器/CLI 场景请加 `--no-open`，并且不要把含 `token=` 的输出原样存日志，例如：

```sh
dsh web --no-open --profile <profile> 2>&1 | sed -E 's/(token=)[^&[:space:]]+/\1***/g' >> run.log
```

插件自己写的 status.json 和日志不包含令牌。

### 可选：本地候选 tgz

验证其他尚未发布的核心/服务器候选时，把归档放到被忽略的 `vendor/`（`*.tgz` 已在 .gitignore），在部署目录或临时检出中安装，不要提交额外改动的 `package.json`/锁文件：

```sh
npm install ./vendor/agent-mc-world-<版本>.tgz ./vendor/agent-mc-qiandengji-<版本>.tgz
```

`candidate-sources.json` 记录核心与服务器包的来源及完整性校验。Harness² 使用与回退见 [harness2.md](docs/harness2.md)，默认不启用。

只有需要千灯纪服务器协议时才配置 `serverPack: qiandengji`。普通服务器使用 `none`，不启用服务器专用规则。核心和适配器不需要 Cortico 主项目。

rc.17 的普通接入：先在 DSH 选好默认模型，打开侧栏 Minecraft，填地址、角色名和登录方式，点击保存并连接。一般离线服不需要密码；仅明确要求 `/login` 的已有账号填写可选密码。首次任务可留空，进服后通过右侧原会话输入指令。不需要手写 JSON、选择端口或另填模型密钥。

高级部署仍按 DSH bundle 流程加载本包，并将 `mc-harness.config.configFile` 设为私有 Agent JSON 绝对路径。参考 [Agent JSON](examples/harness/agent.json) 和 [DeepSeek provider](examples/harness/deepseek.patch.yml)，将路径、账号、主机、环境变量改成自己的。示例默认 `enabled: false`，填写完成再启用。已有 configFile 不受首次配置覆盖。

DeepSeek 官方云端的密钥只放本机环境变量，Agent JSON 使用 `reasoningEffort: off` 显式关闭思考。不要把凭据放进提示词、聊天或仓库。服务器登录密码也应使用该服务器/账号专属的私有配置。

游戏版本设为 `1.21.1`，优先使用配套核心的内置 viewer 资源。确认账号与 viewer 的世界绑定一致后，再开启自主目标。安装、编译成功均不等于在线登录或目标达成，需分别核验连接就绪、工具终态和实际进展。

升级前备份私有配置、profile、原会话目录与游戏数据。继续使用原 `session-id.txt`，不要覆盖目标、记忆或账本；保持一个账号只有一个身体。回滚时停止本次部署，恢复旧依赖和配置，然后从原会话恢复。详细生命周期见 [迁移指南](docs/harness-migration.md)。

## 包名变更（0.3.0-rc.6 起）

npm 上的 `dsh-minecraft-agent` 属于其他发布者，本插件改用 `@jcs130/dsh-minecraft-agent`。DSH 按 npm 包名加载插件模块和浏览器入口，profile 中的行 id（`mc-frontend`、`mc-harness`）不变，但 `name` 需改为带作用域的路径：

```yaml
- id: mc-frontend
  name: '@jcs130/dsh-minecraft-agent'
- id: mc-harness
  name: '@jcs130/dsh-minecraft-agent/lib/plugins/mc-harness.mjs'
```

已有部署升级时先卸载旧包名（`npm uninstall dsh-minecraft-agent`），再安装新包名，并把 profile 里旧的 `name` 改掉；否则会残留旧包或加载失败。
