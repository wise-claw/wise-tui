import { invoke } from "@tauri-apps/api/core";
import { SESSION_NOTIFICATION_UI_EVENT_OPEN_PANEL } from "../constants/workflowUiEvents";

export async function wiseMascotShow(): Promise<void> {
  return invoke("wise_mascot_show");
}

export async function wiseMascotHide(): Promise<void> {
  return invoke("wise_mascot_hide");
}

export async function wiseMascotSavePosition(x: number, y: number): Promise<void> {
  return invoke("wise_mascot_save_position", { x, y });
}

export async function wiseNotificationUnreadTotal(): Promise<number> {
  return invoke<number>("wise_notification_unread_total");
}

export type WiseNotificationIngestOptions = {
  /**
   * 入库成功后派发 `SESSION_NOTIFICATION_UI_EVENT_OPEN_PANEL`，
   * 由当前标签页的 `ClaudeChat` 在 `conversationId` 与当前会话一致时展开消息通知面板。
   */
  requestOpenSessionNotificationPanel?: boolean;
};

export async function wiseNotificationIngest(
  payload: {
    conversationId: string;
    body: string;
    serverMsgId?: string | null;
  },
  options?: WiseNotificationIngestOptions,
): Promise<number> {
  const total = await invoke<number>("wise_notification_ingest", {
    payload: {
      conversationId: payload.conversationId,
      body: payload.body,
      serverMsgId: payload.serverMsgId ?? null,
    },
  });
  if (options?.requestOpenSessionNotificationPanel === true && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SESSION_NOTIFICATION_UI_EVENT_OPEN_PANEL, {
        detail: { conversationId: payload.conversationId },
      }),
    );
  }
  return total;
}

export type WiseInboundMessageRow = {
  id: string;
  conversationId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export async function wiseNotificationListRecent(limit = 50): Promise<WiseInboundMessageRow[]> {
  return invoke<WiseInboundMessageRow[]>("wise_notification_list_recent", { limit });
}

export async function wiseNotificationMarkAllRead(): Promise<void> {
  return invoke("wise_notification_mark_all_read");
}

export async function wiseNotificationMarkRead(messageId: string): Promise<void> {
  return invoke("wise_notification_mark_read", { messageId });
}

export async function wiseMainWindowFocus(): Promise<void> {
  return invoke("wise_main_window_focus");
}

/** 启动可选 WebSocket；JSON 帧字段与 `wiseNotificationIngest` 一致（camelCase）。 */
export async function wisePushStart(url: string, bearerToken?: string | null): Promise<void> {
  return invoke("wise_push_start", {
    url,
    bearerToken: bearerToken ?? null,
  });
}

export async function wisePushStop(): Promise<void> {
  return invoke("wise_push_stop");
}
