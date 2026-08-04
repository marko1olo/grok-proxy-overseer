import subprocess
import os

base_dir = r"C:\Users\Admin\Desktop\_Organized\02_Scripts_And_Proxies"

daemons = [
    {
        "project": r"C:\hades\Hecton8",
        "session": "H8_AUTO_08",
        "prompt_file": "prompt_h8.txt"
    },
    {
        "project": r"C:\Clinic_MVP\dental-crm",
        "session": "CLINIC_AUTO_08",
        "prompt_file": "prompt_clinic.txt"
    },
    {
        "project": r"C:\hades\gigahrush2",
        "session": "GIGA_AUTO_07",
        "prompt_file": "prompt_giga.txt"
    }
]

for d in daemons:
    prompt_path = os.path.join(base_dir, d["prompt_file"])
    with open(prompt_path, "r", encoding="utf-8") as f:
        prompt_text = f.read().strip()
    
    cmd = [
        "python",
        r"C:\hades\.codex_ops\UniversalDaemonLoop.py",
        "--project", d["project"],
        "--session", d["session"],
        "--max-turns", "10000",
        "--model", "zai-org/glm-5.2",
        "--prompt", prompt_text
    ]
    print(f"Starting daemon for {d['session']}...")
    subprocess.Popen(cmd, creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0)

print("All daemons launched cleanly!")
