const { contextBridge, ipcRenderer, webUtils } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('reformato', {
  chooseFiles: () => ipcRenderer.invoke('files:choose'),
  dropFiles: (files) => ipcRenderer.invoke('files:drop', files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)),
  removeFile: (id) => ipcRenderer.invoke('files:remove', id),
  chooseDestination: (current) => ipcRenderer.invoke('destination:choose', current),
  openDestination: () => ipcRenderer.invoke('destination:open'),
  convert: (jobs, outputFolder, videoProfile) => ipcRenderer.invoke('conversion:start', { jobs, outputFolder, videoProfile }),
  onProgress: (callback) => subscribe('conversion:progress', callback),
  engineStatus: () => ipcRenderer.invoke('engine:status'),
  installEngine: () => ipcRenderer.invoke('engine:install'),
  onEngine: (callback) => subscribe('engine:status', callback),
  updateStatus: () => ipcRenderer.invoke('updates:status'),
  checkUpdate: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  installReady: () => ipcRenderer.invoke('updates:ready'),
  onUpdate: (callback) => subscribe('updates:status', callback),
  about: () => ipcRenderer.invoke('app:about'),
  acknowledge: () => ipcRenderer.invoke('app:acknowledge'),
})
