#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const explicit = String(process.argv[3] || '').trim();

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

function normalizeHttpUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function isLoopback(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

const envFile = path.join(root, '.env');
const fileEnv = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
const candidates = [
  explicit,
  process.env.GINGA_SERVER_URL,
  fileEnv.GINGA_SERVER_URL
].map(value => normalizeHttpUrl(String(value || '').trim())).filter(Boolean);

if (!candidates.length) {
  const origins = String(fileEnv.APP_ORIGINS || process.env.APP_ORIGINS || '')
    .split(',')
    .map(value => normalizeHttpUrl(value.trim()))
    .filter(Boolean);
  const preferred = origins.find(value => value.startsWith('https://') && !isLoopback(value))
    || origins.find(value => !isLoopback(value))
    || origins[0];
  if (preferred) candidates.push(preferred);
}

const serverUrl = candidates[0];
if (!serverUrl) {
  console.error('Nao foi possivel resolver a URL do Ginga. Defina GINGA_SERVER_URL no .env ou informe -ServerUrl explicitamente.');
  process.exit(2);
}

if (serverUrl.startsWith('http://') && !isLoopback(serverUrl)) {
  console.error('AVISO: GINGA_SERVER_URL externo usa HTTP. Funciona, mas nao e adequado para exposicao publica; prefira HTTPS.');
}

process.stdout.write(serverUrl);
