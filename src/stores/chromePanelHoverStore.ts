/** 左/右栏 hover 或左栏/文件树滚动：略降聊天区 Markdown/live 优先级，避免与侧栏 hit-test 争抢主线程。 */
let leftHovered = false;
let rightHovered = false;
let leftScrollActive = false;
let fileTreeScrollActive = false;
let workspaceScrollActive = false;
let workspacePointerActive = false;
const listeners = new Set<() => void>();
const pendingScrollIdleRuns: Array<() => void> = [];
let scrollIdleDrainRaf: number | null = null;
let scrollIdlePollTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setChromePanelHovered(panel: "left" | "right", hovered: boolean): void {
  const nextLeft = panel === "left" ? hovered : leftHovered;
  const nextRight = panel === "right" ? hovered : rightHovered;
  if (nextLeft === leftHovered && nextRight === rightHovered) return;
  leftHovered = nextLeft;
  rightHovered = nextRight;
  notify();
}

/** 工作区 / 运行面板等左栏列表滚动。 */
export function setLeftSidebarScrollActive(active: boolean): void {
  if (leftScrollActive === active) return;
  leftScrollActive = active;
  notify();
  if (!active) ensureChromeScrollIdleDrainScheduled();
}

/** 文件树滚动（比通用左栏滚动让路更强）。 */
export function setFileTreeScrollActive(active: boolean): void {
  if (fileTreeScrollActive === active) return;
  fileTreeScrollActive = active;
  notify();
  if (!active) ensureChromeScrollIdleDrainScheduled();
}

/** 工作区列表滚动。 */
export function setWorkspaceScrollActive(active: boolean): void {
  if (workspaceScrollActive === active) return;
  workspaceScrollActive = active;
  notify();
  if (!active) ensureChromeScrollIdleDrainScheduled();
}

/** 指针在工作区列表内（含快速划过未触发滚动时）。 */
export function setWorkspacePointerActive(active: boolean): void {
  if (workspacePointerActive === active) return;
  workspacePointerActive = active;
  notify();
}

export function isChromePanelHovered(): boolean {
  return leftHovered || rightHovered;
}

export function isFileTreeScrollActive(): boolean {
  return fileTreeScrollActive;
}

export function isWorkspaceScrollActive(): boolean {
  return workspaceScrollActive;
}

/** 左栏 / 文件树 / 工作区正在滚动（不含纯 hover）：live flush 硬推迟。 */
export function isChromeScrollReliefActive(): boolean {
  return leftScrollActive || fileTreeScrollActive || workspaceScrollActive;
}

/** 工作区滚动或指针在列表内：聊天区更强降频。 */
export function isWorkspacePriorityReliefActive(): boolean {
  return workspaceScrollActive || workspacePointerActive;
}

export function isSidePanelPriorityReliefActive(): boolean {
  return (
    leftHovered ||
    rightHovered ||
    leftScrollActive ||
    fileTreeScrollActive ||
    workspaceScrollActive ||
    workspacePointerActive
  );
}

export function subscribeChromePanelHover(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function drainChromeScrollIdleRuns(): void {
  scrollIdleDrainRaf = null;
  if (isChromeScrollReliefActive()) {
    if (scrollIdlePollTimer !== null) return;
    scrollIdlePollTimer = setTimeout(() => {
      scrollIdlePollTimer = null;
      ensureChromeScrollIdleDrainScheduled();
    }, 40);
    return;
  }
  const next = pendingScrollIdleRuns.shift();
  if (next) next();
  if (pendingScrollIdleRuns.length > 0) {
    if (typeof requestAnimationFrame === "undefined") {
      drainChromeScrollIdleRuns();
      return;
    }
    scrollIdleDrainRaf = requestAnimationFrame(drainChromeScrollIdleRuns);
  }
}

function ensureChromeScrollIdleDrainScheduled(): void {
  if (scrollIdleDrainRaf !== null || scrollIdlePollTimer !== null) return;
  if (pendingScrollIdleRuns.length === 0) return;
  if (typeof requestAnimationFrame === "undefined") {
    drainChromeScrollIdleRuns();
    return;
  }
  scrollIdleDrainRaf = requestAnimationFrame(drainChromeScrollIdleRuns);
}

/** 侧栏/文件树滚动时推迟 live flush，停稳后再补刷。 */
export function scheduleAfterChromeScrollIdle(run: () => void): void {
  if (!isChromeScrollReliefActive()) {
    run();
    return;
  }
  pendingScrollIdleRuns.push(run);
  ensureChromeScrollIdleDrainScheduled();
}

/** @internal test helper */
export function resetChromePanelHoverStoreForTests(): void {
  leftHovered = false;
  rightHovered = false;
  leftScrollActive = false;
  fileTreeScrollActive = false;
  workspaceScrollActive = false;
  workspacePointerActive = false;
  pendingScrollIdleRuns.length = 0;
  if (scrollIdleDrainRaf !== null && typeof cancelAnimationFrame !== "undefined") {
    cancelAnimationFrame(scrollIdleDrainRaf);
    scrollIdleDrainRaf = null;
  }
  if (scrollIdlePollTimer !== null) {
    clearTimeout(scrollIdlePollTimer);
    scrollIdlePollTimer = null;
  }
  listeners.clear();
}
