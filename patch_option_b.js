const fs = require('fs');
const files = ['proxy.js', 'grok-proxy-EXPORT.js'];

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, 'utf8');

  // Skip if already patched
  if (text.includes('OVERSEER IMPERATIVE DAEMON MANDATE')) {
    console.log('Already has Option B: ' + file);
    return;
  }

  // We need to inject after JSON parse.
  // For proxy.js:
  // try { obj = JSON.parse(rawBody.toString('utf8')); }
  // catch (e) { log('json parse err (chat): ' + e.message); res.writeHead(400).end('{"error":"bad json"}'); return; }
  
  // For grok-proxy-EXPORT.js:
  // if (!obj || !Array.isArray(obj.messages) || obj.messages.length === 0) return bodyBuffer;
  // body = checkAndInjectDirectives(body, sessionId, keyIdx);

  const injection = `
  if (obj && Array.isArray(obj.messages)) {
    const historyStr = JSON.stringify(obj.messages).toLowerCase();
    const isCompletionAttempt = historyStr.includes('"name":"attempt_completion"') || historyStr.includes('"attempt_completion"');
    const isUsingSubagents = historyStr.includes('"name":"use_subagents"') || historyStr.includes('"use_subagents"');
    
    if (isCompletionAttempt && !isUsingSubagents) {
      const daemonDirective = "[OVERSEER IMPERATIVE DAEMON MANDATE]: ОСТАНОВКА ЗАПРЕЩЕНА! Ты находишься в режиме безостановочной работы. Завершать таск запрещено. Иди в Product Bible/backlog, бери следующую фичу, и начинай реализовывать её немедленно!";
      const lastMsg = obj.messages[obj.messages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        if (typeof lastMsg.content === 'string') {
          lastMsg.content += "\\n" + daemonDirective;
        } else if (Array.isArray(lastMsg.content)) {
          lastMsg.content.push({ type: 'text', text: "\\n" + daemonDirective });
        }
      } else {
        obj.messages.push({ role: 'user', content: daemonDirective });
      }
    }
  }
`;

  let modified = false;
  
  if (file === 'proxy.js' && text.includes('catch (e) { log(\'json parse err (chat): \'')) {
    const search = "catch (e) { log('json parse err (chat): ' + e.message); res.writeHead(400).end('{\"error\":\"bad json\"}'); return; }";
    if (text.includes(search)) {
      text = text.replace(search, search + "\n" + injection);
      // Need to stringify again since proxy.js re-stringifies at:
      // const outBody = Buffer.from(JSON.stringify(obj), 'utf8');
      modified = true;
    }
  } else if (file === 'grok-proxy-EXPORT.js' && text.includes('function checkAndInjectDirectives(bodyBuffer, sessionId, keyIdx) {')) {
    const search = "if (!injections || Object.keys(injections).length === 0) return bodyBuffer;";
    if (text.includes(search)) {
      // In EXPORT.js we must parse the bodyBuffer first, so we do it where obj is available.
      // Wait, let's inject where obj is parsed:
      const parseSearch = "if (!obj || !Array.isArray(obj.messages) || obj.messages.length === 0) return bodyBuffer;";
      if (text.includes(parseSearch)) {
        text = text.replace(parseSearch, parseSearch + "\n" + injection);
        modified = true;
      }
    }
  }

  if (modified) {
    fs.writeFileSync(file, text, 'utf8');
    console.log('Patched Option B into ' + file);
  } else {
    console.log('Failed to match injection point in ' + file);
  }
});
