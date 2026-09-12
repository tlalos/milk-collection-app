@echo off
cd /d "%~dp0"
wscript.exe "%~dp0RunScaleAgentHidden.vbs"
echo Scale agent started hidden.
echo Test http://127.0.0.1:8795/health in the browser.
pause
