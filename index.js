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

// 用 BrowserView 加载页面、点击元素、捕获 AJAX JSON 响应
async function clickAndCaptureAjax(targetUrl, cookies, selector) {
  return new Promise((resolve, reject) => {
    hiddenView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
      }
    })

    mainWindow.addBrowserView(hiddenView)
    // 调试阶段可以把坐标改成 { x: 0, y: 0, ... } 来观察页面
    hiddenView.setBounds({ x: -9999, y: -9999, width: 1280, height: 800 })

    const ses = hiddenView.webContents.session
    const wc = hiddenView.webContents

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
      wc.loadURL(targetUrl)
    })

    wc.once('did-finish-load', async () => {
      try {
        // 等待页面 JS 渲染完成
        await new Promise(r => setTimeout(r, 2000))

        // ============ 第一步：注入拦截脚本 ============
        // 在页面里 monkey-patch fetch 和 XMLHttpRequest，
        // 把所有 JSON 响应存到 window.__capturedJsonResponses 数组
        await wc.executeJavaScript(`
          (function() {
            window.__capturedJsonResponses = [];
            window.__captureFinished = false;

            // ---------- 拦截 fetch ----------
            const originalFetch = window.fetch;
            window.fetch = async function(...args) {
              const response = await originalFetch.apply(this, args);
              try {
                const clone = response.clone();
                const contentType = clone.headers.get('content-type') || '';
                if (contentType.includes('application/json') || contentType.includes('text/json')) {
                  const json = await clone.json();
                  window.__capturedJsonResponses.push({
                    type: 'fetch',
                    url: typeof args[0] === 'string' ? args[0] : (args[0].url || ''),
                    status: clone.status,
                    data: json
                  });
                } else {
                  // 尝试解析，有些接口不设 content-type
                  const text = await clone.text();
                  try {
                    const json = JSON.parse(text);
                    window.__capturedJsonResponses.push({
                      type: 'fetch',
                      url: typeof args[0] === 'string' ? args[0] : (args[0].url || ''),
                      status: clone.status,
                      data: json
                    });
                  } catch(e) {}
                }
              } catch(e) {}
              return response;
            };

            // ---------- 拦截 XMLHttpRequest ----------
            const originalXHROpen = XMLHttpRequest.prototype.open;
            const originalXHRSend = XMLHttpRequest.prototype.send;

            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
              this.__capturedUrl = url;
              this.__capturedMethod = method;
              return originalXHROpen.apply(this, [method, url, ...rest]);
            };

            XMLHttpRequest.prototype.send = function(...args) {
              this.addEventListener('load', function() {
                try {
                  const contentType = this.getResponseHeader('content-type') || '';
                  let parsed = null;
                  if (contentType.includes('application/json') || contentType.includes('text/json')) {
                    parsed = JSON.parse(this.responseText);
                  } else {
                    try { parsed = JSON.parse(this.responseText); } catch(e) {}
                  }
                  if (parsed !== null) {
                    window.__capturedJsonResponses.push({
                      type: 'xhr',
                      method: this.__capturedMethod,
                      url: this.__capturedUrl,
                      status: this.status,
                      data: parsed
                    });
                  }
                } catch(e) {}
              });
              return originalXHRSend.apply(this, args);
            };
          })();
          true;
        `)

        // ============ 第二步：点击目标元素 ============
        const clickResult = await wc.executeJavaScript(`
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { found: false };
            el.click();
            return { found: true, tag: el.tagName, text: el.textContent.trim().slice(0, 100) };
          })();
        `)

        if (!clickResult.found) {
          // 清理
          mainWindow.removeBrowserView(hiddenView)
          wc.destroy()
          hiddenView = null
          resolve({
            success: false,
            error: `未找到选择器 "${selector}" 对应的元素`
          })
          return
        }

        // ============ 第三步：等待 AJAX 请求完成 ============
        // 每 500ms 检查一次，如果连续 2 次数量不变则认为请求结束
        // 最多等 15 秒
        let lastCount = 0
        let stableCount = 0
        const maxWait = 15000
        const interval = 500
        let waited = 0

        await new Promise((res) => {
          const timer = setInterval(async () => {
            waited += interval
            const count = await wc.executeJavaScript(
              'window.__capturedJsonResponses.length'
            )
            if (count === lastCount) {
              stableCount++
            } else {
              stableCount = 0
              lastCount = count
            }
            // 连续 2 次（1 秒）数量稳定，或超时
            if ((stableCount >= 2 && count > 0) || waited >= maxWait) {
              clearInterval(timer)
              res()
            }
          }, interval)
        })

        // ============ 第四步：收集结果 ============
        const captured = await wc.executeJavaScript(
          'JSON.stringify(window.__capturedJsonResponses)'
        )

        // 清理 BrowserView
        mainWindow.removeBrowserView(hiddenView)
        wc.destroy()
        hiddenView = null

        const jsonResponses = JSON.parse(captured)

        resolve({
          success: true,
          clickedElement: clickResult,
          responses: jsonResponses
        })
      } catch (err) {
        reject(err)
      }
    })

    wc.once('did-fail-load', (_, code, desc) => {
      reject(new Error(`加载失败: ${desc} (${code})`))
    })
  })
}

// IPC：接收渲染进程的抓取请求
ipcMain.handle('scrape', async (_, { url, cookieFilePath, selector }) => {
  try {
    const content = fs.readFileSync(cookieFilePath, 'utf8')
    const cookies = parseNetscapeCookies(content)

    const result = await clickAndCaptureAjax(url, cookies, selector)
    return result
  } catch (err) {
    return { success: false, error: err.message }
  }
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
