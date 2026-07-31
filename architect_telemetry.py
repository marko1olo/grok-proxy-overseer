"""
architect_telemetry.py  --mode [fast|medium|deep]

100% DYNAMIC PROJECT DISCOVERY & SMART ACTION CLASSIFICATION:
1. Scans workspace roots (C:\hades, C:\Clinic_MVP, active git repos).
2. Auto-detects all project git repositories dynamically.
3. Scans active agent task histories across all task storage locations.
4. Inspects LAST AGENT ACTION (attempt_completion, long-running commands, subagents, compilation) before declaring state!
5. Distinguishes COMPLETED TASKS (attempt_completion) from STALLS!
"""

import json, time, sys, subprocess, os
from pathlib import Path
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

MODE = 'fast'
if '--mode' in sys.argv:
    idx = sys.argv.index('--mode')
    if idx + 1 < len(sys.argv):
        MODE = sys.argv[idx + 1]

TURNS_PER_MODE   = {'fast': 6,  'medium': 15, 'deep': 30}
GIT_LOG_PER_MODE = {'fast': 0,  'medium': 5,  'deep': 10}
TURNS = TURNS_PER_MODE.get(MODE, 6)
GIT_N = GIT_LOG_PER_MODE.get(MODE, 0)

BASE_PATHS = [
    Path(r"C:\Users\Admin\AppData\Roaming\Code\User\globalStorage\saoudrizwan.claude-dev\tasks"),
    Path(r"C:\Users\Admin\AppData\Roaming\Code\User\globalStorage\rooveteran.roo-cline\tasks"),
    Path(r"C:\Users\Admin\.gemini\antigravity\brain"),
]

SEARCH_ROOTS = [
    Path(r"C:\hades"),
    Path(r"C:\Clinic_MVP"),
]


def discover_projects():
    projects = {}
    for root in SEARCH_ROOTS:
        if not root.exists():
            continue
        if (root / ".git").exists():
            projects[root.name] = str(root)
        try:
            for item in os.listdir(root):
                p = root / item
                if p.is_dir() and (p / ".git").exists():
                    projects[p.name] = str(p)
        except:
            pass
    return projects


def detect_project_for_history(history, projects):
    try:
        full_str = json.dumps(history, ensure_ascii=False).lower()
        scores = {}
        for name, git_path in projects.items():
            name_lower = name.lower()
            path_lower = git_path.lower()
            path_escaped = path_lower.replace('\\', '\\\\')
            score = full_str.count(name_lower) + full_str.count(path_lower) + full_str.count(path_escaped)
            if score > 0:
                scores[name] = score
        
        if scores:
            best_name = max(scores, key=scores.get)
            return best_name, projects[best_name]
    except:
        pass
    return None, None


def find_active_tasks(projects, top_n=6, min_size_kb=50):
    candidates = []
    for base_dir in BASE_PATHS:
        if not base_dir.exists():
            continue
        try:
            for task_id in os.listdir(base_dir):
                p = base_dir / task_id / "api_conversation_history.json"
                if p.exists():
                    stat = p.stat()
                    if stat.st_size > min_size_kb * 1024:
                        candidates.append((stat.st_mtime, task_id, p))
        except:
            pass
    
    candidates.sort(reverse=True)
    
    found = {}
    for mtime, task_id, hist_path in candidates[:top_n * 3]:
        try:
            with open(hist_path, 'r', encoding='utf-8', errors='ignore') as f:
                history = json.load(f)
        except:
            continue
        
        name, git_path = detect_project_for_history(history, projects)
        if name and name not in found:
            found[name] = (task_id, mtime, git_path, history, hist_path)
        
        if len(found) >= top_n:
            break
    
    return found


