import type { Terminal } from "ghostty-web";
import { UrlRegexProvider } from "ghostty-web";
import { openExternalUrl } from "../services/openExternal";

/** 将 ghostty 隐藏的 1×1 textarea 移出视口，避免左上角出现浏览器插入符。 */
export function configureGhosttyInputSurface(terminal: Terminal): () => void {
  const element = terminal.element;
  const textarea = terminal.textarea;
  if (textarea) {
    textarea.style.caretColor = "transparent";
    textarea.style.color = "transparent";
    textarea.style.background = "transparent";
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
  }
  if (!element) {
    return () => undefined;
  }

  // ghostty open() 会设 contenteditable，WebKit 会插入占位 <br> 把 canvas 顶下去。
  element.removeAttribute("contenteditable");
  element.style.userSelect = "none";
  element.style.webkitUserSelect = "none";

  const removePlaceholderBreaks = () => {
    for (const node of element.querySelectorAll(":scope > br")) {
      node.remove();
    }
  };
  removePlaceholderBreaks();

  const preventNativeSelection = (event: Event) => {
    event.preventDefault();
  };
  element.addEventListener("selectstart", preventNativeSelection);

  const placeholderObserver =
    typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => {
          removePlaceholderBreaks();
        })
      : null;
  placeholderObserver?.observe(element, { childList: true });

  return () => {
    element.removeEventListener("selectstart", preventNativeSelection);
    placeholderObserver?.disconnect();
  };
}

/**
 * FitAddon 偶发多算一行（字体度量与 canvas 像素高度不同步）。
 * 以容器实际高度为上限收紧 rows，避免末行被 overflow 裁成半截。
 */
export function reconcileTerminalCanvasFit(
  terminal: Terminal,
  container: HTMLElement,
): void {
  const renderer = terminal.renderer as
    | { getMetrics?: () => { width: number; height: number } }
    | undefined;
  const getMetrics = renderer?.getMetrics;
  if (!getMetrics) return;

  const metrics = getMetrics.call(renderer);
  if (!metrics?.height || !metrics?.width) return;

  const availableHeight = container.clientHeight;
  const availableWidth = container.clientWidth;
  if (availableHeight <= 0 || availableWidth <= 0) return;

  const scrollbarReserve = 15;
  const maxRows = Math.max(1, Math.floor(availableHeight / metrics.height));
  const maxCols = Math.max(
    2,
    Math.floor((availableWidth - scrollbarReserve) / metrics.width),
  );

  if (terminal.rows > maxRows || terminal.cols > maxCols) {
    terminal.resize(
      Math.min(terminal.cols, maxCols),
      Math.min(terminal.rows, maxRows),
    );
    return;
  }

  const canvas = container.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const canvasHeight = canvas.getBoundingClientRect().height;
  if (canvasHeight > availableHeight + 0.5 && terminal.rows > 1) {
    terminal.resize(terminal.cols, terminal.rows - 1);
  }
}

/** 注册 URL 链接识别，Shift/Cmd+点击时打开外部浏览器。 */
export function registerTerminalLinkProviders(terminal: Terminal): () => void {
  const provider = new UrlRegexProvider(terminal);
  terminal.registerLinkProvider({
    provideLinks(y, callback) {
      provider.provideLinks(y, (links) => {
        if (!links?.length) {
          callback(undefined);
          return;
        }
        callback(
          links.map((link) => ({
            ...link,
            activate(event: MouseEvent) {
              if (!event.shiftKey && !event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              event.stopImmediatePropagation();
              void openExternalUrl(link.text);
            },
          })),
        );
      });
    },
    dispose() {
      provider.dispose?.();
    },
  });
  return () => {
    provider.dispose?.();
  };
}

/**
 * 从容器 CSS 变量读取终端主题色，随 Ant Design 浅/深色自动切换。
 */
export function readTerminalThemeFromContainer(container: HTMLElement) {
  const styles = getComputedStyle(container);
  const readColor = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };
  const foreground = readColor("--terminal-foreground", "#1f1f1f");
  const background = readColor("--terminal-background", "#ffffff");
  const cursor = readColor("--terminal-cursor", foreground);
  const selectionBackground = readColor(
    "--terminal-selection",
    "rgba(100, 200, 255, 0.25)",
  );
  return {
    foreground,
    background,
    cursor,
    cursorAccent: background,
    selectionBackground,
  };
}

/** 监听主题相关 CSS 变量变化并回调。 */
export function observeTerminalTheme(
  container: HTMLElement,
  onThemeChange: () => void,
): () => void {
  if (typeof MutationObserver === "undefined") {
    return () => undefined;
  }
  const observer = new MutationObserver(() => onThemeChange());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "style"],
  });
  observer.observe(container, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  return () => observer.disconnect();
}
