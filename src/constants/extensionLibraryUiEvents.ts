/** 扩展库清单变更（收录、删除等）后通知 UI 刷新 */
export const WISE_UI_EVENT_EXTENSION_LIBRARY_CHANGED = "wise:extension-library-changed";

export interface ExtensionLibraryChangedDetail {
  /** 刷新后选中的库条目 id */
  selectedItemId?: string;
}

export function notifyExtensionLibraryChanged(detail?: ExtensionLibraryChangedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ExtensionLibraryChangedDetail>(WISE_UI_EVENT_EXTENSION_LIBRARY_CHANGED, {
      detail: detail ?? {},
    }),
  );
}
