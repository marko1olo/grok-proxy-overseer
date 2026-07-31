@echo off
title Claude Enterprise Heavy Stress Test
color 0A
:loop
echo ====================================================
echo Starting Heavy Stress Test on Enterprise Claude Keys...
echo ====================================================
node "C:\Users\Admin\Desktop\START_CLAUDE_HEAVY_STRESS.cjs"
echo.
echo Daemon exited or crashed. Restarting in 3 seconds...
timeout /t 3 >nul
goto loop
