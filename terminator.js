const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOTS = [
  'C:\\hades\\gigahrush2',
  'C:\\hades\\Hecton8',
  'C:\\Clinic_MVP\\dental-crm',
  'C:\\Users\\Admin\\Desktop'
];

const FORBIDDEN_PATTERNS = [
  /^tmp-.*\.(mjs|js|ts|py|ps1)$/,
  /^_patch_.*\.(mjs|js|ts|py|ps1)$/,
  /^_.*\.(txt|log|mjs|js|ts|py|ps1)$/
];

function log(msg) {
  console.log(`[TERMINATOR] ${new Date().toISOString()} | ${msg}`);
}

function scanAndDestroy() {
  for (const root of ROOTS) {
    if (!fs.existsSync(root)) continue;

    try {
      const files = fs.readdirSync(root);
      for (const file of files) {
        if (FORBIDDEN_PATTERNS.some(p => p.test(file))) {
          const fullPath = path.join(root, file);
          log(`CRITICAL VIOLATION DETECTED: ${fullPath}`);
          
          // Try to kill any node/python process that might be running it
          try {
            if (file.endsWith('.mjs') || file.endsWith('.js')) {
              execSync(`taskkill /F /IM node.exe /FI "WINDOWTITLE eq ${file}*"`, { stdio: 'ignore' });
            } else if (file.endsWith('.py')) {
              execSync(`taskkill /F /IM python.exe /FI "WINDOWTITLE eq ${file}*"`, { stdio: 'ignore' });
            }
          } catch (e) { /* ignore taskkill errors */ }

          // Delete the file
          try {
            fs.unlinkSync(fullPath);
            log(`DELETED: ${fullPath}`);
          } catch (e) {
            log(`FAILED TO DELETE (maybe locked): ${fullPath}`);
          }
        }
      }
    } catch (e) {
      log(`Error scanning ${root}: ${e.message}`);
    }
  }
}

log("ARCHITECT TERMINATOR DAEMON STARTED.");
log("Scanning for illegal scratch scripts outside of 'scratch/'...");
setInterval(scanAndDestroy, 5000);
