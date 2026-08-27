const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gingaScreenPicker', {
  select: (id, includeAudio) => ipcRenderer.invoke('ginga:screen-source-selected', { id, includeAudio: Boolean(includeAudio) }),
  cancel: () => ipcRenderer.invoke('ginga:screen-source-cancelled')
});
