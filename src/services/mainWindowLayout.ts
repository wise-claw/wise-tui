import { LogicalSize, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  computeDualPaneTargetCenterLogical,
  computeMultiPaneTargetCenterLogical,
  MAIN_LAYOUT_DUAL_EXPAND_INNER_WIDTH_BUFFER_PX,
  MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX,
  MAIN_LAYOUT_MULTI_PANE_EXPAND_BUFFER_PX,
  MAIN_LAYOUT_RESIZE_HANDLE_PX,
  MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX,
  type PaneCount,
} from "../constants/mainLayoutWidths";

/** 等待布局提交后再量 DOM（双栏切换、挂载后需要多帧）。 */
export function waitLayoutFrames(count: number): Promise<void> {
  let chain = Promise.resolve();
  for (let i = 0; i < count; i += 1) {
    chain = chain.then(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        }),
    );
  }
  return chain;
}

/**
 * 读取主窗口内尺寸（物理像素）。非 Tauri 环境会抛错，由调用方 catch。
 */
export async function readMainWindowInnerSize(): Promise<{ width: number; height: number }> {
  const win = getCurrentWindow();
  const s = await win.innerSize();
  return { width: s.width, height: s.height };
}

/**
 * 设置主窗口内尺寸（物理像素）。
 */
export async function setMainWindowInnerSize(width: number, height: number): Promise<void> {
  const win = getCurrentWindow();
  await win.setSize(new PhysicalSize(Math.round(width), Math.round(height)));
}

/**
 * 按逻辑像素设置主窗口 **inner** 尺寸（与 `window.innerWidth` / `innerHeight` 一致）。
 */
export async function setMainWindowLogicalInnerSize(width: number, height: number): Promise<void> {
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(Math.round(width), Math.round(height)));
}

/** 在保持高度的前提下，按逻辑像素增减主窗口 inner 宽度（用于侧栏收起/展开时由窗口承接宽度变化）。 */
export async function adjustMainWindowLogicalWidthByDelta(deltaLogical: number): Promise<void> {
  if (deltaLogical === 0) return;
  if (typeof window === "undefined") return;
  try {
    await setMainWindowLogicalInnerSize(
      Math.max(320, window.innerWidth + deltaLogical),
      window.innerHeight,
    );
  } catch {
    /* 浏览器 dev / 非 Tauri */
  }
}

/**
 * 测量主内容区（`Layout.Content`）逻辑宽度；若 ant-layout `width:0` 导致为 0，则回退到子节点或 `innerWidth − 侧栏`。
 */
