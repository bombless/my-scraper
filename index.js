const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron')
const fs = require('fs')
const path = require('path')

let mainWindow
let hiddenView

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    }
  })
  mainWindow.loadFile('renderer/index.html')
}

function parseNetscapeCookies(content) {
  const cookies = []
  for (const line of content.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 7) continue
    cookies.push({
      domain: parts[0],
      httpOnly: parts[1] === 'TRUE',
      path: parts[2],
      secure: parts[3] === 'TRUE',
      expirationDate: parseInt(parts[4]),
      name: parts[5],
      value: parts[6].trim(),
    })
  }
  return cookies
}

async function fetchWithClick(targetUrl, cookies, selector) {
  return new Promise((resolve, reject) => {
    hiddenView = new BrowserView({
      webPreferences: { contextIsolation: true }
    })
    mainWindow.addBrowserView(hiddenView)
    hiddenView.setBounds({ x: -9999, y: -9999, width: 1280, height: 800 })

    const ses = hiddenView.webContents.session
    const collectedResponses = []

    // ---- 拦截网络响应，收集 JSON ----
    ses.webRequest.onCompleted({ urls: ['<all_urls>'] }, async (details) => {
      const ct = (details.responseHeaders?.['content-type'] || []).join('')
      if (!ct.includes('application/json') && !ct.includes('text/json')) return
      // Electron 无法直接拿到响应体，需借助 debugger 协议（见下方）
    })

    // 用 Chrome DevTools Protocol 拿响应体
    hiddenView.webContents.debugger.attach('1.3')
    hiddenView.webContents.debugger.sendCommand('Network.enable')

    const responseBodyMap = {}

    hiddenView.webContents.debugger.on('message', async (_, method, params) => {
      try {
        if (method === 'Network.responseReceived') {
          const ct = params.response.mimeType || ''
          if (ct.includes('json')) {
            responseBodyMap[params.requestId] = { url: params.response.url }
          }
        }
        if (method === 'Network.loadingFinished') {
          if (responseBodyMap[params.requestId]) {
            try {
              const result = await hiddenView.webContents.debugger.sendCommand(
                'Network.getResponseBody',
                { requestId: params.requestId }
              )
              const bodyStr = result.base64Encoded
                ? Buffer.from(result.body, 'base64').toString('utf8')
                : result.body
              const json = JSON.parse(bodyStr)
              collectedResponses.push({
                url: responseBodyMap[params.requestId].url,
                data: json,
              })
            } catch (_) {
              // 解析失败跳过
            }
            delete responseBodyMap[params.requestId]
          }
        }
      } catch (_) {}
    })

    // ---- 注入 cookie 并加载页面 ----
    const injectCookies = cookies.map(c =>
      ses.cookies.set({
        url: targetUrl,
        name: c.name,
        value: c.value,
        domain: c.domain.replace(/^\./, ''),
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate,
      })
    )

    Promise.all(injectCookies).then(() => {
      hiddenView.webContents.loadURL(targetUrl)
    })

    hiddenView.webContents.once('did-finish-load', async () => {
      try {
        // 等页面 JS 渲染
        await new Promise(r => setTimeout(r, 1500))

        // 点击 selector
        const clicked = await hiddenView.webContents.executeJavaScript(`
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return false;
            el.click();
            return true;
          })()
        `)

        if (!clicked) {
          throw new Error(`未找到选择器对应的元素：${selector}`)
        }

        // 等待点击后的请求完成（可按需调整）
        await new Promise(r => setTimeout(r, 3000))

        // 清理
        try { hiddenView.webContents.debugger.detach() } catch (_) {}
        mainWindow.removeBrowserView(hiddenView)
        hiddenView.webContents.destroy()
        hiddenView = null

        resolve(collectedResponses)
      } catch (err) {
        reject(err)
      }
    })

    hiddenView.webContents.once('did-fail-load', (_, code, desc) => {
      reject(new Error(`加载失败: ${desc} (${code})`))
    })
  })
}

ipcMain.handle('scrape', async (_, { url, cookieFilePath, selector }) => {
  try {
    const content = fs.readFileSync(cookieFilePath, 'utf8')
    const cookies = parseNetscapeCookies(content)
    const responses = await fetchWithClick(url, cookies, selector)
    return { success: true, results: responses }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
