import type { FitAddon, Terminal } from "ghostty-web";
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

/** 终端 canvas 至少需要的布局尺寸，避免 1px 容器导致 fit 失败。 */
const MIN_TERMINAL_LAYOUT_PX = 32;

/** 空白屏 / 布局 settle：多阶段延迟（ms），逐级重试 remeasure + fit + 全量重绘。 */
export const TERMINAL_BLANK_RECOVERY_DELAYS_MS = [50, 120, 280, 520, 900] as const;

/** @deprecated 使用 {@link TERMINAL_BLANK_RECOVERY_DELAYS_MS} */
export const TERMINAL_LAYOUT_SETTLE_DELAYS_MS = TERMINAL_BLANK_RECOVERY_DELAYS_MS;

function terminalLayoutReady(container: HTMLElement): boolean {
  return (
    container.clientWidth >= MIN_TERMINAL_LAYOUT_PX &&
    container.clientHeight >= MIN_TERMINAL_LAYOUT_PX
  );
}

/**
 * 强制 ghostty canvas 全量重绘。
 * attach/replay/fit 后 dirty 区可能不完整，表现为「画面乱、按 Enter 才正常」。
 */
export function forceTerminalFullRedraw(terminal: Terminal): void {
  const renderer = terminal.renderer as
    | {
        render?: (
          buffer: unknown,
          forceAll?: boolean,
          viewportY?: number,
          scrollbackProvider?: unknown,
          scrollbarOpacity?: number,
        ) => void;
      }
    | undefined;
  const wasmTerm = terminal.wasmTerm;
  if (!renderer?.render || !wasmTerm) return;
  try {
    renderer.render(wasmTerm, true, terminal.getViewportY(), terminal);
  } catch {
    // ignore renderer errors during dispose / not-open
  }
}

/** 判断终端 buffer 是否尚无可见字符（仅有光标）。 */
export function terminalBufferLooksEmpty(terminal: Terminal): boolean {
  try {
    const buffer = terminal.buffer.active;
    const lines = Math.min(buffer.length, terminal.rows);
    for (let y = 0; y < lines; y += 1) {
      const line = buffer.getLine(y);
      if (!line) continue;
      for (let x = 0; x < line.length; x += 1) {
        const cell = line.getCell(x);
        const chars = cell?.getChars?.() ?? "";
        if (chars.trim().length > 0) {
          return false;
        }
      }
    }
  } catch {
    return false;
  }
  return true;
}

/** surface 尺寸异常或 buffer 为空时视为空白屏。 */
export function terminalNeedsBlankRecovery(
  container: HTMLElement,
  terminal: Terminal,
): boolean {
  return (
    terminalSurfaceLooksBlank(container, terminal) ||
    terminalBufferLooksEmpty(terminal)
  );
}

/** 判断终端 surface 是否尚未正确渲染（无 canvas 或尺寸异常）。 */
export function terminalSurfaceLooksBlank(
  container: HTMLElement,
  terminal: Terminal,
): boolean {
  const canvas = container.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) return true;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < MIN_TERMINAL_LAYOUT_PX || rect.height < MIN_TERMINAL_LAYOUT_PX) {
    return true;
  }
  return terminal.cols < 2 || terminal.rows < 2;
}

/** remeasure 字体后 fit，并强制全量重绘。 */
export function forceTerminalRemeasureAndFit(
  terminal: Terminal,
  fitAddon: FitAddon,
  container: HTMLElement,
): void {
  (
    terminal.renderer as { remeasureFont?: () => void } | undefined
  )?.remeasureFont?.();
  fitAddon.fit();
  reconcileTerminalCanvasFit(terminal, container);
  forceTerminalFullRedraw(terminal);
}

/**
 * 等待终端容器完成布局，避免 ghostty 在过小尺寸下 fit 导致空白屏。
 */
export function waitForTerminalContainerLayout(
  container: HTMLElement,
  timeoutMs = 5000,
): Promise<void> {
  if (terminalLayoutReady(container)) {
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
      if (terminalLayoutReady(container)) {
        finish();
      }
    });
    observer.observe(container);

    const poll = () => {
      if (terminalLayoutReady(container)) {
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

/**
 * 等待容器尺寸连续若干帧不变，再打开/fit PTY。
 * 面板刚展开时宽高常抖动；过早 open 会导致 shell 用错误 COLUMNS 折行，需按 Enter 才恢复。
 */
export async function waitForTerminalContainerStableLayout(
  container: HTMLElement,
  options?: { timeoutMs?: number; stableFrames?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const stableFrames = Math.max(1, options?.stableFrames ?? 3);
  await waitForTerminalContainerLayout(container, timeoutMs);

  const deadline = Date.now() + timeoutMs;
  let lastW = container.clientWidth;
  let lastH = container.clientHeight;
  let stableCount = 0;

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    const nextW = container.clientWidth;
    const nextH = container.clientHeight;
    if (
      nextW === lastW &&
      nextH === lastH &&
      terminalLayoutReady(container)
    ) {
      stableCount += 1;
      if (stableCount >= stableFrames) {
        return;
      }
      continue;
    }
    stableCount = 0;
    lastW = nextW;
    lastH = nextH;
  }
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
    brightBlack: "#333333",
    brightRed: "#e03131",
    brightGreen: "#2f9e44",
    brightYellow: "#e67700",
    brightBlue: "#1971c2",
    brightMagenta: "#9c36b5",
    brightCyan: "#0c8599",
    brightWhite: "#0a0a0a",
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
  const foreground = isDark ? "#f5f5f5" : "#0a0a0a";
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
