import os

content = """@echo off
echo STARTING OMNISENSE GOOSE DAEMON SWARM
echo ===================================================

echo [1/4] Launching Grok Proxy...
start "GROK PROXY" cmd /k node C:\\Users\\Admin\\Desktop\\_Organized\\02_Scripts_And_Proxies\\grok-proxy-claude-code.js
ping 127.0.0.1 -n 3 > nul

echo [2/4] Launching Hecton8 Daemon...
set "H8_PROMPT=You are Hecton8 Senior Technical Lead. Your job: deep architecture audit and improvement of Hecton-8. FIRST read AGENTS.md and COMMON_SENSE.md completely. Use todo_write to plan your work. Focus on finding architectural debt, verifying struct layouts match mandates, and identifying code that violates Zero-GC policy. Spawn subagents via delegate for parallel mandate reads. Use rg (ripgrep). Work continuously."
start "HECTON8 DAEMON" cmd /k python C:\\hades\\.codex_ops\\UniversalDaemonLoop.py --project C:\\hades\\Hecton8 --session H8_AUTO_04 --max-turns 10000 --prompt "%H8_PROMPT%"
ping 127.0.0.1 -n 2 > nul

echo [3/4] Launching Clinic MVP Daemon...
set "CLINIC_PROMPT=You are Clinic MVP CTO. Your job: deep tenant isolation audit and code quality improvement. FIRST read .agents/AGENTS.md completely. Use todo_write to plan your work. Focus on finding routes without organizationId filters, verifying schema.ts tables, and running npm run typecheck to verify compile health. Spawn subagents via delegate for parallel file reviews. Use rg. Work continuously."
start "CLINIC DAEMON" cmd /k python C:\\hades\\.codex_ops\\UniversalDaemonLoop.py --project C:\\Clinic_MVP\\dental-crm --session CLINIC_AUTO_04 --max-turns 10000 --prompt "%CLINIC_PROMPT%"
ping 127.0.0.1 -n 2 > nul

echo [4/4] Launching GigaHrush2 Daemon...
set "GIGA_PROMPT=You are GigaHrush2 C++ Engine Architect. Your job: evolve A-Life systems and C++ engine. FIRST read jirnyak.md completely. Use todo_write to track tasks. Focus on Section 18/19 mandates (Voxel layer architecture, PropDetached events). DO NOT write python/powershell scripts to edit files. Write C++ directly. Ensure changes pass game_test.exe. Spawn subagents for doc reads. Use rg. Work continuously."
start "GIGAHRUSH2 DAEMON" cmd /k python C:\\hades\\.codex_ops\\UniversalDaemonLoop.py --project C:\\hades\\gigahrush2 --session GIGA_AUTO_04 --max-turns 10000 --prompt "%GIGA_PROMPT%"

echo ===================================================
echo ALL DAEMONS LAUNCHED SUCCESSFULLY.
echo You can safely close Antigravity. The daemons will keep running.
echo ===================================================
pause
"""

with open(r"C:\Users\Admin\Desktop\START_DAEMON_SWARM.bat", "w", encoding="ascii") as f:
    f.write(content.replace('\n', '\r\n'))

print("Bat file generated successfully")
