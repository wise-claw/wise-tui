import type { SessionExecutionEngine } from "./sessionExecutionEngine";
import type { PaneClaudeProxyRoute, PaneRuntimeOverride } from "../types/paneRuntimeOverride";

/** 与 `LeftSidebar` 中 `Layout.Sider` 的 `width` 一致。 */
export const MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX = 260;

/** 工作台配置（Author）左侧导航栏宽度，略窄于主左栏以让出内容区。 */
export const AUTHOR_CONFIG_NAV_SIDER_WIDTH_PX = 212;

/** 历史左栏默认宽度；持久化值与之相同时归一化为 {@link MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX}。 */
const MAIN_LAYOUT_LEFT_SIDER_PRIOR_DEFAULT_WIDTHS_PX: readonly number[] = [300, 280, 270];

/** 与 `RightPanel` 中 `Layout.Sider` 的 `width` 一致。 */
export const MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX = 300;

/** 主三栏之间拖动手柄占位宽度（与中栏之间的间隔）。 */
export const MAIN_LAYOUT_RESIZE_HANDLE_PX = 5;

/** 左栏可拖动宽度范围。 */
export const MAIN_LAYOUT_LEFT_SIDER_MIN_WIDTH_PX = 200;
export const MAIN_LAYOUT_LEFT_SIDER_MAX_WIDTH_PX = 480;

/** @deprecated 仅用于读取旧版 localStorage 并迁移到 v2。 */
export const MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY_LEGACY = "wise.mainLayout.leftSiderWidthPx";

export const MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY = "wise.mainLayout.leftSiderWidthPx.v2";

/**
 * 读取持久化左栏宽度：无记录或旧版偏窄（小于当前默认）时用默认宽度；
 * v2 起用户主动拖窄的值会原样保留。
 */
export function resolvePersistedLeftSiderWidthPx(
  stored: number | null | undefined,
  fallback: number = MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX,
): number {
  if (stored == null || !Number.isFinite(stored)) {
    return fallback;
  }
  return normalizePersistedLeftSiderWidthPx(stored);
}

function normalizePersistedLeftSiderWidthPx(width: number): number {
  if (MAIN_LAYOUT_LEFT_SIDER_PRIOR_DEFAULT_WIDTHS_PX.includes(width)) {
    return MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX;
  }
  if (width < MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX) {
    return MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX;
  }
  return width;
}

export function readPersistedLeftSiderWidthFromStorage(): number {
  if (typeof window === "undefined") {
    return MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX;
  }
  try {
    const v2Raw = window.localStorage.getItem(MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY);
    if (v2Raw != null) {
      const v2 = Number(v2Raw);
      return resolvePersistedLeftSiderWidthPx(Number.isFinite(v2) ? v2 : null);
    }
    const legacyRaw = window.localStorage.getItem(MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY_LEGACY);
    if (legacyRaw == null) {
      return MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX;
    }
    const legacy = Number(legacyRaw);
    if (!Number.isFinite(legacy)) {
      return MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX;
    }
    return normalizePersistedLeftSiderWidthPx(legacy);
  } catch {
    return MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX;
  }
}

export function writePersistedLeftSiderWidthToStorage(widthPx: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY, String(widthPx));
  } catch {
    /* ignore */
  }
}

/** 右栏可拖动宽度范围。 */
export const MAIN_LAYOUT_RIGHT_SIDER_MIN_WIDTH_PX = 200;
export const MAIN_LAYOUT_RIGHT_SIDER_MAX_WIDTH_PX = 640;

/** 拖动时中栏至少保留的逻辑宽度，避免三栏挤死。 */
export const MAIN_LAYOUT_CENTER_MIN_WIDTH_WHILE_RESIZE_PX = 360;

export interface MainLayoutSiderClampContext {
  innerWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /** 调左栏宽度时传入当前右栏宽度 */
  peerRightWidthPx: number;
  /** 调右栏宽度时传入当前左栏宽度 */
  peerLeftWidthPx: number;
}

function resizeHandleGutterPx(leftCollapsed: boolean, rightCollapsed: boolean): number {
  return (
    (!leftCollapsed ? MAIN_LAYOUT_RESIZE_HANDLE_PX : 0) +
    (!rightCollapsed ? MAIN_LAYOUT_RESIZE_HANDLE_PX : 0)
  );
}

/** 将左栏宽度限制在配置范围与当前视口可容范围内。 */
export function clampMainLayoutLeftWidthPx(width: number, ctx: MainLayoutSiderClampContext): number {
  if (ctx.leftCollapsed) {
    return Math.min(
      MAIN_LAYOUT_LEFT_SIDER_MAX_WIDTH_PX,
      Math.max(MAIN_LAYOUT_LEFT_SIDER_MIN_WIDTH_PX, Math.round(width)),
    );
  }
  const maxByViewport =
    ctx.innerWidth -
    resizeHandleGutterPx(ctx.leftCollapsed, ctx.rightCollapsed) -
    MAIN_LAYOUT_CENTER_MIN_WIDTH_WHILE_RESIZE_PX -
    (ctx.rightCollapsed ? 0 : ctx.peerRightWidthPx);
  const upper = Math.max(MAIN_LAYOUT_LEFT_SIDER_MIN_WIDTH_PX, Math.floor(maxByViewport));
  return Math.min(
    MAIN_LAYOUT_LEFT_SIDER_MAX_WIDTH_PX,
    Math.max(MAIN_LAYOUT_LEFT_SIDER_MIN_WIDTH_PX, Math.min(upper, Math.round(width))),
  );
}

