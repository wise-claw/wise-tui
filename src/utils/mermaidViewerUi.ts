import {
  bindMermaidDiagramViewport,
  destroyMermaidDiagramViewport,
  handleMermaidZoomAction,
} from "./mermaidDiagramViewport";

const ZOOM_OUT_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 8h10"/></svg>';
const ZOOM_IN_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
const ZOOM_FIT_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/></svg>';
const EXPAND_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 9V2h7M9 2h5v5M14 7v7H7"/></svg>';
const COPY_ICON =
  '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6.25 6.25V2.92h10.83v10.83h-3.33M13.75 6.25v10.83H2.92V6.25h10.83z"/></svg>';
const CLOSE_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

const toolbarListeners = new WeakMap<HTMLElement, () => void>();

function createZoomButton(
  doc: Document,
  action: string,
  label: string,
  html: string,
  extraClass = "",
): HTMLButtonElement {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = `app-markdown-mermaid__btn ${extraClass}`.trim();
  btn.setAttribute("data-mermaid-action", action);
  btn.setAttribute("aria-label", label);
  btn.setAttribute("data-tooltip", label);
  btn.innerHTML = html;
  return btn;
}

function createMermaidZoomControls(doc: Document): HTMLDivElement {
  const group = doc.createElement("div");
  group.className = "app-markdown-mermaid__zoom-controls";

  const zoomOutBtn = createZoomButton(doc, "zoom-out", "缩小", ZOOM_OUT_ICON);
  const zoomLabelBtn = createZoomButton(doc, "zoom-reset", "重置缩放", "100%", "app-markdown-mermaid__btn--label");
  zoomLabelBtn.setAttribute("data-mermaid-zoom-label", "true");

  const zoomInBtn = createZoomButton(doc, "zoom-in", "放大", ZOOM_IN_ICON);
  const zoomFitBtn = createZoomButton(doc, "zoom-fit", "适应窗口", ZOOM_FIT_ICON);

  group.append(zoomOutBtn, zoomLabelBtn, zoomInBtn, zoomFitBtn);
  return group;
}

export function createMermaidToolbar(doc: Document, opts?: { includeExpand?: boolean }): HTMLDivElement {
  const toolbar = doc.createElement("div");
  toolbar.className = "app-markdown-mermaid__toolbar";

  toolbar.appendChild(createMermaidZoomControls(doc));

  if (opts?.includeExpand !== false) {
    const expandBtn = createZoomButton(doc, "expand", "全屏查看", EXPAND_ICON);
    toolbar.appendChild(expandBtn);
  }

  const copyBtn = createZoomButton(doc, "copy", "复制 Mermaid 源码", COPY_ICON);
  toolbar.appendChild(copyBtn);

  return toolbar;
}

function bindMermaidToolbarActions(block: HTMLElement, toolbar: HTMLElement): void {
  toolbarListeners.get(block)?.();

  const onClick = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-mermaid-action]");
    if (!button || !toolbar.contains(button)) return;
    const action = button.getAttribute("data-mermaid-action");
    if (!action) return;
    handleMermaidAction(block, action, button);
  };

  toolbar.addEventListener("click", onClick);
  toolbarListeners.set(block, () => toolbar.removeEventListener("click", onClick));
}

export function mountRenderedMermaidDiagram(
  block: HTMLElement,
  svg: string,
  doc: Document = document,
): void {
  destroyMermaidDiagramViewport(block);
  toolbarListeners.get(block)?.();
  toolbarListeners.delete(block);

  const existingSource = block.querySelector<HTMLElement>(".app-markdown-mermaid__source");
  const sourceText = existingSource?.textContent ?? "";

  block.replaceChildren();

  const toolbar = createMermaidToolbar(doc);
  const viewport = doc.createElement("div");
  viewport.className = "app-markdown-mermaid__viewport";
  const canvas = doc.createElement("div");
  canvas.className = "app-markdown-mermaid__canvas";
  canvas.innerHTML = svg;
  viewport.appendChild(canvas);
  block.append(toolbar, viewport);

  const hint = doc.createElement("div");
  hint.className = "app-markdown-mermaid__hint";
  hint.textContent = "拖拽平移 · ⌘/Ctrl + 滚轮缩放";
  block.appendChild(hint);

  if (sourceText) {
    const sourceEl = doc.createElement("pre");
    sourceEl.className = "app-markdown-mermaid__source";
    sourceEl.hidden = true;
    sourceEl.textContent = sourceText;
    block.appendChild(sourceEl);
  }

  block.classList.add("app-markdown-mermaid--rendered");
  block.setAttribute("data-mermaid-rendered", "true");
  block.setAttribute("aria-label", "流程图");
  bindMermaidToolbarActions(block, toolbar);
  bindMermaidDiagramViewport(block, { mode: "inline", initialScale: 1 });
}

