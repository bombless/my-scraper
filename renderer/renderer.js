// renderer.js

async function doScrape() {
  const url = document.getElementById('url').value.trim()
  const cookieFilePath = document.getElementById('cookiePath').value.trim()
  const selector = document.getElementById('selector').value.trim()
  const btn = document.getElementById('btn')
  const output = document.getElementById('output')

  if (!url || !cookieFilePath || !selector) {
    output.innerHTML = '<div class="error">请填写所有字段</div>'
    return
  }

  btn.disabled = true
  btn.textContent = '触发点击并捕获中...'
  // 清空之前的输出
  output.innerHTML = '<span class="loading">正在加载页面并等待点击响应（约需几秒钟）...</span>'

  const res = await window.api.scrape({ url, cookieFilePath, selector })

  btn.disabled = false
  btn.textContent = '开始抓取'

  if (!res.success) {
    output.innerHTML = `<div class="error">错误：${res.error}</div>`
    return
  }

  if (res.results.length === 0) {
    output.innerHTML = '<div class="error">点击后未捕获到 JSON 格式的响应。</div>'
    return
  }

  // 将结果格式化为 JSON 字符串显示
  output.innerHTML = res.results
    .map((item, index) => `
      <div class="item" style="margin-bottom: 20px; border-bottom: 1px solid #ccc; padding-bottom: 10px;">
        <strong>请求 #${index + 1} URL:</strong> <span style="font-size:12px; color:#666;">${item.url}</span>
        <pre style="background: #f4f4f4; padding: 10px; overflow-x: auto;">${JSON.stringify(item.data, null, 2)}</pre>
      </div>
    `)
    .join('')
}
