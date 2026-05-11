/** 与 `LeftSidebar` 中 `Layout.Sider` 的 `width` 一致。 */
export const MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX = 240;

/** 与 `RightPanel` 中 `Layout.Sider` 的 `width` 一致。 */
export const MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX = 300;

/** 主三栏之间拖动手柄占位宽度（与中栏之间的间隔）。 */
export const MAIN_LAYOUT_RESIZE_HANDLE_PX = 5;

/** 左栏可拖动宽度范围。 */
export const MAIN_LAYOUT_LEFT_SIDER_MIN_WIDTH_PX = 200;
export const MAIN_LAYOUT_LEFT_SIDER_MAX_WIDTH_PX = 480;

/** 右栏可拖动宽度范围。 */
export const MAIN_LAYOUT_RIGHT_SIDER_MIN_WIDTH_PX = 220;
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

/**
 * 与 `ClaudeSessions/index.css` 中 `--app-dual-pane-session-min-width` 一致
 *（单路会话在双栏模式下的最小宽度）。
 */
export const MAIN_LAYOUT_DUAL_SESSION_MIN_WIDTH_PX = 460;

/** 与 `ClaudeSessions/index.css` 中 `.app-claude-sessions__dual-divider` 的 `width` 一致。 */
export const MAIN_LAYOUT_DUAL_PANES_DIVIDER_PX = 1;

/** 双栏打开时，在理论最小宽度上预留的缓冲（边框/舍入误差）。 */
export const MAIN_LAYOUT_DUAL_EXPAND_INNER_WIDTH_BUFFER_PX = 8;

/** 双栏时主内容区（`Layout.Content`）所需最小逻辑宽度：两路会话 min + 分隔条。 */
export function computeMinLogicalCenterWidthForDualPane(): number {
  return MAIN_LAYOUT_DUAL_SESSION_MIN_WIDTH_PX * 2 + MAIN_LAYOUT_DUAL_PANES_DIVIDER_PX;
}

/**
 * 开启双栏后主内容区目标逻辑宽度：在「保留现有中栏宽度」的前提下再容纳一路最小会话宽 + 分隔；
 * 且不低于绝对最小双栏中栏宽度。
 */
export function computeDualPaneTargetCenterLogical(centerBeforeLogical: number): number {
  const minTotal = computeMinLogicalCenterWidthForDualPane();
  const withSecondColumn =
    centerBeforeLogical + MAIN_LAYOUT_DUAL_SESSION_MIN_WIDTH_PX + MAIN_LAYOUT_DUAL_PANES_DIVIDER_PX;
  return Math.max(minTotal, withSecondColumn);
}

export function computeMinLogicalInnerWidthForDualPaneLayout(options: {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /** 可选：当前左栏宽度；未传则用默认常量。 */
  leftWidthPx?: number;
  /** 可选：当前右栏宽度；未传则用默认常量。 */
  rightWidthPx?: number;
}): number {
  const left = options.leftCollapsed
    ? 0
    : (options.leftWidthPx ?? MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
  const right = options.rightCollapsed
    ? 0
    : (options.rightWidthPx ?? MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX);
  const handleGutter =
    (!options.leftCollapsed ? MAIN_LAYOUT_RESIZE_HANDLE_PX : 0) +
    (!options.rightCollapsed ? MAIN_LAYOUT_RESIZE_HANDLE_PX : 0);
  const center =
    MAIN_LAYOUT_DUAL_SESSION_MIN_WIDTH_PX * 2 + MAIN_LAYOUT_DUAL_PANES_DIVIDER_PX;
  return left + center + right + handleGutter;
}
