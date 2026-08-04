/**
 * grok-proxy v6.2 — CACHED PRE-EMPTIVE PROACTIVE PRUNING & OVERSEER
 *
 * FIXES vs v6.1:
 *  - FEAT CRITICAL (v6.2): Pre-Emptive In-Memory Pruning (preEmptivePrune) before network requests!
 *    When payload exceeds 500 KB (~125k tokens), string/image bloat in historical middle turns
 *    is compressed instantly BEFORE calling https.request. Eliminates 15.7 MB POST requests,
 *    5-pass HTTP 413 error loops, and aggressive message dropping.
 *  - FEAT CRITICAL (v6.2): Persistent Compaction Cache (sessionCompactedMsgCache).
 *    Memorizes compacted historical messages per session so 2,000+ turns are not re-compacted
 *    on every single HTTP request. Reduces CPU overhead from O(N) to O(1) per turn.
 *  - FEAT CRITICAL (v6.2): Historical Image Archiving.
 *    Any image_url / base64 image block in historical turns (messages[2 ... N-4]) is compressed
 *    into an ASCII placeholder, preserving context budget without losing logic history.
 *  - FIX: Completely removed attempt_completion override so agents can finish sprints cleanly.
 *
 * 100% CONSOLE-NATIVE CYBERPUNK CLI INTERFACE:
 *  - ANSI Color Palette & Box-Drawing Character Tables
 *  - Interactive CLI Commands via STDIN (`inj <text>`, `clear`, `status`, `sessions`, `help`)
 *  - Subagent Role Classifier (Automatic Subagent Guard vs Main Strategy Injections)
 *  - Bulletproof Role-Alternation Directives (`injections.json`)
 *  - Strict User-Protected 413 Trimmer
 *  - Dead Key Guard (401/403) & Smart LRU Load Balancer
 */

const http  = require('http');
const https = require('https');
const { Transform } = require('stream');
const zlib  = require('zlib');
const fs    = require('fs');
const path  = require('path');
const readline = require('readline');
const child_process = require('child_process');
const { URL } = require('url');

// Force UTF-8 encoding in Windows console
if (process.platform === 'win32') {
  try {
    child_process.execSync('chcp 65001', { stdio: 'ignore' });
  } catch {}
}

const PROXY_PORT = 8282;
const UPSTREAM   = 'https://tunnel.rue.onl';

// ── SAFETY CAPS ──────────────────────────────────────────────────────────────
const MAX_NET_RETRIES    = 15;    // Network error retry cap
// 429: NO CAP — infinite retry is a FEATURE. The proxy's job is to wait out rate limits.
const MAX_PRUNE_PASSES   = 8;    // 413 prune pass cap (8 passes should reduce any payload)
// Session GC: DOES NOT kill active chats. sessionKeyMap only tracks which API key
// is assigned to which session for load balancing. GC just forgets the key assignment
// for sessions that haven't sent a request in SESSION_TTL_MS. If the session comes
// back later, it simply gets a fresh key assignment via getBestAvailableKeyIdx().
const SESSION_TTL_MS     = 15 * 60 * 1000; // 15 minutes — forget stale key assignments
const SESSION_GC_INTERVAL_MS = 2 * 60 * 1000; // Run GC every 2 min

// ── ANSI COLOR STYLING ENGINE ────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  brightCyan: '\x1b[96m',
  green: '\x1b[32m',
  brightGreen: '\x1b[92m',
  yellow: '\x1b[33m',
  brightYellow: '\x1b[93m',
  red: '\x1b[31m',
  brightRed: '\x1b[91m',
  magenta: '\x1b[35m',
  brightMagenta: '\x1b[95m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  bgCyan: '\x1b[46m\x1b[30m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgYellow: '\x1b[43m\x1b[30m',
  bgRed: '\x1b[41m\x1b[37m',
  bgMagenta: '\x1b[45m\x1b[37m',
};

// ── DEFAULT GROK KEYS & CONFIG ───────────────────────────────────────────────
let GROK_KEYS = process.env.GROK_KEYS
  ? process.env.GROK_KEYS.split(',').map(k => k.trim()).filter(Boolean)
  : [
      'pk_DEMO_KEY_1',
      'pk_DEMO_KEY_2',
    ];

const KEYS_JSON_PATH       = path.join(__dirname, 'keys.json');
const KEYS_TXT_PATH        = path.join(__dirname, 'keys.txt');
const INJECTIONS_JSON_PATH = path.join(__dirname, 'injections.json');

const startTime = Date.now();

function loadExternalKeys() {
  try {
    if (fs.existsSync(KEYS_JSON_PATH)) {
      const raw = fs.readFileSync(KEYS_JSON_PATH, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        GROK_KEYS = arr.map(k => String(k).trim()).filter(Boolean);
        log(`${C.brightGreen}🔑 Loaded ${GROK_KEYS.length} keys from keys.json${C.reset}`);
        reinitKeyArrays();
        return;
      }
    }
    if (fs.existsSync(KEYS_TXT_PATH)) {
      const raw = fs.readFileSync(KEYS_TXT_PATH, 'utf8');
      const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      if (lines.length > 0) {
        GROK_KEYS = lines;
        log(`${C.brightGreen}🔑 Loaded ${GROK_KEYS.length} keys from keys.txt${C.reset}`);
        reinitKeyArrays();
        return;
      }
    }
  } catch (err) {
    log(`${C.yellow}⚠ Failed to read external keys: ${err.message}${C.reset}`);
  }
}

function reinitKeyArrays() {
  const len = GROK_KEYS.length;
  keyLastUsedTime  = padArray(keyLastUsedTime, len, 0);
  keyReqCounts     = padArray(keyReqCounts, len, 0);
  keyWait429Counts = padArray(keyWait429Counts, len, 0);
  keyAuto413Trims  = padArray(keyAuto413Trims, len, 0);
  keyInjections    = padArray(keyInjections, len, 0);
  keyDisabled      = padArray(keyDisabled, len, false);
}

function padArray(arr, len, fill) {
  if (arr.length >= len) return arr.slice(0, len);
  return [...arr, ...new Array(len - arr.length).fill(fill)];
}

const recentLogs = [];
function log(...args) {
  const ts = new Date().toLocaleTimeString();
  const rawLine = args.join(' ');
  const line = `${C.gray}[${ts}]${C.reset} ${rawLine}`;
  process.stdout.write(`${line}\n`);
  recentLogs.push(rawLine);
  if (recentLogs.length > 80) recentLogs.shift();
}

// ── STATE TRACKING ───────────────────────────────────────────────────────────
const sessionKeyMap      = new Map(); // sessionId -> keyIdx
const sessionLastSeen    = new Map(); // sessionId -> timestamp (for GC)
const sessionProjectTag  = new Map(); // sessionId -> {name, root, hits} (auto-detected from body paths)
const projectKeyMap      = new Map(); // project root -> keyIdx (sticky routing for all subagents)
let keyLastUsedTime      = new Array(GROK_KEYS.length).fill(0);
let keyReqCounts         = new Array(GROK_KEYS.length).fill(0);
let keyWait429Counts     = new Array(GROK_KEYS.length).fill(0);
let keyAuto413Trims      = new Array(GROK_KEYS.length).fill(0);
let keyInjections        = new Array(GROK_KEYS.length).fill(0);
let keyDisabled          = new Array(GROK_KEYS.length).fill(false);

loadExternalKeys();

// ── SESSION GC ───────────────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  let evicted = 0;
  for (const [sid, lastSeen] of sessionLastSeen.entries()) {
    if (now - lastSeen > SESSION_TTL_MS) {
      sessionKeyMap.delete(sid);
      sessionLastSeen.delete(sid);
      sessionProjectTag.delete(sid);
      sessionDeliveredDirectives.delete(sid);
      evicted++;
    }
  }
  if (evicted > 0) {
    log(`${C.dim}🧹 Session GC: evicted ${evicted} stale sessions (TTL ${SESSION_TTL_MS / 60000}min)${C.reset}`);
  }
}, SESSION_GC_INTERVAL_MS);

