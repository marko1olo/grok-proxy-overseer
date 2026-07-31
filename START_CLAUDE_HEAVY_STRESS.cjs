const fs = require('fs');
const path = require('path');

// 3 РАБОЧИХ КЛЮЧЕЙ С ВЫСОКИМИ ЛИМИТАМИ (Tier 4/5 Enterprise)
const KEYS = [
  { id: '#2', key: 'sk-DEMO_KEY_SANITIZED_BY_OVERSEER' },
  { id: '#4', key: 'sk-DEMO_KEY_SANITIZED_BY_OVERSEER' },
  { id: '#6', key: 'sk-DEMO_KEY_SANITIZED_BY_OVERSEER' }
];

// МОДЕЛИ ДЛЯ ТЕСТИРОВАНИЯ
const MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-8'
];

const LOG_FILE = path.join(__dirname, 'claude_heavy_stress.log');
const STATS_FILE = path.join(__dirname, 'claude_token_stats.json');
const CONTEXT_FILE = 'C:\\Users\\Admin\\Documents\\прошлый диалог важные уроки.txt';

let keyIndex = 0;
let concurrency = 3; // Старт с 3 параллельных запросов
const MAX_CONCURRENCY = 18; // До 18 параллельных потоков
const MIN_CONCURRENCY = 1;

let stats = {
  total_requests: 0,
  successful_requests: 0,
  failed_requests: 0,
  prompt_tokens_burned: 0,
  completion_tokens_burned: 0,
  total_tokens_burned: 0,
  estimated_cost_usd: 0,
  rate_limit_errors: 0,
  quota_errors: 0
};

try {
  if (fs.existsSync(STATS_FILE)) {
    stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  }
} catch (e) {}

function saveStats() {
  stats.total_tokens_burned = stats.prompt_tokens_burned + stats.completion_tokens_burned;
  // Оценка стоимости по тарифам Sonnet/Opus (~$3.00/1M in, ~$15.00/1M out)
  stats.estimated_cost_usd = Number(((stats.prompt_tokens_burned / 1e6 * 3.0) + (stats.completion_tokens_burned / 1e6 * 15.0)).toFixed(4));
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
  } catch (e) {}
}

function log(msg) {
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (e) {}
}

// Загрузка контекстного файла для тяжелого ввода
let baseContextText = '';
try {
  if (fs.existsSync(CONTEXT_FILE)) {
    baseContextText = fs.readFileSync(CONTEXT_FILE, 'utf8');
    log(`📖 Загружен файл контекста: ${(baseContextText.length / 1024).toFixed(1)} KB`);
  }
} catch (e) {}

const HEAVY_PROMPTS = [
  'Write an exhaustive, 2500-word engineering manual on building a distributed high-throughput message queue in Rust from scratch.',
  'Analyze in complete technical detail the entire Linux CFS (Completely Fair Scheduler) algorithm, red-black tree operations, and virtual runtime calculation.',
  'Provide a comprehensive, highly detailed textbook chapter on PostgreSQL Internals: MVCC, WAL, page layout, HOT updates, and buffer pool eviction strategies.',
  'Write a full technical deep-dive into Modern CPU Microarchitecture: Out-of-Order execution, Register Renaming, Branch Target Buffers, and Speculative Execution vulnerabilities.',
  'Write a masterclass manual on V8 JavaScript Engine compilation pipeline: Ignition bytecode interpreter, TurboFan optimization phases, and Garbage Collector (Scavenger + Mark-Sweep-Compact).'
];

function getNextKey() {
  const keyObj = KEYS[keyIndex % KEYS.length];
  keyIndex++;
  return keyObj;
}

// Таймаут для отдельных чанков стрима
function readWithTimeout(reader, timeoutMs) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Reader Timeout')), timeoutMs);
  });
  return Promise.race([
    reader.read(),
    timeoutPromise
  ]).finally(() => clearTimeout(timeoutId));
}

