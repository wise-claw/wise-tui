import { describe, expect, test } from "bun:test";
import {
  COLLAB_GLOBAL_LIMIT_DEFAULT,
  COLLAB_GLOBAL_LIMIT_MAX,
  isCollabStopOverdue,
  parseCollabAutomationSettings,
} from "./automationSettings";
import {
  COLLAB_NOTIFY_TYPES,
  DEFAULT_COLLAB_CHANNEL_SETTINGS,
  formatCollabNotification,
  parseCollabChannelSettings,
  routeCollabOutboxItem,
} from "./channelInbox";

describe("collab automation settings", () => {
  test("defaults for missing or malformed input", () => {
    expect(parseCollabAutomationSettings(null)).toEqual({ paused: false, globalLimit: COLLAB_GLOBAL_LIMIT_DEFAULT, stopReminderMinutes: 10 });
    expect(parseCollabAutomationSettings("{not json").globalLimit).toBe(COLLAB_GLOBAL_LIMIT_DEFAULT);
  });

  test("clamps limits and only accepts literal true for paused", () => {
    const s = parseCollabAutomationSettings(JSON.stringify({ paused: "yes", globalLimit: 99, stopReminderMinutes: 0 }));
    expect(s.paused).toBe(false);
    expect(s.globalLimit).toBe(COLLAB_GLOBAL_LIMIT_MAX);
    expect(s.stopReminderMinutes).toBe(1);
    expect(parseCollabAutomationSettings({ paused: true, globalLimit: 0.4 }).globalLimit).toBe(1);
  });

  test("stop overdue only for stopping states past the reminder", () => {
    const seen = 1_000;
    expect(isCollabStopOverdue("stop_requested", seen, seen + 9 * 60_000, 10)).toBe(false);
    expect(isCollabStopOverdue("stop_pending", seen, seen + 10 * 60_000, 10)).toBe(true);
    expect(isCollabStopOverdue("running", seen, seen + 60 * 60_000, 10)).toBe(false);
    expect(isCollabStopOverdue("stop_requested", undefined, Date.now(), 10)).toBe(false);
  });
});

describe("collab channel settings and routing", () => {
  test("drops unknown types and externals", () => {
    const s = parseCollabChannelSettings({ desktopToast: false, external: "slack", types: ["task.failed", "evil", 3] });
    expect(s).toEqual({ desktopToast: false, external: "none", types: ["task.failed"] });
    expect(parseCollabChannelSettings(undefined)).toEqual(DEFAULT_COLLAB_CHANNEL_SETTINGS);
    expect(DEFAULT_COLLAB_CHANNEL_SETTINGS.types).toEqual([...COLLAB_NOTIFY_TYPES]);
  });

  test("routes unselected types and silent config to skip", () => {
    const base = parseCollabChannelSettings({ types: ["decision.required"] });
    expect(routeCollabOutboxItem(base, { type: "decision.required" })).toBe("notify");
    expect(routeCollabOutboxItem(base, { type: "task.failed" })).toBe("skip");
    expect(routeCollabOutboxItem(base, null)).toBe("skip");
    const silent = { ...base, desktopToast: false, external: "none" as const };
    expect(routeCollabOutboxItem(silent, { type: "decision.required" })).toBe("skip");
    expect(routeCollabOutboxItem({ ...silent, external: "feishu" }, { type: "decision.required" })).toBe("notify");
  });

  test("notification text reads only string fields", () => {
    const n = formatCollabNotification("登录改造", { type: "decision.required", body: { summary: "执行次数用尽", extra: { x: 1 } } });
    expect(n.title).toBe("【待决策】登录改造");
    expect(n.text).toBe("执行次数用尽");
    const fallback = formatCollabNotification("  ", { type: "requirement.done", body: { summary: 42 } as Record<string, unknown> });
    expect(fallback.title).toBe("【需求完成】协作需求");
    expect(fallback.text).toContain("请在 Wise 中查看");
  });
});
