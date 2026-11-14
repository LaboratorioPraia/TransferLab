const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('transferAPI', {
  deviceInfo: () => ipcRenderer.invoke('device-info'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: patch => ipcRenderer.invoke('save-settings', patch),
  trustDevice: (device, token) => ipcRenderer.invoke('trust-device', device, token),
  storePeerToken: (receiverId, token) => ipcRenderer.invoke('store-peer-token', receiverId, token),
  untrustDevice: id => ipcRenderer.invoke('untrust-device', id),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  startFolderWatch: () => ipcRenderer.invoke('start-folder-watch'),
  onFolderFileReady: callback => { ipcRenderer.removeAllListeners('folder-file-ready'); ipcRenderer.on('folder-file-ready', (_event, file) => callback(file)); },
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  readChunk: (p, o, l) => ipcRenderer.invoke('read-chunk', p, o, l),
  saveStart: (name, autoReceive) => ipcRenderer.invoke('save-start', name, autoReceive),
  saveChunk: (p, b, o) => ipcRenderer.invoke('save-chunk', p, b, o),
  saveFinish: (p, finalPath, size) => ipcRenderer.invoke('save-finish', p, finalPath, size),
  saveAbort: p => ipcRenderer.invoke('save-abort', p),
  openPath: p => ipcRenderer.invoke('open-path', p),
  diagnosticSelfTest: () => ipcRenderer.invoke('diagnostic-self-test'),
  diagnosticLog: entry => ipcRenderer.invoke('diagnostic-log', entry),
  diagnosticReadLogs: () => ipcRenderer.invoke('diagnostic-read-logs'),
  exportDiagnosticReport: report => ipcRenderer.invoke('export-diagnostic-report', report)
});