function readMermaidSource(block: Element): string {
  return block.querySelector(".app-markdown-mermaid__source")?.textContent?.trim() ?? "";
}

function readMermaidCanvasHtml(block: Element): string {
  const svg = block.querySelector(".app-markdown-mermaid__canvas svg");
  return svg ? svg.outerHTML : "";
}

type MermaidLightboxOverlay = HTMLElement & { __mermaidKeyDown?: (event: KeyboardEvent) => void };

function closeMermaidLightbox(overlay: HTMLElement): void {
  const panel = overlay.querySelector<HTMLElement>(".app-markdown-mermaid-lightbox__panel");
  if (panel) destroyMermaidDiagramViewport(panel);
  const keyHandler = (overlay as MermaidLightboxOverlay).__mermaidKeyDown;
  if (keyHandler) {
    document.removeEventListener("keydown", keyHandler);
    delete (overlay as MermaidLightboxOverlay).__mermaidKeyDown;
  }
  overlay.remove();
  if (!document.querySelector(".app-markdown-mermaid-lightbox")) {
    document.body.style.overflow = "";
  }
}

function handleMermaidAction(block: HTMLElement, action: string, button: HTMLButtonElement): void {
  if (handleMermaidZoomAction(block, action)) return;
  if (action === "expand") {
    openMermaidLightbox(block);
    return;
  }
  if (action === "copy") {
    void copyMermaidSourceFromBlock(block, button);
  }
}

export function openMermaidLightbox(block: Element): void {
  const canvasHtml = readMermaidCanvasHtml(block);
  if (!canvasHtml) return;

  const overlay = document.createElement("div");
  overlay.className = "app-markdown-mermaid-lightbox";
  overlay.innerHTML = `
    <div class="app-markdown-mermaid-lightbox__panel" role="dialog" aria-modal="true" aria-label="流程图预览">
      <div class="app-markdown-mermaid-lightbox__toolbar">
        <span class="app-markdown-mermaid-lightbox__title">流程图</span>
        <div class="app-markdown-mermaid-lightbox__actions"></div>
      </div>
      <div class="app-markdown-mermaid-lightbox__viewport">
        <div class="app-markdown-mermaid__canvas">${canvasHtml}</div>
      </div>
    </div>
  `;

  const panel = overlay.querySelector<HTMLElement>(".app-markdown-mermaid-lightbox__panel");
  const actions = overlay.querySelector<HTMLElement>(".app-markdown-mermaid-lightbox__actions");
  if (panel && actions) {
    actions.appendChild(createMermaidZoomControls(document));
    const copyBtn = createZoomButton(document, "copy", "复制 Mermaid 源码", COPY_ICON);
    const closeBtn = createZoomButton(document, "close", "关闭", CLOSE_ICON);
    actions.append(copyBtn, closeBtn);
  }

  const source = readMermaidSource(block);
  if (source && panel) {
    const sourceEl = document.createElement("pre");
    sourceEl.className = "app-markdown-mermaid__source";
    sourceEl.hidden = true;
    sourceEl.textContent = source;
    panel.appendChild(sourceEl);
  }

  overlay.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target === overlay) {
      closeMermaidLightbox(overlay);
      return;
    }
    const actionEl = target.closest<HTMLElement>("[data-mermaid-action]");
    if (!actionEl || !panel) return;
    const action = actionEl.getAttribute("data-mermaid-action");
    if (action === "close") {
      closeMermaidLightbox(overlay);
      return;
    }
    handleMermaidAction(panel, action ?? "", actionEl as HTMLButtonElement);
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeMermaidLightbox(overlay);
  };
  (overlay as MermaidLightboxOverlay).__mermaidKeyDown = onKeyDown;
  document.addEventListener("keydown", onKeyDown);

  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  if (panel) bindMermaidDiagramViewport(panel, { mode: "lightbox" });
}

async function copyMermaidSourceFromBlock(block: Element, button: HTMLButtonElement): Promise<boolean> {
  const source = readMermaidSource(block);
  if (!source) return false;
  try {
    await navigator.clipboard.writeText(source);
    button.setAttribute("data-copied", "true");
    button.setAttribute("data-tooltip", "已复制");
    window.setTimeout(() => {
      button.removeAttribute("data-copied");
      button.setAttribute("data-tooltip", "复制");
    }, 2000);
    return true;
  } catch {
    return false;
  }
}

/**
 * @deprecated 工具栏与全屏预览已在 mount/open 时自绑定；保留空实现以免旧调用方报错。
 */
export function attachMermaidViewerInteractions(_container: HTMLElement): () => void {
  return () => {};
}
