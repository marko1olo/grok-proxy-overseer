# ⚡ GROK-PROXY v6.0 & OMNISENSE OVERSEER ARCHITECTURE

> **Terminal Overseer, Man-in-the-Middle (MitM) Injection Engine & Smart Load Balancer**

[![Proxy Version](https://img.shields.io/badge/grok--proxy-v6.0-cyan.svg)](grok-proxy.js)
[![Overseer Architecture](https://img.shields.io/badge/Omnisense-Overseer-magenta.svg)](#-omnisense-overseer-architecture)
[![Security Status](https://img.shields.io/badge/Token_Audit-PASSED_0_LEAKS-brightgreen.svg)](#-security--token-audit)
[![Hot--Reload](https://img.shields.io/badge/Hot--Reload-Active-gold.svg)](#-daemon--hot-reloading)

---

## 📖 OVERVIEW

`grok-proxy` is a high-performance, console-native proxy server operating between local AI IDE extensions (Cline, Roo-Code, Claude Code) and external LLM APIs (Anthropic, xAI). 

It acts as an **autonomous architectural steering layer**, injecting real-time tactical directives, project context, and compliance mandates directly into outgoing API payload streams without altering IDE extension source code.

---

## 🏛️ CORE ARCHITECTURAL FEATURES (v6.0)

### 1. 🔄 Daemon & Hot-Reloading Engine
- **Master/Child Process Supervision:** Built-in `fs.watch` master process monitors `grok-proxy.js`.
- **Zero-Downtime Reloading:** Upon file save, the master process cleanly terminates the running child process (`child_process.spawn`) and instantly spawns a fresh worker.

### 2. 🏷️ Dynamic Body-Path Project Detection (`detectProjectFromBody`)
- **Headerless Project Pinning:** Eliminates dependency on static session headers.
- **Path Scanner:** Parses incoming JSON payloads (`messages` and `system` fields) using Windows path regex matching (`[A-Z]:\\[...`).
- **Tag Binding:** Automatically binds `X-Session-ID` to project tags (e.g., `hecton8`, `dental-crm`, `gigahrush2`) based on path frequency and maintains binding in `activeSessions` Map across sub-requests.

### 3. 💉 Dynamic Directive Injection Engine (`injections.json`)
- **Deduplication:** Uses 32-bit string hashing (`getDirectiveHash`) to prevent sending duplicate directives within the same session.
- **Subagent Classifier:** Automatically inspects system prompts and role markers to distinguish subagents from main strategy agents, injecting targeted subagent guardrails.
- **Role-Alternation Resilience:** Safely appends directives into `user` messages or injects compliant fallback structures to maintain valid Anthropic/OpenAI API payload formatting.

### 4. 🛡️ Fail-Safes & Token Management
- **413 Context Trimmer:** Evaluates payload sizes on the fly. When payloads approach token limits, aggressive pruning shrinks `tool_result` arrays to save active IDE sessions from crashing.
- **Zero-Backoff 429 Hard-Retry:** Retries rate-limited requests relentlessly to penetrate rate limits without exponential backoff delays.
- **Dead Key Guard:** Automatically detects 401/403 errors and rotates API keys instantly across the active key pool (`keys.json`).

---

## 🛡️ SECURITY & TOKEN AUDIT

Security and secret protection are strictly enforced:
- **0 Leaked Secrets Guarantee:** All production API keys are externalized into `keys.json` / `keys.txt` or environment variables (`process.env.GROK_KEYS`).
- **Sanitized Source Repository:** Publicly committed code uses safe demonstration placeholders (`pk_DEMO_KEY_1`).
- **Strict `.gitignore` Enforcement:** `keys.json`, `keys.txt`, `.env`, and session logs are excluded from source control.

---

## 🎮 COMMAND LINE INTERFACE (CLI)

Interactive CLI commands supported via `STDIN`:

| Command | Description |
| :--- | :--- |
| `status` | Displays active proxy statistics, key rotation counts, and session metrics. |
| `sessions` | Lists currently bound session IDs, auto-detected project tags, and key assignments. |
| `inj <target> <text>` | Issues an instant targeted directive to active sessions (`hecton8`, `dental`, `gigahrush`, `all`). |
| `clear` | Clears all dynamic injections from `injections.json`. |
| `keys` | Hot-reloads API keys from `keys.json` / `keys.txt`. |
| `help` | Prints the CLI command matrix. |

---

## 🚀 QUICKSTART

### 1. Configure Environment / Keys
Create a private `keys.json` file in the root directory (automatically ignored by git):
```json
[
  "pk_YOUR_XAI_GROK_KEY_1",
  "pk_YOUR_XAI_GROK_KEY_2"
]
```

### 2. Launch Proxy
```bash
node grok-proxy.js
```
*Proxy will start listening on `http://127.0.0.1:8319`.*

---

## 📜 LICENSE & CREDITS
Architected for high-performance pair programming and real-time agent orchestration.  
**Omnisense Overseer Architecture — DeepMind Antigravity Division.**
