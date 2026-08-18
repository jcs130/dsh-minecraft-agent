# dsh-minecraft-agent 穿越者镜像 —— AI 玩家客户端（每个 AI 玩家一个容器）。
#
# build context 必须是「同时包含 deepseek-harness/ 与 minecraft-ai-friend/ 的目录」
# （workspace 根；两个仓平级 checkout 时天然满足）：
#
#   docker build -f deepseek-harness/scratch-plugin/Dockerfile -t mc-transmigrator .
#
# 设计三条铁律：
#  1. 无头 3D（无浏览器/无显卡/GPU 零占用）：MC_VIEWER=0 不起 viewer 网页服务，
#     但 mc_see 的方案 C 相机栈进镜像——canvas/gl 预编译二进制 + node-canvas-webgl
#     （纯 JS）+ Xvfb（headless-gl 的 GLX pbuffer 需要 X display；DEFECT-20260818-
#     063022 实证：无 X 时 createGLContext 返回 null）。渲染走 Mesa swrast 纯软渲染
#     （与 Windows 裸机同路径同性能画像）。
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
# 相机栈运行库：cairo/pango/jpeg/gif/rsvg（node-canvas 预编译的动态链接）+
# mesa/GL/x11/glew（headless-gl 预编译的动态链接）+ xvfb/xauth（虚拟 X）。
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     python3 make g++ \
     libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
     libgl1 libglx-mesa0 libgl1-mesa-dri libglew2.2 libx11-6 libxext6 libxi6 \
     xvfb xauth \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) 依赖层（package*.json 不变则缓存命中；--omit=optional 跳过 canvas/gl
#    【包管理器解析】——相机栈改由下面显式钉版本安装，不动 package.json/lock）。
#    ⚠️ 所有 --no-save 包必须在同一条 npm 命令里安装：npm 每次按 package.json+lock
#    对账，后一条 --no-save 会把前一条装的当 extraneous 清掉（实测踩坑）。
COPY deepseek-harness/scratch-plugin/package.json deepseek-harness/scratch-plugin/package-lock.json ./
RUN npm install --omit=optional --legacy-peer-deps --no-audit --no-fund \
  --registry=https://registry.npmmirror.com \
  && npm install --no-save --legacy-peer-deps --no-audit --no-fund \
  tsx @standard-schema/spec canvas@3.2.3 gl@8.1.6 \
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
     deepseek-harness/scratch-plugin/src/mc-village.ts \
     deepseek-harness/scratch-plugin/src/mc-loop.ts \
     deepseek-harness/scratch-plugin/src/mc-panel.ts \
     deepseek-harness/scratch-plugin/src/shims.d.ts \
     deepseek-harness/scratch-plugin/src/cordis-augment.d.ts \
     ./src/
COPY deepseek-harness/scratch-plugin/bootstrap-mc.mts deepseek-harness/scratch-plugin/tsconfig.json ./
COPY deepseek-harness/scratch-plugin/docker/seed-agent.mjs ./

# 相机栈纯 JS 位（node-canvas-webgl：canvas.js/index.js/mock.js 三个文件）。
# 不走 npm（其依赖声明 gl@^6 会拖一个嵌套旧 gl 进来）；直接复刻 Windows 裸机
# 的 robocopy 位——require('canvas')/require('gl') 解析到上面钉版本的顶层安装。
COPY deepseek-harness/scratch-plugin/node_modules/node-canvas-webgl /app/node_modules/node-canvas-webgl

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
# ⚠️ 不能用 xvfb-run 做入口（DEFECT-20260818-063022 踩坑）：它的就绪机制靠 X server
# 给父进程发 SIGUSR1，而 X server 拒绝向 PID 1 发信号——exec 进去的 xvfb-run 会
# 永远卡在 wait。改为手动起 Xvfb（-ac 免 xauth，容器内隔离无风险；先清残留锁防
# docker restart 复用旧 rw 层），DISPLAY 注入后 exec tsx，SIGTERM 直达 bot 优雅停机。
ENTRYPOINT ["/bin/sh", "-c", "mkdir -p data && node seed-agent.mjs || exit 1; rm -f /tmp/.X99-lock /tmp/.X11-unix/X99; Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp -ac >/dev/null 2>&1 & sleep 1; export DISPLAY=:99; exec npx tsx bootstrap-mc.mts"]
