@echo off
setlocal
cd /d "%~dp0"
node pico-webapp/tools/usb-camera-bench.mjs %*
if errorlevel 1 (
  echo.
  echo Check Apple Devices, Trust This Computer and Personal Hotspot.
)
pause
