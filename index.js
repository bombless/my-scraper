const { app, BrowserWindow, ipcMain } = require('electron')
const puppeteer = require('puppeteer') // 或 puppeteer-core


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


// 存储网络响应的数组
let networkResponses = []

ipcMain.handle('scrape-with-network', async (event, { url, cookieFilePath, selector }) => {
  let browser = null
  networkResponses = [] // 重置
  
  try {
    // 读取 cookies
    let cookies = []
    if (fs.existsSync(cookieFilePath)) {
      const cookieData = fs.readFileSync(cookieFilePath, 'utf8')
      cookies = JSON.parse(cookieData)
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })

    const page = await browser.newPage()
    
    // 设置 cookies
    if (cookies.length > 0) {
      await page.setCookie(...cookies)
    }

    // 监听所有网络响应
    await page.setRequestInterception(true)
    
    page.on('request', (request) => {
      request.continue() // 继续请求
    })

    page.on('response', async (response) => {
      try {
        const request = response.request()
        const contentType = response.headers()['content-type'] || ''
        
        // 只处理 JSON 响应
        if (contentType.includes('application/json')) {
          const url = request.url()
          const method = request.method()
          const status = response.status()
          
          try {
            const data = await response.json()
            
            const networkData = {
              url: url,
              method: method,
              status: status,
              timestamp: new Date().toISOString(),
              data: data
            }
            
            networkResponses.push(networkData)
            
            // 可选：实时发送到渲染进程
            event.sender.send('network-response', networkData)
            
          } catch (e) {
            // JSON 解析失败，忽略
          }
        }
      } catch (error) {
        console.error('网络监听错误:', error)
      }
    })

    // 加载页面
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    // 等待选择器出现
    await page.waitForSelector(selector, { timeout: 10000 })

    // 获取点击前的元素信息
    const elementInfo = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      return {
        tagName: el.tagName,
        text: el.textContent?.trim().substring(0, 100) || '',
        href: el.href || null
      }
    }, selector)

    // 点击元素（这会触发 AJAX/fetch）
    await page.click(selector)

    // 等待一段时间让 AJAX 请求完成（可根据需要调整）
    const sleep = ms => new Promise(res => setTimeout(res, ms));

    (async () => {
      console.log(new Date().getSeconds());
      await sleep(3000);
      console.log(new Date().getSeconds());
    })();
    // 或者等待特定条件：await page.waitForResponse(response => response.url().includes('api'))

    // 获取页面内容（可选）
    const results = await page.evaluate((sel) => {
      const elements = document.querySelectorAll(sel)
      return Array.from(elements).map(el => el.textContent?.trim() || '')
    }, selector)

    await browser.close()

    return {
      success: true,
      clickedElement: elementInfo,
      networkResponses: networkResponses,
      results: results
    }

  } catch (error) {
    if (browser) await browser.close()
    return {
      success: false,
      error: error.message
    }
  }
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