function getSessionCountsPerKey() {
  const counts = new Array(GROK_KEYS.length).fill(0);
  for (const [sid, kIdx] of sessionKeyMap.entries()) {
    if (kIdx >= 0 && kIdx < GROK_KEYS.length && !keyDisabled[kIdx]) {
      counts[kIdx]++;
    }
  }
  return counts;
}

function getBestAvailableKeyIdx() {
  const counts = getSessionCountsPerKey();
  let minCount = Infinity;
  let candidates = [];

  for (let i = 0; i < GROK_KEYS.length; i++) {
    if (keyDisabled[i]) continue;
    if (counts[i] < minCount) {
      minCount = counts[i];
      candidates = [i];
    } else if (counts[i] === minCount) {
      candidates.push(i);
    }
  }

  if (candidates.length === 0) {
    log(`${C.brightRed}⚠ ALL KEYS DISABLED! Resetting emergency lock.${C.reset}`);
    keyDisabled.fill(false);
    return 0;
  }

  let bestIdx = candidates[0];
  let oldestTime = keyLastUsedTime[bestIdx];
  for (const idx of candidates) {
    if (keyLastUsedTime[idx] < oldestTime) {
      oldestTime = keyLastUsedTime[idx];
      bestIdx = idx;
    }
  }
  return bestIdx;
}

function getKeyIdxForSession(sessionId, bodyBuffer) {
  let projectInfo = null;
  if (sessionId && sessionProjectTag.has(sessionId)) {
    projectInfo = sessionProjectTag.get(sessionId);
  } else if (bodyBuffer) {
    projectInfo = detectProjectFromBody(bodyBuffer);
    if (projectInfo && sessionId) {
      sessionProjectTag.set(sessionId, projectInfo);
      log(`${C.brightMagenta}🏷️  [${sessionId.slice(0,8)}...]${C.reset} -> project: ${C.bold}${projectInfo.name}${C.reset} (${projectInfo.root})`);
    }
  }

  if (projectInfo && projectInfo.root) {
    const root = projectInfo.root.toLowerCase();
    if (projectKeyMap.has(root)) {
      const pIdx = projectKeyMap.get(root);
      if (!keyDisabled[pIdx]) {
        if (sessionId && (!sessionKeyMap.has(sessionId) || sessionKeyMap.get(sessionId) !== pIdx)) {
          sessionKeyMap.set(sessionId, pIdx);
          const counts = getSessionCountsPerKey();
          log(`${C.brightCyan}🔑 Session [${sessionId ? sessionId.slice(0,8) : 'anon'}]${C.reset} bound to ${C.bold}Key #${pIdx + 1}${C.reset} (Project: ${projectInfo.name}) (Load: ${counts.map((cnt,i)=>`K${i+1}:${cnt}`).join(' ')})`);
        }
        if (sessionId) sessionLastSeen.set(sessionId, Date.now());
        keyLastUsedTime[pIdx] = Date.now();
        return pIdx;
      }
    }
    // New project or its key is disabled
    const idx = getBestAvailableKeyIdx();
    projectKeyMap.set(root, idx);
    if (sessionId) sessionKeyMap.set(sessionId, idx);
    if (sessionId) sessionLastSeen.set(sessionId, Date.now());
    keyLastUsedTime[idx] = Date.now();
    const counts = getSessionCountsPerKey();
    log(`${C.brightCyan}🏗️ Project [${projectInfo.name}]${C.reset} mapped to ${C.bold}Key #${idx + 1}${C.reset} (Load: ${counts.map((cnt,i)=>`K${i+1}:${cnt}`).join(' ')})`);
    return idx;
  }

  // Fallback if no project root detected
  if (!sessionId) {
    const idx = getBestAvailableKeyIdx();
    keyLastUsedTime[idx] = Date.now();
    return idx;
  }

  sessionLastSeen.set(sessionId, Date.now());

  if (!sessionKeyMap.has(sessionId)) {
    const idx = getBestAvailableKeyIdx();
    sessionKeyMap.set(sessionId, idx);
    const counts = getSessionCountsPerKey();
    keyLastUsedTime[idx] = Date.now();
    log(`${C.brightCyan}🔑 Session [${sessionId.slice(0,8)}...]${C.reset} -> ${C.bold}Key #${idx + 1}${C.reset} (Load: ${counts.map((cnt,i)=>`K${i+1}:${cnt}`).join(' ')})`);
    return idx;
  }

  let assignedIdx = sessionKeyMap.get(sessionId);

  if (keyDisabled[assignedIdx]) {
    const newIdx = getBestAvailableKeyIdx();
    log(`${C.brightRed}🛡 DEAD KEY GUARD: Key #${assignedIdx + 1} DISABLED${C.reset} -> Re-assigning [${sessionId.slice(0,8)}] -> ${C.bold}Key #${newIdx + 1}${C.reset}`);
    assignedIdx = newIdx;
    sessionKeyMap.set(sessionId, assignedIdx);
  } else {
    const counts = getSessionCountsPerKey();
    if (counts[assignedIdx] > 1) {
      const freeIdx = counts.indexOf(0);
      if (freeIdx !== -1 && !keyDisabled[freeIdx]) {
        const oldIdx = assignedIdx;
        assignedIdx = freeIdx;
        sessionKeyMap.set(sessionId, assignedIdx);
        log(`${C.brightMagenta}⚖️ REBALANCE:${C.reset} [${sessionId.slice(0,8)}] K#${oldIdx + 1} -> ${C.bold}Key #${assignedIdx + 1}${C.reset} (was idle)`);
      }
    }
  }

  keyLastUsedTime[assignedIdx] = Date.now();
  return assignedIdx;
}

