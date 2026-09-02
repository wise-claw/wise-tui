/** WebView DevTools 停靠时 outer/inner 差值通常会明显变大（Safari/WKWebView）。 */
const DEVTOOLS_CHROME_PX = 120;

/** Vite dev / 未压缩 bundle 下主线程更忙，非关键轮询略放慢。 */
const DEV_POLL_MULTIPLIER = import.meta.env.DEV ? 1.5 : 1;

/** 主线程拥塞时轮询间隔翻倍，避免卡顿期间轮询回调雪上加霜。 */
const CONGESTION_MULTIPLIER = 2;

/** DevTools 打开时主线程与 IPC 成本显著上升，用于放慢非关键轮询。 */
export function isWebViewDevToolsLikelyOpen(): boolean {
  if (typeof window === "undefined") return false;
  const widthChrome = window.outerWidth - window.innerWidth;
  const heightChrome = window.outerHeight - window.innerHeight;
  return widthChrome > DEVTOOLS_CHROME_PX || heightChrome > DEVTOOLS_CHROME_PX;
}

export function scalePollIntervalMs(baseMs: number, devtoolsMultiplier = 2.5): number {
  if (baseMs <= 0) return baseMs;
  let scaled = Math.round(baseMs * DEV_POLL_MULTIPLIER);
  if (isWebViewDevToolsLikelyOpen()) {
    scaled = Math.round(scaled * devtoolsMultiplier);
  }
  // 延迟导入避免循环依赖：adaptivePoll 被 claudeSessionsLiveStore 依赖，
  // 而 liveFlushMinIntervalMs 依赖 mainThreadCongestionStore。
  if (congestionCheckRef.current?.()) {
    scaled = Math.round(scaled * CONGESTION_MULTIPLIER);
  }
  return scaled;
}

/**
 * 注入拥塞检测函数引用，避免 adaptivePoll ↔ mainThreadCongestionStore 循环依赖。
 * 由 mainThreadCongestionStore 在模块加载时调用。
 */
export const congestionCheckRef: { current: (() => boolean) | null } = { current: null };

/**
 * 侧栏滚动 / 输入硬推迟窗：轮询 tick 让路。
 * 由 wireAdaptivePollInteractionRelief 注入，避免与 chrome/composer store 循环依赖。
 */
export const pollInteractionReliefRef: { current: (() => boolean) | null } = { current: null };

/** 非关键轮询是否应跳过本拍（滚动/打字让路）。 */
export function shouldDeferAdaptivePollTick(): boolean {
  return pollInteractionReliefRef.current?.() === true;
}

export function readVisiblePollIntervalMs(visibleMs: number, hiddenMs: number): number {
  if (typeof document === "undefined") return visibleMs;
  const base = document.visibilityState === "visible" ? visibleMs : hiddenMs;
  return scalePollIntervalMs(base);
}

/**
 * 创建随 visibility / DevTools 调整间隔的轮询；隐藏时跳过 tick。
 * 侧栏滚动或正在输入时也跳过，避免与流式/hit-test 抢主线程与 IPC。
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
    if (shouldDeferAdaptivePollTick()) return;
    onTick();
  };

  const restart = () => {
    if (timer) clearInterval(timer);
    timer = null;
    // tick 本就不会在后台执行；隐藏时彻底停表，避免每个轮询器继续产生无效 wake-up。
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
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
