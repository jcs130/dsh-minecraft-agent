# 安装当前 Harness 候选版

需要 Node.js 24、DSH 0.2.0-rc.2，以及同一次验收的适配器、核心和可选服务器包 tgz。当前核心/服务器候选未发布到 npm，直接 Git 或 registry 安装不能代替准备配套候选。

在独立部署目录同时安装经过校验的候选，避免 npm 去 registry 寻找尚未发布的核心：

```sh
npm install ./agent-mc-world-0.5.7-rc.43.tgz ./agent-mc-qiandengji-0.5.0-dev.20261019.5.tgz ./dsh-minecraft-agent-0.3.0-rc.3.tgz @deepseek-ai/dsh@0.2.0-rc.2
```

只有需要千灯纪服务器协议时才配置 `serverPack: qiandengji`。普通服务器使用 `none`，不启用服务器专用规则。核心和适配器不需要 Cortico 主项目。

按 DSH bundle 流程将本包加载到独立 profile，再把该 profile 中 `mc-harness.config.configFile` 设为自己的私有 Agent JSON 绝对路径。参考 [Agent JSON](examples/harness/agent.json) 和 [DeepSeek provider](examples/harness/deepseek.patch.yml)，将路径、账号、主机、环境变量改成自己的。示例默认 `enabled: false`，填写完成再启用。

DeepSeek 官方云端的密钥只放本机环境变量，Agent JSON 使用 `reasoningEffort: off` 显式关闭思考。不要把凭据放进提示词、聊天或仓库。服务器登录密码也应使用该服务器/账号专属的私有配置。

游戏版本设为 `1.21.1`，优先使用配套核心的内置 viewer 资源。确认账号与 viewer 的世界绑定一致后，再开启自主目标。安装、编译成功均不等于在线登录或目标达成，需分别核验连接就绪、工具终态和实际进展。

升级前备份私有配置、profile、原会话目录与游戏数据。继续使用原 `session-id.txt`，不要覆盖目标、记忆或账本；保持一个账号只有一个身体。回滚时停止本次部署，恢复旧依赖和配置，然后从原会话恢复。详细生命周期见 [迁移指南](docs/harness-migration.md)。
