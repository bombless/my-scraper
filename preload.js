const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  scrape: (params) => ipcRenderer.invoke('scrape', params)
})
