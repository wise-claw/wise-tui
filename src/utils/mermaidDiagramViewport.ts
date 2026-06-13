const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.2;

export type MermaidViewportMode = "inline" | "lightbox";

export type MermaidViewportOptions = {
  mode?: MermaidViewportMode;
  initialScale?: number | "fit" | "fit-width";
};

function readSvgDimensions(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { w: vb.width, h: vb.height };
  }
  const attrW = parseFloat(svg.getAttribute("width") ?? "");
  const attrH = parseFloat(svg.getAttribute("height") ?? "");
  if (attrW > 0 && attrH > 0) return { w: attrW, h: attrH };
  const rect = svg.getBoundingClientRect();
  return { w: rect.width || 800, h: rect.height || 600 };
}

function readViewportMetrics(viewport: HTMLElement, padX: number, padY: number) {
  const styles = getComputedStyle(viewport);
  const maxHeightRaw = styles.maxHeight;
  const maxHeight =
    maxHeightRaw && maxHeightRaw !== "none" ? parseFloat(maxHeightRaw) : viewport.clientHeight;
  return {
    availW: Math.max(1, viewport.clientWidth - padX),
    availH: Math.max(1, Math.max(viewport.clientHeight, maxHeight) - padY),
  };
}

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

function formatZoomLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

function prepareSvgForZoom(svg: SVGSVGElement): void {
  svg.style.removeProperty("max-width");
  svg.style.removeProperty("transform");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
}

export type MermaidDiagramViewportController = {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  zoomFit: () => void;
  zoomFitWidth: () => void;
  getScale: () => number;
  destroy: () => void;
};

/** 初始化流程图缩放 / 平移视口（尺寸缩放，避免 transform 模糊）。 */
export function initMermaidDiagramViewport(
  root: HTMLElement,
  opts?: MermaidViewportOptions,
): MermaidDiagramViewportController | null {
  const viewport =
    root.querySelector<HTMLElement>(".app-markdown-mermaid__viewport") ??
    root.querySelector<HTMLElement>(".app-markdown-mermaid-lightbox__viewport");
  const canvas = root.querySelector<HTMLElement>(".app-markdown-mermaid__canvas");
  const svg = canvas?.querySelector<SVGSVGElement>("svg");
  if (!viewport || !canvas || !svg) return null;

  const mode = opts?.mode ?? "inline";
  const { w: baseW, h: baseH } = readSvgDimensions(svg);
  prepareSvgForZoom(svg);

  canvas.classList.add("app-markdown-mermaid__canvas--zoomable");
  viewport.classList.add("app-markdown-mermaid__viewport--interactive");

  const styles = getComputedStyle(viewport);
  const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);

  let scale = 1;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let scrollOriginX = 0;
  let scrollOriginY = 0;

  const zoomLabel = root.querySelector<HTMLElement>("[data-mermaid-zoom-label]");

  const fitWidthScale = () => {
    const { availW } = readViewportMetrics(viewport, padX, padY);
    return clampZoom(availW / baseW);
  };

  const fitAllScale = () => {
    const { availW, availH } = readViewportMetrics(viewport, padX, padY);
    return clampZoom(Math.min(availW / baseW, availH / baseH));
  };

  const resolveInitialScale = (): number => {
    const initial = opts?.initialScale;
    if (initial === "fit") return fitAllScale();
    if (initial === "fit-width") return fitWidthScale();
    if (typeof initial === "number") return clampZoom(initial);
    if (mode === "lightbox") return clampZoom(Math.max(fitWidthScale(), 0.75));
    return 1;
  };

  const applyScale = (nextScale: number, anchor?: { x: number; y: number }): void => {
    const prev = scale;
    const clamped = clampZoom(nextScale);
    if (anchor && prev > 0) {
      const ratio = clamped / prev;
      viewport.scrollLeft = anchor.x * ratio - (anchor.x - viewport.scrollLeft);
      viewport.scrollTop = anchor.y * ratio - (anchor.y - viewport.scrollTop);
    }
    scale = clamped;
    canvas.style.width = `${baseW * scale}px`;
    canvas.style.height = `${baseH * scale}px`;
    root.setAttribute("data-mermaid-zoom", scale.toFixed(3));
    if (zoomLabel) zoomLabel.textContent = formatZoomLabel(scale);
  };

  const onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const anchor = {
      x: event.clientX - rect.left + viewport.scrollLeft,
      y: event.clientY - rect.top + viewport.scrollTop,
    };
    const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    applyScale(scale + delta, anchor);
  };

  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("[data-mermaid-action]")) return;
    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    scrollOriginX = viewport.scrollLeft;
    scrollOriginY = viewport.scrollTop;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("app-markdown-mermaid__viewport--dragging");
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    viewport.scrollLeft = scrollOriginX - (event.clientX - dragStartX);
    viewport.scrollTop = scrollOriginY - (event.clientY - dragStartY);
  };

  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    viewport.classList.remove("app-markdown-mermaid__viewport--dragging");
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
  };

  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  applyScale(resolveInitialScale());

  const destroy = (): void => {
    viewport.removeEventListener("wheel", onWheel);
    viewport.removeEventListener("pointerdown", onPointerDown);
    viewport.removeEventListener("pointermove", onPointerMove);
    viewport.removeEventListener("pointerup", endDrag);
    viewport.removeEventListener("pointercancel", endDrag);
  };

  return {
    zoomIn: () => applyScale(scale + ZOOM_STEP),
    zoomOut: () => applyScale(scale - ZOOM_STEP),
    zoomReset: () => {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      applyScale(1);
    },
    zoomFit: () => {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      applyScale(fitAllScale());
    },
    zoomFitWidth: () => {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      applyScale(fitWidthScale());
    },
    getScale: () => scale,
    destroy,
  };
}

const viewportControllers = new WeakMap<HTMLElement, MermaidDiagramViewportController>();

export function bindMermaidDiagramViewport(
  root: HTMLElement,
  opts?: MermaidViewportOptions,
): MermaidDiagramViewportController | null {
  viewportControllers.get(root)?.destroy();
  const controller = initMermaidDiagramViewport(root, opts);
  if (controller) viewportControllers.set(root, controller);
  return controller;
}

export function handleMermaidZoomAction(root: HTMLElement, action: string): boolean {
  const controller = viewportControllers.get(root);
  if (!controller) return false;
  switch (action) {
    case "zoom-in":
      controller.zoomIn();
      return true;
    case "zoom-out":
      controller.zoomOut();
      return true;
    case "zoom-reset":
      controller.zoomReset();
      return true;
    case "zoom-fit":
      controller.zoomFit();
      return true;
    case "zoom-fit-width":
      controller.zoomFitWidth();
      return true;
    default:
      return false;
  }
}

export function destroyMermaidDiagramViewport(root: HTMLElement): void {
  viewportControllers.get(root)?.destroy();
  viewportControllers.delete(root);
}
