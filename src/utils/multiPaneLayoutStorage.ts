import { PRIMARY_MAIN_WINDOW_LABEL } from "../services/mainWindow";

/** @deprecated 旧版全局多屏状态；主窗首次加载时会迁移到按窗键。 */
export const LEGACY_MULTI_PANE_LAYOUT_STATE_STORAGE_KEY = "wise.mainLayout.multiPaneState.v1";

const MULTI_PANE_LAYOUT_STORAGE_KEY_PREFIX = "wise.mainLayout.multiPaneState.v1:";

/** 多屏布局持久化键：每个主工作区窗口独立一份（main / main-dock-*）。 */
export function multiPaneLayoutStorageKey(windowLabel: string): string {
  const safe = windowLabel.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${MULTI_PANE_LAYOUT_STORAGE_KEY_PREFIX}${safe || PRIMARY_MAIN_WINDOW_LABEL}`;
}

export function resolveCurrentMultiPaneLayoutStorageKey(
  windowLabel: string | null | undefined,
): string {
  const label = windowLabel?.trim() || PRIMARY_MAIN_WINDOW_LABEL;
  return multiPaneLayoutStorageKey(label);
}
