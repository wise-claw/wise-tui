import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { SESSION_NOTIFICATION_UI_EVENT_OPEN_PANEL } from "../constants/workflowUiEvents";

export type WiseNotificationSource =
  | "claude"
  | "dingtalk"
  | "code-review"
  | "permission"
  | "unknown";

export type WisePetState = "idle" | "working" | "permission";

/**
 * 通知入库 + 表情联动：调用方一行调用即可同时入库并通知 mascot 窗口切到对应表情。
 * 来源为 `permission` 时切 permission 状态（举手+感叹号），其他带源通知切 working。
 */
export async function wiseNotificationIngestWithPet(
  payload: {
    conversationId: string;
    body: string;
    serverMsgId?: string | null;
    source?: WiseNotificationSource | null;
    title?: string | null;
  },
  options?: WiseNotificationIngestOptions,
): Promise<number> {
  const total = await wiseNotificationIngest(payload, options);
  const nextState: WisePetState = payload.source === "permission" ? "permission" : "working";
  void emit("wise-mascot-state", { state: nextState }).catch(() => {
    /* mascot 窗口未启动时 emit 会失败，不影响主流程 */
  });
  return total;
}

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
    /** 来源（claude/dingtalk/code-review/permission），不传则视为 unknown。 */
    source?: WiseNotificationSource | null;
    /** 真实标题（会话名/仓库名/权限项），用于气泡头部展示。 */
    title?: string | null;
  },
  options?: WiseNotificationIngestOptions,
): Promise<number> {
  const total = await invoke<number>("wise_notification_ingest", {
    payload: {
      conversationId: payload.conversationId,
      body: payload.body,
      serverMsgId: payload.serverMsgId ?? null,
      source: payload.source ?? null,
      title: payload.title ?? null,
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
