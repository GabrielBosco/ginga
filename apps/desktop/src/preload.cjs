const { contextBridge, ipcRenderer } = require('electron');

const desktopApi = Object.freeze({
  isDesktop: true,
  platform: process.platform,
  retryServer: () => ipcRenderer.invoke('ginga:retry-server'),
  showMainWindow: () => ipcRenderer.invoke('ginga:show-window'),
  getServerUrl: () => ipcRenderer.invoke('ginga:server-url'),
  openServerSettings: () => ipcRenderer.invoke('ginga:open-server-settings'),
  minimizeWindow: () => ipcRenderer.invoke('ginga:window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('ginga:window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('ginga:window-close'),
  getWindowState: () => ipcRenderer.invoke('ginga:window-state'),
  checkForUpdate: () => ipcRenderer.invoke('ginga:check-runtime-update'),
  getUpdateChannel: () => ipcRenderer.invoke('ginga:update-channel-get'),
  setUpdateChannel: (channel) => ipcRenderer.invoke('ginga:update-channel-set', channel),
  restartToUpdate: () => ipcRenderer.invoke('ginga:restart-to-update'),
  notify: (payload) => ipcRenderer.invoke('ginga:notify', payload),
  setTaskbarBadge: (count) => ipcRenderer.invoke('ginga:taskbar-badge', Number(count) || 0),
  clearTaskbarBadge: () => ipcRenderer.invoke('ginga:taskbar-badge-clear'),
  detectGameActivity: () => ipcRenderer.invoke('ginga:detect-game'),
  getGameOverlaySettings: () => ipcRenderer.invoke('ginga:game-overlay-settings-get'),
  setGameOverlaySettings: (settings) => ipcRenderer.invoke('ginga:game-overlay-settings-set', settings),
  updateGameOverlayState: (state) => ipcRenderer.invoke('ginga:game-overlay-state', state),
  previewGameOverlay: () => ipcRenderer.invoke('ginga:game-overlay-preview'),
  readSessionToken: () => ipcRenderer.sendSync('ginga:session-read-sync'),
  writeSessionToken: (token) => ipcRenderer.sendSync('ginga:session-write-sync', token || ''),
  openExternalPath: (path) => ipcRenderer.invoke('ginga:open-external-path', path),
  logRuntime: (payload) => ipcRenderer.invoke('ginga:runtime-log', payload)
});

contextBridge.exposeInMainWorld('gingaDesktop', desktopApi);


function installDesktopChrome() {
  let pendingUpdate = null;

  const renderUpdate = (payload) => {
    if (!payload?.version) return;
    pendingUpdate = payload;
    const button = document.querySelector('.ginga-desktop-update');
    if (!button) return;
    const label = button.querySelector('.ginga-desktop-update-label');
    if (label) label.textContent = `Ginga ${payload.version} disponivel - Reiniciar para atualizar`;
    button.hidden = false;
  };

  ipcRenderer.on('ginga:update-available', (_event, payload) => renderUpdate(payload));

  const apply = () => {
    try {
      document.documentElement.setAttribute('data-ginga-desktop', 'true');
      if (!document.getElementById('ginga-desktop-chrome-style')) {
        const style = document.createElement('style');
        style.id = 'ginga-desktop-chrome-style';
        style.textContent = `
          :root { --ginga-desktop-chrome-height:32px; }
          html[data-ginga-desktop="true"] body { padding-top:var(--ginga-desktop-chrome-height) !important; min-height:100vh !important; background:#0c1015 !important; }
          html[data-ginga-desktop="true"] #root { height:calc(100vh - var(--ginga-desktop-chrome-height)) !important; min-height:0 !important; }
          html[data-ginga-desktop="true"] .workspace,
          html[data-ginga-desktop="true"] .nexora-shell,
          html[data-ginga-desktop="true"] .auth-page,
          html[data-ginga-desktop="true"] .auth-site,
          html[data-ginga-desktop="true"] .app-loading { height:calc(100vh - var(--ginga-desktop-chrome-height)) !important; min-height:0 !important; }
          .ginga-desktop-titlebar { position:fixed; inset:0 0 auto 0; height:var(--ginga-desktop-chrome-height); z-index:2147483646; display:flex; align-items:center; background:#0c1015; border-bottom:1px solid rgba(255,255,255,.045); color:#8e98a4; -webkit-app-region:drag; user-select:none; font-family:Inter,"Segoe UI",sans-serif; }
          .ginga-desktop-titlebar-brand { height:100%; display:flex; align-items:center; padding:0 14px; color:#737e8b; font-size:10px; font-weight:700; letter-spacing:.035em; opacity:.9; }
          .ginga-desktop-update { position:absolute; left:50%; top:4px; transform:translateX(-50%); height:24px; max-width:min(520px,calc(100vw - 360px)); padding:0 12px; border:1px solid rgba(92,171,129,.24); border-radius:7px; background:rgba(49,91,69,.26); color:#b6d8c4; display:flex; align-items:center; gap:7px; font:600 10px/1 Inter,"Segoe UI",sans-serif; cursor:pointer; -webkit-app-region:no-drag; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; box-shadow:0 4px 18px rgba(0,0,0,.14); transition:background .14s ease,border-color .14s ease,color .14s ease; }
          .ginga-desktop-update[hidden] { display:none !important; }
          .ginga-desktop-update:hover { background:rgba(56,113,82,.38); border-color:rgba(102,195,146,.34); color:#d8efe2; }
          .ginga-desktop-update:disabled { cursor:default; opacity:.72; }
          .ginga-desktop-update-dot { width:6px; height:6px; flex:0 0 auto; border-radius:50%; background:#67bf8e; box-shadow:0 0 0 4px rgba(103,191,142,.09); animation:ginga-update-pulse 1.8s ease-in-out infinite; }
          @keyframes ginga-update-pulse { 50% { box-shadow:0 0 0 7px rgba(103,191,142,0); } }
          .ginga-window-controls { position:absolute; top:0; right:0; z-index:2; height:100%; display:flex; align-items:stretch; -webkit-app-region:no-drag; }
          .ginga-window-control { width:46px; height:32px; padding:0; border:0; border-radius:0; display:grid; place-items:center; background:transparent; color:#7f8995; cursor:default; outline:0; transition:background .12s ease,color .12s ease; }
          .ginga-window-control svg { width:11px; height:11px; stroke:currentColor; stroke-width:1.45; fill:none; }
          .ginga-window-control:hover { background:#1a2027; color:#dce2e7; }
          .ginga-window-control.close:hover { background:#c84b54; color:#fff; }
          .ginga-window-control:active { filter:brightness(.87); }
        `;
        document.head.appendChild(style);
      }
      if (!document.querySelector('.ginga-desktop-titlebar')) {
        const bar = document.createElement('div');
        bar.className = 'ginga-desktop-titlebar';
        bar.innerHTML = `
          <div class="ginga-desktop-titlebar-brand">Ginga</div>
          <button class="ginga-desktop-update" type="button" hidden aria-label="Reiniciar para instalar atualizacao"><span class="ginga-desktop-update-dot"></span><span class="ginga-desktop-update-label">Atualizacao disponivel</span></button>
          <div class="ginga-window-controls">
            <button class="ginga-window-control minimize" type="button" aria-label="Minimizar"><svg viewBox="0 0 16 16"><path d="M3.5 8.5h9"/></svg></button>
            <button class="ginga-window-control maximize" type="button" aria-label="Maximizar"><svg viewBox="0 0 16 16"><rect x="3.75" y="3.75" width="8.5" height="8.5" rx=".4"/></svg></button>
            <button class="ginga-window-control close" type="button" aria-label="Fechar"><svg viewBox="0 0 16 16"><path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5"/></svg></button>
          </div>`;
        document.body.prepend(bar);
        const maxButton = bar.querySelector('.maximize');
        const updateButton = bar.querySelector('.ginga-desktop-update');
        const syncMaximize = async () => {
          try {
            const state = await desktopApi.getWindowState();
            const maximized = Boolean(state?.maximized);
            maxButton?.setAttribute('aria-label', maximized ? 'Restaurar' : 'Maximizar');
            if (maxButton) maxButton.innerHTML = maximized
              ? '<svg viewBox="0 0 16 16"><rect x="5" y="3.25" width="7.5" height="7.5" rx=".35"/><path d="M3.5 5v7.5H11"/></svg>'
              : '<svg viewBox="0 0 16 16"><rect x="3.75" y="3.75" width="8.5" height="8.5" rx=".4"/></svg>';
          } catch {}
        };
        bar.querySelector('.minimize')?.addEventListener('click', () => void desktopApi.minimizeWindow());
        maxButton?.addEventListener('click', async () => { await desktopApi.toggleMaximizeWindow(); await syncMaximize(); });
        bar.querySelector('.close')?.addEventListener('click', () => void desktopApi.closeWindow());
        updateButton?.addEventListener('click', async () => {
          if (updateButton.disabled) return;
          updateButton.disabled = true;
          const label = updateButton.querySelector('.ginga-desktop-update-label');
          if (label) label.textContent = 'Reiniciando para atualizar...';
          try {
            const result = await desktopApi.restartToUpdate();
            if (!result?.restarting) {
              updateButton.disabled = false;
              if (label) label.textContent = pendingUpdate?.version ? `Ginga ${pendingUpdate.version} disponivel - Reiniciar para atualizar` : 'Atualizacao disponivel';
            }
          } catch {
            updateButton.disabled = false;
            if (label) label.textContent = 'Nao foi possivel reiniciar. Tente novamente.';
          }
        });
        bar.addEventListener('dblclick', async (event) => {
          if (event.target?.closest?.('.ginga-window-controls,.ginga-desktop-update')) return;
          await desktopApi.toggleMaximizeWindow();
          await syncMaximize();
        });
        window.addEventListener('resize', () => void syncMaximize());
        void syncMaximize();
        if (pendingUpdate) renderUpdate(pendingUpdate);
        void desktopApi.checkForUpdate().then((result) => {
          if (result?.available && result.version) renderUpdate(result);
        }).catch(() => {});
      }

      // title/aria-label preservados para tooltips e acessibilidade.
    } catch {}
  };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', apply, { once:true });
  else apply();
}

installDesktopChrome();
