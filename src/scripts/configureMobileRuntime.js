const fs = require('node:fs');
const path = require('node:path');

const requestedUrl = String(process.argv[2] || '').trim();
let apiBaseUrl = '';

if (requestedUrl) {
  const parsed = new URL(requestedUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('A URL da API deve ser uma origem HTTPS simples, por exemplo: https://sistema.exemplo.gov.br');
  }
  apiBaseUrl = parsed.origin;
}

const target = path.resolve(__dirname, '../../public/runtime-config.js');
const content = `/* Gerado somente durante a compilação do APK. */\nwindow.ZELACITY_RUNTIME_CONFIG = Object.freeze({ apiBaseUrl: ${JSON.stringify(apiBaseUrl)} });\n`;
fs.writeFileSync(target, content, 'utf8');
console.log(apiBaseUrl ? `API do APK configurada para ${apiBaseUrl}.` : 'APK configurado sem URL de API.');
