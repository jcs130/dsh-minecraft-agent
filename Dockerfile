# dsh-minecraft-agent 穿越者镜像 —— AI 玩家客户端（每个 AI 玩家一个容器）。
#
# build context 必须是「同时包含 deepseek-harness/ 与 minecraft-ai-friend/ 的目录」
# （workspace 根；两个仓平级 checkout 时天然满足）：
#
#   docker build -f deepseek-harness/scratch-plugin/Dockerfile -t mc-transmigrator .
#
# 设计三条铁律：
#  1. 无头（MC_VIEWER=0）：prismarine-viewer 的 canvas/gl 全家桶走
#     --omit=optional 跳过（懒加载 import 已修，viewer 关闭时零 native 需求）。
#     观察走自带 mc-panel(:3200) web 面板（纯 node:http + node 内置模块）。
#  2. 零 RCON 边界靠镜像层物理强制：只 COPY 穿越者侧源码，mc-rcon / mc-god /
#     mc-magic 等世界侧文件根本不进镜像——不是“不调用”，是“不存在”。
#  3. 零配置冷启动：entrypoint 先跑 seed-agent.mjs 给 MC_USERNAME 自动生成
#     「旅人」档案（MC_PERSONA / MC_BACKSTORY / MC_EPITHET 可覆盖）。
#
# 分发到局域网其他电脑：
#   docker save mc-transmigrator | gzip > mc-transmigrator.tar.gz
#   # 对方：docker load < mc-transmigrator.tar.gz && node cli/mc-join.mjs join --name XiaoP --host <服务器IP>
FROM node:22-bookworm-slim

# python3/make/g++ 仅作 better-sqlite3 prebuilt 缺失时的编译兜底。
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) 依赖层（package*.json 不变则缓存命中；--omit=optional 跳过 canvas/gl）
COPY deepseek-harness/scratch-plugin/package.json deepseek-harness/scratch-plugin/package-lock.json ./
RUN npm install --omit=optional --legacy-peer-deps --no-audit --no-fund \
  --registry=https://registry.npmmirror.com \
  && npm install --no-save --legacy-peer-deps --no-audit --no-fund \
  tsx @standard-schema/spec \
  --registry=https://registry.npmmirror.com

# 2) dsh 底座（vendor + packages，symlink 进 node_modules 等价 Windows junction）。
COPY deepseek-harness/vendor /app/dsh/vendor
COPY deepseek-harness/packages /app/dsh/packages
RUN node -e '\
const fs = require("fs"), path = require("path"); \
const target = "/app/node_modules/@deepseek-ai"; \
fs.mkdirSync(target, { recursive: true }); \
const link = (dir) => { \
  const pj = path.join(dir, "package.json"); \
  if (!fs.existsSync(pj)) return; \
  const name = JSON.parse(fs.readFileSync(pj, "utf8")).name || ""; \
  if (!name.startsWith("@deepseek-ai/")) return; \
  const dest = path.join(target, name.split("/")[1]); \
  if (!fs.existsSync(dest)) fs.symlinkSync(dir, dest, "dir"); \
  console.log("linked " + name + " -> " + dir); \
}; \
const walk = (root) => fs.readdirSync(root, { withFileTypes: true }) \
  .filter((d) => d.isDirectory()).forEach((d) => link(path.join(root, d.name))); \
walk("/app/dsh/vendor"); \
walk("/app/dsh/packages/core"); \
'

# 3) 穿越者侧源码（白名单 COPY —— 世界侧文件物理隔离，零 RCON 是结构保证）
COPY deepseek-harness/scratch-plugin/src/mc-bot.ts \
     deepseek-harness/scratch-plugin/src/mc-tools.ts \
     deepseek-harness/scratch-plugin/src/mc-camera.ts \
     deepseek-harness/scratch-plugin/src/mc-vision.ts \
     deepseek-harness/scratch-plugin/src/mc-memory.ts \
     deepseek-harness/scratch-plugin/src/mc-memos.ts \
     deepseek-harness/scratch-plugin/src/mc-evolve.ts \
     deepseek-harness/scratch-plugin/src/mc-transmigrator.ts \
     deepseek-harness/scratch-plugin/src/mc-identity.ts \
     deepseek-harness/scratch-plugin/src/mc-mystic.ts \
     deepseek-harness/scratch-plugin/src/mc-offering.ts \
     deepseek-harness/scratch-plugin/src/mc-wiki.ts \
     deepseek-harness/scratch-plugin/src/mc-loop.ts \
     deepseek-harness/scratch-plugin/src/mc-panel.ts \
     deepseek-harness/scratch-plugin/src/shims.d.ts \
     deepseek-harness/scratch-plugin/src/cordis-augment.d.ts \
     ./src/
COPY deepseek-harness/scratch-plugin/bootstrap-mc.mts deepseek-harness/scratch-plugin/tsconfig.json ./
COPY deepseek-harness/scratch-plugin/docker/seed-agent.mjs ./

# 4) 运行时默认值（全部可被 docker run -e / compose environment 覆盖）。
#    LLM/MemOS 默认指 host.docker.internal：与穿越者镜像同机部署时零配置。
#    跨机部署（小 P 电脑）用 CLI：mc-join.mjs join --name X --host <服务器IP>
#    会自动把 LLM/MemOS 指到服务器 IP。
ENV MC_HOST=host.docker.internal \
    MC_PORT=25565 \
    MC_VIEWER=0 \
    MC_GOD_NAME=Goddess \
    MC_PANEL_HOST=0.0.0.0 \
    MC_PANEL_PORT=3200 \
    MC_LLM_BASE_URL=http://host.docker.internal:8890/v1 \
    MC_LLM_URL=http://host.docker.internal:8890/v1 \
    MC_LLM_API_KEY=sk-local \
    MC_LLM_KEY=sk-local \
    MC_LLM_MODEL=qwen3.8 \
    MC_MEMOS_URL=http://host.docker.internal:8002

EXPOSE 3200
VOLUME /app/data

# 面板(3200) + 穿越者进程。数据持久化在 volume（记忆/状态/档案润色不丢）。
ENTRYPOINT ["/bin/sh", "-c", "mkdir -p data && node seed-agent.mjs && exec npx tsx bootstrap-mc.mts"]
