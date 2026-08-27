const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [mode, rootArg, installerArg, versionArg, publishDirArg] = process.argv.slice(2);
if (!mode || !rootArg) {
  console.error('Uso: node update-signing.cjs ensure <root> | sign <root> <installer> <version> [publishDir] | fingerprint <root>');
  process.exit(2);
}

const root = path.resolve(rootArg);
const secretDir = path.join(root, 'secrets', 'update-signing');
const privatePath = path.join(secretDir, 'private.pem');
const publicPath = path.join(secretDir, 'public.pem');
const embeddedPublicPath = path.join(root, 'apps', 'desktop', 'update-public.pem');
const pinnedFingerprintPath = path.join(secretDir, 'deployed-fingerprint.txt');
const defaultPublishDir = path.join(root, 'updates', 'windows');

function atomicWrite(filePath, data, modeBits) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, data, { mode: modeBits });
  fs.renameSync(tempPath, filePath);
}

function toPublicKey(key) {
  if (key && typeof key === 'object' && key.type === 'public') return key;
  return crypto.createPublicKey(key);
}

function publicDer(key) {
  return toPublicKey(key).export({ type: 'spki', format: 'der' });
}

function fingerprint(key) {
  return crypto.createHash('sha256').update(publicDer(key)).digest('hex');
}

function loadPrivate() {
  if (!fs.existsSync(privatePath)) {
    throw new Error(`Chave privada ausente: ${privatePath}`);
  }
  const key = crypto.createPrivateKey(fs.readFileSync(privatePath));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('A chave privada do updater precisa ser Ed25519.');
  return key;
}

function ensureKeys() {
  fs.mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  const hasPrivate = fs.existsSync(privatePath);
  const hasPublic = fs.existsSync(publicPath);

  if (!hasPrivate && hasPublic) {
    throw new Error('A chave privada do updater nao esta neste pacote. Restaure secrets/update-signing/private.pem do backup do host de build para manter a cadeia de atualizacao existente.');
  }

  if (!hasPrivate && !hasPublic) {
    if (process.env.GINGA_ALLOW_NEW_UPDATE_KEY !== '1') {
      throw new Error('Nenhuma chave de updater foi encontrada. Para uma instalacao NOVA, defina GINGA_ALLOW_NEW_UPDATE_KEY=1 e execute novamente. Para clientes existentes, restaure a private.pem original.');
    }
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    atomicWrite(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), 0o600);
    atomicWrite(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), 0o644);
    console.log('Chave Ed25519 do updater criada. FACA BACKUP de secrets/update-signing/private.pem.');
  }

  const privateKey = loadPrivate();
  const derivedPublic = crypto.createPublicKey(privateKey);
  const derivedPem = derivedPublic.export({ type: 'spki', format: 'pem' });
  const derivedFingerprint = fingerprint(derivedPublic);

  let pinnedFingerprint = '';
  if (fs.existsSync(pinnedFingerprintPath)) {
    pinnedFingerprint = fs.readFileSync(pinnedFingerprintPath, 'utf8').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(pinnedFingerprint)) throw new Error('deployed-fingerprint.txt esta invalido.');
    if (pinnedFingerprint !== derivedFingerprint) {
      throw new Error(`PRIVATE KEY ERRADA. A chave implantada nos clientes tem fingerprint ${pinnedFingerprint}, mas a private.pem atual deriva ${derivedFingerprint}. Build abortada para nao quebrar o auto-update.`);
    }
  } else {
    // Na primeira configuracao fixa a fingerprint que passa a representar a cadeia
    // implantada. Rotacao futura precisa ser um processo explicito, nunca acidental.
    atomicWrite(pinnedFingerprintPath, `${derivedFingerprint}\n`, 0o644);
    pinnedFingerprint = derivedFingerprint;
    console.log(`Fingerprint implantada fixada em ${pinnedFingerprintPath}`);
  }

  if (fs.existsSync(publicPath)) {
    let currentFingerprint = '';
    try {
      currentFingerprint = fingerprint(fs.readFileSync(publicPath));
    } catch {
      currentFingerprint = 'invalida';
    }
    if (currentFingerprint !== derivedFingerprint) {
      const backupPath = `${publicPath}.mismatch-${Date.now()}.bak`;
      try { fs.copyFileSync(publicPath, backupPath); } catch {}
      console.warn(`ATENCAO: public.pem NAO correspondia a private.pem. A publica foi reconstruida da privada. Backup: ${backupPath}`);
    }
  }

  // A private.pem e a unica fonte de verdade no host de build. Isso impede
  // compilar um EXE com uma public key e assinar o manifesto com outra.
  atomicWrite(publicPath, derivedPem, 0o644);
  atomicWrite(embeddedPublicPath, derivedPem, 0o644);

  const embeddedFingerprint = fingerprint(fs.readFileSync(embeddedPublicPath));
  if (embeddedFingerprint !== derivedFingerprint) {
    throw new Error('Falha ao sincronizar a chave publica embutida no Desktop.');
  }

  console.log(`Updater key fingerprint SHA-256: ${derivedFingerprint}`);
  return { privateKey, publicKey: derivedPublic, fingerprint: derivedFingerprint };
}

