function nodeContentOverflows(node: HTMLElement): boolean {
  return node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
}

function measureTextOverflow(
  el: HTMLElement,
  containerWidth: number,
): { horizontal: boolean; vertical: boolean } {
  if (containerWidth <= 0 || !el.textContent?.trim()) {
    return { horizontal: false, vertical: false };
  }

  const range = document.createRange();
  range.selectNodeContents(el);
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    return { horizontal: false, vertical: false };
  }

  const lineHeight = Number.parseFloat(window.getComputedStyle(el).lineHeight);
  const singleLine =
    Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : rect.height;

  return {
    horizontal: rect.width > containerWidth + 1,
    vertical: rect.height > singleLine + 1,
  };
}

function measurePlainTextWidth(text: string, referenceEl: HTMLElement | null): number {
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;white-space:nowrap;left:-9999px;top:0;";
  if (referenceEl) {
    const styles = window.getComputedStyle(referenceEl);
    probe.style.font = styles.font;
    probe.style.letterSpacing = styles.letterSpacing;
  }
  probe.textContent = text;
  document.body.appendChild(probe);
  const width = probe.offsetWidth;
  document.body.removeChild(probe);
  return width;
}

export function reasoningPreviewOverflows(bodyEl: HTMLElement, rawText: string): boolean {
  const trimmed = rawText.trim();
  if (!trimmed) return false;
  if (/\n/.test(trimmed)) return true;

  const row = bodyEl.querySelector<HTMLElement>(".app-message-part-reasoning-inline-row");
  if (!row) return false;

  if (nodeContentOverflows(row) || nodeContentOverflows(bodyEl)) return true;

  const host = bodyEl.querySelector<HTMLElement>(".app-message-part-reasoning-inline-row .app-markdown-host");
  const markdown = bodyEl.querySelector<HTMLElement>(".app-message-part-reasoning-inline-row .app-markdown");
  if (host && nodeContentOverflows(host)) return true;
  if (markdown && nodeContentOverflows(markdown)) return true;

  const containerWidth = host?.clientWidth ?? bodyEl.clientWidth;
  const measureEl = markdown ?? host;
  if (measureEl && containerWidth > 0) {
    const { horizontal, vertical } = measureTextOverflow(measureEl, containerWidth);
    if (horizontal || vertical) return true;
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  const label = bodyEl.querySelector<HTMLElement>(".app-message-part-reasoning-label");
  const rowStyles = window.getComputedStyle(row);
  const gap = Number.parseFloat(rowStyles.columnGap || rowStyles.gap || "4") || 4;
  const rowPaddingRight = Number.parseFloat(rowStyles.paddingRight || "0") || 0;
  const labelWidth = label?.offsetWidth ?? 0;
  const available = row.clientWidth - labelWidth - gap - rowPaddingRight;
  if (available <= 0) return false;

  const textWidth = measurePlainTextWidth(normalized, markdown ?? host);
  return textWidth > available + 1;
}
