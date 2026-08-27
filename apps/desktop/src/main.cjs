const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  session,
  shell,
  desktopCapturer,
  ipcMain,
  Notification,
  safeStorage,
  screen,
  globalShortcut
} = require('electron');
const { NsisUpdater } = require('electron-updater');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const APP_ID = 'br.com.ginga.desktop';
const FALLBACK_SERVER_URL = 'http://127.0.0.1';
const UPDATE_TIMEOUT_MS = 15000;
const UPDATE_STALL_TIMEOUT_MS = 120000;
const HEALTH_TIMEOUT_MS = 6000;
const RUNTIME_UPDATE_INITIAL_DELAY_MS = 15000;
const RUNTIME_UPDATE_INTERVAL_MS = 120000;
const UPDATE_PUBLIC_KEY = path.join(__dirname, '..', 'update-public.pem');

function configBaseDir() {
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'Ginga');
  return path.join(os.homedir(), '.config', 'Ginga');
}


const USER_SERVER_CONFIG = path.join(configBaseDir(), 'server.json');
const USER_SESSION_FILE = path.join(configBaseDir(), 'session.bin');
const UPDATE_LOG_FILE = path.join(configBaseDir(), 'logs', 'updater.log');
const USER_UPDATE_CONFIG = path.join(configBaseDir(), 'update.json');
const USER_GAME_OVERLAY_CONFIG = path.join(configBaseDir(), 'game-overlay.json');
const RUNTIME_LOG_FILE = path.join(configBaseDir(), 'logs', 'runtime.log');

const KNOWN_GAME_PROCESSES = new Map([
  ['cs2', 'Counter-Strike 2'],
  ['valorant-win64-shipping', 'VALORANT'],
  ['league of legends', 'League of Legends'],
  ['dota2', 'Dota 2'],
  ['fortniteclient-win64-shipping', 'Fortnite'],
  ['overwatch', 'Overwatch 2'],
  ['r5apex', 'Apex Legends'],
  ['rocketleague', 'Rocket League'],
  ['gta5', 'Grand Theft Auto V'],
  ['fivem', 'FiveM'],
  ['helldivers2', 'HELLDIVERS 2'],
  ['destiny2', 'Destiny 2'],
  ['eldenring', 'ELDEN RING'],
  ['bg3', 'Baldur\'s Gate 3'],
  ['minecraft', 'Minecraft'],
  ['minecraft.windows', 'Minecraft'],
  ['wow', 'World of Warcraft'],
  ['wowclassic', 'World of Warcraft Classic'],
  ['ascension', 'Project Ascension'],
  ['rainbowsix', 'Rainbow Six Siege'],
  ['rainbowsix_vulkan', 'Rainbow Six Siege'],
  ['tslgame', 'PUBG: BATTLEGROUNDS'],
  ['deadbydaylight-win64-shipping', 'Dead by Daylight'],
  ['palworld-win64-shipping', 'Palworld'],
  ['marvel-win64-shipping', 'Marvel Rivals'],
  ['warframe.x64', 'Warframe'],
  ['pathofexile_x64', 'Path of Exile'],
  ['pathofexile2', 'Path of Exile 2'],
  ['diablo iv', 'Diablo IV'],
  ['hearthstone', 'Hearthstone'],
  ['ffxiv_dx11', 'FINAL FANTASY XIV'],
  ['genshinimpact', 'Genshin Impact'],
  ['starrail', 'Honkai: Star Rail'],
  ['zenlesszonezero', 'Zenless Zone Zero'],
  ['brawlhalla', 'Brawlhalla'],
  ['robloxplayerbeta', 'Roblox'],
  ['aces', 'War Thunder'],
  ['worldoftanks', 'World of Tanks'],
  ['worldofwarships64', 'World of Warships'],
  ['escapefromtarkov', 'Escape from Tarkov'],
  ['terraria', 'Terraria'],
  ['stardew valley', 'Stardew Valley'],
  ['factorio', 'Factorio'],
  ['civilizationvi', "Sid Meier's Civilization VI"],
  ['eu4', 'Europa Universalis IV'],
  ['hoi4', 'Hearts of Iron IV'],
  ['stellaris', 'Stellaris'],
  ['projectzomboid64', 'Project Zomboid'],
  ['vrchat', 'VRChat'],
  ['scum', 'SCUM'],
  ['scum-win64-shipping', 'SCUM'],
  ['theforest', 'The Forest'],
  ['sonsoftheforest', 'Sons of the Forest'],
  ['rustclient', 'Rust'],
  ['dayz_x64', 'DayZ'],
  ['7daystodie', '7 Days to Die']
]);

function execFileText(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout) => {
      if (error) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

// Deteccao local e opt-in. Em vez de enumerar todos os processos do PC,
// consultamos somente os nomes de executaveis de jogos conhecidos. O renderer
// recebe apenas o jogo reconhecido (ou null), nunca uma lista de processos.
async function detectGameActivityUncached() {
  if (process.platform !== 'win32') return { supported: false, activity: null };
  const powershellNames = Array.from(KNOWN_GAME_PROCESSES.keys())
    .map((name) => `'${name.replace(/'/g, "''")}'`)
    .join(',');
  const command = [
    '$ErrorActionPreference = "Stop"',
    `$known = @(${powershellNames})`,
    '$names = Get-Process -Name $known -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName -Unique',
    '$names | ConvertTo-Json -Compress'
  ].join('; ');
  try {
    const stdout = await execFileText('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', command
    ], { windowsHide: true, timeout: 4500, maxBuffer: 128 * 1024 });
    const parsed = stdout.trim() ? JSON.parse(stdout.trim()) : [];
    const names = (Array.isArray(parsed) ? parsed : [parsed])
      .map((name) => String(name || '').trim().toLowerCase())
      .filter(Boolean);
    const running = new Set(names);
    for (const [processName, gameName] of KNOWN_GAME_PROCESSES) {
      if (running.has(processName.toLowerCase())) return { supported: true, activity: { name: gameName, detectedAt: new Date().toISOString() } };
    }
    return { supported: true, activity: null };
  } catch (error) {
    return { supported: true, activity: null, error: error instanceof Error ? error.message : 'Falha ao detectar jogo' };
  }
}



let gameDetectionCacheAt = 0;
let gameDetectionCache = { supported: process.platform === 'win32', activity: null };
let gameDetectionInFlight = null;
async function detectGameActivity() {
  const now = Date.now();
  if (now - gameDetectionCacheAt < 5000) return gameDetectionCache;
  if (gameDetectionInFlight) return gameDetectionInFlight;
  gameDetectionInFlight = detectGameActivityUncached()
    .then((result) => { gameDetectionCache = result; gameDetectionCacheAt = Date.now(); return result; })
    .finally(() => { gameDetectionInFlight = null; });
  return gameDetectionInFlight;
}


const DEFAULT_GAME_OVERLAY_SETTINGS = Object.freeze({
  enabled: true,
  showGame: true,
  showVoice: true,
  showOnlyInVoice: false,
  position: 'top-right',
  opacity: 0.92
});
let gameOverlayWindow = null;
let gameOverlaySettings = { ...DEFAULT_GAME_OVERLAY_SETTINGS };
let gameOverlayVoiceState = null;
let gameOverlayDetectedActivity = null;
let gameOverlayPollTimer = null;
let gameOverlayPreviewTimer = null;
let gameOverlayManualHidden = false;
let gameOverlayLastGame = '';
let gameOverlayScanRunning = false;