def inspect_last_action(history, ui_path):
    """Analyze last message/tool call to distinguish completion, compilation, subagents from true stalls."""
    
    # Check ui_messages.json for active subagents
    if os.path.exists(ui_path):
        try:
            with open(ui_path, 'r', encoding='utf-8', errors='ignore') as uif:
                ui_data = json.load(uif)
                for umsg in reversed(ui_data[-10:]):
                    if umsg.get('type') == 'say' and umsg.get('say') == 'subagent':
                        s_text = umsg.get('text', '')
                        if s_text:
                            s_obj = json.loads(s_text)
                            if s_obj.get('status') == 'running':
                                done = s_obj.get('completed', 0)
                                tot = s_obj.get('total', 1)
                                tool_calls = s_obj.get('toolCalls', 0)
                                return f"🟣 SUBAGENTS RUNNING ({done}/{tot} done, {tool_calls} tool calls)", "SUBAGENTS"
        except:
            pass

    # Inspect last assistant turn in history
    for msg in reversed(history):
        if msg.get('role') == 'assistant':
            content = msg.get('content', [])
            if isinstance(content, list):
                for block in reversed(content):
                    btype = block.get('type')
                    if btype == 'tool_use':
                        tname = block.get('name')
                        tinp = block.get('input', {})
                        if tname == 'attempt_completion':
                            res = tinp.get('result', '')[:100]
                            return f"🏁 TASK COMPLETED: \"{res}...\"", "COMPLETED"
                        elif tname == 'execute_command':
                            cmd = tinp.get('command', '')
                            cmd_short = cmd[:80]
                            if any(k in cmd.lower() for k in ['cmake', 'build', 'game_test', 'npm', 'dev', 'run_batchmode', 'pytest', 'ping', 'timeout', 'start']):
                                return f"⚙️ EXECUTING COMMAND: `{cmd_short}`", "LONG_RUNNING"
                            return f"🔧 COMMAND: `{cmd_short}`", "REGULAR"
                        elif tname in ('read_file', 'view_file'):
                            fpath = tinp.get('path') or tinp.get('absolutePath') or ''
                            return f"📄 READING: `{os.path.basename(fpath)}`", "REGULAR"
                        elif tname in ('write_to_file', 'replace_file_content'):
                            fpath = tinp.get('path') or tinp.get('absolutePath') or ''
                            return f"✏️ EDITING: `{os.path.basename(fpath)}`", "REGULAR"
                        elif tname == 'summarize_task':
                            return "📦 SUMMARIZING TASK CONTEXT", "LONG_RUNNING"
                        else:
                            return f"🛠️ TOOL: {tname}", "REGULAR"
                    elif btype == 'text':
                        txt = (block.get('text') or '').strip()
                        if "task complete" in txt.lower() or "all goals completed" in txt.lower():
                            return f"🏁 TASK COMPLETED: \"{txt[:80]}...\"", "COMPLETED"
                        if len(txt) > 10:
                            return f"💭 THINKING/EXPLAINING: \"{txt[:70]}...\"", "REGULAR"
            break
            
    return "UNKNOWN", "REGULAR"


def get_recent_turns(history, n):
    turns = []
    for msg in reversed(history):
        if len(turns) >= n:
            break
        role = msg.get('role')
        content = msg.get('content', '')
        if role == 'assistant' and isinstance(content, list):
            parts = []
            for block in content:
                btype = block.get('type', '')
                if btype == 'tool_use':
                    inp = json.dumps(block.get('input', {}), ensure_ascii=False)
                    inp = inp[:200] + '…' if len(inp) > 200 else inp
                    parts.append(f"  → [{block['name']}] {inp}")
                elif btype == 'text':
                    txt = (block.get('text') or '').strip()
                    if len(txt) > 15:
                        parts.append(f"  💭 {txt[:200]}")
                elif btype == 'thinking':
                    txt = (block.get('thinking') or '').strip()
                    if len(txt) > 15:
                        parts.append(f"  🧠 {txt[:150]}")
            if parts:
                turns.append('\n'.join(parts))
    return list(reversed(turns))


def git_dirty(path):
    try:
        r = subprocess.run(
            ['git', 'status', '--porcelain'],
            cwd=path, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=5
        )
        return len([l for l in r.stdout.split('\n') if l.strip()])
    except:
        return -1


now = time.time()
print(f"\n{'='*70}")
print(f"ARCHITECT TELEMETRY [{MODE.upper()}] — {datetime.now().strftime('%H:%M:%S')}")
print(f"{'='*70}\n")

discovered_projects = discover_projects()
print(f"🔍 Dynamically Discovered {len(discovered_projects)} Projects: {', '.join(discovered_projects.keys())}\n")

tasks = find_active_tasks(discovered_projects)

if not tasks:
    print("❌ No active project tasks found in agent storage.")
    sys.exit(0)

for name, (task_id, mtime, git_path, history, hist_path) in tasks.items():
    age_s = int(now - mtime)
    dirty = git_dirty(git_path)
    ui_path = os.path.join(os.path.dirname(hist_path), "ui_messages.json")

    last_action, category = inspect_last_action(history, ui_path)

    # Classify state intelligently
    if category == "COMPLETED":
        alive = "🏁 TASK COMPLETED & SHIPPED"
    elif category in ("LONG_RUNNING", "SUBAGENTS") or age_s < 120:
        alive = "🟢 ACTIVE / WORKING"
    elif age_s < 600:
        alive = "🟡 IDLE (READ/THINKING PAUSE)"
    else:
        alive = "🔴 STALLED / DEAD"

    print(f"{'─'*70}")
    print(f"■ {name}  [{alive}]  task={task_id}  last={age_s}s  msgs={len(history)}  dirty={dirty}")
    print(f"  Last Action: {last_action}")

    turns = get_recent_turns(history, TURNS)
    if turns:
        print(f"  Last {len(turns)} turns:")
        for t in turns:
            print(t[:350])
    print()

print(f"{'='*70}\n")
