@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0UninstallScaleAgentUserStartup.ps1"
pause
