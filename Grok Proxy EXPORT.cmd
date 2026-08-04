@echo off
chcp 65001 >nul
title Grok Proxy v6.2 (EXPORT) :8319
cd /d "%~dp0"

rem Auto-kill any existing node process occupying port 8319 to prevent EADDRINUSE
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort 8319 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } catch {}" >nul 2>&1

echo.
echo ===================================================
echo   GROK PROXY v6.2 - TERMINAL OVERSEER (EXPORT)
echo   Ctrl+C to stop proxy
echo ===================================================
echo.
node "%~dp0grok-proxy-EXPORT.js"
pause
