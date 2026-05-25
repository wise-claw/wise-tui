import { emit } from "@tauri-apps/api/event";
import {
  WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED,
  type SplitTodoCountUpdatedDetail,
} from "../constants/workflowUiEvents";

/**
 * 可执行任务 / Trellis 任务数量变更后广播。
 * 同时触发 window CustomEvent（ClaudeChat 等）与 Tauri event（侧栏统计 hooks）。
 */
export function notifySplitTodoCountUpdated(detail: SplitTodoCountUpdatedDetail = {}): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<SplitTodoCountUpdatedDetail>(WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED, {
        detail,
      }),
    );
  }
  void emit(WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED, detail).catch(() => {
    /* 单测或非 Tauri 宿主：仅 window 事件即可 */
  });
}
