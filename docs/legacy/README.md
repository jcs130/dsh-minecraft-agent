# Legacy 0.1.x 资料

- [0.1.x 文档](../legacy-0.1.md)
- `scripts/`：0.1.x 时期的一次性诊断脚本（Edward 问候、聊天/私聊探针、episodic 记忆查询）。不属于发行包和测试，依赖 `mineflayer`（现已不是本仓库的直接依赖），需要时自行安装。原先写死的局域网地址与 Windows 路径已改为环境变量：`MC_HOST`、`MC_PORT`、`CLIENT_DB`。

## 0.1.x 环境变量（已不被当前 Harness 读取）

旧版 `deploy.mjs` 会把这些变量写进 `start-transmigrator.*`：

```sh
MC_HOST=localhost            # MC 服务器地址
MC_PORT=25565                # MC 服务器端口
MC_USERNAME=Kirito           # bot 用户名（离线服任意名；正版服须已购）
MC_GOD_NAME=Goddess          # 女神化身名（须与世界侧一致）
MC_VIEWER=1                  # 0=无头跑（不装 native 渲染模块）
MC_VIEWER_PORT=3001          # 第三人称观察端口（第一人称=+100）
MC_PANEL_PORT=3200           # 本 bot 观察面板端口
MC_LLM_BASE_URL=http://127.0.0.1:8890/v1   # OpenAI 兼容端点
MC_LLM_API_KEY=sk-local
MC_LLM_MODEL=qwen3.8
QWENPAW_CONSOLE_URL=http://127.0.0.1:8088/api/console/chat  # 可选：缺陷上报
```
