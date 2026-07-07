/**
 * 「助手模板」跨组件事件总线。
 *
 * - `assistants_save_custom` / `assistants_delete` 落库后，调用
 *   `dispatchAssistantsChanged()` 通知所有订阅方（比如
 *   `useSessionQuickActionsLayout`）重新拉取 `listAssistants`，
 *   让「更多」弹窗和「外显」主行同步出现新模板项。
 * - 仅做事件分发；状态本身仍由 `listAssistants()` 单一权威来源。
 */

export const WISE_UI_EVENT_ASSISTANTS_CHANGED = "wise:assistants-changed";

export function dispatchAssistantsChanged(): void {
  window.dispatchEvent(new CustomEvent(WISE_UI_EVENT_ASSISTANTS_CHANGED));
}