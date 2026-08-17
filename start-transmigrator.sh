#!/bin/sh
# 由 deploy.mjs 生成于 2026-08-17T11:27:46.335Z
# 用法: ./start-transmigrator.sh [用户名]
cd "$(dirname "$0")"
MC_USERNAME="${1:-Kirito}"; export MC_USERNAME
MC_HOST=192.168.3.133; export MC_HOST
MC_PORT=25565; export MC_PORT
MC_VIEWER=1; export MC_VIEWER
MC_VIEWER_PORT=3001; export MC_VIEWER_PORT
MC_PANEL_PORT=3200; export MC_PANEL_PORT
MC_LLM_BASE_URL=http://127.0.0.1:8890/v1; export MC_LLM_BASE_URL
MC_LLM_API_KEY=sk-local; export MC_LLM_API_KEY
MC_LLM_MODEL=qwen3.8; export MC_LLM_MODEL
mkdir -p data
echo "===== transmigrator $MC_USERNAME boot $(date) =====" >> data/bot-$MC_USERNAME.log
../node_modules/.bin/tsx bootstrap-mc.mts >> data/bot-$MC_USERNAME.log 2>> data/bot-$MC_USERNAME.err.log