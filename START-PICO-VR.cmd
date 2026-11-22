@echo off
setlocal
cd /d "%~dp0pico-webapp"
node tools/start-pico-vr.mjs %*
if errorlevel 1 (
  echo.
  echo Server startup failed. Copy the error above or send a screenshot.
)
pause
