const { app, BrowserWindow, BrowserView, ipcMain } = require('electron')
const cheerio = require('cheerio')
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

// 解析 Netscape 格式 cookie 文件（wget/curl 导出的标准格式）
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

// 用 BrowserView 模拟真实浏览器访问（带完整 JS 执行环境）
async function fetchWithBrowserView(targetUrl, cookies) {
  return new Promise((resolve, reject) => {
    // 创建隐藏的 BrowserView
    hiddenView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
      }
    })

    // 加到主窗口但移到屏幕外（不显示）
    mainWindow.addBrowserView(hiddenView)
    hiddenView.setBounds({ x: -9999, y: -9999, width: 1280, height: 800 })

    const ses = hiddenView.webContents.session

    // 注入 cookie
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

    // 等页面加载完成（包括 JS 执行）
    hiddenView.webContents.once('did-finish-load', async () => {
      try {
        // 等 JS 渲染完成（可根据需要调整时间）
        await new Promise(r => setTimeout(r, 1500))

        // 提取页面 HTML
        const html = await hiddenView.webContents.executeJavaScript(
          'document.documentElement.outerHTML'
        )

        // 清理 BrowserView
        mainWindow.removeBrowserView(hiddenView)
        hiddenView.webContents.destroy()
        hiddenView = null

        resolve(html)
      } catch (err) {
        reject(err)
      }
    })

    hiddenView.webContents.once('did-fail-load', (_, code, desc) => {
      reject(new Error(`加载失败: ${desc} (${code})`))
    })
  })
}

// IPC：接收渲染进程的抓取请求
ipcMain.handle('scrape', async (_, { url, cookieFilePath, selector }) => {
  try {
    const content = fs.readFileSync(cookieFilePath, 'utf8')
    const cookies = parseNetscapeCookies(content)

    const html = await fetchWithBrowserView(url, cookies)

    // 用 cheerio 提取数据
    const $ = cheerio.load(html)
    const results = []
    $(selector).each((_, el) => {
      results.push($(el).text().trim())
    })

    return { success: true, results, html: html.slice(0, 500) + '...' }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