function normalizeGameOverlaySettings(value) {
  const input = value && typeof value === 'object' ? value : {};
  const positions = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
  return {
    enabled: input.enabled !== false,
    showGame: input.showGame !== false,
    showVoice: input.showVoice !== false,
    showOnlyInVoice: Boolean(input.showOnlyInVoice),
    position: positions.has(input.position) ? input.position : 'top-right',
    opacity: Math.max(0.55, Math.min(1, Number(input.opacity) || 0.92))
  };
}

function readGameOverlaySettings() {
  try {
    gameOverlaySettings = normalizeGameOverlaySettings(JSON.parse(fs.readFileSync(USER_GAME_OVERLAY_CONFIG, 'utf8')));
  } catch {
    gameOverlaySettings = { ...DEFAULT_GAME_OVERLAY_SETTINGS };
  }
  return gameOverlaySettings;
}

function saveGameOverlaySettings(value) {
  gameOverlaySettings = normalizeGameOverlaySettings(value);
  fs.mkdirSync(path.dirname(USER_GAME_OVERLAY_CONFIG), { recursive: true, mode: 0o700 });
  fs.writeFileSync(USER_GAME_OVERLAY_CONFIG, JSON.stringify(gameOverlaySettings, null, 2), { mode: 0o600 });
  gameOverlayManualHidden = false;
  positionGameOverlayWindow();
  renderGameOverlay();
  return gameOverlaySettings;
}

function createGameOverlayWindow() {
  if (gameOverlayWindow && !gameOverlayWindow.isDestroyed()) return gameOverlayWindow;
  if (!app.isReady()) return null;
  gameOverlayWindow = new BrowserWindow({
    width: 360,
    height: 300,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: hardenedWindowOptions({ preload: path.join(__dirname, 'game-overlay-preload.cjs'), backgroundThrottling: false })
  });
  gameOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
  try { gameOverlayWindow.setAlwaysOnTop(true, 'screen-saver'); } catch { gameOverlayWindow.setAlwaysOnTop(true); }
  try { gameOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  gameOverlayWindow.loadFile(path.join(__dirname, 'game-overlay.html'));
  gameOverlayWindow.on('closed', () => { gameOverlayWindow = null; });
  gameOverlayWindow.webContents.on('did-finish-load', () => renderGameOverlay());
  positionGameOverlayWindow();
  return gameOverlayWindow;
}

function positionGameOverlayWindow() {
  if (!app.isReady()) return;
  const win = gameOverlayWindow;
  if (!win || win.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const [width, height] = win.getSize();
  const margin = 18;
  const right = gameOverlaySettings.position.endsWith('right');
  const bottom = gameOverlaySettings.position.startsWith('bottom');
  const x = right ? area.x + area.width - width - margin : area.x + margin;
  const y = bottom ? area.y + area.height - height - margin : area.y + margin;
  win.setPosition(Math.round(x), Math.round(y), false);
}

function gameOverlayPayload(preview = false) {
  const voice = preview ? {
    connected: true,
    channelId: 'preview',
    channelName: 'Lobby',
    deafened: false,
    muted: false,
    inputMode: 'ptt',
    pushToTalkLabel: 'Mouse 4',
    participants: [
      { identity: 'you', name: 'Você', speaking: false, microphoneEnabled: true, local: true },
      { identity: 'friend', name: 'Amigo', speaking: true, microphoneEnabled: true, local: false },
      { identity: 'friend2', name: 'Squad', speaking: false, microphoneEnabled: true, local: false }
    ]
  } : gameOverlayVoiceState;
  return {
    settings: gameOverlaySettings,
    game: preview ? { name: 'Jogo detectado', detectedAt: new Date().toISOString() } : gameOverlayDetectedActivity,
    voice,
    preview
  };
}

function shouldShowGameOverlay(preview = false) {
  if (preview) return true;
  if (!gameOverlaySettings.enabled || gameOverlayManualHidden || !gameOverlayDetectedActivity?.name) return false;
  if (gameOverlaySettings.showOnlyInVoice && !gameOverlayVoiceState?.connected) return false;
  if (!gameOverlaySettings.showGame && (!gameOverlaySettings.showVoice || !gameOverlayVoiceState?.connected)) return false;
  return true;
}

function renderGameOverlay({ preview = false } = {}) {
  if (!app.isReady()) return;
  const win = createGameOverlayWindow();
  if (!win || win.isDestroyed()) return;
  const visible = shouldShowGameOverlay(preview);
  if (!visible) {
    win.hide();
    return;
  }
  positionGameOverlayWindow();
  win.setOpacity(gameOverlaySettings.opacity);
  win.webContents.send('ginga:game-overlay-state', gameOverlayPayload(preview));
  if (!win.isVisible()) win.showInactive();
}

async function refreshGameOverlayDetection() {
  if (gameOverlayScanRunning || !gameOverlaySettings.enabled || process.platform !== 'win32') return;
  gameOverlayScanRunning = true;
  try {
    const result = await detectGameActivity();
    const next = result?.activity?.name ? result.activity : null;
    const nextName = String(next?.name || '');
    if (nextName !== gameOverlayLastGame) {
      gameOverlayLastGame = nextName;
      gameOverlayDetectedActivity = next;
      gameOverlayManualHidden = false;
      positionGameOverlayWindow();
    } else {
      gameOverlayDetectedActivity = next;
    }
    renderGameOverlay();
  } catch {
    gameOverlayDetectedActivity = null;
    renderGameOverlay();
  } finally {
    gameOverlayScanRunning = false;
  }
}

function startGameOverlayWatcher() {
  readGameOverlaySettings();
  if (gameOverlayPollTimer) clearInterval(gameOverlayPollTimer);
  void refreshGameOverlayDetection();
  gameOverlayPollTimer = setInterval(() => void refreshGameOverlayDetection(), 8000);
  try {
    globalShortcut.unregister('CommandOrControl+Shift+O');
    globalShortcut.register('CommandOrControl+Shift+O', () => {
      if (!gameOverlayDetectedActivity?.name) return;
      gameOverlayManualHidden = !gameOverlayManualHidden;
      renderGameOverlay();
    });
  } catch (error) {
    logRuntime(`overlay-shortcut error=${error instanceof Error ? error.message : String(error)}`);
  }
}

function previewGameOverlayWindow() {
  if (gameOverlayPreviewTimer) clearTimeout(gameOverlayPreviewTimer);
  createGameOverlayWindow();
  renderGameOverlay({ preview: true });
  gameOverlayPreviewTimer = setTimeout(() => {
    gameOverlayPreviewTimer = null;
    renderGameOverlay();
  }, 5000);
  return true;
}

function readSecureSessionToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return '';
    const encoded = fs.readFileSync(USER_SESSION_FILE, 'utf8').trim();
    if (!encoded) return '';
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  } catch {
    return '';
  }
}

function writeSecureSessionToken(token) {
  fs.mkdirSync(path.dirname(USER_SESSION_FILE), { recursive: true, mode: 0o700 });
  const value = String(token || '').trim();
  if (!value) {
    try { fs.rmSync(USER_SESSION_FILE, { force: true }); } catch {}
    return true;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Armazenamento seguro do Windows indisponivel');
  const encrypted = safeStorage.encryptString(value).toString('base64');
  fs.writeFileSync(USER_SESSION_FILE, encrypted, { mode: 0o600 });
  return true;
}

function normalizeServerUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use http:// ou https://');
  if (parsed.username || parsed.password) throw new Error('Nao informe usuario ou senha na URL');
  if (!parsed.hostname) throw new Error('Endereco do servidor invalido');
  return parsed.origin;
}

function readEmbeddedServerUrl() {
  try {
    const configPath = path.join(__dirname, '..', 'config.json');
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return normalizeServerUrl(parsed.serverUrl || FALLBACK_SERVER_URL);
  } catch {
    return FALLBACK_SERVER_URL;
  }
}

