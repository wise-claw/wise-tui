/** WebView DevTools 停靠时 outer/inner 差值通常会明显变大（Safari/WKWebView）。 */
const DEVTOOLS_CHROME_PX = 120;

/** DevTools 打开时主线程与 IPC 成本显著上升，用于放慢非关键轮询。 */
export function isWebViewDevToolsLikelyOpen(): boolean {
  if (typeof window === "undefined") return false;
  const widthChrome = window.outerWidth - window.innerWidth;
  const heightChrome = window.outerHeight - window.innerHeight;
  return widthChrome > DEVTOOLS_CHROME_PX || heightChrome > DEVTOOLS_CHROME_PX;
}

export function scalePollIntervalMs(baseMs: number, devtoolsMultiplier = 2.5): number {
  if (baseMs <= 0) return baseMs;
  return isWebViewDevToolsLikelyOpen() ? Math.round(baseMs * devtoolsMultiplier) : baseMs;
}

export function readVisiblePollIntervalMs(visibleMs: number, hiddenMs: number): number {
  if (typeof document === "undefined") return visibleMs;
  const base = document.visibilityState === "visible" ? visibleMs : hiddenMs;
  return scalePollIntervalMs(base);
}

/**
 * 创建随 visibility / DevTools 调整间隔的轮询；隐藏时跳过 tick。
 * 返回 dispose：清 interval 并移除 visibility 监听。
 */
export function startAdaptiveInterval(
  onTick: () => void,
  visibleMs: number,
  hiddenMs: number,
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    onTick();
  };

  const restart = () => {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, readVisiblePollIntervalMs(visibleMs, hiddenMs));
  };

  const onVisibilityChange = () => {
    restart();
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      tick();
    }
  };

  restart();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

/** 两个 string set 是否相同（顺序无关）。 */
export function stringSetEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}
