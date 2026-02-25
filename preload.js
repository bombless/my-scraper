const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // 原有的 scrape 方法（保留）
  scrape: (params) => ipcRenderer.invoke('scrape', params),
  
  // 新增：带网络监听的抓取方法
  scrapeWithNetwork: (params) => ipcRenderer.invoke('scrape-with-network', params),
  
  // 监听网络响应（用于实时更新，可选）
  onNetworkResponse: (callback) => {
    ipcRenderer.on('network-response', (event, data) => callback(data))
  }
})