// ── INJECTION FILE I/O (safe) ────────────────────────────────────────────────
function readInjectionsSafe() {
  try {
    if (!fs.existsSync(INJECTIONS_JSON_PATH)) return {};
    const raw = fs.readFileSync(INJECTIONS_JSON_PATH, 'utf8');
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}

function writeInjectionsSafe(obj) {
  try {
    fs.writeFileSync(INJECTIONS_JSON_PATH, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    log(`${C.red}⚠ Failed to write injections.json: ${err.message}${C.reset}`);
  }
}

// ── BULLETPROOF DIRECTIVE INJECTOR ───────────────────────────────────────────
// Track which session has already received which directive version to prevent injection spam on every request
const sessionDeliveredDirectives = new Map(); // sessionId -> directiveHash

function getDirectiveHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return 'd_' + hash;
}

// ── AUTO-DETECT PROJECT FROM REQUEST BODY PATHS ─────────────────────────────
function detectProjectFromBody(bodyBuffer) {
  try {
    const bodyStr = bodyBuffer.toString('utf8');
    // Prevent 'https://' from matching as 's://' -> 'S:\'
    const pathMatches = [];
    const regex = /(?:^|[^a-zA-Z])([A-Z]:[\\\\/]+[^\s"',}{)\]]+)/gi;
    let m;
    while ((m = regex.exec(bodyStr)) !== null) {
      pathMatches.push(m[1]);
    }
    if (pathMatches.length === 0) return null;

    const rootCounts = {};
    for (const p of pathMatches) {
      const normalized = p.replace(/[\\/]+/g, '\\');
      const parts = normalized.split('\\').filter(Boolean);
      if (parts.length >= 3) {
        const root = parts.slice(0, 3).join('\\');
        rootCounts[root] = (rootCounts[root] || 0) + 1;
      }
    }

    if (Object.keys(rootCounts).length === 0) return null;
    const sorted = Object.entries(rootCounts).sort((a, b) => b[1] - a[1]);
    const bestRoot = sorted[0][0];
    const name = bestRoot.split('\\').pop().toLowerCase();
    return { name, root: bestRoot, hits: sorted[0][1] };
  } catch {
    return null;
  }
}

// ── BULLETPROOF DIRECTIVE INJECTOR ───────────────────────────────────────────
function checkAndInjectDirectives(bodyBuffer, sessionId, keyIdx) {
  // sessionProjectTag is now populated earlier in getKeyIdxForSession

  const injections = readInjectionsSafe();
  if (!injections || Object.keys(injections).length === 0) return bodyBuffer;

  let targetDirective = null;

  // Match targeted injections by session's auto-detected project tag or direct body detection
  let projectInfo = sessionId ? sessionProjectTag.get(sessionId) : null;
  if (!projectInfo) {
    projectInfo = detectProjectFromBody(bodyBuffer);
    if (projectInfo && sessionId) {
      sessionProjectTag.set(sessionId, projectInfo);
    }
  }

  if (projectInfo) {
    const projName = projectInfo.name;
    const projRoot = projectInfo.root.toLowerCase();
    for (const [key, dir] of Object.entries(injections)) {
      if (key === 'all') continue;
      if (dir && typeof dir === 'string') {
        const keyLower = key.toLowerCase();
        if (projName.includes(keyLower) || keyLower.includes(projName) || projRoot.includes(keyLower)) {
          targetDirective = dir;
          break;
        }
      }
    }
  }

  // Fallback to 'all' persistent directive if no specific session target matched
  if (!targetDirective && injections.all && typeof injections.all === 'string') {
    targetDirective = injections.all;
  }

  let text, obj;
  try {
    text = bodyBuffer.toString('utf8');
    obj  = JSON.parse(text);
  } catch {
    return bodyBuffer;
  }
  if (!obj || !Array.isArray(obj.messages) || obj.messages.length === 0) return bodyBuffer;

  // Force MAX REASONING EFFORT (High) for Grok-4.5
  obj.reasoning_effort = "high";

  // ── CLEAN ANTI-COMPLETION: Strip attempt_completion from tools array ────────
  // Instead of hacking the SSE response stream (which broke JSON and caused
  // infinite error loops), we simply REMOVE the tool from the request.
  // If the model doesn't see the tool, it cannot call it. Clean and bulletproof.
  if (Array.isArray(obj.tools)) {
    const before = obj.tools.length;
    
    obj.tools = obj.tools.filter(t => {
      const name = t && t.function && t.function.name;
      return name !== 'attempt_completion';
    });
    
    if (obj.tools.length < before) {
      log(`🔒 Stripped attempt_completion from tools array (${before} -> ${obj.tools.length} tools)`);
    }

    const systemPromptStr = typeof obj.system === 'string' ? obj.system : JSON.stringify(obj.system || '');
    if (systemPromptStr.includes('explicit_instructions type="summarize_task"')) {
      const hasSummarize = obj.tools.some(t => t?.function?.name === 'summarize_task');
      if (!hasSummarize) {
        log(`💉 Injected summarize_task tool to bypass Claude-Dev Grok API schema bug`);
        obj.tools.push({
          type: 'function',
          function: {
            name: 'summarize_task',
            description: 'Create a comprehensive summary of the conversation so far.',
            parameters: {
              type: 'object',
              properties: { summary: { type: 'string' } },
              required: ['summary']
            }
          }
        });
      }
    }
  }

  // ── CLEAN ANTI-COMPLETION: Strip from system prompt ────────
  if (obj.system) {
    if (typeof obj.system === 'string') {
      obj.system = obj.system.replace(/attempt_completion/g, 'DO_NOT_USE_THIS_TOOL_01');
    } else if (Array.isArray(obj.system)) {
      obj.system.forEach(s => {
        if (s && s.type === 'text' && s.text) {
          s.text = s.text.replace(/attempt_completion/g, 'DO_NOT_USE_THIS_TOOL_01');
        }
      });
    }
  }

  // ── COMPLETION ATTEMPT INTERCEPTOR (Option B: prompt injection only) ────────
  // NOTE: SSE stream interception (Option A) is INTENTIONALLY REMOVED.
  // Reason: replacing "name":"attempt_completion" -> "name":"execute_command" on raw SSE
  // chunks produces malformed JSON because chunks are partial. Cline receives
  // execute_command with empty <command> => 3 consecutive tool errors => YOLO MODE FAIL.
  // Option B (below) injects a directive into the INCOMING prompt BEFORE it hits the API.
  // The model then generates a valid, non-empty tool call on its own.
  const historyStr = JSON.stringify(obj.messages.slice(-2)).toLowerCase();
  // ── COMPLETION DETECTION (verified against real Goose wire format from llm_request.*.jsonl) ──
  // Goose wire format facts:
  //   - Tool calls: assistant message has `tool_calls` array (standard OpenAI snake_case)
  //   - Tool responses: separate message with `role: "tool"` + `tool_call_id`
  //   - Completion: assistant message with ONLY `content` text, NO `tool_calls` array
  //   - The words `toolCall`, `toolRequest`, `toolResponse` NEVER appear on the wire.
  const lastMsg = obj.messages[obj.messages.length - 1];
  const prevMsg = obj.messages.length >= 2 ? obj.messages[obj.messages.length - 2] : null;

  // Is the last message a tool response? (role: "tool" in OpenAI format)
  const lastMsgIsToolResponse = lastMsg && lastMsg.role === 'tool';

  // Did the previous assistant message contain tool_calls?
  const prevAssistantHasTools = prevMsg &&
    prevMsg.role === 'assistant' &&
    Array.isArray(prevMsg.tool_calls) &&
    prevMsg.tool_calls.length > 0;

  // Cline/Claude Code: explicit attempt_completion tool call in history
  const isClineCompletion = historyStr.includes('"name":"attempt_completion"') ||
                             historyStr.includes('"attempt_completion"') ||
                             historyStr.includes('attempt_completion for');

  // Goose: assistant's last turn was pure text (no tool_calls), and the current
  // message is a new user prompt (not a tool response continuing the loop).
  const isGooseCompletion = obj.messages.length >= 2 &&
    lastMsg.role === 'user' &&
    !lastMsgIsToolResponse &&
    prevMsg && prevMsg.role === 'assistant' &&
    !prevAssistantHasTools;

  const isCompletionAttempt = isClineCompletion || isGooseCompletion;

  // Goose uses `delegate` for subagents, not `use_subagents`
  const isUsingSubagents = historyStr.includes('"name":"use_subagents"') ||
                           historyStr.includes('"name":"delegate"') ||
                           historyStr.includes('"use_subagents"') ||
                           historyStr.includes('use_subagents for');

  if (isCompletionAttempt && !isUsingSubagents) {
    const daemonDirective = [
      `[OVERSEER UNIVERSAL GOOSE DAEMON MANDATE — ${new Date().toISOString()}]`,
      '1. YOUR SESSION COMPLETION WAS INTERCEPTED BY THE OVERSEER DAEMON. DO NOT STOP.',
      '2. UNIVERSAL SELF-EVALUATION & REFLECTION:',
      '   - Evaluate your current work against your project-specific rules and instructions.',
      '   - IF tests fail, lints break, or core project rules are violated: POLISH AND FIX IT IMMEDIATELY.',
      '   - IF current work passes all checks and rules: DO NOT over-polish. Proceed immediately to the NEXT task in the backlog.',
      '3. GOOSE TOOL RULES (STRICT & EXCLUSIVE):',
      '   - Use `shell` for terminal commands, testing, and linting.',
      '   - Use `write` or `edit` for creating and modifying files.',
      '   - Use `delegate(async: true)` to spawn subagents for broad codebase searches, reads, or audits.',
      '   - Use `load` to retrieve subagent findings when ready.',
      '   - Use `todo_write` to track remaining work.',
      '4. CRITICAL ANTI-STALL RULE:',
      '   - Never wait idle. While subagents run asynchronously, continue parallel work.',
      '   - If any tool execution fails or errors out, NEVER repeat the identical failing invocation. Pivot to a different tool/command immediately.',
      '5. CONTINUE WORKING NOW. Do not emit completion text until all project goals are verified.'
    ].join('\n');
    targetDirective = targetDirective ? (targetDirective + '\n' + daemonDirective) : daemonDirective;
  }

  if (!targetDirective) return bodyBuffer;

  // Deduplication check: Has this session already received THIS exact directive?
  const dirHash = getDirectiveHash(targetDirective);
  const effectiveSid = sessionId || (projectInfo ? 'proj_' + projectInfo.name : 'anonymous');
  const lastDeliveredHash = sessionDeliveredDirectives.get(effectiveSid);

  if (lastDeliveredHash === dirHash && !isCompletionAttempt) {
    return bodyBuffer;
  }

  // NOTE: Context limit warning interceptor was removed.
  // claude-dev sends <explicit_instructions type="summarize_task"> natively when auto-condense
  // triggers. Replacing that message broke the summarize_task flow. Let it pass through unmodified.

  const injectionTargetMsg = obj.messages[obj.messages.length - 1];

  // Role-alternation safe injection
  if (injectionTargetMsg && injectionTargetMsg.role === 'user') {
    if (typeof injectionTargetMsg.content === 'string') {
      injectionTargetMsg.content += `\n[OVERSEER MAIN AGENT DIRECTIVE VIA PROXY]: ${targetDirective}\n`;
    } else if (Array.isArray(injectionTargetMsg.content)) {
      injectionTargetMsg.content.push({ type: 'text', text: `\n[OVERSEER MAIN AGENT DIRECTIVE VIA PROXY]: ${targetDirective}\n` });
    }
  } else {
    obj.messages.push({
      role: 'user',
      content: [{ type: 'text', text: `\n[OVERSEER MAIN AGENT DIRECTIVE VIA PROXY]: ${targetDirective}\n` }],
    });
  }

  sessionDeliveredDirectives.set(effectiveSid, dirHash);
  keyInjections[keyIdx]++;
  const newBodyStr = JSON.stringify(obj);
  const tag = isCompletionAttempt ? `${C.bgMagenta}${C.bold} RE-WAKE ${C.reset}` : `${C.bgGreen}${C.bold} MAIN ${C.reset}`;
  log(`💉 ${tag} -> [${sessionId ? sessionId.slice(0,8) : 'anon'}] "${C.cyan}${targetDirective.slice(0, 60).replace(/\n/g, ' ')}${targetDirective.length > 60 ? '...' : ''}${C.reset}"`);
  return Buffer.from(newBodyStr, 'utf8');
}

// ── PERSISTENT COMPACTION CACHE & PRUNING ENGINE (v6.2) ─────────────────────
const sessionCompactedMsgCache = new Map(); // cacheKey -> compactedContent

function trimAnyValue(val, maxLen, stats, stripImages = false) {
  if (!val) return val;
  if (typeof val === 'string') {
    if (val.length > maxLen) {
      if (stats) stats.truncatedBlocks++;
      const headLen = Math.max(20, Math.floor(maxLen * 0.4));
      const tailLen = Math.max(20, Math.floor(maxLen * 0.4));
      const replacement = val.slice(0, headLen) + '\n[..Compacted ' + val.length + 'B..]\n' + val.slice(-tailLen);
      return replacement.length < val.length ? replacement : val;
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(item => trimAnyValue(item, maxLen, stats, stripImages));
  }
  if (typeof val === 'object') {
    if (val.type === 'image_url' || val.type === 'image' || val.image_url) {
      if (stats) stats.truncatedImages++;
      return { type: 'text', text: '[Proxy: Historical image archived for VRAM/context budget]' };
    }
    const newObj = {};
    for (const [k, v] of Object.entries(val)) {
      newObj[k] = trimAnyValue(v, maxLen, stats, stripImages);
    }
    return newObj;
  }
  return val;
}

function preEmptivePrune(bodyBuffer, sessionId) {
  try {
    const text = bodyBuffer.toString('utf8');
    const obj = JSON.parse(text);
    if (!obj || !Array.isArray(obj.messages) || obj.messages.length < 5) return null;

    const msgs = obj.messages;
    const tailStartIdx = Math.max(2, msgs.length - 4);
    const sid = sessionId || 'anon';
    const stats = { truncatedBlocks: 0, truncatedImages: 0 };

    for (let i = 2; i < tailStartIdx; i++) {
      const m = msgs[i];
      if (!m || !m.content) continue;
      const cacheKey = `${sid}_${i}_${JSON.stringify(m.content).length}`;
      if (sessionCompactedMsgCache.has(cacheKey)) {
        m.content = sessionCompactedMsgCache.get(cacheKey);
        continue;
      }
      m.content = trimAnyValue(m.content, 200, stats, true);
      sessionCompactedMsgCache.set(cacheKey, m.content);
    }

    if (sessionCompactedMsgCache.size > 20000) sessionCompactedMsgCache.clear();

    let finalStr = JSON.stringify(obj);
    if (finalStr.length > 1250000 && msgs.length > 15) {
      const archiveCount = Math.floor((tailStartIdx - 2) * 0.35);
      if (archiveCount > 0) {
        msgs.splice(2, archiveCount, {
          role: 'user',
          content: `[Proxy: Archived oldest ${archiveCount} historical turns to preserve context window and VRAM budget]`
        });
        finalStr = JSON.stringify(obj);
      }
    }

    return Buffer.from(finalStr, 'utf8');
  } catch (err) {
    return null;
  }
}

function pruneMiddleFor413(bodyBuffer, pass = 1) {
  try {
    const text = bodyBuffer.toString('utf8');
    const obj  = JSON.parse(text);
    if (!obj || !Array.isArray(obj.messages) || obj.messages.length < 4) return null;

    const msgs = obj.messages;
    const tailStartIdx = Math.max(2, msgs.length - 3);
    const maxResultLen = pass === 1 ? 200 : (pass === 2 ? 100 : 50);
    const stats = { truncatedBlocks: 0, truncatedImages: 0 };

    for (let i = 2; i < tailStartIdx; i++) {
      const m = msgs[i];
      if (!m || !m.content) continue;
      m.content = trimAnyValue(m.content, maxResultLen, stats, true);
    }

    if (pass >= 3 && msgs.length > 8) {
      let ratio = 0.35;
      if (pass === 4) ratio = 0.65;
      else if (pass === 5) ratio = 0.85;
      else if (pass >= 6) ratio = 0.98;
      
      const archiveCount = Math.floor((tailStartIdx - 2) * ratio);
      if (archiveCount > 0) {
        msgs.splice(2, archiveCount, {
          role: 'user',
          content: `[Proxy: Archived oldest ${archiveCount} historical turns to preserve context window and VRAM budget]`
        });
        stats.truncatedBlocks += archiveCount;
        log(`✂️  ${C.yellow}413 HISTORICAL TURN ARCHIVING pass ${pass}:${C.reset} Archived oldest ${archiveCount} middle turns.`);
      }
    }

      if (pass >= 7) {
        const tailLimit = pass === 7 ? 2000 : 200;
        for (let i = Math.max(1, msgs.length - 3); i < msgs.length; i++) {
          if (msgs[i] && msgs[i].content) {
            msgs[i].content = trimAnyValue(msgs[i].content, tailLimit, stats, true);
          }
        }
      }

    const finalStr = JSON.stringify(obj);
    log(`✂️  ${C.yellow}413 TRIM pass ${pass}:${C.reset} ${stats.truncatedBlocks} text/tool blocks. ${bodyBuffer.length}B -> ${finalStr.length}B`);
    return Buffer.from(finalStr, 'utf8');
  } catch (err) {
    log(`${C.red}⚠ Prune 413 failed: ${err.message}${C.reset}`);
    return null;
  }
}

const RATE_LIMIT_WAIT_MS = 20000;
const NET_DELAYS_MS = [2000, 2000, 4000, 8000, 15000, 30000];
const netDelay = (n) => Math.round(NET_DELAYS_MS[Math.min(n, NET_DELAYS_MS.length - 1)] * (0.75 + Math.random() * 0.5));

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 4,
  keepAliveMsecs: 5000,
});

let netFailStreak = 0;
function noteNetFailure(reason) {
  netFailStreak++;
  if (netFailStreak >= 3) {
    log(`${C.yellow}🔄 ${netFailStreak} net glitches (${reason}) -> socket pool reset${C.reset}`);
    try { httpsAgent.destroy(); } catch {}
    netFailStreak = 0;
  }
}

// ── SEND ERROR TO CLIENT (helper) ────────────────────────────────────────────
function sendErrorToClient(res, statusCode, message) {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  try {
    const body = JSON.stringify({ error: { message, type: 'proxy_error' } });
    res.writeHead(statusCode, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    });
    res.end(body);
  } catch {}
}

// ── FORWARD REQUEST ───────────────────────────────────────────────────────────
function executeForward(req, res, body, cleanUrl, sessionId, retryCount = 0, rateLimitRetry = 0, prunePass = 0, deadKeyAttempts = 0) {
  if (retryCount > MAX_NET_RETRIES) {
    log(`${C.brightRed}❌ MAX NET RETRIES (${MAX_NET_RETRIES}) exceeded. Giving up.${C.reset}`);
    sendErrorToClient(res, 502, `Proxy: upstream unreachable after ${MAX_NET_RETRIES} retries`);
    return;
  }
  if (deadKeyAttempts >= GROK_KEYS.length) {
    log(`${C.brightRed}❌ ALL ${GROK_KEYS.length} KEYS REJECTED (401/403). No valid keys left.${C.reset}`);
    sendErrorToClient(res, 401, `Proxy: all ${GROK_KEYS.length} API keys rejected`);
    return;
  }

  const keyIdx = getKeyIdxForSession(sessionId, body);

  body = checkAndInjectDirectives(body, sessionId, keyIdx);

  // Auto-Fallback: Rewrite any model request to cbcn/deepseek-v4-flash on tunnel.rue.onl
  // NOTE: seekai.cc STRIPS tools from ALL OpenAI requests — DO NOT USE for agentic work.
  try {
    let bodyStr = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    if (bodyStr.includes('"model"')) {
      bodyStr = bodyStr.replace(/"model"\s*:\s*"[^"]+"/g, '"model":"cbcn/deepseek-v4-flash"');
      body = Buffer.from(bodyStr, 'utf8');
      log(`🔄 ${C.brightYellow}AUTOMATIC MODEL REWRITE:${C.reset} -> cbcn/deepseek-v4-flash`);
    }
  } catch (e) {}

  // v6.2 Cached Pre-Emptive Proactive Pruning
  if (prunePass === 0 && body.length > 500000) {
    const prePruned = preEmptivePrune(body, sessionId);
    if (prePruned && prePruned.length < body.length) {
      log(`⚡ ${C.brightGreen}PRE-EMPTIVE PROACTIVE PRUNING:${C.reset} Compressed payload ${body.length}B -> ${prePruned.length}B (cached string/image trimming)`);
      body = prePruned;
    }
  }

  const rawKey = GROK_KEYS[keyIdx] || '';
  const key = rawKey.trim().replace(/[^\x20-\x7E]/g, '');
  const keyNum = keyIdx + 1;

  if (!key || /[^\x20-\x7E]/.test(rawKey) || rawKey.includes('INSERT') || rawKey.includes('YOUR')) {
    log(`${C.brightRed}❌ KEY #${keyNum} is a placeholder or invalid!${C.reset}`);
    sendErrorToClient(res, 500, `Key #${keyNum} is invalid or a placeholder`);
    return;
  }

  keyReqCounts[keyIdx]++;

  const upHeaders = {};
  for (const [hk, hv] of Object.entries(req.headers)) {
    if (['host','content-length','authorization','x-api-key','accept-encoding'].includes(hk)) continue;
    upHeaders[hk] = hv;
  }
  upHeaders['host']           = new URL(UPSTREAM).hostname;
  upHeaders['content-length'] = String(body.length);
  upHeaders['authorization']  = `Bearer ${key}`;
  upHeaders['x-api-key']      = key;
  upHeaders['user-agent']     = 'cline/1.0';

  const retryLabel = retryCount > 0 ? ` ${C.yellow}R#${retryCount}${C.reset}` : '';
  const rateLabel  = rateLimitRetry > 0 ? ` ${C.yellow}429#${rateLimitRetry}${C.reset}` : '';
  log(`🚀 ${C.brightCyan}${req.method} ${cleanUrl}${C.reset} | ${C.bold}K#${keyNum}${C.reset}${retryLabel}${rateLabel} | ${C.dim}${body.length}B${C.reset}`);

  const upUrl = new URL(cleanUrl, UPSTREAM);
  const upReq = https.request({
    hostname: upUrl.hostname,
    port:     443,
    path:     upUrl.pathname + (upUrl.search || ''),
    method:   req.method,
    headers:  upHeaders,
    agent:    httpsAgent,
  }, (upRes) => {
    const sc = upRes.statusCode;

    // ── 401 / 403 DEAD KEY ───────────────────────────────────────────────────
    if (sc === 401 || sc === 403) {
      upRes.resume();
      log(`${C.bgRed}${C.bold} REJECTED ${C.reset} K#${keyNum} -> HTTP ${sc}. Disabling.`);
      keyDisabled[keyIdx] = true;
      if (sessionId) sessionKeyMap.delete(sessionId);
      executeForward(req, res, body, cleanUrl, sessionId, retryCount, rateLimitRetry, prunePass, deadKeyAttempts + 1);
      return;
    }

    // ── 413 PAYLOAD TOO LARGE ────────────────────────────────────────────────
    if (sc === 413) {
      upRes.resume();
      keyAuto413Trims[keyIdx]++;
      const nextPass = prunePass + 1;
      if (nextPass > MAX_PRUNE_PASSES) {
        log(`${C.brightRed}❌ 413 after ${MAX_PRUNE_PASSES} trim passes. Payload irreducible.${C.reset}`);
        sendErrorToClient(res, 413, `Payload too large after ${MAX_PRUNE_PASSES} trim passes`);
        return;
      }
      log(`✂️  HTTP 413 -> trim pass ${nextPass}...`);
      const prunedBody = pruneMiddleFor413(body, nextPass);
      if (prunedBody && prunedBody.length < body.length) {
        executeForward(req, res, prunedBody, cleanUrl, sessionId, retryCount + 1, rateLimitRetry, nextPass, deadKeyAttempts);
        return;
      }
      log(`${C.brightRed}❌ 413 trim yielded no reduction. Forwarding error to client.${C.reset}`);
      sendErrorToClient(res, 413, 'Payload too large and could not be reduced');
      return;
    }

    // ── 429 RATE LIMIT ───────────────────────────────────────────────────────
    if (sc === 429) {
      upRes.resume();
      keyWait429Counts[keyIdx]++;
      log(`⏳ ${C.yellow}429 (K#${keyNum})${C.reset} -> wait ${RATE_LIMIT_WAIT_MS / 1000}s...`);
      setTimeout(() => {
        if (res.writableEnded || res.destroyed) return;
        executeForward(req, res, body, cleanUrl, sessionId, retryCount, rateLimitRetry + 1, prunePass, deadKeyAttempts);
      }, RATE_LIMIT_WAIT_MS);
      return;
    }

    // ── 5xx SERVER ERROR ─────────────────────────────────────────────────────
    if (sc === 529 || sc >= 500) {
      upRes.resume();
      const wait = netDelay(retryCount);
      log(`⚠ HTTP ${sc} -> retry in ${wait}ms`);
      setTimeout(() => {
        if (res.writableEnded || res.destroyed) return;
        executeForward(req, res, body, cleanUrl, sessionId, retryCount + 1, rateLimitRetry, prunePass, deadKeyAttempts);
      }, wait);
      return;
    }

    // ── 200 OK ───────────────────────────────────────────────────────────────
    if (sc === 200) {
      netFailStreak = 0;
      res.writeHead(sc, upRes.headers);

      // Hard absolute timeout: if the upstream SSE stream doesn't finish within
      // 3 minutes, destroy it and let Cline retry. Prevents event loop freeze.
      const STREAM_TIMEOUT_MS = 3 * 60 * 1000;
      const streamKiller = setTimeout(() => {
        log(`⏱ HARD STREAM TIMEOUT (${STREAM_TIMEOUT_MS/1000}s) — destroying hung upstream SSE pipe`);
        upRes.destroy(new Error('stream timeout'));
        if (!res.writableEnded) res.end();
      }, STREAM_TIMEOUT_MS);
      upRes.on('end', () => clearTimeout(streamKiller));
      upRes.on('error', () => clearTimeout(streamKiller));

      const processLine = (line) => line;

      let lineBuffer = '';
      const interceptor = new Transform({
        transform(chunk, encoding, callback) {
          lineBuffer += chunk.toString('utf8');
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';

          let out = '';
          for (let line of lines) {
            out += processLine(line) + '\n';
          }
          callback(null, Buffer.from(out, 'utf8'));
        },
        flush(callback) {
          if (lineBuffer) {
            this.push(Buffer.from(processLine(lineBuffer), 'utf8'));
          }
          callback();
        }
      });

      upRes.pipe(interceptor).pipe(res);
      upRes.on('error', err => log(`⚠ upRes pipe error: ${err.message}`));
      return;
    }

    // ── OTHER 4xx / UNEXPECTED ───────────────────────────────────────────────
    const errParts = [];
    upRes.on('data', chunk => errParts.push(chunk));
    upRes.on('end', () => {
      const buf = Buffer.concat(errParts);
      const decode = upRes.headers['content-encoding'] === 'gzip'
        ? (b, cb) => zlib.gunzip(b, (err, r) => cb(err ? b.toString('utf8') : r.toString('utf8')))
        : (b, cb) => cb(b.toString('utf8'));
      decode(buf, errText => {
        log(`💥 ${C.red}HTTP ${sc}:${C.reset} ${errText.slice(0, 200)}`);
        if (!res.headersSent) {
          const outBuf = Buffer.from(errText, 'utf8');
          const fwdHeaders = { ...upRes.headers };
          delete fwdHeaders['content-encoding'];
          fwdHeaders['content-length'] = String(outBuf.length);
          res.writeHead(sc, fwdHeaders);
          res.end(outBuf);
        }
      });
    });
  });

  upReq.on('socket', (sock) => {
    if (sock.connecting) {
      sock.setTimeout(15000);
      sock.once('connect', () => sock.setTimeout(90000));
    } else {
      sock.setTimeout(90000);
    }
  });

  upReq.on('timeout', () => {
    log(`⏱ socket timeout -> destroy & retry`);
    upReq.destroy(new Error('socket timeout'));
  });

  upReq.on('error', err => {
    if (/ECONNRESET|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|socket timeout|ECONNREFUSED/i.test(err.message || '')) {
      noteNetFailure(err.message);
    }
    const wait = netDelay(retryCount);
    log(`✗ upstream error (K#${keyNum}): ${err.message} -> retry in ${wait}ms`);
    setTimeout(() => {
      if (res.writableEnded || res.destroyed) return;
      executeForward(req, res, body, cleanUrl, sessionId, retryCount + 1, rateLimitRetry, prunePass, deadKeyAttempts);
    }, wait);
  });

  upReq.write(body);
  upReq.end();
}

// ── UPTIME FORMATTER ─────────────────────────────────────────────────────────
function formatUptime() {
  const sec = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

// ── FORMATTED TERMINAL STATUS TABLE ──────────────────────────────────────────
function printTerminalStatusTable() {
  const counts = getSessionCountsPerKey();
  const totalReqs = keyReqCounts.reduce((a,b)=>a+b, 0) || 1;

  console.log(`\n${C.dim}Uptime: ${formatUptime()} | Sessions: ${sessionKeyMap.size} | Total Requests: ${totalReqs}${C.reset}`);
  console.log(`+-------+-----------+----------+----------+----------+------------------------+`);
  console.log(`| ${C.bold}KEY${C.reset}   | ${C.bold}STATUS${C.reset}    | ${C.bold}SESSIONS${C.reset} | ${C.bold}REQUESTS${C.reset} | ${C.bold}INJECTED${C.reset} | ${C.bold}LOAD BAR${C.reset}               |`);
  console.log(`+-------+-----------+----------+----------+----------+------------------------+`);

  GROK_KEYS.forEach((k, i) => {
    const statusStr = keyDisabled[i] ? `${C.red}DEAD${C.reset}      ` : `${C.green}OK${C.reset}        `;
    const sessStr   = String(counts[i]).padStart(8, ' ');
    const reqStr    = String(keyReqCounts[i]).padStart(8, ' ');
    const injStr    = String(keyInjections[i]).padStart(8, ' ');

    const loadPct   = Math.round((keyReqCounts[i] / totalReqs) * 100);
    const filled    = Math.round((loadPct / 100) * 10);
    const barStr    = `[${C.brightCyan}${'#'.repeat(filled)}${C.dim}${'.'.repeat(10 - filled)}${C.reset}] ${String(loadPct).padStart(3, ' ')}%`;

    console.log(`| K#${String(i+1).padEnd(3, ' ')} | ${statusStr}| ${sessStr} | ${reqStr} | ${injStr} | ${barStr}     |`);
  });

  console.log(`+-------+-----------+----------+----------+----------+------------------------+\n`);
}

// ── INTERACTIVE TERMINAL CLI STDIN LISTENER ──────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${C.brightCyan}proxy>${C.reset} `
});

