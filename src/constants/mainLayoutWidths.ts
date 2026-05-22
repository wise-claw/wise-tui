/** 与 `LeftSidebar` 中 `Layout.Sider` 的 `width` 一致。 */
export const MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX = 260;

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
export const MAIN_LAYOUT_RIGHT_SIDER_MIN_WIDTH_PX = 300;
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
