/** 文件树 / Git 面板同栏上下分栏（split）模式下的 Git 面板高度配置。 */

/** Git 面板最小高度：至少能展示 panel header（30px）+ 一行 diff。 */
export const REPO_PANEL_SPLIT_HEIGHT_MIN_PX = 60;

/** Git 面板最大高度硬上限，防止撑满整侧栏。 */
export const REPO_PANEL_SPLIT_HEIGHT_MAX_PX = 600;

/** 旧写死值的兼容默认。 */
export const REPO_PANEL_SPLIT_HEIGHT_DEFAULT_PX = 230;

/** 文件树 pane 在拖动时至少保留的高度，避免被压到 0 时出现溢出。 */
export const REPO_PANEL_SPLIT_FILES_MIN_PX = 60;

/** 拖动把手自身占位高度（命中区）。 */
export const REPO_PANEL_SPLIT_HANDLE_PX = 5;

export interface RepoPanelSplitHeightClampContext {
  /** 父容器（`app-left-sidebar-bottom-tab-content`）可用高度，px。 */
  parentAvailablePx?: number;
}

/**
 * 将 split 模式下 Git 面板的目标高度 clamp 到安全范围：
 * - 下限：MIN，保证至少能看到 header + 1 行 diff
 * - 上限：取 MAX 与 `parentAvailable - FILES_MIN - HANDLE` 的较小者，避免压垮 files pane 或超过父容器
 */
export function clampRepoPanelSplitHeightPx(
  value: number,
  ctx: RepoPanelSplitHeightClampContext = {},
): number {
  if (!Number.isFinite(value)) {
    return REPO_PANEL_SPLIT_HEIGHT_DEFAULT_PX;
  }
  const min = REPO_PANEL_SPLIT_HEIGHT_MIN_PX;
  const maxFromParent = ctx.parentAvailablePx
    ? Math.max(
        min,
        ctx.parentAvailablePx -
          REPO_PANEL_SPLIT_FILES_MIN_PX -
          REPO_PANEL_SPLIT_HANDLE_PX,
      )
    : REPO_PANEL_SPLIT_HEIGHT_MAX_PX;
  const max = Math.min(REPO_PANEL_SPLIT_HEIGHT_MAX_PX, maxFromParent);
  return Math.max(min, Math.min(max, Math.round(value)));
}