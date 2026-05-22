import { beforeEach, describe, expect, mock, test } from "bun:test";

const setAppSetting = mock(async () => undefined);

mock.module("../services/appSettingsStore", () => ({
  getAppSetting: mock(async () => null),
  setAppSetting,
}));

import {
  applyTabConnectionKindOverride,
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

  test("normalizeClaudeConnectionKind defaults to oneshot", () => {
    expect(normalizeClaudeConnectionKind(undefined)).toBe("oneshot");
    expect(normalizeClaudeConnectionKind("bad")).toBe("oneshot");
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
    expect(sessionUsesStreamingConnection({})).toBe(false);
  });

  test("loadDefaultClaudeConnectionKind defaults to oneshot when unset", async () => {
    expect(await loadDefaultClaudeConnectionKind()).toBe("oneshot");
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
