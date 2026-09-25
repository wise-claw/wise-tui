import { useSyncExternalStore } from "react";
import { getAppSetting, setAppSetting } from "../appSettingsStore";

/** Automation 中的多仓库协作调度设置（app_settings 持久化）。 */
export const COLLAB_AUTOMATION_SETTING_KEY = "wise.collaboration.automation.v1";

export const COLLAB_GLOBAL_LIMIT_MIN = 1;
export const COLLAB_GLOBAL_LIMIT_MAX = 16;
export const COLLAB_GLOBAL_LIMIT_DEFAULT = 4;

export interface CollabAutomationSettings {
  /** 暂停新的领取与自动恢复；运行中的尝试不受影响。 */
  paused: boolean;
  /** Wise 全局协作并发上限（每个需求另受自身 maxConcurrentAttempts 约束）。 */
  globalLimit: number;
  /** 停止请求超过该时长仍未确认时提醒（分钟）。 */
  stopReminderMinutes: number;
}

export const DEFAULT_COLLAB_AUTOMATION_SETTINGS: CollabAutomationSettings = {
  paused: false,
  globalLimit: COLLAB_GLOBAL_LIMIT_DEFAULT,
  stopReminderMinutes: 10,
};

export function parseCollabAutomationSettings(raw: unknown): CollabAutomationSettings {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  const rec = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const limit = typeof rec.globalLimit === "number" && Number.isFinite(rec.globalLimit) ? Math.round(rec.globalLimit) : COLLAB_GLOBAL_LIMIT_DEFAULT;
  const reminder =
    typeof rec.stopReminderMinutes === "number" && Number.isFinite(rec.stopReminderMinutes)
      ? Math.round(rec.stopReminderMinutes)
      : DEFAULT_COLLAB_AUTOMATION_SETTINGS.stopReminderMinutes;
  return {
    paused: rec.paused === true,
    globalLimit: Math.min(COLLAB_GLOBAL_LIMIT_MAX, Math.max(COLLAB_GLOBAL_LIMIT_MIN, limit)),
    stopReminderMinutes: Math.min(240, Math.max(1, reminder)),
  };
}

const STOPPING_STATES = new Set(["stop_requested", "stop_pending"]);

/** 停止中的尝试（从首次观察到停止态起）超过提醒时长即视为超时。 */
export function isCollabStopOverdue(
  state: string,
  stopSeenAt: number | null | undefined,
  now: number,
  reminderMinutes: number,
): boolean {
  if (!STOPPING_STATES.has(state) || stopSeenAt == null) return false;
  return now - stopSeenAt >= reminderMinutes * 60_000;
}

let snapshot: CollabAutomationSettings = DEFAULT_COLLAB_AUTOMATION_SETTINGS;
let hydrated: Promise<CollabAutomationSettings> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getCollabAutomationSettings(): CollabAutomationSettings {
  return snapshot;
}

export function hydrateCollabAutomationSettings(): Promise<CollabAutomationSettings> {
  if (!hydrated) {
    hydrated = getAppSetting(COLLAB_AUTOMATION_SETTING_KEY)
      .then((raw) => {
        snapshot = parseCollabAutomationSettings(raw);
        emit();
        return snapshot;
      })
      .catch(() => snapshot);
  }
  return hydrated;
}

export async function updateCollabAutomationSettings(patch: Partial<CollabAutomationSettings>): Promise<CollabAutomationSettings> {
  const next = parseCollabAutomationSettings({ ...snapshot, ...patch });
  await setAppSetting(COLLAB_AUTOMATION_SETTING_KEY, JSON.stringify(next));
  snapshot = next;
  emit();
  return next;
}

export function subscribeCollabAutomationSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCollabAutomationSettings(): CollabAutomationSettings {
  return useSyncExternalStore(
    subscribeCollabAutomationSettings,
    getCollabAutomationSettings,
    () => DEFAULT_COLLAB_AUTOMATION_SETTINGS,
  );
}
