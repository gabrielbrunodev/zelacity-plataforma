const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const publicDirectory = path.join(projectRoot, 'public');
const requiredFiles = [
  'index.html',
  'runtime-config.js',
  'capacitor-adapter.js',
  'manifest.json',
  path.join('assets', 'app-icon.svg')
];

for (const relativeFile of requiredFiles) {
  const target = path.join(publicDirectory, relativeFile);

  if (!fs.existsSync(target)) {
    throw new Error(`Arquivo necessário para a versão web não encontrado: public/${relativeFile}`);
  }
}

const htmlPages = fs.readdirSync(publicDirectory)
  .filter((file) => file.endsWith('.html'));

if (htmlPages.length === 0) {
  throw new Error('Nenhuma página HTML foi encontrada em public/.');
}

console.log(`Versão web estática validada: ${htmlPages.length} página(s) pronta(s) para o Capacitor.`);
