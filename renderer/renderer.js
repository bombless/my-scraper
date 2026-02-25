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
  output.innerHTML = '<span class="loading">正在加载页面并监听网络请求...</span>'

  try {
    // 调用新的 scrapeWithNetwork 方法，传入 selector
    const res = await window.api.scrapeWithNetwork({ 
      url, 
      cookieFilePath, 
      selector 
    })

    btn.disabled = false
    btn.textContent = '开始抓取'

    if (!res.success) {
      output.innerHTML = `<div class="error">错误：${res.error}</div>`
      return
    }

    // 构建显示内容
    let html = ''
    
    // 显示点击的元素信息
    if (res.clickedElement) {
      html += `<div class="section">
        <h3>🖱️ 点击的元素</h3>
        <div class="item"><strong>Selector:</strong> ${selector}</div>
        <div class="item"><strong>标签:</strong> ${res.clickedElement.tagName}</div>
        <div class="item"><strong>文本:</strong> ${res.clickedElement.text || 'N/A'}</div>
      </div>`
    }

    // 显示捕获的 JSON 响应
    if (res.networkResponses && res.networkResponses.length > 0) {
      html += `<div class="section">
        <h3>📡 捕获的 JSON 响应 (${res.networkResponses.length} 条)</h3>`
      
      res.networkResponses.forEach((item, index) => {
        html += `<div class="network-item">
          <div class="request-header">
            <span class="method">${item.method}</span>
            <span class="url">${item.url}</span>
            <span class="status status-${item.status}">${item.status}</span>
          </div>
          <div class="response-body">
            <pre>${JSON.stringify(item.data, null, 2)}</pre>
          </div>
        </div>`
      })
      
      html += `</div>`
    } else {
      html += `<div class="section"><h3>📡 网络请求</h3><div class="item">未捕获到 JSON 响应</div></div>`
    }

    // 显示原始抓取结果（如果有）
    if (res.results && res.results.length > 0) {
      html += `<div class="section">
        <h3>📄 页面元素内容</h3>
        ${res.results.map(t => `<div class="item">${t}</div>`).join('')}
      </div>`
    }

    output.innerHTML = html

  } catch (error) {
    btn.disabled = false
    btn.textContent = '开始抓取'
    output.innerHTML = `<div class="error">错误：${error.message}</div>`
  }
}