function readSavedServerUrl() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USER_SERVER_CONFIG, 'utf8'));
    return normalizeServerUrl(parsed.serverUrl);
  } catch {
    return null;
  }
}

function saveServerUrl(serverUrl) {
  const normalized = normalizeServerUrl(serverUrl);
  fs.mkdirSync(path.dirname(USER_SERVER_CONFIG), { recursive: true, mode: 0o700 });
  fs.writeFileSync(USER_SERVER_CONFIG, JSON.stringify({ serverUrl: normalized }, null, 2), { mode: 0o600 });
  return normalized;
}

function defaultUpdateChannel() { return String(app.getVersion() || '').includes('-') ? 'beta' : 'stable'; }
function readUpdateChannel() { const forced=String(process.env.GINGA_UPDATE_CHANNEL||'').trim().toLowerCase();if(forced==='stable'||forced==='beta')return forced;try{const parsed=JSON.parse(fs.readFileSync(USER_UPDATE_CONFIG,'utf8'));return parsed?.channel==='stable'||parsed?.channel==='beta'?parsed.channel:defaultUpdateChannel();}catch{return defaultUpdateChannel();} }
function saveUpdateChannel(channel) { const normalized=String(channel||'').trim().toLowerCase();if(!['stable','beta'].includes(normalized))throw new Error('Canal de atualizacao invalido');fs.mkdirSync(path.dirname(USER_UPDATE_CONFIG),{recursive:true,mode:0o700});fs.writeFileSync(USER_UPDATE_CONFIG,JSON.stringify({channel:normalized},null,2),{mode:0o600});return normalized; }
function manifestAllowedForChannel(manifest,channel=readUpdateChannel()){return channel==='beta'||!String(manifest?.version||'').includes('-');}

const SERVER_URL = normalizeServerUrl(
  process.env.GINGA_SERVER_URL || readSavedServerUrl() || readEmbeddedServerUrl()
);
const SERVER_ORIGIN = new URL(SERVER_URL).origin;
const UPDATE_URL = new URL('/updates/windows/', `${SERVER_URL}/`).toString();
const ALLOWED_ORIGINS = new Set([SERVER_ORIGIN]);

