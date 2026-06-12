import type { MonacoSelectionToolbarViewportPosition } from "./monacoSelectionToolbarPosition";

export interface ClampMonacoToolbarOptions {
  viewportWidth?: number;
  viewportHeight?: number;
  toolbarWidth?: number;
  toolbarHeight?: number;
  margin?: number;
}

const DEFAULT_TOOLBAR_WIDTH = 168;
const DEFAULT_TOOLBAR_HEIGHT = 36;
const DEFAULT_MARGIN = 8;

/** 将 fixed 工具条坐标限制在视口内，避免贴边被裁切。 */
export function clampMonacoSelectionToolbarPosition(
  position: MonacoSelectionToolbarViewportPosition,
  options: ClampMonacoToolbarOptions = {},
): MonacoSelectionToolbarViewportPosition {
  const viewportWidth = options.viewportWidth ?? window.innerWidth;
  const viewportHeight = options.viewportHeight ?? window.innerHeight;
  const toolbarWidth = options.toolbarWidth ?? DEFAULT_TOOLBAR_WIDTH;
  const toolbarHeight = options.toolbarHeight ?? DEFAULT_TOOLBAR_HEIGHT;
  const margin = options.margin ?? DEFAULT_MARGIN;

  const maxLeft = Math.max(margin, viewportWidth - toolbarWidth - margin);
  const maxTop = Math.max(margin, viewportHeight - toolbarHeight - margin);
  return {
    left: Math.min(Math.max(margin, position.left), maxLeft),
    top: Math.min(Math.max(margin, position.top), maxTop),
  };
}
