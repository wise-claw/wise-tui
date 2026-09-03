/** 顶栏拖窗口期间禁止划选；mouseup / blur 后恢复。返回清理函数。 */
export function suppressTextSelectionUntilMouseUp(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }
  const onSelectStart = (event: Event) => {
    event.preventDefault();
  };
  document.addEventListener("selectstart", onSelectStart, true);
  window.getSelection()?.removeAllRanges();

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.removeEventListener("selectstart", onSelectStart, true);
    window.removeEventListener("mouseup", cleanup, true);
    window.removeEventListener("blur", cleanup);
  };
  window.addEventListener("mouseup", cleanup, true);
  window.addEventListener("blur", cleanup);
  return cleanup;
}
