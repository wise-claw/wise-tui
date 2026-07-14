/**
 * 尝试关掉卡住的 Ant Design Modal / Drawer 遮罩，恢复主 UI 可点。
 * 保守策略：只点关闭/取消类按钮，不点危险确认。
 */
export function dismissStuckAntOverlays(): number {
  if (typeof document === "undefined") return 0;
  let dismissed = 0;

  const roots = document.querySelectorAll<HTMLElement>(".ant-modal-wrap, .ant-drawer-content-wrapper");
  for (const root of roots) {
    const style = window.getComputedStyle(root);
    if (style.display === "none" || style.visibility === "hidden") continue;

    const closeBtn =
      root.querySelector<HTMLButtonElement>(".ant-modal-close") ??
      root.querySelector<HTMLButtonElement>(".ant-drawer-close");
    if (closeBtn && !closeBtn.disabled) {
      closeBtn.click();
      dismissed += 1;
      continue;
    }

    const cancelBtn = [...root.querySelectorAll<HTMLButtonElement>("button")].find((btn) => {
      if (btn.disabled) return false;
      if (btn.classList.contains("ant-btn-dangerous") || btn.classList.contains("ant-btn-primary")) {
        return false;
      }
      const text = (btn.textContent ?? "").trim();
      return text === "取消" || text === "关闭" || text === "返回" || text.toLowerCase() === "cancel";
    });
    if (cancelBtn) {
      cancelBtn.click();
      dismissed += 1;
    }
  }

  return dismissed;
}
