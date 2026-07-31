@echo off
:: grok-proxy launcher
chcp 65001 >nul
title Grok Proxy :8319
cd /d "%~dp0"
echo.
echo ===================================================
echo   GROK PROXY v6.0 - http://127.0.0.1:8319/v1
echo   Ctrl+C to stop proxy
echo ===================================================
echo.
node "%~dp0grok-proxy.js"
pause