async function sendHeavyRequest(reqId, type, payload) {
  const start = Date.now();
  const keyObj = getNextKey();
  const model = payload.model || MODELS[Math.floor(Math.random() * MODELS.length)];
  
  stats.total_requests++;
  saveStats();

  const controller = new AbortController();
  const connectTimeoutId = setTimeout(() => controller.abort(), 45000); // 45s на коннект

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': keyObj.key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: payload.max_tokens || 4000,
        messages: [{ role: 'user', content: payload.prompt }],
        stream: true
      }),
      signal: controller.signal
    });

    clearTimeout(connectTimeoutId);

    if (!res.ok) {
      const errText = await res.text();
      let errCode = 'unknown';
      let msg = errText;
      try {
        const j = JSON.parse(errText);
        msg = j?.error?.message || errText;
        errCode = j?.error?.type || String(res.status);
      } catch {}

      stats.failed_requests++;
      if (res.status === 429) stats.rate_limit_errors++;
      if (msg.includes('credit balance') || msg.includes('quota')) stats.quota_errors++;
      saveStats();

      return { reqId, keyId: keyObj.id, model, success: false, status: res.status, errCode, error: msg.slice(0, 150), elapsed: ((Date.now() - start) / 1000).toFixed(1) };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    let prompt_tokens = 0;
    let completion_tokens = 0;

    while (true) {
      const { done, value } = await readWithTimeout(reader, 30000); // 30s таймаут на чанк
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.type === 'message_start' && data.message?.usage) {
              prompt_tokens = data.message.usage.input_tokens || 0;
            }
            if (data.type === 'content_block_delta' && data.delta?.text) {
              completion_tokens += Math.round(data.delta.text.length / 3.5);
            }
            if (data.type === 'message_delta' && data.usage) {
              if (data.usage.output_tokens) completion_tokens = data.usage.output_tokens;
            }
          } catch (e) {}
        }
      }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    
    // Если точные токены не пришли из API, оцениваем приблизительно по длине
    if (!prompt_tokens) prompt_tokens = Math.round(payload.prompt.length / 2.5);

    stats.successful_requests++;
    stats.prompt_tokens_burned += prompt_tokens;
    stats.completion_tokens_burned += completion_tokens;
    saveStats();

    return { reqId, keyId: keyObj.id, model, success: true, elapsed, prompt_tokens, completion_tokens };

  } catch (err) {
    clearTimeout(connectTimeoutId);
    try { controller.abort(); } catch(e) {}
    
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    stats.failed_requests++;
    saveStats();

    let errMsg = err.message;
    if (err.name === 'AbortError') errMsg = 'Connect Timeout';
    return { reqId, keyId: keyObj.id, model, success: false, exception: true, error: errMsg, elapsed };
  }
}

