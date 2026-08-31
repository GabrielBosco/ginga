'use strict';

/**
 * Identidade publica do Desktop. A 0.4.1 continua sendo Ginga e preserva compatibilidade com a linha 0.4.x.
 * Eventos IPC `ginga:*`, pastas legadas e outras chaves de compatibilidade nao
 * devem ser renomeados junto com a marca sem uma migracao explicita.
 */
module.exports = Object.freeze({
  name: 'Ginga',
  desktopName: 'Ginga Desktop',
  appId: 'br.com.ginga.desktop',
  updateProduct: 'Ginga',
  windowsInstallerPrefix: 'Ginga-Setup',
  configDirectoryName: 'Ginga',
  notificationTitle: 'Ginga'
});
