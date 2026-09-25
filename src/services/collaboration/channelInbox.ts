import { useSyncExternalStore } from "react";
import { getAppSetting, setAppSetting } from "../appSettingsStore";
import type { CollabMessage } from "../../types/collaboration";
import { messageSummary, messageTypeLabel } from "./selectors";

/** 协作消息 → 桌面提醒 / 外部渠道的映射设置（app_settings 持久化）。 */
export const COLLAB_CHANNEL_SETTING_KEY = "wise.collaboration.channel.v1";

/** 与 Rust `events::NOTIFY_TYPES` 对齐：进入 channel outbox 的消息类型。 */
export const COLLAB_NOTIFY_TYPES = [
  "decision.required",
  "requirement.verifying",
  "requirement.done",
  "task.failed",
  "change.requested",
  "change.verified",
  "requirement.stop_pending",
] as const;

export type CollabExternalChannel = "none" | "feishu" | "wecom" | "telegram";

export const COLLAB_EXTERNAL_CHANNEL_LABELS: Record<CollabExternalChannel, string> = {
  none: "不转发",
  feishu: "飞书",
  wecom: "企业微信",
  telegram: "Telegram",
};

export interface CollabChannelSettings {
  desktopToast: boolean;
  external: CollabExternalChannel;
  /** 需要提醒/转发的消息类型；未勾选的类型只进收件箱。 */
  types: string[];
}

export const DEFAULT_COLLAB_CHANNEL_SETTINGS: CollabChannelSettings = {
  desktopToast: true,
  external: "none",
  types: [...COLLAB_NOTIFY_TYPES],
};

const EXTERNALS = new Set<CollabExternalChannel>(["none", "feishu", "wecom", "telegram"]);
const NOTIFY_SET = new Set<string>(COLLAB_NOTIFY_TYPES);

export function parseCollabChannelSettings(raw: unknown): CollabChannelSettings {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  const rec = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const external = typeof rec.external === "string" && EXTERNALS.has(rec.external as CollabExternalChannel)
    ? (rec.external as CollabExternalChannel)
    : "none";
  const types = Array.isArray(rec.types)
    ? [...new Set(rec.types.filter((t): t is string => typeof t === "string" && NOTIFY_SET.has(t)))]
    : [...COLLAB_NOTIFY_TYPES];
  return { desktopToast: rec.desktopToast !== false, external, types };
}

export interface CollabNotificationText {
  title: string;
  text: string;
}

/** 渠道通知文案；只读取消息体中的字符串字段。 */
export function formatCollabNotification(
  requirementTitle: string,
  message: Pick<CollabMessage, "type" | "body">,
): CollabNotificationText {
  const kind = messageTypeLabel(message.type);
  const title = `【${kind}】${requirementTitle.trim() || "协作需求"}`.slice(0, 120);
  const summary = messageSummary(message);
  const text = summary && summary !== kind ? summary : `${kind}，请在 Wise 中查看。`;
  return { title, text };
}

export type CollabOutboxRoute = "skip" | "notify";

/** 渠道泵的路由：未勾选的类型直接确认（只进收件箱），其余走提醒/转发。 */
export function routeCollabOutboxItem(
  settings: CollabChannelSettings,
  message: Pick<CollabMessage, "type"> | null,
): CollabOutboxRoute {
  if (!message) return "skip";
  if (!settings.types.includes(message.type)) return "skip";
  if (!settings.desktopToast && settings.external === "none") return "skip";
  return "notify";
}

let snapshot: CollabChannelSettings = DEFAULT_COLLAB_CHANNEL_SETTINGS;
let hydrated: Promise<CollabChannelSettings> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getCollabChannelSettings(): CollabChannelSettings {
  return snapshot;
}

export function hydrateCollabChannelSettings(): Promise<CollabChannelSettings> {
  if (!hydrated) {
    hydrated = getAppSetting(COLLAB_CHANNEL_SETTING_KEY)
      .then((raw) => {
        snapshot = parseCollabChannelSettings(raw);
        emit();
        return snapshot;
      })
      .catch(() => snapshot);
  }
  return hydrated;
}

export async function updateCollabChannelSettings(patch: Partial<CollabChannelSettings>): Promise<CollabChannelSettings> {
  const next = parseCollabChannelSettings({ ...snapshot, ...patch });
  await setAppSetting(COLLAB_CHANNEL_SETTING_KEY, JSON.stringify(next));
  snapshot = next;
  emit();
  return next;
}

export function subscribeCollabChannelSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCollabChannelSettings(): CollabChannelSettings {
  return useSyncExternalStore(
    subscribeCollabChannelSettings,
    getCollabChannelSettings,
    () => DEFAULT_COLLAB_CHANNEL_SETTINGS,
  );
}
