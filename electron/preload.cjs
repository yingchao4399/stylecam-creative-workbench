const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('stylecam', Object.freeze({
  initial: () => ipcRenderer.invoke('stylecam:initial'),
  demoAsset: name => ipcRenderer.invoke('stylecam:demo-asset', name),
  generate: payload => ipcRenderer.invoke('stylecam:generate', payload),
  saveWork: payload => ipcRenderer.invoke('stylecam:save-work', payload),
  exportWork: id => ipcRenderer.invoke('stylecam:export-work', id),
  getSettings: () => ipcRenderer.invoke('stylecam:get-settings'),
  saveSettings: input => ipcRenderer.invoke('stylecam:save-settings', input),
  testConnection: input => ipcRenderer.invoke('stylecam:test-connection', input),
  listModels: input => ipcRenderer.invoke('stylecam:list-models', input),
}));
