import type { TerminalCellRun, TerminalFrame } from "../types/terminal";
import {
  normalizeTerminalSelection,
  terminalSelectionIsEmpty,
  type TerminalSelectionRange,
} from "./terminalSelection";

const FONT_FAMILY =
  '"JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "MesloLGS NF", "Hack Nerd Font Mono", "SF Mono", Menlo, Monaco, "Courier New", monospace';
export const TERMINAL_FONT_SIZE = 13;
export const TERMINAL_LINE_HEIGHT = 1.35;

/** Canvas 自绘需要的四个颜色；权威来源是 `TerminalPanel/index.css` 的 `--terminal-*`。 */
export type TerminalPalette = {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
};

/** 深色兜底：与 CSS `:root[data-wise-theme="dark"]` / Rust `DARK_PALETTE` 对齐（Catppuccin Mocha）。 */
export const TERMINAL_DARK_PALETTE: TerminalPalette = {
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  cursor: "#f5e0dc",
  selection: "rgba(137, 180, 250, 0.35)",
};

/** 浅色兜底：与 CSS `.terminal-panel` / Rust `LIGHT_PALETTE` 对齐（Catppuccin Latte）。 */
export const TERMINAL_LIGHT_PALETTE: TerminalPalette = {
  background: "#eff1f5",
  foreground: "#4c4f69",
  cursor: "#dc8a78",
  selection: "rgba(30, 102, 245, 0.22)",
};

export function terminalFallbackPalette(dark: boolean): TerminalPalette {
  return dark ? TERMINAL_DARK_PALETTE : TERMINAL_LIGHT_PALETTE;
}

/**
 * 终端 canvas 最大 DPR。Retina 用 2 保持清晰；绘制过慢时由自适应降到 1，
 * 减轻低配/内存紧张时的整屏闪烁（见 noteTerminalPaintDuration）。
 */
export const TERMINAL_MAX_DEVICE_PIXEL_RATIO = 2;

/** 自适应质量上限：正常为 MAX，卡顿时降为 1。 */
let adaptiveMaxDevicePixelRatio = TERMINAL_MAX_DEVICE_PIXEL_RATIO;
let slowPaintStreak = 0;
let fastPaintStreak = 0;

export type TerminalMetrics = {
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
};

type TerminalCanvasState = {
  ctx: CanvasRenderingContext2D;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
};

const canvasStates = new WeakMap<HTMLCanvasElement, TerminalCanvasState>();

/** 测量用共享 canvas，避免每次 measure 都新建。 */
let measureCtx: CanvasRenderingContext2D | null | undefined;

export function terminalDevicePixelRatio(
  devicePixelRatio = typeof window !== "undefined" ? window.devicePixelRatio : 1,
  maxRatio = adaptiveMaxDevicePixelRatio,
): number {
  const dpr = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  const cap = Math.min(
    TERMINAL_MAX_DEVICE_PIXEL_RATIO,
    Math.max(1, maxRatio),
  );
  return Math.min(Math.max(1, dpr), cap);
}

/** 根据单帧耗时调节 DPR：卡顿降清晰度，恢复后再升回。 */
export function noteTerminalPaintDuration(elapsedMs: number): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  if (elapsedMs >= 22) {
    slowPaintStreak += 1;
    fastPaintStreak = 0;
    if (slowPaintStreak >= 2) {
      adaptiveMaxDevicePixelRatio = 1;
    }
    return;
  }
  slowPaintStreak = 0;
  if (elapsedMs <= 12) {
    fastPaintStreak += 1;
    if (
      fastPaintStreak >= 8 &&
      adaptiveMaxDevicePixelRatio < TERMINAL_MAX_DEVICE_PIXEL_RATIO
    ) {
      adaptiveMaxDevicePixelRatio = TERMINAL_MAX_DEVICE_PIXEL_RATIO;
      fastPaintStreak = 0;
    }
  } else {
    fastPaintStreak = 0;
  }
}

