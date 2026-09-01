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
const { fileURLToPath } = require('node:url');
const { execFile } = require('node:child_process');
const BRAND = require('./brand.cjs');

const APP_ID = BRAND.appId;
const FALLBACK_SERVER_URL = 'http://127.0.0.1';
const UPDATE_TIMEOUT_MS = 15000;
const UPDATE_STALL_TIMEOUT_MS = 120000;
const HEALTH_TIMEOUT_MS = 6000;
const RUNTIME_UPDATE_INITIAL_DELAY_MS = 15000;
const RUNTIME_UPDATE_INTERVAL_MS = 120000;
const UPDATE_PUBLIC_KEY = path.join(__dirname, '..', 'update-public.pem');

function configBaseDir() {
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, BRAND.configDirectoryName);
  return path.join(os.homedir(), '.config', BRAND.configDirectoryName);
}


const LEGACY_USER_SERVER_CONFIG = path.join(configBaseDir(), 'server.json');
const USER_SESSION_FILE = path.join(configBaseDir(), 'session.bin');
const UPDATE_LOG_FILE = path.join(configBaseDir(), 'logs', 'updater.log');
const USER_UPDATE_CONFIG = path.join(configBaseDir(), 'update.json');
const USER_GAME_OVERLAY_CONFIG = path.join(configBaseDir(), 'game-overlay.json');
const USER_DESKTOP_CONFIG = path.join(configBaseDir(), 'desktop.json');
const USER_WINDOW_STATE_CONFIG = path.join(configBaseDir(), 'window-state.json');
const RUNTIME_LOG_FILE = path.join(configBaseDir(), 'logs', 'runtime.log');
const DEEP_LINK_SCHEME = 'ginga';
let pendingDeepLink = '';
let lastCrashReportAt = 0;

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
  // Consultamos apenas executaveis de jogos conhecidos. Para posicionar a
  // sobreposicao no monitor correto, lemos somente o retangulo da janela do
  // jogo reconhecido e se ela e a janela em primeiro plano. Nenhuma lista de
  // processos e enviada ao renderer/servidor.
  const command = [
    '$ErrorActionPreference = "SilentlyContinue"',
    `Add-Type -TypeDefinition @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class GingaOverlayNative {\n  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }\n  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);\n  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();\n}\n'@`,
    `$known = @(${powershellNames})`,
    '$foreground = [GingaOverlayNative]::GetForegroundWindow()',
    '$items = @()',
    'Get-Process -Name $known -ErrorAction SilentlyContinue | ForEach-Object {',
    '  $handle = $_.MainWindowHandle',
    '  $bounds = $null',
    '  if ($handle -ne 0) {',
    "    $rect = New-Object 'GingaOverlayNative+RECT'",
    '    if ([GingaOverlayNative]::GetWindowRect($handle, [ref]$rect)) {',
    '      $width = [Math]::Max(0, $rect.Right - $rect.Left)',
    '      $height = [Math]::Max(0, $rect.Bottom - $rect.Top)',
    '      if ($width -gt 240 -and $height -gt 160) { $bounds = [ordered]@{ x=$rect.Left; y=$rect.Top; width=$width; height=$height } }',
    '    }',
    '  }',
    '  $items += [pscustomobject]@{ processName=$_.ProcessName; pid=$_.Id; foreground=($handle -ne 0 -and $handle -eq $foreground); hasWindow=($null -ne $bounds); bounds=$bounds }',
    '}',
    '$items | ConvertTo-Json -Compress -Depth 4'
  ].join('\n');
  try {
    const stdout = await execFileText('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', command
    ], { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 });
    const parsed = stdout.trim() ? JSON.parse(stdout.trim()) : [];
    const entries = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const processName = String(entry.processName || '').trim();
      const gameName = KNOWN_GAME_PROCESSES.get(processName.toLowerCase());
      if (!gameName) return [];
      const rawBounds = entry.bounds && typeof entry.bounds === 'object' ? entry.bounds : null;
      const bounds = rawBounds ? {
        x: Number(rawBounds.x) || 0,
        y: Number(rawBounds.y) || 0,
        width: Math.max(0, Number(rawBounds.width) || 0),
        height: Math.max(0, Number(rawBounds.height) || 0)
      } : null;
      return [{
        name: gameName,
        processName,
        pid: Number(entry.pid) || 0,
        foreground: Boolean(entry.foreground),
        hasWindow: Boolean(entry.hasWindow && bounds && bounds.width > 0 && bounds.height > 0),
        bounds,
        detectedAt: new Date().toISOString()
      }];
    });
    entries.sort((a, b) => Number(b.foreground) - Number(a.foreground) || Number(b.hasWindow) - Number(a.hasWindow) || a.name.localeCompare(b.name));
    return { supported: true, activity: entries[0] || null };
  } catch (error) {
    return { supported: true, activity: null, error: error instanceof Error ? error.message : 'Falha ao detectar jogo' };
  }
}

function publicDetectedGame(result) {
  const activity = result?.activity;
  return {
    supported: result?.supported !== false,
    activity: activity?.name ? {
      name: String(activity.name),
      detectedAt: String(activity.detectedAt || new Date().toISOString()),
      focused: activity.foreground !== false,
      windowDetected: Boolean(activity.hasWindow)
    } : null,
    ...(result?.error ? { error: String(result.error) } : {})
  };
}



let gameDetectionCacheAt = 0;
let gameDetectionCache = { supported: process.platform === 'win32', activity: null };
let gameDetectionInFlight = null;
async function detectGameActivity() {
  const now = Date.now();
  if (now - gameDetectionCacheAt < 1200) return gameDetectionCache;
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
let gameOverlayShortcutRegistered = false;

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
  if (gameOverlaySettings.enabled) void refreshGameOverlayDetection();
  return gameOverlaySettings;
}

