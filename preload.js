const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultAPI', {
  status: () => ipcRenderer.invoke('vault:status'),
  create: (masterPassword) => ipcRenderer.invoke('vault:create', masterPassword),
  unlock: (masterPassword) => ipcRenderer.invoke('vault:unlock', masterPassword),
  lock: () => ipcRenderer.invoke('vault:lock'),
  list: () => ipcRenderer.invoke('vault:list'),
  add: (entry) => ipcRenderer.invoke('vault:add', entry),
  reveal: (id) => ipcRenderer.invoke('vault:reveal', id),
  copy: (id) => ipcRenderer.invoke('vault:copy', id),
  remove: (id) => ipcRenderer.invoke('vault:delete', id)
});