async function main() {
  log('===========================================================');
  log('   🔥 ТЯЖЕЛЫЙ СТРЕСС-ДЕМОН CLAUDE (3 Enterprise Ключа)   ');
  log('===========================================================');
  log(`Ранее сожжено токенов: ${stats.total_tokens_burned.toLocaleString()} (~$${stats.estimated_cost_usd})`);
  log(`Доступные модели: ${MODELS.join(', ')}`);
  log('===========================================================');

  while (true) {
    const roundMode = Math.floor(Math.random() * 3);
    const startRound = Date.now();

    if (roundMode === 0 && baseContextText) {
      // РЕЖИМ 1: МЕГА-ВВОД (Контекст x5 - x8, ~200k+ токенов на вход)
      const mult = Math.floor(Math.random() * 4) + 5; // x5 .. x8
      log(`\n💥 [РЕЖИМ: МЕГА-ВВОД] Подача контекста x${mult}...`);
      
      let contextStr = '';
      for (let i = 0; i < mult; i++) contextStr += baseContextText + '\n\n';
      const prompt = `${contextStr}\n\n[TASK]: Perform a detailed critical audit of Section 2 (PNG Trap) from the provided text. Write response in Russian.`;

      log(`📡 Отправляем огромный контекст (~${Math.round(prompt.length / 2.5).toLocaleString()} токенов)...`);
      const res = await sendHeavyRequest(1, 'HUGE_INPUT', { prompt, max_tokens: 1500 });

      if (res.success) {
        log(`  ✅ [${res.keyId}][${res.model}] ${res.elapsed}s | Вход: ${res.prompt_tokens.toLocaleString()} tok | Выход: ${res.completion_tokens.toLocaleString()} tok`);
      } else {
        log(`  ❌ [${res.keyId}][${res.model}] ${res.elapsed}s | ${res.status || 'ERR'}: ${res.error}`);
        if (res.status === 429) {
          log('💤 Rate-limit hit. Pausing 10s...');
          await new Promise(r => setTimeout(r, 10000));
        }
      }

    } else if (roundMode === 1) {
      // РЕЖИМ 2: МАКСИМАЛЬНЫЙ ВЫВОДИ И МЫШЛЕНИЕ
      const prompt = HEAVY_PROMPTS[Math.floor(Math.random() * HEAVY_PROMPTS.length)];
      log(`\n🧠 [РЕЖИМ: МАКСИМАЛЬНЫЙ ВЫВОД] Моделирование сложной задачи...`);
      log(`📡 Отправляем тяжелый промпт на генерацию...`);

      const res = await sendHeavyRequest(1, 'MAX_OUTPUT', { prompt, max_tokens: 4000 });

      if (res.success) {
        log(`  ✅ [${res.keyId}][${res.model}] ${res.elapsed}s | Выдано: ${res.completion_tokens.toLocaleString()} tok | Вход: ${res.prompt_tokens.toLocaleString()} tok`);
      } else {
        log(`  ❌ [${res.keyId}][${res.model}] ${res.elapsed}s | ${res.status || 'ERR'}: ${res.error}`);
      }

    } else {
      // РЕЖИМ 3: ПАРАЛЛЕЛЬНЫЙ ШТОРМ (Пачка запросов)
      log(`\n⚡ [РЕЖИМ: ПАРАЛЛЕЛЬНЫЙ ШТОРМ] Потоков: ${concurrency}`);
      const tasks = [];

      for (let i = 0; i < concurrency; i++) {
        const prompt = HEAVY_PROMPTS[i % HEAVY_PROMPTS.length];
        tasks.push(sendHeavyRequest(i + 1, 'CONCURRENCY', { prompt, max_tokens: 1500 }));
      }

      const results = await Promise.allSettled(tasks);
      let okCount = 0, failCount = 0;
      let roundPrompt = 0, roundComp = 0;

      for (const r of results) {
        const val = r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message };
        if (val.success) {
          okCount++;
          roundPrompt += val.prompt_tokens;
          roundComp += val.completion_tokens;
        } else {
          failCount++;
        }
      }

      log(`📊 Пачка параллельных (${concurrency} потоков): ${okCount} ОК, ${failCount} ошибок | Сожгли: вх:${roundPrompt.toLocaleString()} / вых:${roundComp.toLocaleString()}`);

      // Авто-масштабирование параллелизма
      if (failCount === 0) {
        concurrency = Math.min(MAX_CONCURRENCY, concurrency + 2);
        log(`📈 Успех! Повышаем параллелизм -> ${concurrency} потоков`);
      } else {
        concurrency = Math.max(MIN_CONCURRENCY, Math.floor(concurrency / 2));
        log(`📉 Ошибки в пачке. Снижаем параллелизм -> ${concurrency} потоков`);
      }
    }

    // Сводка
    log(`🔥 ИТОГО СОЖЖЕНО: ${stats.total_tokens_burned.toLocaleString()} токенов | Эквивалент: ~$${stats.estimated_cost_usd} USD`);
    log(`   (Успешно запросов: ${stats.successful_requests}/${stats.total_requests})`);
    log('-----------------------------------------------------------');

    await new Promise(r => setTimeout(r, 4000)); // Короткая пауза 4с
  }
}

main().catch(err => log(`💥 FATAL: ${err.message}`));
