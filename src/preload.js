const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('transferAPI', {
  deviceInfo: () => ipcRenderer.invoke('device-info'),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  readChunk: (p, o, l) => ipcRenderer.invoke('read-chunk', p, o, l),
  saveStart: n => ipcRenderer.invoke('save-start', n),
  saveChunk: (p, b, o) => ipcRenderer.invoke('save-chunk', p, b, o),
  saveFinish: p => ipcRenderer.invoke('save-finish', p),
  openPath: p => ipcRenderer.invoke('open-path', p),
  diagnosticSelfTest: () => ipcRenderer.invoke('diagnostic-self-test'),
  diagnosticLog: entry => ipcRenderer.invoke('diagnostic-log', entry),
  diagnosticReadLogs: () => ipcRenderer.invoke('diagnostic-read-logs'),
  exportDiagnosticReport: report => ipcRenderer.invoke('export-diagnostic-report', report)
});