/** 测试或会话重建时重置自适应质量。 */
export function resetTerminalPaintQuality(): void {
  adaptiveMaxDevicePixelRatio = TERMINAL_MAX_DEVICE_PIXEL_RATIO;
  slowPaintStreak = 0;
  fastPaintStreak = 0;
}

function get2dContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D | null {
  return canvas.getContext("2d");
}

/**
 * 确保 canvas 像素尺寸匹配；若发生重置则立刻填背景色，避免黑帧。
 * 内存压力下应尽量少触发（仅尺寸真变时），因赋值 width/height 会重分配显存。
 */
export function syncTerminalCanvasSize(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  background: string,
): CanvasRenderingContext2D | null {
  const pixelW = Math.max(1, Math.floor(cssWidth * dpr));
  const pixelH = Math.max(1, Math.floor(cssHeight * dpr));
  let state = canvasStates.get(canvas);

  if (!state) {
    const ctx = get2dContext(canvas);
    if (!ctx) return null;
    state = { ctx, cssWidth: 0, cssHeight: 0, dpr: 0 };
    canvasStates.set(canvas, state);
  }

  const resized =
    state.cssWidth !== cssWidth ||
    state.cssHeight !== cssHeight ||
    state.dpr !== dpr ||
    canvas.width !== pixelW ||
    canvas.height !== pixelH;

  if (resized) {
    try {
      canvas.width = pixelW;
      canvas.height = pixelH;
    } catch {
      // 内存不足时分配可能抛错；保持旧尺寸继续画。
      return state.ctx;
    }
    if (canvas.style.width !== `${cssWidth}px`) {
      canvas.style.width = `${cssWidth}px`;
    }
    if (canvas.style.height !== `${cssHeight}px`) {
      canvas.style.height = `${cssHeight}px`;
    }
    state.cssWidth = cssWidth;
    state.cssHeight = cssHeight;
    state.dpr = dpr;
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.ctx.fillStyle = background;
    state.ctx.fillRect(0, 0, cssWidth, cssHeight);
  }

  return state.ctx;
}

/**
 * 释放画布的 backing store。面板折叠后 canvas 仍留在 DOM 上（PTY 要继续活着），
 * 但一块全屏画布在 Retina 下是几十 MB 的常驻占用，多标签会叠加。
 * 恢复可见时由 `syncTerminalCanvasSize` 按新尺寸重新分配。
 */
export function releaseTerminalCanvas(canvas: HTMLCanvasElement): void {
  try {
    canvas.width = 1;
    canvas.height = 1;
  } catch {
    return;
  }
  canvas.style?.removeProperty("width");
  canvas.style?.removeProperty("height");
  const state = canvasStates.get(canvas);
  if (state) {
    state.cssWidth = 0;
    state.cssHeight = 0;
    state.dpr = 0;
  }
}

export function measureTerminalMetrics(
  container: HTMLElement,
  fontSize = TERMINAL_FONT_SIZE,
): TerminalMetrics {
  if (measureCtx === undefined) {
    const canvas = document.createElement("canvas");
    measureCtx = canvas.getContext("2d");
  }
  const ctx = measureCtx;
  if (!ctx) {
    return { cellWidth: 7.2, cellHeight: 15, cols: 80, rows: 24 };
  }
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  const cellWidth = Math.max(1, Math.ceil(ctx.measureText("M").width));
  const cellHeight = Math.max(1, Math.ceil(fontSize * TERMINAL_LINE_HEIGHT));
  const width = Math.max(0, container.clientWidth - 6);
  const height = Math.max(0, container.clientHeight);
  const cols = Math.max(2, Math.floor(width / cellWidth));
  const rows = Math.max(1, Math.floor(height / cellHeight));
  return { cellWidth, cellHeight, cols, rows };
}

function paintBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
}

function paintSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  frame: TerminalFrame,
  metrics: Pick<TerminalMetrics, "cellWidth" | "cellHeight">,
  selection: TerminalSelectionRange | null | undefined,
  selectionColor: string,
): void {
  if (!selection || terminalSelectionIsEmpty(selection)) return;
  const norm = normalizeTerminalSelection(selection);
  ctx.fillStyle = selectionColor;
  for (let row = norm.start.row; row <= norm.end.row; row += 1) {
    if (row < 0 || row >= frame.rows) continue;
    const startCol = row === norm.start.row ? norm.start.col : 0;
    const endCol = row === norm.end.row ? norm.end.col : frame.cols - 1;
    if (endCol < startCol) continue;
    const x = startCol * metrics.cellWidth;
    const y = row * metrics.cellHeight;
    const width = (endCol - startCol + 1) * metrics.cellWidth;
    ctx.fillRect(x, y, width, metrics.cellHeight);
  }
}

/**
 * ASCII 可打印字符可用单次 fillText；CJK/控制符仍逐字画以保列对齐。
 */
export function terminalRunNeedsPerGlyphPaint(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return true;
  }
  return false;
}

export function renderTerminalFrame(
  canvas: HTMLCanvasElement,
  frame: TerminalFrame,
  metrics: Pick<TerminalMetrics, "cellWidth" | "cellHeight">,
  palette: TerminalPalette,
  selection?: TerminalSelectionRange | null,
): void {
  const dpr = terminalDevicePixelRatio();
  const width = Math.max(1, Math.floor(frame.cols * metrics.cellWidth));
  const height = Math.max(1, Math.floor(frame.rows * metrics.cellHeight));
  const ctx = syncTerminalCanvasSize(
    canvas,
    width,
    height,
    dpr,
    palette.background,
  );
  if (!ctx) return;

  paintBackground(ctx, width, height, palette.background);
  ctx.font = `${TERMINAL_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textBaseline = "top";

  // 宽字符（CJK）字形会越过自己的格子延伸到右半格，若背景与文字交错绘制，
  // 右侧 run 的背景会把字形右半边擦掉。整行先铺完背景，再统一画文字。
  for (let row = 0; row < frame.lines.length; row += 1) {
    const runs = frame.lines[row] ?? [];
    let col = 0;
    for (const run of runs) {
      paintRunBackground(ctx, run, col, row, metrics, palette);
      col += run.text.length;
    }
    col = 0;
    for (const run of runs) {
      paintRunText(ctx, run, col, row, metrics, palette);
      col += run.text.length;
    }
  }

  paintSelectionOverlay(ctx, frame, metrics, selection, palette.selection);

  if (frame.cursor.visible) {
    const x = frame.cursor.col * metrics.cellWidth;
    const y = frame.cursor.row * metrics.cellHeight;
    ctx.fillStyle = palette.cursor;
    ctx.fillRect(x, y, Math.max(1, metrics.cellWidth), metrics.cellHeight);
  }
}

function normalizeHexColor(color: string): string {
  const trimmed = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    const r = trimmed[1]!;
    const g = trimmed[2]!;
    const b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return trimmed;
}

function paintRunBackground(
  ctx: CanvasRenderingContext2D,
  run: TerminalCellRun,
  startCol: number,
  row: number,
  metrics: Pick<TerminalMetrics, "cellWidth" | "cellHeight">,
  palette: TerminalPalette,
): void {
  const runBg = normalizeHexColor(run.bg || palette.background);
  const canvasBg = normalizeHexColor(palette.background);
  if (!runBg || runBg === canvasBg) return;
  ctx.fillStyle = run.bg;
  ctx.fillRect(
    startCol * metrics.cellWidth,
    row * metrics.cellHeight,
    run.text.length * metrics.cellWidth,
    metrics.cellHeight,
  );
}

function paintRunText(
  ctx: CanvasRenderingContext2D,
  run: TerminalCellRun,
  startCol: number,
  row: number,
  metrics: Pick<TerminalMetrics, "cellWidth" | "cellHeight">,
  palette: TerminalPalette,
): void {
  const x = startCol * metrics.cellWidth;
  const y = row * metrics.cellHeight;
  const width = run.text.length * metrics.cellWidth;
  let font = `${TERMINAL_FONT_SIZE}px ${FONT_FAMILY}`;
  if (run.bold && run.italic) font = `bold italic ${font}`;
  else if (run.bold) font = `bold ${font}`;
  else if (run.italic) font = `italic ${font}`;
  ctx.font = font;
  ctx.globalAlpha = run.dim ? 0.7 : 1;
  ctx.fillStyle = run.fg || palette.foreground;
  const textY = y + 1;
  if (terminalRunNeedsPerGlyphPaint(run.text)) {
    for (let i = 0; i < run.text.length; i += 1) {
      const ch = run.text[i]!;
      ctx.fillText(ch, x + i * metrics.cellWidth, textY);
    }
  } else {
    ctx.fillText(run.text, x, textY);
  }
  if (run.underline || run.strike) {
    ctx.strokeStyle = run.fg || palette.foreground;
    ctx.beginPath();
    if (run.underline) {
      const uy = y + metrics.cellHeight - 2;
      ctx.moveTo(x, uy);
      ctx.lineTo(x + width, uy);
    }
    if (run.strike) {
      const sy = y + metrics.cellHeight / 2;
      ctx.moveTo(x, sy);
      ctx.lineTo(x + width, sy);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Convert browser keyboard events into PTY byte sequences (xterm-ish). */
export function encodeTerminalKey(event: KeyboardEvent): string | null {
  if (event.isComposing || event.key === "Process" || event.keyCode === 229) {
    return null;
  }
  const { key, ctrlKey, altKey, metaKey } = event;
  if (metaKey) return null;

  if (ctrlKey && !altKey && key.length === 1) {
    const code = key.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) {
      return String.fromCharCode(code - 64);
    }
    if (key === "@") return "\x00";
    if (key === "?") return "\x7f";
  }

  switch (key) {
    case "Enter":
      return "\r";
    case "Tab":
      return "\t";
    case "Backspace":
      return "\x7f";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
    case "Delete":
      return "\x1b[3~";
    case "Insert":
      return "\x1b[2~";
    default:
      break;
  }

  if (key.length === 1 && !ctrlKey && !altKey) {
    return key;
  }
  return null;
}

/**
 * 浏览器滚轮 delta → alacritty `Scroll::Delta` 行数。
 * 向上滚（看更旧历史）为正；向下滚为负。
 */
export function wheelDeltaToScrollLines(
  event: Pick<WheelEvent, "deltaY" | "deltaMode">,
  cellHeight: number,
): number {
  const linePx = Math.max(1, cellHeight);
  let pixels = event.deltaY;
  if (event.deltaMode === 1) {
    // DOM_DELTA_LINE
    pixels = event.deltaY * linePx;
  } else if (event.deltaMode === 2) {
    // DOM_DELTA_PAGE
    pixels = event.deltaY * linePx * 24;
  }
  const lines = Math.round(pixels / linePx);
  if (lines === 0 && Math.abs(pixels) >= 1) {
    return pixels < 0 ? 1 : -1;
  }
  return -lines;
}

/**
 * 从终端容器上读取 `--terminal-*`，让 Canvas 与 CSS 共用同一套外观定义。
 * `dark` 只用于变量缺失时（测试环境、样式未加载）选兜底色。
 */
export function readTerminalPalette(
  container: HTMLElement,
  dark: boolean,
): TerminalPalette {
  const fallback = terminalFallbackPalette(dark);
  const style = getComputedStyle(container);
  const readVar = (name: string): string =>
    style.getPropertyValue(name).trim();

  let background = readVar("--terminal-background");
  if (!background) {
    const fromBg = style.backgroundColor?.trim();
    background =
      fromBg && fromBg !== "rgba(0, 0, 0, 0)" && fromBg !== "transparent"
        ? fromBg
        : fallback.background;
  }

  return {
    background,
    foreground: readVar("--terminal-foreground") || fallback.foreground,
    cursor: readVar("--terminal-cursor") || fallback.cursor,
    selection: readVar("--terminal-selection") || fallback.selection,
  };
}
