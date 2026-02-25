// index.js

const { app, BrowserWindow, BrowserView, ipcMain } = require('electron')
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

// 解析 Netscape 格式 cookie 文件
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

/**
 * 核心功能：加载页面 -> 点击元素 -> 捕获 JSON 响应
 */
async function captureJsonAfterClick(targetUrl, cookies, selector) {
  return new Promise(async (resolve, reject) => {
    // 1. 创建隐藏 View
    hiddenView = new BrowserView({
      webPreferences: { contextIsolation: true }
    })
    mainWindow.addBrowserView(hiddenView)
    hiddenView.setBounds({ x: -9999, y: -9999, width: 1280, height: 800 })

    const ses = hiddenView.webContents.session

    // 2. 注入 Cookies
    try {
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
      await Promise.all(injectCookies)
    } catch (e) {
      console.error("Cookie 注入失败:", e)
    }

    // 3. 挂载 Debugger (Chrome DevTools Protocol)
    // 这是捕获 Response Body 的关键
    const dbg = hiddenView.webContents.debugger
    try {
      dbg.attach('1.3')
    } catch (err) {
      reject(new Error('无法挂载调试器: ' + err.message))
      return
    }

    await dbg.sendCommand('Network.enable')

    // 用于存储捕获到的请求 ID 和 URL
    const capturedRequestIds = new Map() // requestId -> url

    // 监听网络响应
    dbg.on('message', (event, method, params) => {
      if (method === 'Network.responseReceived') {
        const mimeType = params.response.mimeType.toLowerCase()
        // 过滤：只关心 JSON 类型的响应
        if (mimeType.includes('json')) {
          capturedRequestIds.set(params.requestId, params.response.url)
        }
      }
    })

    // 4. 加载页面
    hiddenView.webContents.loadURL(targetUrl)

    hiddenView.webContents.once('did-finish-load', async () => {
      try {
        // 等待页面基础渲染
        await new Promise(r => setTimeout(r, 2000))

        console.log(`正在尝试点击选择器: ${selector}`)

        // 5. 在页面内执行 JS 点击操作
        const clickResult = await hiddenView.webContents.executeJavaScript(`
          (function() {
            const el = document.querySelector('${selector}');
            if (!el) return { found: false };
            el.click();
            return { found: true };
          })()
        `)

        if (!clickResult.found) {
          throw new Error(`未在页面上找到选择器对应的元素: ${selector}`)
        }

        // 6. 等待 AJAX 请求完成
        // 这里硬等待 3 秒，也可以根据业务需求调整
        await new Promise(r => setTimeout(r, 3000))

        // 7. 收集数据
        const results = []
        for (const [requestId, url] of capturedRequestIds) {
          try {
            // 通过 CDP 获取响应体
            const responseBody = await dbg.sendCommand('Network.getResponseBody', {
              requestId
            })
            
            // 尝试解析 JSON
            let parsedData
            if (responseBody.base64Encoded) {
               // 极少数情况 JSON 会被 base64 编码
               const buffer = Buffer.from(responseBody.body, 'base64')
               parsedData = JSON.parse(buffer.toString('utf8'))
            } else {
               parsedData = JSON.parse(responseBody.body)
            }

            results.push({
              url: url,
              data: parsedData
            })
          } catch (err) {
            console.log(`获取/解析请求 ID ${requestId} 失败:`, err.message)
            // 忽略非 JSON 内容或获取失败的请求（如预检请求等）
          }
        }

        // 清理
        dbg.detach()
        mainWindow.removeBrowserView(hiddenView)
        hiddenView.webContents.destroy()
        hiddenView = null

        resolve(results)

      } catch (err) {
        // 出错也要清理
        if (hiddenView) {
            try { dbg.detach() } catch(e){}
            mainWindow.removeBrowserView(hiddenView)
            hiddenView.webContents.destroy()
            hiddenView = null
        }
        reject(err)
      }
    })

    hiddenView.webContents.once('did-fail-load', (_, code, desc) => {
      reject(new Error(`页面加载失败: ${desc} (${code})`))
    })
  })
}

// IPC 处理
ipcMain.handle('scrape', async (_, { url, cookieFilePath, selector }) => {
  try {
    const content = fs.readFileSync(cookieFilePath, 'utf8')
    const cookies = parseNetscapeCookies(content)

    // 调用新的处理函数
    const results = await captureJsonAfterClick(url, cookies, selector)

    return { success: true, results }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