function createGameOverlayWindow() {
  if (gameOverlayWindow && !gameOverlayWindow.isDestroyed()) return gameOverlayWindow;
  if (!app.isReady()) return null;
  gameOverlayWindow = new BrowserWindow({
    width: 380,
    height: 380,
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
  try { gameOverlayWindow.setAlwaysOnTop(true, 'screen-saver', 1); } catch { gameOverlayWindow.setAlwaysOnTop(true); }
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
  const [width, height] = win.getSize();
  const gameBounds = gameOverlayDetectedActivity?.hasWindow && gameOverlayDetectedActivity?.bounds
    ? gameOverlayDetectedActivity.bounds
    : null;
  let area;
  if (gameBounds && gameBounds.width >= width && gameBounds.height >= 180) {
    area = gameBounds;
  } else {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    area = display.workArea;
  }
  const margin = gameBounds ? 22 : 18;
  const right = gameOverlaySettings.position.endsWith('right');
  const bottom = gameOverlaySettings.position.startsWith('bottom');
  let x = right ? area.x + area.width - width - margin : area.x + margin;
  let y = bottom ? area.y + area.height - height - margin : area.y + margin;
  try {
    const display = screen.getDisplayMatching({ x: Math.round(area.x), y: Math.round(area.y), width: Math.max(1, Math.round(area.width)), height: Math.max(1, Math.round(area.height)) });
    const bounds = display.bounds;
    x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - width));
    y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - height));
  } catch {}
  win.setPosition(Math.round(x), Math.round(y), false);
}

function reinforceGameOverlayWindow() {
  const win = gameOverlayWindow;
  if (!win || win.isDestroyed()) return;
  try { win.setIgnoreMouseEvents(true, { forward: true }); } catch {}
  try { win.setAlwaysOnTop(true, 'screen-saver', 1); } catch { try { win.setAlwaysOnTop(true); } catch {} }
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  try { win.moveTop(); } catch {}
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
      { identity: 'you', name: 'Você', speaking: false, microphoneEnabled: true, deafened: false, cameraEnabled: true, screenShareEnabled: false, avatarUrl: null, local: true },
      { identity: 'friend', name: 'Amigo', speaking: true, microphoneEnabled: true, deafened: false, cameraEnabled: false, screenShareEnabled: true, avatarUrl: null, local: false },
      { identity: 'friend2', name: 'Squad', speaking: false, microphoneEnabled: false, deafened: true, cameraEnabled: false, screenShareEnabled: false, avatarUrl: null, local: false }
    ]
  } : gameOverlayVoiceState;
  return {
    settings: gameOverlaySettings,
    game: preview ? { name: 'Jogo detectado', detectedAt: new Date().toISOString(), focused: true, windowDetected: true } : publicDetectedGame({ supported: true, activity: gameOverlayDetectedActivity }).activity,
    voice,
    preview
  };
}

function shouldShowGameOverlay(preview = false) {
  if (preview) return true;
  if (!gameOverlaySettings.enabled || gameOverlayManualHidden || !gameOverlayDetectedActivity?.name) return false;
  // Nao deixe a camada flutuando sobre navegador/desktop quando o usuario
  // deu Alt+Tab. Se o jogo possui janela detectavel, a overlay acompanha o
  // foco e volta automaticamente ao retornar para o jogo.
  if (gameOverlayDetectedActivity.hasWindow && gameOverlayDetectedActivity.foreground === false) return false;
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
  reinforceGameOverlayWindow();
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
  // 2,5 s deixa Alt+Tab/retorno ao jogo perceptivelmente rapido sem manter
  // uma consulta PowerShell agressiva em segundo plano.
  gameOverlayPollTimer = setInterval(() => void refreshGameOverlayDetection(), 2500);
  gameOverlayPollTimer.unref?.();
  try {
    globalShortcut.unregister('CommandOrControl+Shift+O');
    gameOverlayShortcutRegistered = globalShortcut.register('CommandOrControl+Shift+O', () => {
      if (!gameOverlayDetectedActivity?.name) {
        // Sem jogo, o atalho serve como teste rapido de 3 segundos.
        previewGameOverlayWindow(3000);
        return;
      }
      gameOverlayManualHidden = !gameOverlayManualHidden;
      renderGameOverlay();
    });
    if (!gameOverlayShortcutRegistered) logRuntime('overlay-shortcut registration=failed');
  } catch (error) {
    gameOverlayShortcutRegistered = false;
    logRuntime(`overlay-shortcut error=${error instanceof Error ? error.message : String(error)}`);
  }
}

function gameOverlayRuntimeStatus() {
  let reason = 'ready';
  if (process.platform !== 'win32') reason = 'unsupported_platform';
  else if (!gameOverlaySettings.enabled) reason = 'disabled';
  else if (!gameOverlayDetectedActivity?.name) reason = 'game_not_detected';
  else if (gameOverlayDetectedActivity.hasWindow && gameOverlayDetectedActivity.foreground === false) reason = 'game_not_focused';
  else if (gameOverlayManualHidden) reason = 'manual_hidden';
  else if (gameOverlaySettings.showOnlyInVoice && !gameOverlayVoiceState?.connected) reason = 'voice_required';
  return {
    supported: process.platform === 'win32',
    enabled: gameOverlaySettings.enabled,
    visible: Boolean(gameOverlayWindow && !gameOverlayWindow.isDestroyed() && gameOverlayWindow.isVisible()),
    shortcutRegistered: gameOverlayShortcutRegistered,
    reason,
    detectedGame: publicDetectedGame({ supported: process.platform === 'win32', activity: gameOverlayDetectedActivity }).activity
  };
}

