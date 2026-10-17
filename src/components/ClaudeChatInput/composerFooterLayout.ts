export function updateComposerFooterLayout(root: HTMLElement): void {
  const footer = root.querySelector<HTMLElement>(".semi-aiChatInput-footer");
  const left = root.querySelector<HTMLElement>(".app-claude-semi-footer-toolbar-left");
  const right = root.querySelector<HTMLElement>(".app-claude-semi-footer-toolbar-right");
  if (!footer || !left || !right) return;
  // 同步测量完整文字布局，再在浏览器绘制前恢复合适的显示方式。
  root.removeAttribute("data-footer-labels-compact");
  root.setAttribute("data-footer-labels-measuring", "");
  const requiredWidth = left.getBoundingClientRect().width + right.getBoundingClientRect().width;
  const style = footer.ownerDocument.defaultView!.getComputedStyle(footer);
  const availableWidth = footer.clientWidth - parseFloat(style.paddingLeft || "0")
    - parseFloat(style.paddingRight || "0") - (parseFloat(style.columnGap) || 0);
  root.removeAttribute("data-footer-labels-measuring");
  root.toggleAttribute("data-footer-labels-compact", requiredWidth > availableWidth);
}
