import { beforeEach, describe, expect, mock, test } from "bun:test";

const setAppSetting = mock(async () => undefined);

mock.module("../services/appSettingsStore", () => ({
  getAppSetting: mock(async () => null),
  setAppSetting,
}));

import {
  applyTabConnectionKindOverride,
  applyTabUltracodeOverride,
  isSessionUltracodeActive,
  isTabUltracodeOverride,
  loadDefaultClaudeConnectionKind,
  normalizeClaudeConnectionKind,
  resolveSessionConnectionKind,
  saveDefaultClaudeConnectionKind,
  sessionUsesStreamingConnection,
  WISE_CLAUDE_CONNECTION_KIND_CHANGED,
  type ClaudeSessionConnectionKind,
} from "./claudeConnection";

describe("claudeConnection", () => {
  beforeEach(() => {
    setAppSetting.mockClear();
  });

  test("normalizeClaudeConnectionKind defaults to streaming", () => {
    expect(normalizeClaudeConnectionKind(undefined)).toBe("streaming");
    expect(normalizeClaudeConnectionKind("bad")).toBe("streaming");
    expect(normalizeClaudeConnectionKind("oneshot", "streaming")).toBe("oneshot");
  });

  test("applyTabConnectionKindOverride clears override when picking global default", () => {
    const session = { id: "t1", connectionKind: "streaming" as const };
    expect(applyTabConnectionKindOverride(session, "oneshot", "oneshot")).toEqual({ id: "t1" });
    expect(applyTabConnectionKindOverride(session, "streaming", "oneshot")).toEqual({
      id: "t1",
      connectionKind: "streaming",
    });
  });

  test("resolveSessionConnectionKind falls back to global default when tab unset", () => {
    expect(resolveSessionConnectionKind(undefined, "oneshot")).toBe("oneshot");
    expect(resolveSessionConnectionKind(undefined, "streaming")).toBe("streaming");
    expect(resolveSessionConnectionKind("streaming", "oneshot")).toBe("streaming");
  });

  test("sessionUsesStreamingConnection respects session override", () => {
    expect(sessionUsesStreamingConnection({ connectionKind: "oneshot" })).toBe(false);
    expect(sessionUsesStreamingConnection({ connectionKind: "streaming" })).toBe(true);
    expect(sessionUsesStreamingConnection({})).toBe(true);
  });

  test("loadDefaultClaudeConnectionKind defaults to streaming when unset", async () => {
    expect(await loadDefaultClaudeConnectionKind()).toBe("streaming");
  });

  test("saveDefaultClaudeConnectionKind persists unified default config", async () => {
    await saveDefaultClaudeConnectionKind("oneshot");
    const lastCall = setAppSetting.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("wise.defaultConfig.v1");
    expect(JSON.parse(String(lastCall?.[1]))).toMatchObject({
      version: 1,
      connectionKind: "oneshot",
    });
  });

  test("saveDefaultClaudeConnectionKind dispatches browser event when window exists", async () => {
    if (typeof window === "undefined") return;
    const seen: ClaudeSessionConnectionKind[] = [];
    const handler = (e: Event) => {
      const k = (e as CustomEvent<{ kind: ClaudeSessionConnectionKind }>).detail?.kind;
      if (k) seen.push(k);
    };
    window.addEventListener(WISE_CLAUDE_CONNECTION_KIND_CHANGED, handler);
    try {
      await saveDefaultClaudeConnectionKind("streaming");
      expect(seen).toEqual(["streaming"]);
    } finally {
      window.removeEventListener(WISE_CLAUDE_CONNECTION_KIND_CHANGED, handler);
    }
  });
});

describe("ultracode override helpers", () => {
  test("isTabUltracodeOverride 只识别 boolean", () => {
    expect(isTabUltracodeOverride({ ultracodeEnabled: true })).toBe(true);
    expect(isTabUltracodeOverride({ ultracodeEnabled: false })).toBe(true);
    expect(isTabUltracodeOverride({ ultracodeEnabled: undefined })).toBe(false);
    expect(isTabUltracodeOverride({})).toBe(false);
    // 非法值（null / string / 数字）一律不算 override
    expect(isTabUltracodeOverride({ ultracodeEnabled: null as unknown as undefined })).toBe(false);
    expect(isTabUltracodeOverride({ ultracodeEnabled: "true" as unknown as boolean })).toBe(false);
  });

  test("isSessionUltracodeActive 优先级：per-session 永远赢", () => {
    // 显式 false beats global true
    expect(isSessionUltracodeActive({ ultracodeEnabled: false }, true)).toBe(false);
    // 显式 true beats global false
    expect(isSessionUltracodeActive({ ultracodeEnabled: true }, false)).toBe(true);
    // 未设则 follow global
    expect(isSessionUltracodeActive({}, true)).toBe(true);
    expect(isSessionUltracodeActive({}, false)).toBe(false);
    expect(isSessionUltracodeActive({ ultracodeEnabled: undefined }, false)).toBe(false);
  });

  test("applyTabUltracodeOverride 写入布尔值；null 时清除字段", () => {
    const base = { id: "s1" };
    const opened = applyTabUltracodeOverride(base, true);
    expect(opened).toEqual({ id: "s1", ultracodeEnabled: true });

    const cleared = applyTabUltracodeOverride(opened, null);
    expect(cleared).toEqual({ id: "s1" });
    // 原 base 没有 override → 传 null 必须保持原引用不变（无变更不重渲染）
    const noop = applyTabUltracodeOverride(base, null);
    expect(noop).toBe(base);
  });

  test("applyTabUltracodeOverride 显式 false 与 true 互相可覆盖", () => {
    const a = applyTabUltracodeOverride({}, true);
    const b = applyTabUltracodeOverride(a, false);
    expect(b).toEqual({ ultracodeEnabled: false });
    const c = applyTabUltracodeOverride(b, true);
    expect(c).toEqual({ ultracodeEnabled: true });
  });
});
