const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gingaGameOverlay', Object.freeze({
  onState: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('ginga:game-overlay-state', handler);
    return () => ipcRenderer.off('ginga:game-overlay-state', handler);
  }
}));
