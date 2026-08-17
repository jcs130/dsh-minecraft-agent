@echo off
rem 由 deploy.mjs 生成于 2026-08-17T11:27:46.330Z
rem 用法: start-transmigrator.bat [用户名]（默认 Kirito）
cd /d %~dp0
setlocal
if "%1"=="" (set "MC_USERNAME=Kirito") else set "MC_USERNAME=%1"
set "MC_HOST=192.168.3.133"
set "MC_PORT=25565"
set "MC_VIEWER=1"
set "MC_VIEWER_PORT=3001"
set "MC_PANEL_PORT=3200"
set "MC_LLM_BASE_URL=http://127.0.0.1:8890/v1"
set "MC_LLM_API_KEY=sk-local"
set "MC_LLM_MODEL=qwen3.8"
echo ===== transmigrator %MC_USERNAME% boot %date% %time% ===== >> data\bot-%MC_USERNAME%.log
..\node_modules\.bin\tsx.CMD bootstrap-mc.mts >> data\bot-%MC_USERNAME%.log 2>> data\bot-%MC_USERNAME%.err.log
endlocal