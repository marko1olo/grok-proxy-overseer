@echo off
title Claude Enterprise Proxy v3.1
chcp 65001 >nul
cls
echo =======================================================
echo    CLAUDE ENTERPRISE PROXY v3.1 BULLETPROOF
echo =======================================================
echo  - Port: http://127.0.0.1:8318
echo  - Mode: Sticky Sessions (100%% Prompt Caching)
echo  - Effort: MAX (Ultracode Level)
echo =======================================================
echo.
echo  Keep this window open while working in VS Code!
echo.
:LOOP
if exist "%~dp0proxy.js" (
    node "%~dp0proxy.js"
) else (
    node "C:\Users\Admin\claude-proxy\proxy.js"
)
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [!] Proxy Error. Restarting in 3 seconds...
    timeout /t 3 /nobreak >nul
    goto LOOP
)
echo.
echo  Proxy Stopped.
pause
