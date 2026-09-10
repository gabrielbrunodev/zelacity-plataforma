const fs = require('node:fs');
const path = require('node:path');

const [, , requestedVersionCode, requestedVersionName] = process.argv;
const versionCode = Number.parseInt(requestedVersionCode, 10);
const versionName = String(requestedVersionName || '').trim();
const root = path.resolve(__dirname, '..', '..');
const appGradle = path.join(root, 'android', 'app', 'build.gradle');
const keystoreProperties = path.join(root, 'android', 'keystore.properties');

if (!Number.isSafeInteger(versionCode) || versionCode < 1 || String(versionCode) !== String(requestedVersionCode || '').trim()) {
  throw new Error('versionCode deve ser um número inteiro positivo.');
}

if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,62}$/.test(versionName)) {
  throw new Error('versionName deve ter até 63 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.');
}

if (!fs.existsSync(appGradle)) {
  throw new Error('Projeto Android não encontrado. Execute "npx cap add android" antes desta etapa.');
}

if (!fs.existsSync(keystoreProperties)) {
  throw new Error('Arquivo temporário android/keystore.properties não encontrado.');
}

let content = fs.readFileSync(appGradle, 'utf8');

if (content.includes('ZELACITY_RELEASE_SIGNING')) {
  throw new Error('A assinatura de produção já foi configurada neste projeto Android temporário.');
}

const pluginPattern = /apply plugin: ['"]com\.android\.application['"]/;
if (!pluginPattern.test(content)) {
  throw new Error('Formato inesperado de android/app/build.gradle: plugin Android não encontrado.');
}

const signingSetup = `\n\n// ZELACITY_RELEASE_SIGNING: configurado somente no runner do GitHub Actions.\ndef keystoreProperties = new Properties()\ndef keystorePropertiesFile = rootProject.file('keystore.properties')\nif (!keystorePropertiesFile.exists()) {\n    throw new GradleException('Arquivo keystore.properties não encontrado para a assinatura de produção.')\n}\nkeystoreProperties.load(new FileInputStream(keystorePropertiesFile))\n`;
content = content.replace(pluginPattern, (match) => `${match}${signingSetup}`);

const versionCodePattern = /versionCode\s+\d+/;
const versionNamePattern = /versionName\s+["'][^"']*["']/;
if (!versionCodePattern.test(content) || !versionNamePattern.test(content)) {
  throw new Error('Formato inesperado de android/app/build.gradle: versão Android não encontrada.');
}

content = content.replace(versionCodePattern, `versionCode ${versionCode}`);
content = content.replace(versionNamePattern, `versionName "${versionName}"`);

const buildTypesPattern = /^(\s*)buildTypes\s*\{/m;
if (!buildTypesPattern.test(content)) {
  throw new Error('Formato inesperado de android/app/build.gradle: buildTypes não encontrado.');
}

const signingConfig = `    signingConfigs {\n        release {\n            keyAlias keystoreProperties['keyAlias']\n            keyPassword keystoreProperties['keyPassword']\n            storeFile file(keystoreProperties['storeFile'])\n            storePassword keystoreProperties['storePassword']\n        }\n    }\n\n`;
content = content.replace(buildTypesPattern, `${signingConfig}$&`);

const releasePattern = /(buildTypes\s*\{[\s\S]*?release\s*\{)/;
if (!releasePattern.test(content)) {
  throw new Error('Formato inesperado de android/app/build.gradle: buildType release não encontrado.');
}

content = content.replace(releasePattern, '$1\n            signingConfig signingConfigs.release');
fs.writeFileSync(appGradle, content, 'utf8');
console.log(`Android configurado para release assinado: versionCode ${versionCode}, versionName ${versionName}.`);