/** 将右栏宽度限制在配置范围与当前视口可容范围内。 */
export function clampMainLayoutRightWidthPx(width: number, ctx: MainLayoutSiderClampContext): number {
  if (ctx.rightCollapsed) {
    return Math.min(
      MAIN_LAYOUT_RIGHT_SIDER_MAX_WIDTH_PX,
      Math.max(MAIN_LAYOUT_RIGHT_SIDER_MIN_WIDTH_PX, Math.round(width)),
    );
  }
  const maxByViewport =
    ctx.innerWidth -
    resizeHandleGutterPx(ctx.leftCollapsed, ctx.rightCollapsed) -
    MAIN_LAYOUT_CENTER_MIN_WIDTH_WHILE_RESIZE_PX -
    (ctx.leftCollapsed ? 0 : ctx.peerLeftWidthPx);
  const upper = Math.max(MAIN_LAYOUT_RIGHT_SIDER_MIN_WIDTH_PX, Math.floor(maxByViewport));
  return Math.min(
    MAIN_LAYOUT_RIGHT_SIDER_MAX_WIDTH_PX,
    Math.max(MAIN_LAYOUT_RIGHT_SIDER_MIN_WIDTH_PX, Math.min(upper, Math.round(width))),
  );
}

// ── Multi-pane (2/4/6/8) ──

/** 中栏多屏模式可选的屏数。1 表示单屏（关闭多屏）。 */
export type PaneCount = 1 | 2 | 4 | 6 | 8;

/** 多屏模式下额外窗格槽位（Pane 0 始终是 activeSession，不在数组中）。 */
export interface PaneSlot {
  /** 唯一槽位 id，用于 React key 和稳定引用。 */
  slotId: string;
  /** 该窗格绑定的 session id；null 表示空屏。 */
  sessionId: string | null;
  /** 该窗格绑定的 repository id；null 表示未选择。 */
  repositoryId: number | null;
  /** 窗格级执行引擎覆盖（多屏并发时与侧栏仓库配置解耦）。 */
  executionEngine?: SessionExecutionEngine;
  /** Claude 专用：是否经 Wise 内置代理路由。 */
  claudeProxyRoute?: PaneClaudeProxyRoute;
}

export function paneSlotRuntimeOverride(slot: PaneRuntimeOverride | null | undefined): PaneRuntimeOverride | null {
  if (!slot) return null;
  const out: PaneRuntimeOverride = {};
  if (slot.executionEngine) out.executionEngine = slot.executionEngine;
  if (slot.claudeProxyRoute) out.claudeProxyRoute = slot.claudeProxyRoute;
  return Object.keys(out).length > 0 ? out : null;
}

/** 多屏模式下的有效屏数列表（用于 UI 枚举）。 */
export const PANE_COUNT_OPTIONS: readonly PaneCount[] = [1, 2, 4, 6, 8] as const;

/** 多屏循环切换顺序（Alt+K）：1→2→4→6→8→1。 */
export const PANE_COUNT_CYCLE_ORDER: readonly PaneCount[] = [1, 2, 4, 6, 8] as const;

/** 多屏模式下每个窗格的最小宽度（与 CSS --app-multi-pane-min-width 一致）。 */
export const MAIN_LAYOUT_MULTI_PANE_MIN_WIDTH_PX = 460;

/** 窗格之间的分隔间距（CSS grid gap）。 */
export const MAIN_LAYOUT_MULTI_PANE_GAP_PX = 1;

/** 每增加一列时窗口宽度增量（min-width + gap）。 */
export const MAIN_LAYOUT_MULTI_PANE_UNIT_PX =
  MAIN_LAYOUT_MULTI_PANE_MIN_WIDTH_PX + MAIN_LAYOUT_MULTI_PANE_GAP_PX;

/** 窗口展开时，在理论最小宽度上预留的缓冲（边框/舍入误差）。 */
export const MAIN_LAYOUT_MULTI_PANE_EXPAND_BUFFER_PX = 8;

/** 多屏网格维度：行数 × 列数。2→1×2, 4→2×2, 6→2×3, 8→2×4。 */
export function paneGridDimensions(count: PaneCount): { rows: number; cols: number } {
  if (count <= 1) return { rows: 1, cols: 1 };
  if (count === 2) return { rows: 1, cols: 2 };
  return { rows: 2, cols: count / 2 };
}

/** 指定屏数时主内容区（Layout.Content）所需最小逻辑宽度。 */
export function computeMinLogicalCenterWidthForPaneCount(count: PaneCount): number {
  const { cols } = paneGridDimensions(count);
  return MAIN_LAYOUT_MULTI_PANE_MIN_WIDTH_PX * cols + MAIN_LAYOUT_MULTI_PANE_GAP_PX * Math.max(0, cols - 1);
}

