const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [rootArg, feedDirArg, remoteUrlArg] = process.argv.slice(2);
if (!rootArg) {
  console.error('Uso: node verify-update-release.cjs <root> [feedDir] [remoteUrl]');
  process.exit(2);
}

const root = path.resolve(rootArg);
const feedDir = feedDirArg ? path.resolve(feedDirArg) : path.join(root, 'updates', 'windows');
const publicCandidates = [
  path.join(root, 'secrets', 'update-signing', 'public.pem'),
  path.join(root, 'apps', 'desktop', 'update-public.pem')
];

function fail(message) {
  throw new Error(message);
}

function keyFingerprint(key) {
  const pub = crypto.createPublicKey(key);
  if (pub.asymmetricKeyType !== 'ed25519') fail('A chave publica nao e Ed25519.');
  const der = pub.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

function sha512Buffer(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('base64');
}

function validateManifest(manifest) {
  if (!manifest || manifest.schema !== 1 || manifest.product !== 'Ginga' || manifest.platform !== 'win32-x64') fail('Manifesto com schema/produto/plataforma invalido.');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(String(manifest.version || ''))) fail(`Versao invalida no manifesto: ${manifest.version}`);
  if (manifest.file !== `Ginga-Setup-${manifest.version}-x64.exe`) fail(`Nome do instalador inconsistente no manifesto: ${manifest.file}`);
  if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0) fail('Tamanho invalido no manifesto.');
  if (typeof manifest.sha512 !== 'string' || Buffer.from(manifest.sha512, 'base64').length !== 64) fail('SHA-512 invalido no manifesto.');
}

function parseLatest(text) {
  const pick = (regex) => text.match(regex)?.[1]?.trim() || '';
  return {
    version: pick(/^version:\s*([^\r\n]+)$/m),
    path: pick(/^path:\s*([^\r\n]+)$/m),
    sha512: pick(/^sha512:\s*([^\r\n]+)$/m),
    fileUrl: pick(/^\s*-\s+url:\s*([^\r\n]+)$/m),
    fileSha512: pick(/^\s+sha512:\s*([^\r\n]+)$/m),
    fileSize: Number(pick(/^\s+size:\s*(\d+)$/m) || 0)
  };
}

function validateLatest(latest, manifest) {
  if (latest.version !== manifest.version) fail(`latest.yml version=${latest.version}, manifesto=${manifest.version}`);
  if (latest.path !== manifest.file) fail(`latest.yml path=${latest.path}, manifesto=${manifest.file}`);
  if (latest.fileUrl && latest.fileUrl !== manifest.file) fail(`latest.yml url=${latest.fileUrl}, manifesto=${manifest.file}`);
  if (latest.sha512 !== manifest.sha512) fail('SHA-512 principal do latest.yml nao corresponde ao manifesto.');
  if (latest.fileSha512 && latest.fileSha512 !== manifest.sha512) fail('SHA-512 do arquivo no latest.yml nao corresponde ao manifesto.');
  if (latest.fileSize && latest.fileSize !== manifest.size) fail(`Tamanho do latest.yml=${latest.fileSize}, manifesto=${manifest.size}`);
}

function verifyPair(rawManifest, rawSignature, publicKey) {
  const sigText = rawSignature.toString('utf8').trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sigText)) fail('manifest.sig nao contem Base64 valido.');
  const signature = Buffer.from(sigText, 'base64');
  if (signature.length !== 64) fail(`manifest.sig tem ${signature.length} bytes; Ed25519 deveria ter 64.`);
  if (!crypto.verify(null, rawManifest, publicKey, signature)) fail('Assinatura Ed25519 do manifest.json INVALIDA.');
}

const existingPublic = publicCandidates.filter((p) => fs.existsSync(p));
if (!existingPublic.length) fail('Nenhuma chave publica do updater foi encontrada.');
const publicKey = fs.readFileSync(existingPublic[0]);
const fingerprint = keyFingerprint(publicKey);
const pinnedFingerprintPath = path.join(root, 'secrets', 'update-signing', 'deployed-fingerprint.txt');
if (fs.existsSync(pinnedFingerprintPath)) {
  const pinned = fs.readFileSync(pinnedFingerprintPath, 'utf8').trim().toLowerCase();
  if (pinned !== fingerprint) fail(`Fingerprint implantada=${pinned}, chave publica atual=${fingerprint}`);
}
for (const candidate of existingPublic.slice(1)) {
  const other = keyFingerprint(fs.readFileSync(candidate));
  if (other !== fingerprint) fail(`Chaves publicas divergentes: ${existingPublic[0]} != ${candidate}`);
}

