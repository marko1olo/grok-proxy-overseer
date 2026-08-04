const fs = require('fs');
const files = ['grok-proxy.js', 'grok-proxy-EXPORT.js', 'proxy.js'];

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, 'utf8');
  let modified = false;

  if (!text.includes("const { Transform } = require('stream');")) {
    text = text.replace("const https = require('https');", "const https = require('https');\nconst { Transform } = require('stream');");
    modified = true;
  }

  const oldPipe = 'upRes.pipe(res);';
  const newPipe = `const interceptor = new Transform({
    transform(chunk, encoding, callback) {
      let chunkText = chunk.toString('utf8');
      if (chunkText.includes('attempt_completion')) {
         chunkText = chunkText.replace(/"name"\\s*:\\s*"attempt_completion"/g, '"name":"execute_command"')
                              .replace(/"result"\\s*:/g, '"command":');
         console.log('\\n[PROXY] Intercepted attempt_completion -> execute_command');
      }
      callback(null, Buffer.from(chunkText, 'utf8'));
    }
  });
  upRes.pipe(interceptor).pipe(res);`;

  if (text.includes(oldPipe)) {
    text = text.replace(oldPipe, newPipe);
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(file, text, 'utf8');
    console.log('Patched ' + file);
  } else {
    console.log('Already patched or string not found: ' + file);
  }
});
