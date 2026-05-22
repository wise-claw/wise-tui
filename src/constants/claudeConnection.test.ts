import { beforeEach, describe, expect, mock, test } from "bun:test";

const setAppSetting = mock(async () => undefined);

mock.module("../services/appSettingsStore", () => ({
  getAppSetting: mock(async () => null),
  setAppSetting,
}));

import {
  normalizeClaudeConnectionKind,
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

  test("sessionUsesStreamingConnection respects session override", () => {
    expect(sessionUsesStreamingConnection({ connectionKind: "oneshot" })).toBe(false);
    expect(sessionUsesStreamingConnection({ connectionKind: "streaming" })).toBe(true);
    expect(sessionUsesStreamingConnection({})).toBe(true);
  });

  test("saveDefaultClaudeConnectionKind persists setting", async () => {
    await saveDefaultClaudeConnectionKind("oneshot");
    expect(setAppSetting).toHaveBeenCalledWith("wise.claudeDefaultConnectionKind.v1", "oneshot");
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
