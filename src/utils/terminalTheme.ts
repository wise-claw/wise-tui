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

/**
 * 等待终端容器完成布局（宽高 > 0），避免 ghostty 在 0 尺寸下 fit 导致空白屏。
 */
export function waitForTerminalContainerLayout(
  container: HTMLElement,
  timeoutMs = 4000,
): Promise<void> {
  if (container.clientWidth > 0 && container.clientHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      resolve();
    };

    const observer = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        finish();
      }
    });
    observer.observe(container);

    const poll = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        finish();
        return;
      }
      if (Date.now() >= deadline) {
        finish();
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}

function parseCssColorLuminance(color: string): number | null {
  const trimmed = color.trim();
  const rgbMatch = trimmed.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i,
  );
  if (rgbMatch) {
    const [r, g, b] = rgbMatch.slice(1, 4).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return null;
  let raw = hex[1];
  if (raw.length === 3) {
    raw = raw
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function buildAnsiPalette(isDark: boolean) {
  if (isDark) {
    return {
      black: "#1e1e1e",
      red: "#f14c4c",
      green: "#23d18b",
      yellow: "#f5f543",
      blue: "#3b8eea",
      magenta: "#d670d6",
      cyan: "#29b8db",
      white: "#e4e4e4",
      brightBlack: "#9d9d9d",
      brightRed: "#ff6b6b",
      brightGreen: "#69ff94",
      brightYellow: "#ffff6b",
      brightBlue: "#6cb6ff",
      brightMagenta: "#f0a0f0",
      brightCyan: "#6bdfff",
      brightWhite: "#ffffff",
    };
  }
  return {
    black: "#1a1a1a",
    red: "#c42b2b",
    green: "#0f7a3f",
    yellow: "#8a6d00",
    blue: "#1f5fbf",
    magenta: "#8b3d9e",
    cyan: "#0b7285",
    white: "#f0f0f0",
    brightBlack: "#4a4a4a",
    brightRed: "#e03131",
    brightGreen: "#2f9e44",
    brightYellow: "#e67700",
    brightBlue: "#1971c2",
    brightMagenta: "#9c36b5",
    brightCyan: "#0c8599",
    brightWhite: "#141414",
  };
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
  const background = readColor("--terminal-background", "#ffffff");
  const luminance = parseCssColorLuminance(background);
  const isDark = luminance !== null ? luminance < 0.45 : false;
  const foreground = isDark ? "#f2f2f2" : "#141414";
  const cursor = foreground;
  const selectionBackground = readColor(
    "--terminal-selection",
    isDark ? "rgba(100, 160, 255, 0.35)" : "rgba(24, 144, 255, 0.22)",
  );
  return {
    foreground,
    background,
    cursor,
    cursorAccent: background,
    selectionBackground,
    ...buildAnsiPalette(isDark),
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