const manifestPath = path.join(feedDir, 'manifest.json');
const signaturePath = path.join(feedDir, 'manifest.sig');
const latestPath = path.join(feedDir, 'latest.yml');
for (const required of [manifestPath, signaturePath, latestPath]) {
  if (!fs.existsSync(required)) fail(`Arquivo ausente no feed local: ${required}`);
}

const rawManifest = fs.readFileSync(manifestPath);
const rawSignature = fs.readFileSync(signaturePath);
verifyPair(rawManifest, rawSignature, publicKey);
const manifest = JSON.parse(rawManifest.toString('utf8'));
validateManifest(manifest);
if (manifest.keyFingerprint && manifest.keyFingerprint !== fingerprint) fail(`Fingerprint do manifesto (${manifest.keyFingerprint}) difere da chave local (${fingerprint}).`);

const installerPath = path.join(feedDir, manifest.file);
if (!fs.existsSync(installerPath)) fail(`Instalador ausente no feed: ${installerPath}`);
const installer = fs.readFileSync(installerPath);
if (installer.length !== manifest.size) fail(`Tamanho do instalador=${installer.length}, manifesto=${manifest.size}`);
if (sha512Buffer(installer) !== manifest.sha512) fail('SHA-512 do instalador local NAO corresponde ao manifesto.');
const latest = parseLatest(fs.readFileSync(latestPath, 'utf8'));
validateLatest(latest, manifest);

console.log('OK feed local');
console.log(`  versao: ${manifest.version}`);
console.log(`  arquivo: ${manifest.file}`);
console.log(`  tamanho: ${manifest.size}`);
console.log(`  key SHA-256: ${fingerprint}`);
console.log('  assinatura Ed25519: OK');
console.log('  SHA-512 instalador: OK');
console.log('  latest.yml x manifest: OK');

async function fetchNoCache(url, asBuffer = false, method = 'GET') {
  const parsed = new URL(url);
  parsed.searchParams.set('_ginga_verify', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  let response;
  try {
    response = await fetch(parsed, {
      method,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8_000)
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`feed remoto inacessivel em ${parsed.origin}${parsed.pathname}: ${reason}`);
  }
  if (!response.ok) fail(`HTTP ${response.status} em ${parsed.origin}${parsed.pathname}`);
  if (method === 'HEAD') return response;
  return asBuffer ? Buffer.from(await response.arrayBuffer()) : await response.text();
}

async function verifyRemote(baseUrl) {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const [remoteManifestRaw, remoteSignatureRaw, remoteLatestText] = await Promise.all([
    fetchNoCache(new URL('manifest.json', base).toString(), true),
    fetchNoCache(new URL('manifest.sig', base).toString(), true),
    fetchNoCache(new URL('latest.yml', base).toString(), false)
  ]);
  verifyPair(remoteManifestRaw, remoteSignatureRaw, publicKey);
  const remoteManifest = JSON.parse(remoteManifestRaw.toString('utf8'));
  validateManifest(remoteManifest);
  validateLatest(parseLatest(remoteLatestText), remoteManifest);
  if (remoteManifest.version !== manifest.version || remoteManifest.file !== manifest.file || remoteManifest.sha512 !== manifest.sha512) {
    fail('O feed remoto nao corresponde ao feed local recem-publicado.');
  }
  const installerUrl = new URL(remoteManifest.file, base);
  installerUrl.searchParams.set('_ginga_verify', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const head = await fetchNoCache(installerUrl.toString(), false, 'HEAD');
  const remoteLength = Number(head.headers.get('content-length') || 0);
  if (remoteLength && remoteLength !== remoteManifest.size) fail(`Instalador remoto tem ${remoteLength} bytes; esperado ${remoteManifest.size}.`);
  console.log('OK feed remoto');
  console.log(`  URL: ${base.toString()}`);
  console.log('  assinatura Ed25519: OK');
  console.log('  latest.yml x manifest: OK');
  console.log('  instalador remoto: OK');
}

if (remoteUrlArg) {
  const attempts = Math.max(1, Math.min(10, Number(process.env.GINGA_REMOTE_VERIFY_ATTEMPTS || 5)));
  const delayMs = Math.max(250, Math.min(10_000, Number(process.env.GINGA_REMOTE_VERIFY_DELAY_MS || 1500)));

  (async () => {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await verifyRemote(remoteUrlArg);
        return;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (attempt < attempts) {
          console.warn(`Feed remoto ainda nao validou (${attempt}/${attempts}): ${message}`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    console.error(`FALHA feed remoto apos ${attempts} tentativa(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    process.exitCode = 1;
  })();
}