function isLocalServer(origin = SERVER_ORIGIN) {
  try {
    const host = new URL(origin).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

// Laboratorio com IP puro: permite getUserMedia em HTTP somente para o servidor escolhido.
// Nao desativa webSecurity e nao libera outras origens.
if (SERVER_ORIGIN.startsWith('http://') && !isLocalServer()) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', SERVER_ORIGIN);
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
let updateWindow = null;
let serverWindow = null;
let tray = null;
let isQuitting = false;
let startupFinished = false;
let updater = null;
let updaterTimer = null;
let pickerWindow = null;
let pickerResolve = null;
let signedManifest = null;
let runtimeUpdateManifest = null;
let runtimeUpdateTimer = null;
let runtimeUpdateChecking = false;
const activeNotifications = new Set();
let taskbarUnreadCount = 0;
let updaterState = {
  title: 'Iniciando Ginga',
  message: 'Preparando o aplicativo...',
  percent: 8,
  detail: `Versao ${app.getVersion()}`,
  currentVersion: app.getVersion(),
  targetVersion: '',
  transferred: 0,
  total: 0,
  bytesPerSecond: 0
};

function isAllowedUrl(value) {
  try {
    return ALLOWED_ORIGINS.has(new URL(value).origin);
  } catch {
    return false;
  }
}

function isLocalFileSender(event) {
  try {
    return event.senderFrame?.url?.startsWith('file://') === true;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function appIconPath(preferIco = false) {
  const assetsDir = path.join(__dirname, '..', 'assets');
  const candidates = preferIco
    ? [path.join(assetsDir, 'icon.ico'), path.join(assetsDir, 'icon.png')]
    : [path.join(assetsDir, 'icon.png'), path.join(assetsDir, 'icon.ico')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function trayIcon() {
  const iconPath = appIconPath(process.platform === 'win32');
  if (iconPath) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) return process.platform === 'win32' ? image : image.resize({ width: 20, height: 20 });
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#171b20"/><path d="M43 21c-3-4-7-6-12-6-10 0-18 8-18 18s8 18 18 18c6 0 11-2 15-6V31H31v7h7v3c-2 1-4 2-7 2-6 0-10-4-10-10s4-10 10-10c3 0 6 1 8 4z" fill="#eef1f2"/><circle cx="47" cy="16" r="4" fill="#b59a62"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 20, height: 20 });
}

function isAllowedRendererSender(event) {
  try {
    return isAllowedUrl(event.senderFrame?.url || '');
  } catch {
    return false;
  }
}

function taskbarBadgeImage(count) {
  if (process.platform !== 'win32') return nativeImage.createEmpty();
  const value = Math.max(1, Math.min(999, Number(count) || 1));
  const label = value > 99 ? '99+' : String(value);
  const fontSize = label.length >= 3 ? 14 : label.length === 2 ? 17 : 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="14" fill="#f23f42" stroke="#ffffff" stroke-width="2"/>
    <text x="16" y="21" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${fontSize}" font-weight="800" fill="#ffffff">${label}</text>
  </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function setTaskbarUnreadCount(nextCount, { flash = false } = {}) {
  taskbarUnreadCount = Math.max(0, Math.min(999, Number(nextCount) || 0));
  if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setOverlayIcon(
        taskbarUnreadCount > 0 ? taskbarBadgeImage(taskbarUnreadCount) : null,
        taskbarUnreadCount > 0 ? `${taskbarUnreadCount} notificacao${taskbarUnreadCount === 1 ? '' : 'es'} nao lida${taskbarUnreadCount === 1 ? '' : 's'}` : ''
      );
      if (taskbarUnreadCount <= 0) mainWindow.flashFrame(false);
      else if (flash && !mainWindow.isFocused()) mainWindow.flashFrame(true);
    } catch {
      // Overlay de taskbar e exclusivo do Windows; falha silenciosa em shells sem suporte.
    }
  }
  try {
    tray?.setToolTip(taskbarUnreadCount > 0 ? `Ginga - ${taskbarUnreadCount} nao lida${taskbarUnreadCount === 1 ? '' : 's'}` : 'Ginga');
  } catch {}
  return taskbarUnreadCount;
}

function incrementTaskbarUnread(payload = {}) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused() && mainWindow.isVisible()) return taskbarUnreadCount;
  const explicit = Number(payload.unreadCount);
  const next = Number.isFinite(explicit) && explicit >= 0 ? explicit : taskbarUnreadCount + 1;
  return setTaskbarUnreadCount(next, { flash: payload.flashTaskbar !== false });
}

function clearTaskbarUnread() {
  return setTaskbarUnreadCount(0);
}

function showNativeNotification(payload = {}) {
  if (payload?.taskbarBadge !== false) incrementTaskbarUnread(payload);
  if (!Notification.isSupported()) return false;
  const title = String(payload.title || 'Ginga').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Ginga';
  const body = String(payload.body || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  const durationMs = Math.max(2500, Math.min(15000, Number(payload.durationMs) || 5000));
  const notification = new Notification({
    title,
    body,
    icon: appIconPath(false) || undefined,
    silent: Boolean(payload.silent),
    timeoutType: 'default'
  });
  activeNotifications.add(notification);
  const cleanup = () => activeNotifications.delete(notification);
  notification.once('close', cleanup);
  notification.once('failed', cleanup);
  notification.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  notification.show();
  setTimeout(() => {
    try { notification.close(); } catch {}
    cleanup();
  }, durationMs);
  return true;
}

function offlineHtml(errorMessage = '') {
  const detail = escapeHtml(errorMessage);
  const server = escapeHtml(SERVER_URL);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Ginga</title>
<style>:root{color-scheme:dark;font-family:Inter,Segoe UI,Arial,sans-serif;background:#0f191f;color:#eff7f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f191f}.card{width:min(620px,calc(100vw - 40px));padding:42px;border:1px solid #294048;border-radius:24px;background:#132229;box-shadow:0 24px 80px #0008}.brand{font-size:15px;letter-spacing:.16em;text-transform:uppercase;color:#64d5c2;font-weight:800}.logo{font-size:34px;margin:10px 0 6px;font-weight:850}p{color:#a9bdc3;line-height:1.55}.detail{font-family:Consolas,monospace;font-size:12px;color:#82969c;word-break:break-word;background:#0c151a;padding:12px;border-radius:10px}.row{display:flex;gap:10px;margin-top:18px}button{border:0;border-radius:12px;padding:12px 18px;background:#64d5c2;color:#071114;font-weight:800;cursor:pointer}.secondary{background:#22343b;color:#dce9e7}</style></head>
<body><main class="card"><div class="brand">Ginga Desktop</div><div class="logo">Servidor indisponivel</div><p>O aplicativo tentou acessar <strong>${server}</strong>, mas o Ginga Server nao respondeu.</p>${detail ? `<div class="detail">${detail}</div>` : ''}<div class="row"><button id="retry">Tentar novamente</button><button class="secondary" id="server">Configurar servidor</button></div><script>document.getElementById('retry').onclick=()=>window.gingaDesktop.retryServer();document.getElementById('server').onclick=()=>window.gingaDesktop.openServerSettings();</script></main></body></html>`;
}

function hardenedWindowOptions(extra = {}) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    navigateOnDragDrop: false,
    safeDialogs: true,
    ...extra
  };
}

function lockNavigation(win, allowData = false) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      void win.loadURL(url);
    } else if (/^https?:/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if ((allowData && url.startsWith('data:')) || isAllowedUrl(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function createUpdateWindow() {
  updateWindow = new BrowserWindow({
    width: 520,
    height: 330,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    alwaysOnTop: true,
    center: true,
    backgroundColor: '#0b0e12',
    webPreferences: hardenedWindowOptions()
  });
  updateWindow.loadFile(path.join(__dirname, 'updater.html'));
  updateWindow.once('ready-to-show', () => {
    updateWindow?.show();
    pushUpdaterState(updaterState);
  });
}

function pushUpdaterState(next) {
  updaterState = { ...updaterState, ...next };
  if (!updateWindow || updateWindow.isDestroyed()) return;
  const serialized = JSON.stringify(updaterState);
  void updateWindow.webContents.executeJavaScript(`window.setUpdateState && window.setUpdateState(${serialized})`).catch(() => {});
}

function closeUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) updateWindow.close();
  updateWindow = null;
}

async function fetchWithTimeout(url, timeoutMs = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
    });
  } finally {
    clearTimeout(timer);
  }
}

function updateKeyFingerprint(publicKey) {
  const key = crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('UPD_KEY_TYPE | A chave publica do updater nao e Ed25519');
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

function updaterError(code, message, detail = '') {
  const error = new Error(`${code} | ${message}${detail ? ` | ${detail}` : ''}`);
  error.code = code;
  return error;
}

function appendUpdaterLog(message) {
  try {
    fs.mkdirSync(path.dirname(UPDATE_LOG_FILE), { recursive: true, mode: 0o700 });
    const line = `[${new Date().toISOString()}] ${String(message).replace(/[\r\n]+/g, ' ')}\n`;
    fs.appendFileSync(UPDATE_LOG_FILE, line, { mode: 0o600 });
    const stat = fs.statSync(UPDATE_LOG_FILE);
    if (stat.size > 512 * 1024) {
      const tail = fs.readFileSync(UPDATE_LOG_FILE).subarray(-256 * 1024);
      fs.writeFileSync(UPDATE_LOG_FILE, tail, { mode: 0o600 });
    }
  } catch {}
}

function logRuntime(message) {
  try {
    fs.mkdirSync(path.dirname(RUNTIME_LOG_FILE), { recursive: true, mode: 0o700 });
    const line = `[${new Date().toISOString()}] ${String(message).replace(/[\r\n]+/g, ' ')}\n`;
    fs.appendFileSync(RUNTIME_LOG_FILE, line, { mode: 0o600 });
    const stat = fs.statSync(RUNTIME_LOG_FILE);
    if (stat.size > 1024 * 1024) {
      const tail = fs.readFileSync(RUNTIME_LOG_FILE).subarray(-512 * 1024);
      fs.writeFileSync(RUNTIME_LOG_FILE, tail, { mode: 0o600 });
    }
  } catch {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testServerUrl(value) {
  const normalized = normalizeServerUrl(value);
  const response = await fetchWithTimeout(`${normalized}/api/health`);
  if (!response.ok) throw new Error(`Servidor respondeu HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  if (!body || body.status !== 'ok' || body.service !== 'ginga-api') throw new Error('O endereco respondeu, mas nao parece ser um Ginga Server');
  return { serverUrl: normalized, version: body.version || 'desconhecida', secure: normalized.startsWith('https://') || isLocalServer(normalized) };
}

async function loadServer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    await testServerUrl(SERVER_URL);
    await mainWindow.loadURL(SERVER_URL);
  } catch (error) {
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlineHtml(error instanceof Error ? error.message : String(error)))}`);
  }
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  let unresponsiveReloadTimer = null;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0b0e12',
    show: false,
    autoHideMenuBar: true,
    frame: process.platform !== 'win32',
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    thickFrame: true,
    roundedCorners: true,
    icon: appIconPath(false) || undefined,
    webPreferences: hardenedWindowOptions({ preload: path.join(__dirname, 'preload.cjs'), backgroundThrottling: false })
  });
  lockNavigation(mainWindow, true);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // O renderer e a fonte da verdade para o contador de nao lidas.
  // Focar/mostrar a janela nao significa que todos os canais foram lidos.
  // Ao focar, apenas interrompemos o pisca da taskbar; o badge numerico continua
  // ate o usuario realmente ler as conversas/canais pendentes.
  mainWindow.on('focus', () => { try { mainWindow?.flashFrame(false); } catch {} });
  mainWindow.webContents.on('did-finish-load', () => sendRuntimeUpdateAvailable());
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logRuntime(`renderer-gone reason=${details.reason} exitCode=${details.exitCode}`);
    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || isQuitting) return;
      void loadServer();
    }, 700);
  });
  mainWindow.webContents.on('unresponsive', () => {
    logRuntime('renderer-unresponsive');
    if (!mainWindow || mainWindow.isDestroyed() || isQuitting) return;
    if (unresponsiveReloadTimer) clearTimeout(unresponsiveReloadTimer);
    unresponsiveReloadTimer = setTimeout(() => {
      unresponsiveReloadTimer = null;
      if (!mainWindow || mainWindow.isDestroyed() || isQuitting) return;
      if (mainWindow.webContents.isLoading()) return;
      logRuntime('renderer-still-unresponsive reloadIgnoringCache=1');
      mainWindow.webContents.reloadIgnoringCache();
    }, 5000);
  });
  mainWindow.webContents.on('responsive', () => {
    logRuntime('renderer-responsive');
    if (unresponsiveReloadTimer) clearTimeout(unresponsiveReloadTimer);
    unresponsiveReloadTimer = null;
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    logRuntime(`did-fail-load code=${errorCode} url=${validatedURL} error=${errorDescription}`);
  });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  void loadServer();
  return mainWindow;
}

function createServerSettingsWindow() {
  if (serverWindow && !serverWindow.isDestroyed()) {
    serverWindow.show();
    serverWindow.focus();
    return serverWindow;
  }
  serverWindow = new BrowserWindow({
    width: 560,
    height: 410,
    resizable: false,
    maximizable: false,
    minimizable: false,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: Boolean(mainWindow && !mainWindow.isDestroyed()),
    backgroundColor: '#0f191f',
    autoHideMenuBar: true,
    webPreferences: hardenedWindowOptions({ preload: path.join(__dirname, 'server-settings-preload.cjs') })
  });
  serverWindow.loadFile(path.join(__dirname, 'server-settings.html'));
  serverWindow.on('closed', () => { serverWindow = null; });
  return serverWindow;
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip('Ginga');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Ginga', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Recarregar servidor', click: () => void loadServer() },
    { label: 'Configurar servidor...', click: () => createServerSettingsWindow() },
    { type: 'separator' },
    { label: 'Sair', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', () => { if (!mainWindow || mainWindow.isDestroyed()) return; mainWindow.show(); mainWindow.focus(); });
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function finishStartup(delay = 0) {
  if (startupFinished) return;
  startupFinished = true;
  if (updaterTimer) clearTimeout(updaterTimer);
  setTimeout(() => {
    closeUpdateWindow();
    createMainWindow();
    createTray();
    startRuntimeUpdateWatcher();
    startGameOverlayWatcher();
  }, delay);
}

function updatePickerState(state) {
  if (!pickerWindow || pickerWindow.isDestroyed()) return;
  const serialized = JSON.stringify(state);
  void pickerWindow.webContents.executeJavaScript(`window.renderSources && window.renderSources(${serialized})`).catch(() => {});
}

async function chooseDisplaySource() {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  });
  if (!sources.length) return null;
  if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();

  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  pickerWindow = new BrowserWindow({
    width: 860,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    parent,
    modal: Boolean(parent),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d171d',
    title: 'Compartilhar tela - Ginga',
    webPreferences: hardenedWindowOptions({ preload: path.join(__dirname, 'screen-picker-preload.cjs') })
  });

  const resultPromise = new Promise((resolve) => { pickerResolve = resolve; });
  const data = sources.map((source) => ({
    id: source.id,
    name: source.name,
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : '',
    icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : ''
  }));

  pickerWindow.loadFile(path.join(__dirname, 'screen-picker.html'));
  pickerWindow.once('ready-to-show', () => {
    pickerWindow?.show();
    updatePickerState({ sources: data, audioSupported: process.platform === 'win32' });
  });
  pickerWindow.on('closed', () => {
    pickerWindow = null;
    if (pickerResolve) {
      const resolve = pickerResolve;
      pickerResolve = null;
      resolve(null);
    }
  });

  const selection = await resultPromise;
  if (!selection || typeof selection.id !== 'string') return null;
  const source = sources.find((item) => item.id === selection.id);
  if (!source) return null;
  return { source, includeAudio: Boolean(selection.includeAudio) };
}

function configurePermissions() {
  const ses = session.defaultSession;
  const allowedPermissions = new Set(['media', 'display-capture', 'notifications', 'fullscreen']);

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return allowedPermissions.has(permission) && isAllowedUrl(requestingOrigin || SERVER_URL);
  });

  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const requestUrl = details?.requestingUrl || details?.securityOrigin || SERVER_URL;
    callback(allowedPermissions.has(permission) && isAllowedUrl(requestUrl));
  });

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!isAllowedUrl(request.securityOrigin || SERVER_URL)) return callback({});
      const selection = await chooseDisplaySource();
      if (!selection) return callback({});
      callback({
        video: selection.source,
        audio: selection.includeAudio && request.audioRequested && process.platform === 'win32' ? 'loopback' : undefined
      });
    } catch {
      callback({});
    }
  });
}

function parseGingaVersion(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?$/);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : []
  };
}

function compareVersions(a, b) {
  const left = parseGingaVersion(a);
  const right = parseGingaVersion(b);
  if (!left || !right) return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
  for (let i = 0; i < 3; i += 1) {
    const diff = left.core[i] - right.core[i];
    if (diff) return diff;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) return Number(l) - Number(r);
    if (lNumeric !== rNumeric) return lNumeric ? -1 : 1;
    return l.localeCompare(r, 'en', { numeric: true, sensitivity: 'base' });
  }
  return 0;
}

function parseLatestUpdateYaml(text) {
  const source = String(text || '');
  const pick = (regex) => {
    const value = source.match(regex)?.[1]?.trim() || '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
    return value;
  };
  return {
    version: pick(/^version:\s*([^\r\n]+)$/m),
    path: pick(/^path:\s*([^\r\n]+)$/m),
    sha512: pick(/^sha512:\s*([^\r\n]+)$/m),
    fileUrl: pick(/^\s*-\s+url:\s*([^\r\n]+)$/m),
    fileSha512: pick(/^\s+sha512:\s*([^\r\n]+)$/m),
    fileSize: Number(pick(/^\s+size:\s*(\d+)$/m) || 0)
  };
}

function assertLatestMatchesManifest(latest, manifest) {
  if (!latest?.version || latest.version !== manifest.version) {
    throw updaterError('UPD_LATEST_VERSION', 'latest.yml nao corresponde ao manifesto assinado', `latest=${latest?.version || 'ausente'} manifest=${manifest.version}`);
  }
  if (latest.path !== manifest.file || (latest.fileUrl && latest.fileUrl !== manifest.file)) {
    throw updaterError('UPD_LATEST_FILE', 'Arquivo do latest.yml nao corresponde ao manifesto assinado', `path=${latest.path || 'ausente'} file=${manifest.file}`);
  }
  if (latest.sha512 !== manifest.sha512 || (latest.fileSha512 && latest.fileSha512 !== manifest.sha512)) {
    throw updaterError('UPD_LATEST_HASH', 'SHA-512 do latest.yml nao corresponde ao manifesto assinado');
  }
  if (latest.fileSize && latest.fileSize !== manifest.size) {
    throw updaterError('UPD_LATEST_SIZE', 'Tamanho do latest.yml nao corresponde ao manifesto assinado', `latest=${latest.fileSize} manifest=${manifest.size}`);
  }
}

async function waitForCoherentUpdateFeed(manifest, attempts = 5) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const latestUrl = new URL('latest.yml', UPDATE_URL);
      latestUrl.searchParams.set('_ginga_update', `${Date.now()}-${attempt}-${Math.random().toString(16).slice(2)}`);
      const response = await fetchWithTimeout(latestUrl.toString(), 8000);
      if (!response.ok) throw updaterError('UPD_LATEST_HTTP', 'latest.yml nao encontrado', `HTTP ${response.status}`);
      const latest = parseLatestUpdateYaml(await response.text());
      assertLatestMatchesManifest(latest, manifest);
      appendUpdaterLog(`feed coerente version=${manifest.version} tentativa=${attempt}/${attempts}`);
      return latest;
    } catch (error) {
      lastError = error;
      appendUpdaterLog(`feed tentativa ${attempt}/${attempts} falhou: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt < attempts) await sleep(400 * attempt);
    }
  }
  throw lastError || updaterError('UPD_FEED_INCONSISTENT', 'Feed de atualizacao inconsistente');
}

