const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || '.');
const version = String(process.argv[3] || '').trim();
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

if (!VERSION_RE.test(version)) {
  console.error('Versao invalida. Exemplos: 0.2.0, 0.3.0-beta.1, 1.0.0-rc.1');
  process.exit(2);
}

const legacyCounter = version.match(/-(\d+)(beta|alpha|rc)$/i);
if (legacyCounter && Number(legacyCounter[1]) >= 10) {
  const [, counter, label] = legacyCounter;
  console.error(`Formato de prerelease inseguro para auto-update: ${version}. A partir de 10 use ${version.replace(/-\d+(beta|alpha|rc)$/i, `-${label.toLowerCase()}.${counter}`)}. O electron-updater ordena 10beta abaixo de 9beta.`);
  process.exit(2);
}

const packageFiles = [
  'apps/desktop/package.json',
  'apps/web/package.json',
  'apps/api/package.json'
];

for (const relative of packageFiles) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`Arquivo nao encontrado: ${relative}`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.version = version;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`OK ${relative} -> ${version}`);
}

for (const relative of ['apps/desktop/package-lock.json', 'apps/web/package-lock.json', 'apps/api/package-lock.json']) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.version = version;
  if (json.packages && json.packages['']) json.packages[''].version = version;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`OK ${relative} -> ${version}`);
}

for (const relative of ['.env', '.env.example', '.env.production.example']) {
  const envFile = path.join(root, relative);
  if (!fs.existsSync(envFile)) continue;
  let env = fs.readFileSync(envFile, 'utf8');
  const line = `GINGA_RELEASE_VERSION=${version}`;
  if (/^GINGA_RELEASE_VERSION=.*$/m.test(env)) env = env.replace(/^GINGA_RELEASE_VERSION=.*$/m, line);
  else env = env.replace(/\s*$/, '') + `\n${line}\n`;
  fs.writeFileSync(envFile, env, 'utf8');
  console.log(`OK ${relative} -> GINGA_RELEASE_VERSION=${version}`);
}

console.log(`\nVersao sincronizada: ${version}`);
