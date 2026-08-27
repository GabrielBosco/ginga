#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const strict = process.argv.includes('--strict');
const envPath = path.join(root, '.env');
const issues = [];

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function localHttp(value) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value);
}
function localWs(value) {
  return /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value);
}
function add(level, id, message) { issues.push({ level, id, message }); }

if (!fs.existsSync(envPath)) {
  add('WARN', 'env-missing', '.env nao encontrado. O preflight validou apenas os arquivos estaticos.');
} else {
  const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
  const origins = String(env.APP_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
  const insecureOrigins = origins.filter(v => v.startsWith('http://') && !localHttp(v));
  if (insecureOrigins.length) add('CRITICAL', 'transport-http', 'Existem origens externas HTTP. Use HTTPS antes de expor o Ginga na Internet.');
  else add('PASS', 'transport-http', 'Origens externas sem HTTP inseguro.');

  const livekit = String(env.PUBLIC_LIVEKIT_URL || '').trim();
  if (livekit && !livekit.startsWith('wss://') && !localWs(livekit)) add('CRITICAL', 'livekit-ws', 'PUBLIC_LIVEKIT_URL externo esta em WS. Use WSS.');
  else add('PASS', 'livekit-ws', 'Sinalizacao LiveKit sem WS externo inseguro.');

  if (String(env.ALLOW_LEGACY_WEBHOOK_URL_TOKENS || 'false').toLowerCase() === 'true') add('CRITICAL', 'webhook-url-token', 'Tokens legados de webhook em URL estao habilitados.');
  else add('PASS', 'webhook-url-token', 'Tokens legados de webhook por URL desativados.');

  const registrationOpen = String(env.ALLOW_REGISTRATION || 'true').toLowerCase() === 'true';
  const verification = String(env.EMAIL_VERIFICATION_REQUIRED || 'false').toLowerCase() === 'true';
  if (registrationOpen && !verification) add('WARN', 'registration-verification', 'Cadastro publico esta aberto sem verificacao de e-mail.');
  else add('PASS', 'registration-verification', 'Politica de cadastro nao esta aberta sem verificacao.');

  const jwt = String(env.JWT_SECRET || '');
  if (jwt.length < 48 || /change_me/i.test(jwt)) add('CRITICAL', 'jwt-secret', 'JWT_SECRET e curto, ausente ou usa valor placeholder.');
  else add('PASS', 'jwt-secret', 'JWT_SECRET possui comprimento minimo e nao e placeholder.');

  const serverUrl = String(env.GINGA_SERVER_URL || '').trim();
  if (serverUrl && serverUrl.startsWith('http://') && !localHttp(serverUrl)) add('CRITICAL', 'server-url-http', 'GINGA_SERVER_URL externo usa HTTP. Use HTTPS.');
  else add('PASS', 'server-url-http', 'URL publica principal sem HTTP externo inseguro.');

  const redisPassword = String(env.REDIS_PASSWORD || '');
  if (!redisPassword) add('WARN', 'redis-auth', 'Redis esta sem senha. A rede Docker reduz a exposicao, mas defina REDIS_PASSWORD para defesa em profundidade.');
  else if (redisPassword.length < 24 || /troque|change|senha/i.test(redisPassword)) add('WARN', 'redis-auth', 'REDIS_PASSWORD parece curto ou placeholder. Use ao menos 24 caracteres aleatorios.');
  else add('PASS', 'redis-auth', 'Redis possui senha configurada para o LiveKit.');
}

const privateKeyPath = path.join(root, 'secrets', 'update-signing', 'private.pem');
const desktopPublicPath = path.join(root, 'apps', 'desktop', 'update-public.pem');
if (!fs.existsSync(privateKeyPath)) {
  add('WARN', 'update-private-key', 'Chave privada do updater nao existe neste host. Isso e correto para codigo-fonte, mas o host de publicacao precisa mante-la fora de pacotes.');
} else if (!fs.existsSync(desktopPublicPath)) {
  add('CRITICAL', 'update-public-key', 'Chave publica do Desktop nao foi encontrada.');
} else {
  try {
    const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath));
    const expectedPublic = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString().trim();
    const desktopPublic = crypto.createPublicKey(fs.readFileSync(desktopPublicPath)).export({ type: 'spki', format: 'pem' }).toString().trim();
    if (expectedPublic !== desktopPublic) add('CRITICAL', 'update-key-match', 'Chave publica embutida no Desktop nao corresponde a chave privada de publicacao.');
    else add('PASS', 'update-key-match', 'Chave publica do Desktop corresponde a chave de assinatura do host.');
  } catch (error) {
    add('CRITICAL', 'update-key-parse', `Nao foi possivel validar as chaves do updater: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const rank = { PASS: 0, WARN: 1, CRITICAL: 2 };
for (const item of issues) console.log(`${item.level.padEnd(8)} ${item.id.padEnd(28)} ${item.message}`);
const critical = issues.filter(item => item.level === 'CRITICAL').length;
const warnings = issues.filter(item => item.level === 'WARN').length;
console.log(`\nResumo: ${critical} critico(s), ${warnings} alerta(s), ${issues.filter(i => i.level === 'PASS').length} OK.`);
if (strict && (critical || warnings)) process.exit(2);
if (critical) process.exitCode = 1;