function previewGameOverlayWindow(durationMs = 5000) {
  if (gameOverlayPreviewTimer) clearTimeout(gameOverlayPreviewTimer);
  createGameOverlayWindow();
  renderGameOverlay({ preview: true });
  gameOverlayPreviewTimer = setTimeout(() => {
    gameOverlayPreviewTimer = null;
    renderGameOverlay();
  }, Math.max(1500, Math.min(15000, Number(durationMs) || 5000)));
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

function defaultUpdateChannel() { return String(app.getVersion() || '').includes('-') ? 'beta' : 'stable'; }
function readUpdateChannel() { const forced=String(process.env.GINGA_UPDATE_CHANNEL||'').trim().toLowerCase();if(forced==='stable'||forced==='beta')return forced;try{const parsed=JSON.parse(fs.readFileSync(USER_UPDATE_CONFIG,'utf8'));return parsed?.channel==='stable'||parsed?.channel==='beta'?parsed.channel:defaultUpdateChannel();}catch{return defaultUpdateChannel();} }
function saveUpdateChannel(channel) { const normalized=String(channel||'').trim().toLowerCase();if(!['stable','beta'].includes(normalized))throw new Error('Canal de atualizacao invalido');fs.mkdirSync(path.dirname(USER_UPDATE_CONFIG),{recursive:true,mode:0o700});fs.writeFileSync(USER_UPDATE_CONFIG,JSON.stringify({channel:normalized},null,2),{mode:0o600});return normalized; }
function manifestAllowedForChannel(manifest,channel=readUpdateChannel()){return channel==='beta'||!String(manifest?.version||'').includes('-');}

const DEFAULT_DESKTOP_PREFERENCES = Object.freeze({ startMinimized: false });
function readDesktopPreferences() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USER_DESKTOP_CONFIG, 'utf8'));
    return { startMinimized: Boolean(parsed?.startMinimized) };
  } catch {
    return { ...DEFAULT_DESKTOP_PREFERENCES };
  }
}
function saveDesktopPreferences(next = {}) {
  const current = readDesktopPreferences();
  const saved = { ...current, ...next, startMinimized: Boolean(next.startMinimized ?? current.startMinimized) };
  fs.mkdirSync(path.dirname(USER_DESKTOP_CONFIG), { recursive: true, mode: 0o700 });
  fs.writeFileSync(USER_DESKTOP_CONFIG, JSON.stringify(saved, null, 2), { mode: 0o600 });
  return saved;
}
function readWindowState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USER_WINDOW_STATE_CONFIG, 'utf8'));
    const bounds = parsed?.bounds;
    if (!bounds || ![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite)) return null;
    return { bounds: { x:Math.round(bounds.x), y:Math.round(bounds.y), width:Math.round(bounds.width), height:Math.round(bounds.height) }, maximized:Boolean(parsed.maximized) };
  } catch { return null; }
}
function boundsVisibleOnAnyDisplay(bounds) {
  try {
    return screen.getAllDisplays().some((display) => {
      const a = display.workArea;
      const overlapW = Math.max(0, Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x));
      const overlapH = Math.max(0, Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y));
      return overlapW >= 120 && overlapH >= 80;
    });
  } catch { return false; }
}
function clampWindowBounds(bounds, minWidth, minHeight) {
  if (!bounds || !boundsVisibleOnAnyDisplay(bounds)) return null;
  try {
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const width = Math.min(area.width, Math.max(Math.min(minWidth, area.width), Math.round(bounds.width)));
    const height = Math.min(area.height, Math.max(Math.min(minHeight, area.height), Math.round(bounds.height)));
    const x = Math.min(area.x + area.width - width, Math.max(area.x, Math.round(bounds.x)));
    const y = Math.min(area.y + area.height - height, Math.max(area.y, Math.round(bounds.y)));
    return { x, y, width, height };
  } catch {
    return null;
  }
}

function persistWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const maximized = mainWindow.isMaximized();
    const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    fs.mkdirSync(path.dirname(USER_WINDOW_STATE_CONFIG), { recursive: true, mode: 0o700 });
    fs.writeFileSync(USER_WINDOW_STATE_CONFIG, JSON.stringify({ bounds, maximized }, null, 2), { mode: 0o600 });
  } catch (error) {
    logRuntime(`window-state-save error=${error instanceof Error ? error.message : String(error)}`);
  }
}

const SERVER_URL = normalizeServerUrl(
  process.env.GINGA_SERVER_URL || readEmbeddedServerUrl()
);
const SERVER_ORIGIN = new URL(SERVER_URL).origin;
const UPDATE_URL = new URL('/updates/windows/', `${SERVER_URL}/`).toString();
const ALLOWED_ORIGINS = new Set([SERVER_ORIGIN]);

// Builds antigos permitiam salvar um servidor por usuario. Isso fazia uma
// instalacao nova continuar presa a IPs/domínios antigos. O cliente oficial
// agora usa exclusivamente a URL embutida no build (ou GINGA_SERVER_URL).
try { fs.rmSync(LEGACY_USER_SERVER_CONFIG, { force: true }); } catch {}

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

// Hardware acceleration remains enabled by default. Chromium/Electron already
// enables GPU compositing and WebRTC hardware encode/decode when the installed
// driver is supported. Do not force GPU flags here: forcing a blocked adapter is
// a common source of black frames and renderer crashes. This env var is only a
// troubleshooting fallback for machines with broken video drivers.
const DISABLE_HARDWARE_ACCELERATION = /^(1|true|yes)$/i.test(String(process.env.GINGA_DISABLE_HARDWARE_ACCELERATION || ''));
if (DISABLE_HARDWARE_ACCELERATION) app.disableHardwareAcceleration();

// Electron 43 ships Chromium 150. New Chromium builds always enable the Windows
// Graphics Capture window capturer and removed the old AllowWgcWindowCapturer
// feature flag, so trying to disable that flag has no effect. Cursor inclusion
// is therefore handled at the MediaStreamTrack layer by the Web client
// (cursor: "always"). Chromium itself also requests prefer_cursor_embedded for
// desktop capture. Keeping this explicit avoids a fake compatibility switch that
// would make troubleshooting misleading.

let mainWindow = null;
let updateWindow = null;
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
let serverLoadGeneration = 0;
let serverLoadInProgress = false;
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

