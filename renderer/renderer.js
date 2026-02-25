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
  output.innerHTML = '<span class="loading">正在加载页面并点击元素，捕获 AJAX 响应...</span>'

  const res = await window.api.scrape({ url, cookieFilePath, selector })

  btn.disabled = false
  btn.textContent = '开始抓取'

  if (!res.success) {
    output.innerHTML = `<div class="error">错误：${res.error}</div>`
    return
  }

  // 显示点击信息
  let html = `<div class="item" style="background:#e8f5e9;margin-bottom:16px;padding:10px;border-radius:6px;">
    ✅ 已点击元素：<strong>&lt;${res.clickedElement.tag}&gt;</strong>
    ${res.clickedElement.text ? ` — "${res.clickedElement.text}"` : ''}
  </div>`

  if (res.responses.length === 0) {
    html += '<div class="error">点击后未捕获到任何 JSON 响应</div>'
  } else {
    html += `<div style="margin-bottom:10px;font-weight:bold;">
      共捕获 ${res.responses.length} 个 JSON 响应：
    </div>`

    res.responses.forEach((resp, index) => {
      // 截断过长的 URL
      const displayUrl = resp.url.length > 120
        ? resp.url.slice(0, 120) + '...'
        : resp.url

      const typeLabel = resp.type === 'fetch' ? 'Fetch' : 'XHR'
      const methodLabel = resp.method ? resp.method.toUpperCase() : 'GET'
      const statusColor = resp.status >= 200 && resp.status < 300
        ? '#4caf50'
        : '#f44336'

      // JSON 数据格式化，限制显示长度
      let jsonStr
      try {
        jsonStr = JSON.stringify(resp.data, null, 2)
      } catch {
        jsonStr = String(resp.data)
      }

      html += `
        <div class="item" style="margin-bottom:12px;border:1px solid #ddd;border-radius:8px;overflow:hidden;">
          <div style="background:#f5f5f5;padding:8px 12px;font-size:13px;border-bottom:1px solid #ddd;">
            <strong>#${index + 1}</strong>
            &nbsp;
            <span style="background:#1976d2;color:#fff;padding:2px 6px;border-radius:3px;font-size:11px;">
              ${typeLabel}
            </span>
            &nbsp;
            <span style="background:#555;color:#fff;padding:2px 6px;border-radius:3px;font-size:11px;">
              ${methodLabel}
            </span>
            &nbsp;
            <span style="color:${statusColor};font-weight:bold;">${resp.status}</span>
            &nbsp;
            <span style="color:#666;word-break:break-all;font-size:12px;" title="${escapeHtml(resp.url)}">
              ${escapeHtml(displayUrl)}
            </span>
          </div>
          <div style="padding:10px 12px;max-height:400px;overflow:auto;">
            <pre style="margin:0;font-size:12px;white-space:pre-wrap;word-break:break-all;">${escapeHtml(jsonStr)}</pre>
          </div>
        </div>
      `
    })
  }

  output.innerHTML = html
}

// HTML 转义，防止 XSS
function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}