export function measureMainLayoutContentWidthPx(
  mainContentEl: HTMLElement | null,
  options: {
    leftCollapsed: boolean;
    rightCollapsed: boolean;
    leftWidthPx?: number;
    rightWidthPx?: number;
  },
): number {
  const fromContent = mainContentEl?.getBoundingClientRect().width ?? 0;
  if (fromContent > 16) return fromContent;
  const fromSessions = mainContentEl?.querySelector(".app-claude-sessions")?.getBoundingClientRect().width ?? 0;
  if (fromSessions > 16) return fromSessions;
  if (typeof window === "undefined") return 0;
  const leftW = options.leftCollapsed ? 0 : (options.leftWidthPx ?? MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
  const rightW = options.rightCollapsed ? 0 : (options.rightWidthPx ?? MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX);
  const handleGutter =
    (!options.leftCollapsed ? MAIN_LAYOUT_RESIZE_HANDLE_PX : 0) +
    (!options.rightCollapsed ? MAIN_LAYOUT_RESIZE_HANDLE_PX : 0);
  return Math.max(0, window.innerWidth - leftW - rightW - handleGutter);
}

/**
 * 若根文档横向溢出，则把主窗口加宽约等于溢出量，避免出现整窗横向滚动条（双栏 460+460 等）。
 */
export async function expandMainWindowToRemoveHorizontalOverflow(): Promise<void> {
  await waitLayoutFrames(2);
  const root = document.documentElement;
  const overflow = Math.ceil(root.scrollWidth - window.innerWidth);
  if (overflow <= 0) return;
  try {
    const cur = await readMainWindowInnerSize();
    await setMainWindowInnerSize(cur.width + overflow, cur.height);
  } catch {
    /* 浏览器 dev / 非 Tauri */
  }
}

/**
 * 按「双栏后主内容区目标逻辑宽度 − 当前中栏逻辑宽度」得到逻辑增量，加到 `window.innerWidth` 对应的 inner 宽度上。
 * 返回该逻辑增量，关闭双栏时用 {@link shrinkMainWindowByDualPaneDelta} 减去同一值。
 * 使用 {@link LogicalSize}，与 Webview 视口一致；需在 capability 中启用 `core:window:allow-set-size`。
 */
export async function expandMainWindowByDualPaneCenterDelta(
  centerBeforeLogical: number,
  options?: { shouldAbort?: () => boolean },
): Promise<number> {
  await waitLayoutFrames(1);
  if (options?.shouldAbort?.()) return 0;
  if (centerBeforeLogical <= 0) return 0;
  const centerAfter =
    computeDualPaneTargetCenterLogical(centerBeforeLogical) + MAIN_LAYOUT_DUAL_EXPAND_INNER_WIDTH_BUFFER_PX;
  const deltaLogical = Math.max(0, Math.ceil(centerAfter - centerBeforeLogical));
  if (deltaLogical <= 0) return 0;
  try {
    if (options?.shouldAbort?.()) return 0;
    if (typeof window === "undefined") return 0;
    const nextW = window.innerWidth + deltaLogical;
    const nextH = window.innerHeight;
    if (options?.shouldAbort?.()) return 0;
    await setMainWindowLogicalInnerSize(nextW, nextH);
    return deltaLogical;
  } catch {
    return 0;
  }
}

/**
 * 多屏模式通用窗口展开：根据目标屏数计算主内容区目标宽度并调整窗口。
 * 返回逻辑增量（关闭/切换时用于缩回）。
 */
export async function expandMainWindowForPaneCount(
  count: PaneCount,
  centerBeforeLogical: number,
  options?: { shouldAbort?: () => boolean },
): Promise<number> {
  await waitLayoutFrames(1);
  if (options?.shouldAbort?.()) return 0;
  if (centerBeforeLogical <= 0 || count <= 1) return 0;
  const centerAfter =
    computeMultiPaneTargetCenterLogical(count, centerBeforeLogical) + MAIN_LAYOUT_MULTI_PANE_EXPAND_BUFFER_PX;
  const deltaLogical = Math.max(0, Math.ceil(centerAfter - centerBeforeLogical));
  if (deltaLogical <= 0) return 0;
  try {
    if (options?.shouldAbort?.()) return 0;
    if (typeof window === "undefined") return 0;
    const nextW = window.innerWidth + deltaLogical;
    const nextH = window.innerHeight;
    if (options?.shouldAbort?.()) return 0;
    await setMainWindowLogicalInnerSize(nextW, nextH);
    return deltaLogical;
  } catch {
    return 0;
  }
}

export async function shrinkMainWindowByDualPaneDelta(deltaLogical: number): Promise<void> {
  if (deltaLogical <= 0) return;
  try {
    if (typeof window === "undefined") return;
    await setMainWindowLogicalInnerSize(Math.max(320, window.innerWidth - deltaLogical), window.innerHeight);
  } catch {
    /* 浏览器 dev / 非 Tauri */
  }
}

export async function restoreMainWindowInnerSnapshot(
  snapshot: { width: number; height: number } | null,
): Promise<void> {
  if (!snapshot) return;
  try {
    await setMainWindowInnerSize(snapshot.width, snapshot.height);
  } catch {
    /* ignore */
  }
}

/**
 * 单列布局下若视口比文档内容更宽，则收窄主窗口，与 `expandMainWindowToRemoveHorizontalOverflow` 对称。
 * 用于关闭双栏后消除「多出来的窗口宽度」。
 */
export async function shrinkMainWindowToRemoveHorizontalSlack(minSlackPx = 8): Promise<void> {
  await waitLayoutFrames(2);
  const root = document.documentElement;
  const slack = Math.floor(window.innerWidth - root.scrollWidth);
  if (slack <= minSlackPx) return;
  try {
    const cur = await readMainWindowInnerSize();
    const nextW = Math.max(320, cur.width - slack);
    await setMainWindowInnerSize(nextW, cur.height);
  } catch {
    /* 浏览器 dev / 非 Tauri */
  }
}
