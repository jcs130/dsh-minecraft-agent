# 安装 DSH Minecraft Agent 0.3.0-rc.9

> rc.9 使用 registry 依赖。发布与默认 DSH 安装状态见[发布记录](docs/registry-release.md)，保留包管理器的默认保护。

需要 Node.js24 和 DSH0.2.1-rc.2，Java1.21.1 主维护。发行包已包含构建后的前端，不需要手动准备 vendor 候选。核心锁定 agent-mc-world@0.5.7-rc.57，全部依赖使用 registry.npmjs.org，均含完整性校验。可选服务器包 agent-mc-qiandengji@0.5.0-rc.3 已发布。

安装 npm 固定版本：

```sh
dsh plugin --profile web add @jcs130/dsh-minecraft-agent@0.3.0-rc.9
```

从源码开发：

```sh
git clone https://github.com/jcs130/dsh-minecraft-agent && cd dsh-minecraft-agent
npm ci && npm test && npm run build
```

Desktop 用户优先使用插件管理器；CLI 必须使用 Desktop 随附的命令且先完全退出桌面程序，详见[桌面与实验室指南](docs/desktop.md)。国内网络可以只在本机使用镜像，不要提交 `.npmrc`，也不要用镜像重新生成锁文件：

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

按 DSH bundle 流程将本包加载到独立 profile，再把该 profile 中 `mc-harness.config.configFile` 设为自己的私有 Agent JSON 绝对路径。参考 [Agent JSON](examples/harness/agent.json) 和 [DeepSeek provider](examples/harness/deepseek.patch.yml)，将路径、账号、主机、环境变量改成自己的。示例默认 `enabled: false`，填写完成再启用。

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
