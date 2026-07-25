async function render() {
  const statusEl = document.getElementById("status");
  const detailEl = document.getElementById("detail");
  try {
    const res = await chrome.runtime.sendMessage({ type: "wise-page-monitor-status" });
    if (res?.activeMonitor) {
      statusEl.className = "row ok";
      statusEl.textContent = "已连接 Wise · 监控中";
      detailEl.innerHTML = [
        `<div>会话：<code>${escapeHtml(res.activeMonitor.sessionId)}</code></div>`,
        `<div>地址：<code>${escapeHtml(res.activeMonitor.url)}</code></div>`,
        `<div>桥端口：<code>${res.bridgePort}</code> · 附着标签 ${res.attachedTabs ?? 0}</div>`,
      ].join("");
    } else {
      statusEl.className = "row warn";
      statusEl.textContent = "未检测到 Wise 扩展监控";
      detailEl.innerHTML =
        `<div>请在 Wise 页面监控选择「Chrome 扩展」并开始监控。</div>` +
        `<div>桥端口探测：<code>${res?.bridgePort ?? 17321}</code></div>`;
    }
  } catch (err) {
    statusEl.className = "row warn";
    statusEl.textContent = "扩展后台未响应";
    detailEl.textContent = String(err);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

document.getElementById("refresh")?.addEventListener("click", () => {
  void render();
});
void render();