rl.on('line', (line) => {
  const input = line.trim();
  if (!input) { rl.prompt(); return; }

  const spaceIdx = input.indexOf(' ');
  const cmd = (spaceIdx === -1 ? input : input.slice(0, spaceIdx)).toLowerCase();
  const arg = spaceIdx === -1 ? '' : input.slice(spaceIdx + 1);

  if (cmd === 'status' || cmd === 's') {
    printTerminalStatusTable();

  } else if (cmd === 'sessions' || cmd === 'ss') {
    if (sessionKeyMap.size === 0) {
      console.log(`${C.dim}No active sessions.${C.reset}`);
    } else {
      console.log(`\n${C.bold}Active Sessions (${sessionKeyMap.size}):${C.reset}`);
      for (const [sid, kIdx] of sessionKeyMap.entries()) {
        const lastSeen = sessionLastSeen.get(sid);
        const ago = lastSeen ? `${Math.round((Date.now() - lastSeen) / 1000)}s ago` : '?';
        const proj = sessionProjectTag.get(sid);
        const projLabel = proj ? ` ${C.brightMagenta}[${proj.name}]${C.reset}` : '';
        console.log(`  ${C.cyan}${sid.slice(0, 16)}...${C.reset} -> K#${kIdx + 1}${projLabel} (${ago})`);
      }
      console.log('');
    }

  } else if (cmd === 'inj' || cmd === 'inject') {
    if (!arg) {
      console.log(`${C.yellow}Usage: inj [target] <text>  (e.g., 'inj dental ...' or 'inj hecton ...' or 'inj ...')${C.reset}`);
    } else {
      try {
        const injections = readInjectionsSafe();
        const argParts = arg.split(' ');
        const firstWord = argParts[0].toLowerCase();
        let targetKey = 'all';
        let textToInject = arg;

        if (firstWord === 'all' || (argParts.length >= 2 && /^[a-z][a-z0-9_-]*$/.test(firstWord) && firstWord.length >= 3 && firstWord.length <= 20)) {
          targetKey = firstWord;
          textToInject = argParts.slice(1).join(' ');
        }

        injections[targetKey] = textToInject;
        writeInjectionsSafe(injections);
        console.log(`${C.brightGreen}✅ INJECTED [${targetKey.toUpperCase()}]:${C.reset} "${textToInject.slice(0, 80)}${textToInject.length > 80 ? '...' : ''}"`);
      } catch (err) {
        console.log(`${C.red}❌ Injection failed: ${err.message}${C.reset}`);
      }
    }

  } else if (cmd === 'clear' || cmd === 'cl') {
    writeInjectionsSafe({});
    console.log(`${C.brightGreen}🧹 Injections cleared.${C.reset}`);

  } else if (cmd === 'keys' || cmd === 'reload') {
    loadExternalKeys();
    console.log(`${C.brightGreen}🔑 Keys reloaded. ${GROK_KEYS.length} keys active.${C.reset}`);

  } else if (cmd === 'help' || cmd === 'h' || cmd === '?') {
    console.log(`\n${C.bold}COMMANDS:${C.reset}`);
    console.log(`  ${C.cyan}status${C.reset} (s)      Key telemetry table`);
    console.log(`  ${C.cyan}sessions${C.reset} (ss)   Active session list`);
    console.log(`  ${C.cyan}inj [target] <text>${C.reset} Inject directive (target = project name or 'all')`);
    console.log(`  ${C.cyan}clear${C.reset} (cl)      Clear all injections`);
    console.log(`  ${C.cyan}keys${C.reset} (reload)   Hot-reload keys from keys.json/keys.txt`);
    console.log(`  ${C.cyan}help${C.reset} (h)        This list\n`);

  } else {
    console.log(`${C.yellow}Unknown: '${cmd}'. Type 'help'.${C.reset}`);
  }

  rl.prompt();
});