function extractDeepLink(argv = []) { return (Array.isArray(argv) ? argv : []).find((v) => typeof v === 'string' && v.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`)) || ''; }
function deepLinkToServerUrl(value) { try { const parsed = new URL(String(value || '')); if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) return ''; const route = `${parsed.hostname}${parsed.pathname}`.replace(/^\/+/, ''); const match = route.match(/^invite\/([A-Za-z0-9_-]{3,128})$/i); return match ? new URL(`/invite/${encodeURIComponent(match[1])}`, `${SERVER_URL}/`).toString() : ''; } catch { return ''; } }
async function openDeepLink(value) { const target = deepLinkToServerUrl(value); if (!target) return false; if (!startupFinished || !mainWindow || mainWindow.isDestroyed()) { pendingDeepLink = value; return true; } try { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); await mainWindow.loadURL(target); mainWindow.focus(); pendingDeepLink = ''; return true; } catch (error) { logRuntime(`deep-link-failed error=${error instanceof Error ? error.message : String(error)}`); return false; } }
function getAutoStartEnabled() {
  if (process.platform !== 'win32') return false;
  try { return Boolean(app.getLoginItemSettings({ path: process.execPath, args: ['--autostart'] }).openAtLogin); }
  catch { return false; }
}
function setAutoStartEnabled(enabled) {
  if (process.platform !== 'win32') return false;
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
      args: ['--autostart']
    });
  } catch (error) {
    logRuntime(`auto-start-set error=${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  return getAutoStartEnabled();
}
function readDesktopDiagnostics() {
  let displayScaleFactor = 1;
  let displaySize = null;
  try {
    const display = mainWindow && !mainWindow.isDestroyed() ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay();
    displayScaleFactor = Number(display.scaleFactor || 1);
    displaySize = { width: display.workArea.width, height: display.workArea.height };
  } catch {}
  let windowState = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    windowState = {
      width: bounds.width,
      height: bounds.height,
      maximized: mainWindow.isMaximized(),
      minimized: mainWindow.isMinimized(),
      visible: mainWindow.isVisible(),
      zoomFactor: mainWindow.webContents.getZoomFactor()
    };
  }
  return {
    appVersion: app.getVersion(),
    product: BRAND.name,
    platform: process.platform,
    arch: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    packaged: app.isPackaged,
    serverUrl: SERVER_URL,
    updateChannel: readUpdateChannel(),
    autoStart: { enabled: getAutoStartEnabled(), supported: process.platform === 'win32' },
    desktopPreferences: readDesktopPreferences(),
    window: windowState,
    display: { scaleFactor: displayScaleFactor, workArea: displaySize }
  };
}
async function submitClientCrashReport(kind, message, metadata = {}) { const now=Date.now(); if(now-lastCrashReportAt<15000)return false; lastCrashReportAt=now; const token=readSecureSessionToken(); if(!token)return false; const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),3500); try { const target=new URL('/api/client/crash-reports',`${SERVER_URL}/`); const options={method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({version:app.getVersion(),platform:`${process.platform}-${process.arch}`,kind:String(kind||'desktop').slice(0,32),message:String(message||'Falha no cliente').slice(0,900),stack:'',metadata:{electron:process.versions.electron,chrome:process.versions.chrome,...metadata}}),signal:controller.signal}; const response=app.isReady()&&session.defaultSession?.fetch?await session.defaultSession.fetch(target.toString(),options):await fetch(target,options); return response.ok; } catch { return false; } finally { clearTimeout(timeout); } }

function isLocalFileSender(event) {
  try {
    return event.senderFrame?.url?.startsWith('file://') === true;
  } catch {
    return false;
  }
}

