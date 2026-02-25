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
  btn.textContent = '抓取中...'
  output.innerHTML = '<span class="loading">正在加载页面并点击元素，捕捉 JSON 响应...</span>'

  const res = await window.api.scrape({ url, cookieFilePath, selector })

  btn.disabled = false
  btn.textContent = '开始抓取'

  if (!res.success) {
    output.innerHTML = `<div class="error">错误：${res.error}</div>`
    return
  }

  if (res.results.length === 0) {
    output.innerHTML = '<div class="error">点击后未捕捉到任何 JSON 响应</div>'
    return
  }

  output.innerHTML = res.results.map((item, i) => `
    <div class="item">
      <strong>#${i + 1} ${item.url}</strong>
      <pre>${JSON.stringify(item.data, null, 2)}</pre>
    </div>
  `).join('')
}
