async function render() {
  const statusEl = document.getElementById("status");
  const detailEl = document.getElementById("detail");
  const sendBtn = document.getElementById("send");
  try {
    const res = await chrome.runtime.sendMessage({ type: "wise-page-monitor-status" });
    if (res?.wiseReady) {
      statusEl.className = "row ok";
      statusEl.textContent = res.activeMonitor ? "已连接 Wise · 监控中" : "已连接 Wise · 可发送需求";
      sendBtn.disabled = false;
      const monitorRows = res.activeMonitor
        ? [
            `<div>会话：<code>${escapeHtml(res.activeMonitor.sessionId)}</code></div>`,
            `<div>地址：<code>${escapeHtml(res.activeMonitor.url)}</code></div>`,
            `<div>桥端口：<code>${res.bridgePort}</code> · 附着标签 ${res.attachedTabs ?? 0}</div>`,
          ]
        : [`<div>桥端口：<code>${res.bridgePort}</code>。页面监控未开始，仍可发送选中图文。</div>`];
      detailEl.innerHTML = monitorRows.join("");
    } else {
      statusEl.className = "row warn";
      statusEl.textContent = "未检测到 Wise 桌面端";
      sendBtn.disabled = false;
      detailEl.innerHTML =
        `<div>请先打开 Wise，再发送选中内容。页面监控需在 Wise 中选择「Chrome 扩展」并开始监控。</div>` +
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

async function sendWithType(type) {
  const resultEl = document.getElementById("send-result");
  const sendBtn = document.getElementById("send");
  const viewportBtn = document.getElementById("send-viewport");
  sendBtn.disabled = true;
  if (viewportBtn) viewportBtn.disabled = true;
  resultEl.className = "row";
  resultEl.textContent = "正在采集…请在页面确认";
  try {
    const res = await chrome.runtime.sendMessage({ type });
    if (res?.ok) {
      resultEl.className = "row ok";
      resultEl.textContent = "已发送到 Wise 作为需求";
    } else if (res?.error === "cancelled") {
      resultEl.className = "row";
      resultEl.textContent = "已取消";
    } else if (res?.error === "empty") {
      resultEl.className = "row warn";
      resultEl.textContent = "当前标签没有可发送的选区或截图";
    } else if (res?.error === "offline") {
      resultEl.className = "row warn";
      resultEl.textContent = "未连接到 Wise，请先打开桌面端";
    } else {
      resultEl.className = "row warn";
      resultEl.textContent = `发送失败：${res?.error || "未知错误"}`;
    }
  } catch (err) {
    resultEl.className = "row warn";
    resultEl.textContent = String(err);
  } finally {
    sendBtn.disabled = false;
    if (viewportBtn) viewportBtn.disabled = false;
  }
}

document.getElementById("send")?.addEventListener("click", () => {
  void sendWithType("wise-send-selection");
});

document.getElementById("send-viewport")?.addEventListener("click", () => {
  void sendWithType("wise-send-viewport");
});

void render();