function isScreenPickerSender(event) {
  try {
    if (!pickerWindow || pickerWindow.isDestroyed()) return false;
    return event.sender?.id === pickerWindow.webContents.id && isLocalFileSender(event);
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
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (event.sender?.id !== mainWindow.webContents.id) return false;
    const senderUrl = event.senderFrame?.url || '';
    return isAllowedUrl(senderUrl) || isOfflinePageUrl(senderUrl);
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

function showTrayBalloon(title, body, silent = false) {
  if (process.platform !== 'win32') return false;
  try {
    if (!tray) createTray();
    if (!tray || tray.isDestroyed?.()) return false;
    tray.displayBalloon({
      title: String(title || BRAND.notificationTitle).slice(0, 90),
      content: String(body || '').slice(0, 220),
      icon: appIconPath(false) || undefined,
      noSound: Boolean(silent),
      respectQuietTime: false
    });
    return true;
  } catch (error) {
    logRuntime(`notification tray-balloon failed=${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function showNativeNotification(payload = {}) {
  if (payload?.taskbarBadge !== false) incrementTaskbarUnread(payload);
  const title = String(payload.title || BRAND.notificationTitle).replace(/\s+/g, ' ').trim().slice(0, 90) || BRAND.notificationTitle;
  const body = String(payload.body || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  const durationMs = Math.max(2500, Math.min(15000, Number(payload.durationMs) || 5000));

  if (!Notification.isSupported()) {
    logRuntime('notification native-toast unsupported; tray fallback=1');
    return Promise.resolve(showTrayBalloon(title, body, Boolean(payload.silent)));
  }

  return new Promise((resolve) => {
    let settled = false;
    let shown = false;
    let fallbackUsed = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(Boolean(value));
    };
    const fallback = (reason) => {
      if (fallbackUsed) return false;
      fallbackUsed = true;
      const ok = showTrayBalloon(title, body, Boolean(payload.silent));
      logRuntime(`notification fallback=${ok ? 'shown' : 'failed'} reason=${reason}`);
      finish(ok);
      return ok;
    };

    try {
      const notification = new Notification({
        title,
        body,
        icon: appIconPath(false) || undefined,
        silent: Boolean(payload.silent),
        timeoutType: 'default'
      });
      activeNotifications.add(notification);
      const cleanup = () => activeNotifications.delete(notification);
      notification.once('show', () => {
        shown = true;
        logRuntime('notification native-toast shown=1');
        finish(true);
      });
      notification.once('close', cleanup);
      notification.once('failed', (_event, error) => {
        cleanup();
        logRuntime(`notification native-toast failed=${error instanceof Error ? error.message : String(error || 'unknown')}`);
        fallback('native-failed');
      });
      notification.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      });
      notification.show();

      // Alguns builds do Windows aceitam Notification.show() mas nao entregam o
      // toast (registro/AUMID/Focus Assist). Se o Electron nao confirmar o evento
      // "show", usamos o balloon da bandeja em vez de fingir sucesso para a UI.
      setTimeout(() => {
        if (!shown && !settled) fallback('native-show-timeout');
      }, 1400);
      setTimeout(() => {
        try { notification.close(); } catch {}
        cleanup();
      }, durationMs);
    } catch (error) {
      logRuntime(`notification native-toast exception=${error instanceof Error ? error.message : String(error)}`);
      fallback('native-exception');
    }
  });
}

function isExpectedNavigationAbort(error) {
  const code = Number(error?.errno ?? error?.errorCode ?? error?.code);
  const message = error instanceof Error ? error.message : String(error || '');
  return code === -3 || /ERR_ABORTED|\(-3\)/i.test(message);
}

function friendlyServerError(error) {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (/ERR_NAME_NOT_RESOLVED/i.test(raw)) return 'Nao foi possivel localizar o endereco do Ginga Server.';
  if (/ERR_CONNECTION_REFUSED/i.test(raw)) return 'O servidor recusou a conexao. Ele pode estar reiniciando.';
  if (/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/i.test(raw)) return 'A conexao com o servidor demorou demais.';
  if (/ERR_INTERNET_DISCONNECTED/i.test(raw)) return 'Este computador esta sem acesso a rede.';
  if (/ERR_NETWORK_CHANGED/i.test(raw)) return 'A rede mudou durante a conexao. O Ginga vai tentar novamente.';
  if (/ERR_CERT_|certificate|certificado/i.test(raw)) return 'Nao foi possivel validar o certificado HTTPS do servidor.';
  if (/fetch failed/i.test(raw)) return 'A conexao de rede do aplicativo falhou temporariamente.';
  if (isExpectedNavigationAbort(error)) return 'A abertura foi interrompida por outra navegacao. Tentando novamente.';
  return 'Nao foi possivel conectar ao Ginga Server.';
}

function isOfflinePageUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') return false;
    return path.normalize(fileURLToPath(parsed)) === path.normalize(path.join(__dirname, 'offline.html'));
  } catch {
    return false;
  }
}

async function showOfflinePage(error, generation) {
  if (!mainWindow || mainWindow.isDestroyed() || generation !== serverLoadGeneration) return;
  const raw = error instanceof Error ? error.message : String(error || '');
  const detail = friendlyServerError(error);
  logRuntime(`server-offline-page origin=${SERVER_URL} detail=${raw}`);
  try {
    await mainWindow.loadFile(path.join(__dirname, 'offline.html'), {
      query: {
        server: SERVER_URL,
        detail
      }
    });
  } catch (fallbackError) {
    // ERR_ABORTED aqui normalmente significa que outra tentativa de conexao ja
    // substituiu a tela offline. Nao deve virar erro visivel nem rejection solta.
    if (generation !== serverLoadGeneration || isExpectedNavigationAbort(fallbackError)) {
      logRuntime(`offline-load-aborted generation=${generation}`);
      return;
    }
    logRuntime(`offline-load-failed error=${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
  }
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

function lockNavigation(win, allowOfflineFile = false) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    // window.open() e usado para "Abrir original" em imagens/anexos.
    // Nunca carregue esse URL na janela principal: isso substituia o React
    // pelo arquivo bruto e deixava o Desktop com escala/layout corrompidos.
    // HTTP(S), inclusive do proprio servidor Ginga, abre no navegador padrao.
    if (/^https?:/i.test(url)) {
      void shell.openExternal(url).catch((error) => {
        logRuntime(`window-open-external-failed url=${url} error=${error instanceof Error ? error.message : String(error)}`);
      });
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if ((allowOfflineFile && isOfflinePageUrl(url)) || isAllowedUrl(url)) return;
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
  const options = {
    signal: controller.signal,
    cache: 'no-store',
    redirect: 'error',
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
  };
  try {
    // Use a mesma pilha de rede do Chromium/BrowserWindow. O fetch global do
    // Node nao respeita necessariamente proxy/WPAD e politicas de rede do
    // Windows, gerando "fetch failed" no Desktop enquanto o site abre no browser.
    if (app.isReady() && session.defaultSession?.fetch) {
      return await session.defaultSession.fetch(url, options);
    }
    return await fetch(url, options);
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

function isTransientNetworkError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = error instanceof Error ? error.message : String(error || '');
  if (error?.name === 'AbortError') return true;
  if (['UPD_FEED_HTTP', 'UPD_LATEST_HTTP', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(code)) return true;
  return /fetch failed|network|ERR_(?:NAME_NOT_RESOLVED|CONNECTION|INTERNET_DISCONNECTED|NETWORK_CHANGED|TIMED_OUT)/i.test(message);
}

function friendlyUpdaterNetworkError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(message)) return 'Nao foi possivel localizar o servidor de atualizacoes.';
  if (/ERR_INTERNET_DISCONNECTED/i.test(message)) return 'Este computador esta sem acesso a rede.';
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(message)) return 'O servidor de atualizacoes recusou a conexao.';
  if (/ERR_TIMED_OUT|ETIMEDOUT|AbortError/i.test(message) || error?.name === 'AbortError') return 'A verificacao de atualizacao demorou demais.';
  return 'Nao foi possivel consultar atualizacoes agora.';
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
  try {
    const proxy = app.isReady() ? await session.defaultSession.resolveProxy(normalized).catch(() => '') : '';
    if (proxy) logRuntime(`server-network origin=${normalized} proxy=${proxy}`);
    const response = await fetchWithTimeout(`${normalized}/api/health`);
    if (!response.ok) throw new Error(`Servidor respondeu HTTP ${response.status}`);
    const body = await response.json().catch(() => null);
    if (!body || body.status !== 'ok' || body.service !== 'ginga-api') throw new Error('O endereco respondeu, mas nao parece ser um Ginga Server');
    return { serverUrl: normalized, version: body.version || 'desconhecida', secure: normalized.startsWith('https://') || isLocalServer(normalized) };
  } catch (error) {
    logRuntime(`server-health-failed origin=${normalized} error=${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function loadServer(options = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  const reason = String(options.reason || 'runtime');
  const generation = ++serverLoadGeneration;
  serverLoadInProgress = true;
  logRuntime(`server-load-start generation=${generation} reason=${reason} origin=${SERVER_URL}`);

  try {
    await mainWindow.loadURL(SERVER_URL);
    if (generation !== serverLoadGeneration) return false;
    serverLoadInProgress = false;
    logRuntime(`server-load-ok generation=${generation} url=${mainWindow.webContents.getURL()}`);
    void testServerUrl(SERVER_URL).catch(() => undefined);
    return true;
  } catch (error) {
    if (!mainWindow || mainWindow.isDestroyed()) return false;

    const raw = error instanceof Error ? error.message : String(error);
    const currentUrl = mainWindow.webContents.getURL();

    // Electron usa ERR_ABORTED (-3) quando uma navegacao e substituida por
    // outra (redirect do app, retry, reload ou troca de pagina). Isso nao e
    // prova de servidor indisponivel. Se a janela ja chegou na origem do Ginga,
    // tratamos como sucesso; se uma tentativa mais nova existe, apenas ignoramos.
    if (isExpectedNavigationAbort(error)) {
      if (generation !== serverLoadGeneration) {
        logRuntime(`server-load-aborted-stale generation=${generation} current=${serverLoadGeneration}`);
        return false;
      }
      if (isAllowedUrl(currentUrl)) {
        serverLoadInProgress = false;
        logRuntime(`server-load-aborted-but-online generation=${generation} url=${currentUrl}`);
        void testServerUrl(SERVER_URL).catch(() => undefined);
        return true;
      }
      await sleep(180);
      if (!mainWindow || mainWindow.isDestroyed() || generation !== serverLoadGeneration) return false;
      const afterAbortUrl = mainWindow.webContents.getURL();
      if (isAllowedUrl(afterAbortUrl)) {
        serverLoadInProgress = false;
        logRuntime(`server-load-aborted-recovered generation=${generation} url=${afterAbortUrl}`);
        return true;
      }
    }

    if (generation !== serverLoadGeneration) return false;
    serverLoadInProgress = false;
    logRuntime(`server-load-failed generation=${generation} origin=${SERVER_URL} error=${raw}`);
    await showOfflinePage(error, generation);
    return false;
  }
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  let unresponsiveReloadTimer = null;
  // Nao use uma altura fixa maior que a area util do monitor. Em telas 1440x900,
  // por exemplo, a taskbar reduz a workArea e uma janela frameless de 900px pode
  // ficar parcialmente atras dela, escondendo os controles inferiores de voz.
  let workArea = { width: 1440, height: 900 };
  try { workArea = screen.getPrimaryDisplay().workAreaSize; } catch {}
  const minWidth = Math.min(980, Math.max(640, workArea.width));
  const minHeight = Math.min(640, Math.max(480, workArea.height));
  const initialWidth = Math.max(minWidth, Math.min(1440, workArea.width));
  const initialHeight = Math.max(minHeight, Math.min(900, workArea.height));
  const savedWindowState = readWindowState();
  const savedBounds = clampWindowBounds(savedWindowState?.bounds, minWidth, minHeight);
  const windowOptions = {
    width: savedBounds ? Math.max(minWidth, savedBounds.width) : initialWidth,
    height: savedBounds ? Math.max(minHeight, savedBounds.height) : initialHeight,
    minWidth,
    minHeight,
    backgroundColor: '#0b0e12',
    show: false,
    autoHideMenuBar: true,
    frame: process.platform !== 'win32',
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    thickFrame: true,
    roundedCorners: true,
    icon: appIconPath(false) || undefined,
    webPreferences: hardenedWindowOptions({
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
      additionalArguments: [`--ginga-brand-name=${encodeURIComponent(BRAND.name)}`]
    })
  };
  if (savedBounds) Object.assign(windowOptions, { x: savedBounds.x, y: savedBounds.y });
  mainWindow = new BrowserWindow(windowOptions);
  if (!savedBounds) mainWindow.center();
  if (savedWindowState?.maximized) mainWindow.maximize();
  const shouldStartHidden = process.argv.includes('--autostart') && readDesktopPreferences().startMinimized;
  // O cliente Desktop deve sempre renderizar em escala 100%. Como ele carrega
  // a mesma origem HTTPS usada pela Web, um zoom persistido pelo Chromium pode
  // acionar breakpoints de navegador e fazer o app parecer a versao Web/mobile.
  // Travamos o zoom somente na janela principal; o conteudo continua responsivo
  // quando o usuario redimensiona a janela.
  const enforceDesktopZoom = () => {
    try { mainWindow?.webContents.setZoomFactor(1); } catch {}
  };
  enforceDesktopZoom();
  mainWindow.webContents.on('did-finish-load', enforceDesktopZoom);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const modifier = Boolean(input.control || input.meta);
    if (!modifier) return;
    const key = String(input.key || '').toLowerCase();
    if (['+', '=', '-', '_', '0'].includes(key)) {
      event.preventDefault();
      enforceDesktopZoom();
    }
  });

  lockNavigation(mainWindow, true);
  mainWindow.once('ready-to-show', () => {
    if (shouldStartHidden) { logRuntime('autostart ready startMinimized=1'); return; }
    mainWindow?.show();
    mainWindow?.focus();
  });
  mainWindow.webContents.on('did-finish-load', () => { if (pendingDeepLink) { const next=pendingDeepLink; pendingDeepLink=''; setTimeout(()=>void openDeepLink(next),120); } });
  // O renderer e a fonte da verdade para o contador de nao lidas.
  // Focar/mostrar a janela nao significa que todos os canais foram lidos.
  // Ao focar, apenas interrompemos o pisca da taskbar; o badge numerico continua
  // ate o usuario realmente ler as conversas/canais pendentes.
  mainWindow.on('focus', () => { try { mainWindow?.flashFrame(false); } catch {} });
  let windowStateSaveTimer = null;
  const scheduleWindowStateSave = () => {
    if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = setTimeout(() => { windowStateSaveTimer = null; persistWindowState(); }, 250);
    windowStateSaveTimer.unref?.();
  };
  mainWindow.on('move', scheduleWindowStateSave);
  mainWindow.on('resize', scheduleWindowStateSave);
  mainWindow.on('maximize', scheduleWindowStateSave);
  mainWindow.on('unmaximize', scheduleWindowStateSave);
  mainWindow.webContents.on('did-finish-load', () => sendRuntimeUpdateAvailable());
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logRuntime(`renderer-gone reason=${details.reason} exitCode=${details.exitCode}`);
    void submitClientCrashReport('renderer-gone', `Renderer encerrado: ${details.reason}`, { exitCode: details.exitCode });
    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || isQuitting) return;
      void loadServer({ reason: 'renderer-gone' });
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
    // -3/ERR_ABORTED e esperado quando uma navegacao e substituida. Registrar
    // como diagnostico e suficiente; nunca mostrar o data/file URL ao usuario.
    if (Number(errorCode) === -3) {
      logRuntime(`did-fail-load-aborted url=${validatedURL}`);
      return;
    }
    logRuntime(`did-fail-load code=${errorCode} url=${validatedURL} error=${errorDescription}`);
  });
  mainWindow.on('close', (event) => {
    persistWindowState();
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  void loadServer({ reason: 'startup' });
  return mainWindow;
}

function stopBackgroundActivities() {
  if (runtimeUpdateTimer) { clearInterval(runtimeUpdateTimer); runtimeUpdateTimer = null; }
  if (gameOverlayPollTimer) { clearInterval(gameOverlayPollTimer); gameOverlayPollTimer = null; }
  if (gameOverlayPreviewTimer) { clearTimeout(gameOverlayPreviewTimer); gameOverlayPreviewTimer = null; }
  if (updaterTimer) { clearTimeout(updaterTimer); updaterTimer = null; }
  try { globalShortcut.unregisterAll(); } catch {}
  for (const notification of activeNotifications) {
    try { notification.close?.(); } catch {}
  }
  activeNotifications.clear();
}

function quitApplication() {
  if (isQuitting) {
    try { app.exit(0); } catch {}
    return;
  }
  isQuitting = true;
  logRuntime('explicit-quit requested');
  stopBackgroundActivities();
  try { tray?.destroy(); } catch {}
  tray = null;
  for (const win of BrowserWindow.getAllWindows()) {
    try { if (!win.isDestroyed()) win.destroy(); } catch {}
  }
  try { app.quit(); } catch {}
  const hardExitTimer = setTimeout(() => {
    try { app.exit(0); } catch {}
  }, 600);
  hardExitTimer.unref?.();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Ginga', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Recarregar servidor', click: () => void loadServer({ reason: 'tray' }) },
    ...(process.platform === 'win32' ? [{
      label: 'Abrir com o Windows',
      type: 'checkbox',
      checked: getAutoStartEnabled(),
      click: (menuItem) => {
        const enabled = setAutoStartEnabled(Boolean(menuItem.checked));
        logRuntime(`auto-start tray enabled=${enabled}`);
        refreshTrayMenu();
      }
    }, {
      label: 'Iniciar minimizado com o Windows',
      type: 'checkbox',
      enabled: getAutoStartEnabled(),
      checked: readDesktopPreferences().startMinimized,
      click: (menuItem) => {
        saveDesktopPreferences({ startMinimized:Boolean(menuItem.checked) });
        refreshTrayMenu();
      }
    }] : []),
    { type: 'separator' },
    { label: 'Sair', click: () => quitApplication() }
  ]));
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip('Ginga');
  refreshTrayMenu();
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
        manifest?.schema !== 1 || manifest?.product !== BRAND.updateProduct || manifest?.platform !== 'win32-x64' ||
        !/^(?:\d+)\.(?:\d+)\.(?:\d+)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(manifest?.version || '') ||
        manifest?.file !== `${BRAND.windowsInstallerPrefix}-${manifest.version}-x64.exe` ||
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

  if (process.platform !== 'win32') {
    // A primeira distribuicao Linux usa AppImage/DEB/RPM publicados no site.
    // Nao tente consumir o feed NSIS do Windows nem rotule um pacote Linux como modo dev.
    pushUpdaterState({ title: 'Abrindo Ginga', message: 'Cliente Linux pronto.', percent: 100, detail: `Versao ${app.getVersion()} | atualizacoes em ${SERVER_ORIGIN}` });
    finishStartup(180);
    return;
  }

  if (!app.isPackaged || process.env.GINGA_SKIP_UPDATE === '1' || process.env.NEXORA_SKIP_UPDATE === '1') {
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
    const feedUnavailable = code === 'UPD_FEED_HTTP' || code === 'UPD_LATEST_HTTP' || isTransientNetworkError(error);
    if (feedUnavailable) {
      pushUpdaterState({ title: 'Servidor de atualizacao indisponivel', message: 'Nao foi possivel consultar atualizacoes agora. Abrindo o Ginga normalmente.', percent: 100, detail: friendlyUpdaterNetworkError(error) });
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
    appendUpdaterLog(`electron-updater error: ${error instanceof Error ? error.message : String(error)}`);
    pushUpdaterState({ title: 'Servidor de atualizacao indisponivel', message: 'Nao foi possivel atualizar agora. Abrindo o Ginga normalmente.', percent: 100, detail: isTransientNetworkError(error) ? friendlyUpdaterNetworkError(error) : 'A verificacao de atualizacao falhou. O Ginga sera aberto normalmente.' });
    finishStartup(900);
  });

  updaterTimer = setTimeout(() => {
    pushUpdaterState({ title: 'Continuando inicializacao', message: 'A verificacao demorou demais. Abrindo o Ginga.', percent: 100, detail: 'Nenhum pacote nao validado sera instalado.' });
    finishStartup(650);
  }, UPDATE_TIMEOUT_MS);

  void updater.checkForUpdates().catch((error) => {
    appendUpdaterLog(`checkForUpdates falhou: ${error instanceof Error ? error.message : String(error)}`);
    pushUpdaterState({ title: 'Servidor de atualizacao indisponivel', message: 'Nao foi possivel verificar agora. Abrindo o Ginga normalmente.', percent: 100, detail: isTransientNetworkError(error) ? friendlyUpdaterNetworkError(error) : 'Falha ao consultar o feed de atualizacoes.' });
    finishStartup(900);
  });
}

try { if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])]); else app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME); } catch (error) { logRuntime(`protocol-register error=${error instanceof Error ? error.message : String(error)}`); }
pendingDeepLink = extractDeepLink(process.argv);
app.on('open-url', (event, url) => { event.preventDefault(); void openDeepLink(url); });

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const deepLink = extractDeepLink(argv);
    if (deepLink) void openDeepLink(deepLink);
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
    app.setName(BRAND.name);
    app.setAppUserModelId(APP_ID);
    configurePermissions();

    try {
      const gpuStatus = app.getGPUFeatureStatus();
      logRuntime(`gpu hardwareAcceleration=${DISABLE_HARDWARE_ACCELERATION ? 'disabled-by-env' : 'enabled'} featureStatus=${JSON.stringify(gpuStatus)}`);
      void app.getGPUInfo('basic').then((info) => {
        const devices = Array.isArray(info?.gpuDevice) ? info.gpuDevice.map((device) => ({
          vendorId: device.vendorId,
          deviceId: device.deviceId,
          active: device.active
        })) : [];
        logRuntime(`gpu devices=${JSON.stringify(devices)}`);
      }).catch(() => {});
    } catch {}

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
    ipcMain.handle('ginga:retry-server', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      return await loadServer({ reason: 'offline-retry' });
    });
    ipcMain.handle('ginga:show-window', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      mainWindow?.show();
      mainWindow?.focus();
      return true;
    });
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
      return publicDetectedGame(await detectGameActivity());
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
    ipcMain.handle('ginga:game-overlay-status', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      return gameOverlayRuntimeStatus();
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
    ipcMain.handle('ginga:server-url', async (event) => {
      if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida');
      return SERVER_URL;
    });
    ipcMain.handle('ginga:auto-start-get', async (event) => { if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida'); return { enabled:getAutoStartEnabled(), supported:process.platform==='win32' }; });
    ipcMain.handle('ginga:auto-start-set', async (event, enabled) => { if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida'); const saved=setAutoStartEnabled(Boolean(enabled));refreshTrayMenu();return { enabled:saved, supported:process.platform==='win32' }; });
    ipcMain.handle('ginga:start-minimized-get', async (event) => { if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida'); return { enabled:readDesktopPreferences().startMinimized, supported:process.platform==='win32' }; });
    ipcMain.handle('ginga:start-minimized-set', async (event, enabled) => { if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida'); const saved=saveDesktopPreferences({ startMinimized:Boolean(enabled) }); return { enabled:saved.startMinimized, supported:process.platform==='win32' }; });
    ipcMain.handle('ginga:desktop-diagnostics', async (event) => { if (!isAllowedRendererSender(event)) throw new Error('Origem IPC nao permitida'); return readDesktopDiagnostics(); });
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
    ipcMain.handle('ginga:screen-source-selected', async (event, selection) => {
      if (!isScreenPickerSender(event) || !pickerResolve) return false;
      const resolve = pickerResolve;
      pickerResolve = null;
      resolve(selection && typeof selection.id === 'string' ? selection : null);
      pickerWindow?.close();
      return true;
    });
    ipcMain.handle('ginga:screen-source-cancelled', async (event) => {
      if (!isScreenPickerSender(event)) return false;
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

app.on('child-process-gone', (_event, details) => {
  const kind = String(details?.type || 'unknown');
  const reason = String(details?.reason || 'unknown');
  const exitCode = Number(details?.exitCode ?? 0);
  logRuntime(`child-process-gone type=${kind} reason=${reason} exitCode=${exitCode}`);

  // Falhas do processo GPU/utility podem aparecer no WebRTC como mensagens de
  // pool/encoder (inclusive variacoes do erro "xhp pool"). O Chromium costuma
  // reiniciar o processo sozinho; limpamos/recarregamos apenas o renderer se a
  // interface ficar dependente daquele pipeline, sem encerrar o Ginga inteiro.
  if (!/GPU|utility/i.test(kind) || isQuitting) return;
  showNativeNotification({
    title: 'Ginga recuperou o video',
    body: 'O processo de aceleracao/captura de video reiniciou. Se a transmissao parou, inicie-a novamente.',
    silent: true,
    taskbarBadge: false,
    flashTaskbar: false,
    durationMs: 6500
  });
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || isQuitting) return;
    if (mainWindow.webContents.isCrashed?.()) void loadServer({ reason: 'gpu-process-gone' });
  }, 900);
});

app.on('activate', () => {
  if (!startupFinished) {
    updateWindow?.show();
    return;
  }
  if (!mainWindow) createMainWindow();
  else mainWindow.show();
});

app.on('before-quit', () => { isQuitting = true; stopBackgroundActivities(); });
app.on('window-all-closed', () => {
  // Mantem o processo vivo na bandeja. O encerramento real ocorre em "Sair".
});
