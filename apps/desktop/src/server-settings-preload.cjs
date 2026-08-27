const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gingaServerSettings', Object.freeze({
  get: () => ipcRenderer.invoke('ginga:server-settings-get'),
  test: (serverUrl) => ipcRenderer.invoke('ginga:server-settings-test', serverUrl),
  save: (serverUrl) => ipcRenderer.invoke('ginga:server-settings-save', serverUrl)
}));