async function readSignedUpdateManifest() {
  if (!fs.existsSync(UPDATE_PUBLIC_KEY)) throw updaterError('UPD_KEY_MISSING', 'Chave publica de atualizacao ausente', UPDATE_PUBLIC_KEY);

  const publicKey = fs.readFileSync(UPDATE_PUBLIC_KEY);
  const keyFingerprint = updateKeyFingerprint(publicKey);
  let lastError = null;

  // Tres tentativas evitam falso negativo caso o cliente consulte exatamente
  // durante a troca atomica do feed ou atraves de algum proxy intermediario.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const nonce = `${Date.now()}-${attempt}-${Math.random().toString(16).slice(2)}`;
      const manifestUrl = new URL('manifest.json', UPDATE_URL);
      const signatureUrl = new URL('manifest.sig', UPDATE_URL);
      manifestUrl.searchParams.set('_ginga_update', nonce);
      signatureUrl.searchParams.set('_ginga_update', nonce);

      const [manifestResponse, signatureResponse] = await Promise.all([
        fetchWithTimeout(manifestUrl.toString(), 8000),
        fetchWithTimeout(signatureUrl.toString(), 8000)
      ]);
      if (!manifestResponse.ok || !signatureResponse.ok) {
        throw updaterError('UPD_FEED_HTTP', 'Manifesto assinado nao encontrado', `manifest=${manifestResponse.status} sig=${signatureResponse.status}`);
      }

      const raw = Buffer.from(await manifestResponse.arrayBuffer());
      if (!raw.length || raw.length > 64 * 1024) throw updaterError('UPD_MANIFEST_SIZE', 'Tamanho inesperado do manifest.json', `${raw.length} bytes`);
      const signatureText = (await signatureResponse.text()).trim();
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureText)) throw updaterError('UPD_SIG_FORMAT', 'manifest.sig nao contem Base64 valido');
      const signature = Buffer.from(signatureText, 'base64');
      if (signature.length !== 64) throw updaterError('UPD_SIG_SIZE', 'Assinatura Ed25519 com tamanho invalido', `${signature.length} bytes`);

      if (!crypto.verify(null, raw, publicKey, signature)) {
        const manifestHash = crypto.createHash('sha256').update(raw).digest('hex');
        throw updaterError('UPD_SIG_INVALID', 'Assinatura da atualizacao invalida', `key=${keyFingerprint.slice(0, 16)} manifest=${manifestHash.slice(0, 16)} tentativa=${attempt}/3`);
      }

      let manifest;
      try {
        manifest = JSON.parse(raw.toString('utf8'));
      } catch {
        throw updaterError('UPD_MANIFEST_JSON', 'manifest.json nao e JSON valido');
      }
      if (
        manifest?.schema !== 1 || manifest?.product !== 'Ginga' || manifest?.platform !== 'win32-x64' ||
        !/^(?:\d+)\.(?:\d+)\.(?:\d+)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(manifest?.version || '') ||
        manifest?.file !== `Ginga-Setup-${manifest.version}-x64.exe` ||
        !Number.isSafeInteger(manifest?.size) || manifest.size <= 0 ||
        typeof manifest?.sha512 !== 'string' || Buffer.from(manifest.sha512, 'base64').length !== 64
      ) throw updaterError('UPD_MANIFEST_SCHEMA', 'Manifesto de atualizacao invalido');
      if (manifest.releaseNotes != null && (typeof manifest.releaseNotes !== 'string' || manifest.releaseNotes.length > 12000)) throw updaterError('UPD_MANIFEST_NOTES', 'Notas de versao invalidas');
      if (manifest.keyFingerprint && manifest.keyFingerprint !== keyFingerprint) {
        throw updaterError('UPD_KEY_FINGERPRINT', 'Manifesto foi assinado para outra chave publica', `cliente=${keyFingerprint.slice(0, 16)} release=${String(manifest.keyFingerprint).slice(0, 16)}`);
      }

      appendUpdaterLog(`manifest OK version=${manifest.version} key=${keyFingerprint}`);
      return manifest;
    } catch (error) {
      lastError = error;
      appendUpdaterLog(`manifest tentativa ${attempt}/3 falhou: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt < 3) await sleep(250 * attempt);
    }
  }

  throw lastError || updaterError('UPD_UNKNOWN', 'Falha desconhecida ao validar atualizacao');
}


function sendRuntimeUpdateAvailable() {
  if (!runtimeUpdateManifest || !mainWindow || mainWindow.isDestroyed()) return;
  if (compareVersions(runtimeUpdateManifest.version, app.getVersion()) <= 0) return;
  mainWindow.webContents.send('ginga:update-available', {
    version: runtimeUpdateManifest.version,
    currentVersion: app.getVersion(),
    size: Number(runtimeUpdateManifest.size || 0)
  });
}

async function checkRuntimeUpdate() {
  if (!startupFinished || runtimeUpdateChecking || !app.isPackaged || process.platform !== 'win32') return { available: false };
  if (process.env.GINGA_SKIP_UPDATE === '1' || process.env.NEXORA_SKIP_UPDATE === '1') return { available: false };
  runtimeUpdateChecking = true;
  try {
    const manifest = await readSignedUpdateManifest();
    const channel = readUpdateChannel();
    if (!manifestAllowedForChannel(manifest, channel)) { runtimeUpdateManifest=null; return { available:false,currentVersion:app.getVersion(),channel,skippedPrerelease:true,latestVersion:manifest.version }; }
    if (compareVersions(manifest.version, app.getVersion()) > 0) { runtimeUpdateManifest=manifest;sendRuntimeUpdateAvailable();return { available:true,version:manifest.version,currentVersion:app.getVersion(),channel,releaseNotes:String(manifest.releaseNotes||'') }; }
    runtimeUpdateManifest=null;return { available:false,currentVersion:app.getVersion(),channel };
  } catch (error) {
    appendUpdaterLog(`watcher falhou: ${error instanceof Error ? error.message : String(error)}`);
    // Verificacao em background e silenciosa. O updater completo valida novamente
    // assinatura e SHA-512 quando o usuario reiniciar.
    return { available: false, currentVersion: app.getVersion() };
  } finally {
    runtimeUpdateChecking = false;
  }
}

function startRuntimeUpdateWatcher() {
  if (!app.isPackaged || process.platform !== 'win32' || runtimeUpdateTimer) return;
  setTimeout(() => void checkRuntimeUpdate(), RUNTIME_UPDATE_INITIAL_DELAY_MS).unref?.();
  runtimeUpdateTimer = setInterval(() => void checkRuntimeUpdate(), RUNTIME_UPDATE_INTERVAL_MS);
  runtimeUpdateTimer.unref?.();
}

function sha512File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

async function configureUpdater() {
  createUpdateWindow();

  if (!app.isPackaged || process.platform !== 'win32' || process.env.GINGA_SKIP_UPDATE === '1' || process.env.NEXORA_SKIP_UPDATE === '1') {
    pushUpdaterState({ title: 'Abrindo Ginga', message: 'Modo de desenvolvimento.', percent: 100, detail: `Versao ${app.getVersion()}` });
    finishStartup(350);
    return;
  }

  try {
    pushUpdaterState({ title: 'Verificando atualizacoes', message: 'Buscando a versao mais recente...', percent: 18, detail: 'O Ginga sempre atualiza direto para o release mais novo publicado.', currentVersion: app.getVersion() });
    signedManifest = await readSignedUpdateManifest();
    const updateChannel = readUpdateChannel();
    if (!manifestAllowedForChannel(signedManifest, updateChannel)) {
      appendUpdaterLog(`release ${signedManifest.version} ignorada pelo canal ${updateChannel}`);
      pushUpdaterState({ title: 'Canal estavel', message: 'Existe uma versao beta publicada, mas este cliente esta no canal estavel.', percent: 100, detail: `Versao atual ${app.getVersion()} | beta ${signedManifest.version}`, currentVersion: app.getVersion(), targetVersion: '' });
      finishStartup(650);
      return;
    }
    if (compareVersions(signedManifest.version, app.getVersion()) <= 0) {
      pushUpdaterState({ title: 'Ginga atualizado', message: 'Voce ja esta na versao mais recente.', percent: 100, detail: `Versao ${app.getVersion()}`, currentVersion: app.getVersion(), targetVersion: app.getVersion() });
      finishStartup(450);
      return;
    }
    // O manifesto assinado e o latest.yml precisam descrever exatamente o mesmo
    // instalador antes do electron-updater entrar em cena. Isso elimina falso
    // "Atualizacao inconsistente" durante troca/publicacao do feed.
    await waitForCoherentUpdateFeed(signedManifest);
  } catch (error) {
    appendUpdaterLog(`startup bloqueou update: ${error instanceof Error ? error.message : String(error)}`);
    const code = String(error?.code || '');
    const feedUnavailable = code === 'UPD_FEED_HTTP' || code === 'UPD_LATEST_HTTP' || error?.name === 'AbortError';
    if (feedUnavailable) {
      pushUpdaterState({ title: 'Servidor de atualizacao indisponivel', message: 'Nao foi possivel consultar atualizacoes agora. Abrindo o Ginga normalmente.', percent: 100, detail: error instanceof Error ? error.message : String(error) });
    } else {
      pushUpdaterState({ title: 'Atualizacao nao validada', message: 'O feed nao passou na verificacao criptografica. Nenhum pacote foi instalado.', percent: 100, detail: error instanceof Error ? error.message : String(error) });
    }
    finishStartup(800);
    return;
  }

  updater = new NsisUpdater({ provider: 'generic', url: UPDATE_URL, channel: 'latest' });
  // Ginga usa um unico feed assinado. Forca latest.yml mesmo em builds beta e
  // desliga cache intermediario para o metadata consultado pelo electron-updater.
  updater.channel = 'latest';
  updater.requestHeaders = { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' };
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = true;
  // A ordem oficial do Ginga e validada por compareVersions + manifesto Ed25519.
  // Isto tambem cobre a nomenclatura legada 1.7.5-9beta -> 1.7.5-10beta, que o
  // SemVer puro do electron-updater ordena lexicalmente ao contrario.
  updater.allowDowngrade = true;

  updater.on('checking-for-update', () => {
    pushUpdaterState({ title: 'Verificando atualizacoes', message: 'Confirmando o pacote mais recente...', percent: 24, detail: `Atualizacao direta ${app.getVersion()} -> ${signedManifest.version}`, currentVersion: app.getVersion(), targetVersion: signedManifest.version });
  });

  updater.on('update-available', async (info) => {
    try {
      const files = Array.isArray(info.files) ? info.files : [];
      // O manifesto assinado e a fonte de verdade. Um cliente antigo nao instala
      // releases intermediarios: baixa direto a versao mais recente assinada.
      const matchesSignedManifest = info.version === signedManifest.version && files.some((file) => file.sha512 === signedManifest.sha512);
      if (!matchesSignedManifest) throw new Error('latest.yml nao corresponde ao manifesto assinado mais recente');
      if (updaterTimer) clearTimeout(updaterTimer);
      updaterTimer = setTimeout(() => {
        pushUpdaterState({ title: 'Download pausado', message: 'A atualizacao ficou sem progresso por muito tempo.', percent: updaterState.percent, detail: 'Abrindo o Ginga sem instalar pacote incompleto.' });
        finishStartup(850);
      }, UPDATE_STALL_TIMEOUT_MS);
      pushUpdaterState({
        title: 'Atualizacao encontrada',
        message: `Atualizando direto para o Ginga ${info.version}`,
        percent: 0,
        detail: `${app.getVersion()} -> ${info.version} | pacote autenticado`,
        currentVersion: app.getVersion(),
        targetVersion: info.version,
        transferred: 0,
        total: Number(files[0]?.size || signedManifest.size || 0),
        bytesPerSecond: 0
      });
      await updater.downloadUpdate();
    } catch (error) {
      pushUpdaterState({ title: 'Atualizacao bloqueada', message: 'O pacote nao corresponde ao manifesto assinado.', percent: 100, detail: error instanceof Error ? error.message : String(error) });
      finishStartup(1200);
    }
  });

  updater.on('download-progress', (progress) => {
    if (updaterTimer) clearTimeout(updaterTimer);
    updaterTimer = setTimeout(() => {
      pushUpdaterState({ title: 'Download pausado', message: 'A atualizacao ficou sem progresso por muito tempo.', percent: updaterState.percent, detail: 'Abrindo o Ginga sem instalar pacote incompleto.' });
      finishStartup(850);
    }, UPDATE_STALL_TIMEOUT_MS);
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
    pushUpdaterState({
      title: 'Atualizando Ginga',
      message: `Baixando Ginga ${signedManifest.version}`,
      percent,
      detail: 'Download seguro em andamento',
      currentVersion: app.getVersion(),
      targetVersion: signedManifest.version,
      transferred: Number(progress.transferred || 0),
      total: Number(progress.total || 0),
      bytesPerSecond: Number(progress.bytesPerSecond || 0)
    });
  });

  updater.on('update-downloaded', async (info) => {
    try {
      if (!info.downloadedFile) throw new Error('Caminho do pacote baixado indisponivel');
      const actualHash = await sha512File(info.downloadedFile);
      if (actualHash !== signedManifest.sha512) throw new Error('SHA-512 do instalador nao confere');
      pushUpdaterState({ title: 'Atualizacao pronta', message: `Instalando Ginga ${info.version}...`, percent: 100, detail: 'Download concluido e SHA-512 confirmado. Reiniciando...', currentVersion: app.getVersion(), targetVersion: info.version, bytesPerSecond: 0 });
      if (updaterTimer) clearTimeout(updaterTimer);
      setTimeout(() => {
        isQuitting = true;
        updater.quitAndInstall(true, true);
      }, 900);
    } catch (error) {
      pushUpdaterState({ title: 'Atualizacao bloqueada', message: 'Falha na validacao final do instalador.', percent: 100, detail: error instanceof Error ? error.message : String(error) });
      finishStartup(1200);
    }
  });

  let consistencyRetryCount = 0;
  updater.on('update-not-available', (info) => {
    const feedVersion = String(info?.version || 'desconhecida');
    const currentVersion = app.getVersion();
    appendUpdaterLog(`electron-updater not-available current=${currentVersion} signed=${signedManifest?.version || '-'} latest=${feedVersion} retry=${consistencyRetryCount}`);

    // Se o manifesto assinado continua indicando uma versao mais nova, uma
    // resposta not-available pode ser metadata antiga chegando no exato momento
    // da troca do feed. Reconsulta antes de classificar como inconsistencia.
    if (signedManifest && compareVersions(signedManifest.version, currentVersion) > 0 && consistencyRetryCount < 2) {
      consistencyRetryCount += 1;
      pushUpdaterState({ title: 'Sincronizando atualizacao', message: 'O servidor ainda esta propagando os arquivos da release...', percent: 35, detail: `Tentativa ${consistencyRetryCount + 1}/3 | ${currentVersion} -> ${signedManifest.version}`, currentVersion, targetVersion: signedManifest.version });
      setTimeout(() => {
        void waitForCoherentUpdateFeed(signedManifest, 3)
          .then(() => updater.checkForUpdates())
          .catch((error) => {
            appendUpdaterLog(`retry de consistencia falhou: ${error instanceof Error ? error.message : String(error)}`);
            pushUpdaterState({ title: 'Atualizacao nao validada', message: 'O feed ainda nao esta consistente. O Ginga sera aberto sem instalar nada.', percent: 100, detail: error instanceof Error ? error.message : String(error) });
            finishStartup(900);
          });
      }, 700 * consistencyRetryCount);
      return;
    }

    const detail = `cliente=${currentVersion} | manifesto=${signedManifest?.version || '-'} | latest=${feedVersion}`;
    pushUpdaterState({ title: 'Atualizacao inconsistente', message: 'O manifesto assinado e o metadata do updater nao concordaram apos novas tentativas.', percent: 100, detail });
    finishStartup(900);
  });

  updater.on('error', (error) => {
    pushUpdaterState({ title: 'Servidor de atualizacao indisponivel', message: 'Nao foi possivel atualizar agora. Abrindo o Ginga normalmente.', percent: 100, detail: error?.message || 'Falha ao consultar atualizacoes.' });
    finishStartup(900);
  });

  updaterTimer = setTimeout(() => {
    pushUpdaterState({ title: 'Continuando inicializacao', message: 'A verificacao demorou demais. Abrindo o Ginga.', percent: 100, detail: 'Nenhum pacote nao validado sera instalado.' });
    finishStartup(650);
  }, UPDATE_TIMEOUT_MS);

  void updater.checkForUpdates().catch((error) => {
    pushUpdaterState({ title: 'Servidor de atualizacao indisponivel', message: 'Nao foi possivel verificar agora. Abrindo o Ginga normalmente.', percent: 100, detail: error instanceof Error ? error.message : String(error) });
    finishStartup(900);
  });
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!startupFinished) {
      updateWindow?.show();
      updateWindow?.focus();
      return;
    }
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setName('Ginga');
    app.setAppUserModelId(APP_ID);
    configurePermissions();

    ipcMain.on('ginga:session-read-sync', (event) => {
      if (!isAllowedRendererSender(event)) { event.returnValue = ''; return; }
      event.returnValue = readSecureSessionToken();
    });
    ipcMain.on('ginga:session-write-sync', (event, token) => {
      if (!isAllowedRendererSender(event)) { event.returnValue = false; return; }
      try { event.returnValue = writeSecureSessionToken(token); } catch { event.returnValue = false; }
    });
    ipcMain.handle('ginga:open-external-path', async (event, relativePath) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      const allowed = new Set(['/register', '/reset-password']);
      const next = allowed.has(String(relativePath || '')) ? String(relativePath) : '/';
      await shell.openExternal(new URL(next, `${SERVER_URL}/`).toString());
      return true;
    });
    ipcMain.handle('ginga:runtime-log', async (event, payload) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      const message = typeof payload === 'string'
        ? payload
        : JSON.stringify(payload ?? {});
      logRuntime(`renderer ${String(message).slice(0, 8000)}`);
      return true;
    });
    ipcMain.handle('ginga:retry-server', async () => { await loadServer(); return true; });
    ipcMain.handle('ginga:show-window', async () => { mainWindow?.show(); mainWindow?.focus(); return true; });
    ipcMain.handle('ginga:window-minimize', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
      return true;
    });
    ipcMain.handle('ginga:window-toggle-maximize', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      if (!mainWindow || mainWindow.isDestroyed()) return { maximized: false };
      if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
      return { maximized: mainWindow.isMaximized() };
    });
    ipcMain.handle('ginga:window-close', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      return true;
    });
    ipcMain.handle('ginga:window-state', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      return { maximized: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()) };
    });
    ipcMain.handle('ginga:detect-game', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      return detectGameActivity();
    });
    ipcMain.handle('ginga:game-overlay-settings-get', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      return gameOverlaySettings;
    });
    ipcMain.handle('ginga:game-overlay-settings-set', async (event, settings) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      return saveGameOverlaySettings(settings);
    });
    ipcMain.handle('ginga:game-overlay-state', async (event, state) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      gameOverlayVoiceState = state?.voice && typeof state.voice === 'object' ? state.voice : null;
      renderGameOverlay();
      return true;
    });
    ipcMain.handle('ginga:game-overlay-preview', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      return previewGameOverlayWindow();
    });
    ipcMain.handle('ginga:check-runtime-update', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      return checkRuntimeUpdate();
    });
    ipcMain.handle('ginga:update-channel-get', async (event) => { if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida'); return { channel: readUpdateChannel() }; });
    ipcMain.handle('ginga:update-channel-set', async (event, channel) => { if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida'); const saved=saveUpdateChannel(channel);runtimeUpdateManifest=null;const result=await checkRuntimeUpdate();return { channel:saved,...result }; });
    ipcMain.handle('ginga:restart-to-update', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      const result = await checkRuntimeUpdate();
      if (!result.available && !runtimeUpdateManifest) return { restarting: false };
      setTimeout(() => {
        isQuitting = true;
        app.relaunch();
        app.exit(0);
      }, 180);
      return { restarting: true, version: runtimeUpdateManifest?.version || result.version };
    });
    ipcMain.handle('ginga:server-url', async () => SERVER_URL);
    ipcMain.handle('ginga:open-server-settings', async () => { createServerSettingsWindow(); return true; });
    ipcMain.handle('ginga:notify', async (event, payload) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      return showNativeNotification(payload);
    });
    ipcMain.handle('ginga:taskbar-badge', async (event, count) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      return setTaskbarUnreadCount(count, { flash: Number(count) > 0 });
    });
    ipcMain.handle('ginga:taskbar-badge-clear', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      return clearTaskbarUnread();
    });
    ipcMain.handle('ginga:server-settings-get', async (event) => {
      if (!isLocalFileSender(event)) throw new Error('Origem IPC nao permitida');
      return { serverUrl: SERVER_URL, secure: SERVER_URL.startsWith('https://') || isLocalServer() };
    });
    ipcMain.handle('ginga:server-settings-test', async (event, value) => {
      if (!isLocalFileSender(event)) throw new Error('Origem IPC nao permitida');
      return testServerUrl(value);
    });
    ipcMain.handle('ginga:server-settings-save', async (event, value) => {
      if (!isLocalFileSender(event)) throw new Error('Origem IPC nao permitida');
      const normalized = saveServerUrl(value);
      setTimeout(() => {
        isQuitting = true;
        app.relaunch();
        app.exit(0);
      }, 350);
      return { serverUrl: normalized, restarting: true };
    });
    ipcMain.handle('ginga:screen-source-selected', async (event, selection) => {
      if (!isLocalFileSender(event) || !pickerResolve) return false;
      const resolve = pickerResolve;
      pickerResolve = null;
      resolve(selection && typeof selection.id === 'string' ? selection : null);
      pickerWindow?.close();
      return true;
    });
    ipcMain.handle('ginga:screen-source-cancelled', async (event) => {
      if (!isLocalFileSender(event)) return false;
      if (pickerResolve) {
        const resolve = pickerResolve;
        pickerResolve = null;
        resolve(null);
      }
      pickerWindow?.close();
      return true;
    });

    void configureUpdater();
  });
}

app.on('activate', () => {
  if (!startupFinished) {
    updateWindow?.show();
    return;
  }
  if (!mainWindow) createMainWindow();
  else mainWindow.show();
});

app.on('before-quit', () => { isQuitting = true; if (runtimeUpdateTimer) clearInterval(runtimeUpdateTimer); if (gameOverlayPollTimer) clearInterval(gameOverlayPollTimer); if (gameOverlayPreviewTimer) clearTimeout(gameOverlayPreviewTimer); try { globalShortcut.unregisterAll(); } catch {} });
app.on('window-all-closed', () => {
  // Mantem o processo vivo na bandeja. O encerramento real ocorre em "Sair".
});