const keys = ensureKeys();
if (mode === 'ensure') process.exit(0);
if (mode === 'fingerprint') {
  console.log(keys.fingerprint);
  process.exit(0);
}
if (mode !== 'sign' || !installerArg || !versionArg) process.exit(2);

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(versionArg)) {
  throw new Error(`Versao invalida para o updater: ${versionArg}. Use x.y.z ou prerelease, por exemplo 1.6.7-1beta / 1.6.7-beta.10 / 1.6.7-rc.2.`);
}
const legacyCounter = versionArg.match(/-(\d+)(beta|alpha|rc)$/i);
if (legacyCounter && Number(legacyCounter[1]) >= 10) {
  const [, counter, label] = legacyCounter;
  const safeVersion = versionArg.replace(/-\d+(beta|alpha|rc)$/i, `-${label.toLowerCase()}.${counter}`);
  throw new Error(`Formato de prerelease inseguro para electron-updater: ${versionArg}. Use ${safeVersion}.`);
}

const installer = path.resolve(installerArg);
if (!fs.existsSync(installer)) throw new Error(`Instalador nao encontrado: ${installer}`);
const expectedName = `Ginga-Setup-${versionArg}-x64.exe`;
if (path.basename(installer) !== expectedName) {
  throw new Error(`Nome inesperado do instalador: ${path.basename(installer)}. Esperado: ${expectedName}`);
}

const publishDir = publishDirArg ? path.resolve(publishDirArg) : defaultPublishDir;
fs.mkdirSync(publishDir, { recursive: true });
const bytes = fs.readFileSync(installer);
let releaseNotes = String(process.env.GINGA_RELEASE_NOTES || '').trim();
if (!releaseNotes) {
  try {
    const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const escaped = versionArg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = changelog.match(new RegExp(`(?:^|\\n)#{1,3}\\s*(?:\\[)?${escaped}(?:\\])?[^\\n]*\\n([\\s\\S]*?)(?=\\n#{1,3}\\s|$)`, 'i'));
    if (match?.[1]) releaseNotes = match[1].trim().slice(0, 12000);
  } catch {}
}
const manifest = {
  schema: 1,
  product: 'Ginga',
  platform: 'win32-x64',
  version: versionArg,
  file: path.basename(installer),
  size: bytes.length,
  sha512: crypto.createHash('sha512').update(bytes).digest('base64'),
  publishedAt: new Date().toISOString(),
  keyFingerprint: keys.fingerprint,
  ...(releaseNotes ? { releaseNotes } : {})
};
const raw = Buffer.from(JSON.stringify(manifest), 'utf8');
const signature = crypto.sign(null, raw, keys.privateKey);
if (signature.length !== 64) throw new Error(`Assinatura Ed25519 com tamanho inesperado: ${signature.length}`);
if (!crypto.verify(null, raw, keys.publicKey, signature)) throw new Error('Falha interna: a assinatura recem-gerada nao validou com a chave publica derivada.');

atomicWrite(path.join(publishDir, 'manifest.json'), raw, 0o644);
atomicWrite(path.join(publishDir, 'manifest.sig'), `${signature.toString('base64')}\n`, 0o644);
console.log(`Manifesto assinado: ${manifest.version} ${manifest.sha512.slice(0, 20)}...`);
console.log(`Saida: ${publishDir}`);
