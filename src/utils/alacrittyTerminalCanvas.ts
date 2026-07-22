import type { TerminalCellRun, TerminalFrame } from "../types/terminal";

const FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace';
export const TERMINAL_FONT_SIZE = 12;
export const TERMINAL_LINE_HEIGHT = 1.25;
/** 与 CSS `--terminal-background` / Rust NamedColor::Background 对齐。 */
export const TERMINAL_DEFAULT_BACKGROUND = "#1e1e1e";
export const TERMINAL_DEFAULT_FOREGROUND = "#d4d4d4";
export const TERMINAL_DEFAULT_CURSOR = "#aeafad";

export type TerminalMetrics = {
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
};

export function measureTerminalMetrics(
  container: HTMLElement,
  fontSize = TERMINAL_FONT_SIZE,
): TerminalMetrics {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
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

export function renderTerminalFrame(
  canvas: HTMLCanvasElement,
  frame: TerminalFrame,
  metrics: Pick<TerminalMetrics, "cellWidth" | "cellHeight">,
  background: string,
): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(frame.cols * metrics.cellWidth));
  const height = Math.max(1, Math.floor(frame.rows * metrics.cellHeight));
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintBackground(ctx, width, height, background);
  ctx.font = `${TERMINAL_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textBaseline = "top";

  for (let row = 0; row < frame.lines.length; row += 1) {
    const runs = frame.lines[row] ?? [];
    let col = 0;
    for (const run of runs) {
      paintRun(ctx, run, col, row, metrics, background);
      col += run.text.length;
    }
  }

  if (frame.cursor.visible) {
    const x = frame.cursor.col * metrics.cellWidth;
    const y = frame.cursor.row * metrics.cellHeight;
    ctx.fillStyle = TERMINAL_DEFAULT_CURSOR;
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

function paintRun(
  ctx: CanvasRenderingContext2D,
  run: TerminalCellRun,
  startCol: number,
  row: number,
  metrics: Pick<TerminalMetrics, "cellWidth" | "cellHeight">,
  canvasBackground: string,
): void {
  const x = startCol * metrics.cellWidth;
  const y = row * metrics.cellHeight;
  const width = run.text.length * metrics.cellWidth;
  const runBg = normalizeHexColor(run.bg || canvasBackground);
  const canvasBg = normalizeHexColor(canvasBackground);
  if (runBg && runBg !== canvasBg) {
    ctx.fillStyle = run.bg;
    ctx.fillRect(x, y, width, metrics.cellHeight);
  }
  let font = `${TERMINAL_FONT_SIZE}px ${FONT_FAMILY}`;
  if (run.bold && run.italic) font = `bold italic ${font}`;
  else if (run.bold) font = `bold ${font}`;
  else if (run.italic) font = `italic ${font}`;
  ctx.font = font;
  ctx.globalAlpha = run.dim ? 0.7 : 1;
  ctx.fillStyle = run.fg || TERMINAL_DEFAULT_FOREGROUND;
  // Monospace: draw char-by-char to keep columns aligned for CJK/wide glyphs.
  for (let i = 0; i < run.text.length; i += 1) {
    const ch = run.text[i]!;
    ctx.fillText(ch, x + i * metrics.cellWidth, y + 1);
  }
  if (run.underline || run.strike) {
    ctx.strokeStyle = run.fg || TERMINAL_DEFAULT_FOREGROUND;
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
  if (event.isComposing) return null;
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

export function readTerminalBackground(container: HTMLElement): string {
  const style = getComputedStyle(container);
  const fromVar = style.getPropertyValue("--terminal-background").trim();
  if (fromVar) return fromVar;
  const fromBg = style.backgroundColor?.trim();
  if (fromBg && fromBg !== "rgba(0, 0, 0, 0)" && fromBg !== "transparent") {
    return fromBg;
  }
  return TERMINAL_DEFAULT_BACKGROUND;
}