/** 开启多屏后主内容区目标逻辑宽度：取当前中栏宽度与最小宽度的较大值。 */
export function computeMultiPaneTargetCenterLogical(
  count: PaneCount,
  centerBeforeLogical: number,
): number {
  const minTotal = computeMinLogicalCenterWidthForPaneCount(count);
  return Math.max(minTotal, centerBeforeLogical);
}

export function computeMinLogicalInnerWidthForMultiPaneLayout(
  count: PaneCount,
  options: {
    leftCollapsed: boolean;
    rightCollapsed: boolean;
    leftWidthPx?: number;
    rightWidthPx?: number;
  },
): number {
  const left = options.leftCollapsed
    ? 0
    : (options.leftWidthPx ?? MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
  const right = options.rightCollapsed
    ? 0
    : (options.rightWidthPx ?? MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX);
  const handleGutter =
    (!options.leftCollapsed ? MAIN_LAYOUT_RESIZE_HANDLE_PX : 0) +
    (!options.rightCollapsed ? MAIN_LAYOUT_RESIZE_HANDLE_PX : 0);
  const center = computeMinLogicalCenterWidthForPaneCount(count);
  return left + center + right + handleGutter;
}

/** 根据当前屏数计算下一个循环屏数（Alt+K）。 */
export function nextPaneCountInCycle(current: PaneCount): PaneCount {
  const idx = PANE_COUNT_CYCLE_ORDER.indexOf(current);
  const nextIdx = (idx + 1) % PANE_COUNT_CYCLE_ORDER.length;
  return PANE_COUNT_CYCLE_ORDER[nextIdx];
}

export function isPaneCount(value: unknown): value is PaneCount {
  return value === 1 || value === 2 || value === 4 || value === 6 || value === 8;
}

/** 多屏网格列数（用于窗口宽度增减）。 */
export function columnCountForPaneCount(count: PaneCount): number {
  return paneGridDimensions(count).cols;
}

/** 持久化恢复多屏时，侧栏/手柄占用的逻辑宽度估算（与 useMainLayoutModes 一致）。 */
export const MAIN_LAYOUT_MULTI_PANE_RESTORE_SIDE_GUTTER_PX = 600;

/**
 * 持久化恢复多屏后，若当前 inner 宽度不足以容纳网格 min-width，返回目标逻辑宽度；否则 null。
 */
export function computeRestoreMultiPaneLogicalWidth(
  paneCount: PaneCount,
  currentInnerWidth: number,
  sideGutterPx: number = MAIN_LAYOUT_MULTI_PANE_RESTORE_SIDE_GUTTER_PX,
): number | null {
  if (paneCount <= 1) return null;
  const minCenter = computeMinLogicalCenterWidthForPaneCount(paneCount);
  const cols = columnCountForPaneCount(paneCount);
  const expandPx = Math.max(0, (cols - 1) * MAIN_LAYOUT_MULTI_PANE_UNIT_PX);
  const neededWidth = minCenter + sideGutterPx;
  if (expandPx <= 0 || currentInnerWidth >= neededWidth) return null;
  return Math.max(neededWidth, currentInnerWidth + expandPx);
}

// ── Dual-pane aliases (backward compat) ──

/** @deprecated 使用 {@link MAIN_LAYOUT_MULTI_PANE_MIN_WIDTH_PX} */
export const MAIN_LAYOUT_DUAL_SESSION_MIN_WIDTH_PX = MAIN_LAYOUT_MULTI_PANE_MIN_WIDTH_PX;

/** @deprecated 使用 {@link MAIN_LAYOUT_MULTI_PANE_GAP_PX} */
export const MAIN_LAYOUT_DUAL_PANES_DIVIDER_PX = MAIN_LAYOUT_MULTI_PANE_GAP_PX;

/** @deprecated 使用 {@link MAIN_LAYOUT_MULTI_PANE_EXPAND_BUFFER_PX} */
export const MAIN_LAYOUT_DUAL_EXPAND_INNER_WIDTH_BUFFER_PX = MAIN_LAYOUT_MULTI_PANE_EXPAND_BUFFER_PX;

/** @deprecated 使用 {@link computeMinLogicalCenterWidthForPaneCount}(2) */
export function computeMinLogicalCenterWidthForDualPane(): number {
  return computeMinLogicalCenterWidthForPaneCount(2);
}

/** @deprecated 使用 {@link computeMultiPaneTargetCenterLogical}(2, centerBeforeLogical) */
export function computeDualPaneTargetCenterLogical(centerBeforeLogical: number): number {
  return computeMultiPaneTargetCenterLogical(2, centerBeforeLogical);
}

/** @deprecated 使用 {@link computeMinLogicalInnerWidthForMultiPaneLayout}(2, options) */
export function computeMinLogicalInnerWidthForDualPaneLayout(options: {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftWidthPx?: number;
  rightWidthPx?: number;
}): number {
  return computeMinLogicalInnerWidthForMultiPaneLayout(2, options);
}