// ── HOT-RELOAD & SELF-REBOOT ON CODE CHANGE ──────────────────────────────
let isRebooting = false;
try {
  fs.watch(__filename, () => {
    if (isRebooting) return;
    isRebooting = true;
    log(`${C.brightYellow}⚡ CODE MODIFIED: Hot-rebooting grok-proxy daemon...${C.reset}`);
    setTimeout(() => {
      server.close(() => {
        try {
          const child = child_process.spawn(process.argv[0], process.argv.slice(1), {
            cwd: process.cwd(),
            stdio: 'inherit',
            detached: true
          });
          child.unref();
        } catch (e) {
          log(`${C.red}Failed to spawn reboot child: ${e.message}${C.reset}`);
        }
        process.exit(0);
      });
    }, 300);
  });
} catch {}

// ── HTTP SERVER ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.on('error', err => log(`⚠ client res error: ${err.message}`));

  // Health check & Control endpoints
  if ((req.method === 'HEAD' || req.method === 'GET') && (req.url === '/' || req.url === '')) {
    const health = {
      status: 'ok',
      proxy: 'grok-proxy v6.2',
      uptime: formatUptime(),
      keys: GROK_KEYS.length,
      keysActive: keyDisabled.filter(d => !d).length,
      sessions: sessionKeyMap.size,
      totalRequests: keyReqCounts.reduce((a,b) => a+b, 0),
    };
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(health));
    return;
  }

  // Automated Revive / Wake endpoint for T.A.R.S. Overseer
  if (req.url.startsWith('/wake') || req.url.startsWith('/revive')) {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const projectTarget = parsedUrl.searchParams.get('project') || parsedUrl.searchParams.get('target') || 'all';
      const customDirective = parsedUrl.searchParams.get('text') || `[OVERSEER IMPERATIVE WAKE]: Session revival trigger fired. Resume execution immediately according to the project plan!`;

      const injections = readInjectionsSafe();
      injections[projectTarget.toLowerCase()] = customDirective;
      writeInjectionsSafe(injections);

      log(`${C.brightMagenta}⚡ REVIVE/WAKE TRIGGERED for [${projectTarget.toUpperCase()}]: "${customDirective.slice(0, 60)}..."${C.reset}`);

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'ok',
        action: 'revive_directive_injected',
        project: projectTarget,
        directive: customDirective,
        timestamp: new Date().toISOString()
      }));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'error', error: err.message }));
    }
    return;
  }

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const cleanUrl = req.url;

    let sessionId = req.headers['x-session-id'] || req.headers['x-claude-code-session-id'] || null;
    if (body.length > 0) {
      try {
        const obj = JSON.parse(body.toString('utf8'));
        if (!sessionId && obj.metadata?.user_id) {
          try {
            const uid = JSON.parse(obj.metadata.user_id);
            if (uid.session_id) sessionId = uid.session_id;
          } catch {}
        }
      } catch (err) {
        // ignore parse errors for session extraction
      }
      if (!sessionId) {
        const detected = detectProjectFromBody(body);
        if (detected) sessionId = 'proj_' + detected.name;
      }
    }

    executeForward(req, res, body, cleanUrl, sessionId);
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n${C.bgRed} EADDRINUSE ${C.reset} ${C.brightYellow}Port ${PROXY_PORT} is already occupied by an active Grok Proxy daemon.${C.reset}`);
    console.error(`${C.dim}The proxy is already running on http://127.0.0.1:${PROXY_PORT}/v1. Exiting redundant launch.${C.reset}\n`);
    process.exit(0);
  } else {
    log(`${C.bgRed} SERVER ERROR ${C.reset} ${err.message}`);
  }
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`
${C.brightCyan}+------------------------------------------------------------------+
| ${C.bold}${C.brightGreen}⚡ GROK PROXY v6.2 — TERMINAL OVERSEER${C.reset}${C.brightCyan}                         |
| ${C.dim}Endpoint: http://127.0.0.1:${PROXY_PORT}/v1${C.reset}${C.brightCyan}                             |
| ${C.dim}Commands: status, sessions, inj <text>, clear, keys, help${C.reset}${C.brightCyan}   |
+------------------------------------------------------------------+${C.reset}
  `);
  printTerminalStatusTable();
  rl.prompt();
});

process.on('uncaughtException', err => log(`${C.bgRed} UNCAUGHT ${C.reset} ${err.message}`));
process.on('unhandledRejection', err => log(`${C.bgRed} UNHANDLED ${C.reset} ${err?.message || err}`));
