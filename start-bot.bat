@echo off
rem Start a TRANSMIGRATOR bot process. Usage: start-bot.bat <username> <viewerPort>
rem Logs append to data\bot-<username>.log / data\bot-<username>.err.log
cd /d %~dp0
set "MC_USERNAME=%1"
set "MC_VIEWER_PORT=%2"
set "MC_PANEL_PORT=%3"
echo ===== bot %1 boot %date% %time% ===== >> data\bot-%1.log
..\node_modules\.bin\tsx.CMD bootstrap-mc.mts >> data\bot-%1.log 2>> data\bot-%1.err.log
