import json
import glob
import os
import sys
import time
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

TASKS_DIR = r"C:\Users\Admin\AppData\Roaming\Code\User\globalStorage\saoudrizwan.claude-dev\tasks"

task_dirs = [d for d in glob.glob(os.path.join(TASKS_DIR, "*")) if os.path.isdir(d)]
now = time.time()

total_tokens_in = 0
total_tokens_out = 0
total_cache_reads = 0
total_cache_writes = 0
total_messages = 0
active_tasks_summary = []

for tdir in task_dirs:
    api_file = os.path.join(tdir, "api_conversation_history.json")
    if not os.path.exists(api_file):
        continue
    
    try:
        mtime = os.path.getmtime(api_file)
        size_kb = os.path.getsize(api_file) / 1024
        if size_kb < 10:
            continue
            
        with open(api_file, 'r', encoding='utf-8', errors='replace') as f:
            history = json.load(f)
            
        t_msgs = len(history)
        total_messages += t_msgs
        
        t_in = 0
        t_out = 0
        c_read = 0
        c_write = 0
        
        last_ts = None
        
        for msg in history:
            ts = msg.get('ts')
            if ts and (last_ts is None or ts > last_ts):
                last_ts = ts
                
            # Token counting from API responses
            meta = msg.get('meta') or {}
            usage = msg.get('usage') or meta.get('usage') or {}
            if usage:
                t_in += usage.get('input_tokens', 0) or usage.get('prompt_tokens', 0)
                t_out += usage.get('output_tokens', 0) or usage.get('completion_tokens', 0)
                c_read += usage.get('cache_read_input_tokens', 0)
                c_write += usage.get('cache_creation_input_tokens', 0)

        total_tokens_in += t_in
        total_tokens_out += t_out
        total_cache_reads += c_read
        total_cache_writes += c_write

        age_s = int(now - mtime)
        if age_s < 3600:
            last_time_str = datetime.fromtimestamp(mtime).strftime('%H:%M:%S')
            active_tasks_summary.append({
                'id': os.path.basename(tdir),
                'msgs': t_msgs,
                'last_time': last_time_str,
                'age_s': age_s,
                'tokens_in': t_in,
                'tokens_out': t_out
            })
    except Exception as e:
        pass

active_tasks_summary.sort(key=lambda x: x['age_s'])

print("=" * 70)
print(f"📊 CLINE GLOBAL USAGE & TELEMETRY STATS — {datetime.now().strftime('%H:%M:%S')}")
print("=" * 70)
print(f"Total Discovered Tasks : {len(task_dirs)}")
print(f"Total Messages Recorded: {total_messages:,}")
print(f"Total Input Tokens     : {total_tokens_in:,}")
print(f"Total Output Tokens    : {total_tokens_out:,}")
if total_cache_reads > 0:
    print(f"Cache Read Tokens      : {total_cache_reads:,}")
if total_cache_writes > 0:
    print(f"Cache Write Tokens     : {total_cache_writes:,}")

print("\n--- RECENT ACTIVE SESSIONS (LAST 60 MIN) ---")
for t in active_tasks_summary[:5]:
    status = "🟢 ACTIVE" if t['age_s'] < 120 else ("🟡 IDLE" if t['age_s'] < 600 else "🔴 STALLED")
    print(f"• Task [{t['id']}] | {status}")
    print(f"  Messages: {t['msgs']} | Last Answer: {t['last_time']} ({t['age_s']}s ago)")
    print(f"  Tokens: {t['tokens_in']:,} in / {t['tokens_out']:,} out\n")

print("=" * 70)
