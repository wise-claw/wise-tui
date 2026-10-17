import { describe, expect, test } from "bun:test";
import { parseSidebarSessionPreferences, sidebarSessionPreferenceKey } from "./sidebarSessionPreferencesStore";

describe("sidebar session preferences", () => {
  test("rejects malformed persisted settings", () => {
    for (const raw of [null, "{", "null", "[]", "1"]) {
      expect(parseSidebarSessionPreferences(raw)).toEqual({});
    }
    expect(parseSidebarSessionPreferences('{"a":null,"b":4,"c":{"pinned":"true","title":5}}'))
      .toEqual({ c: { pinned: false, title: undefined } });
  });
  test("restores pinned and renamed sessions", () => {
    const key = sidebarSessionPreferenceKey("/repo", { id: "session-1" });
    const value = { [key]: { pinned: true, title: " 我的会话 " } };
    expect(parseSidebarSessionPreferences(JSON.stringify(value))[key])
      .toEqual({ pinned: true, title: "我的会话" });
    expect(parseSidebarSessionPreferences(JSON.stringify({ [key]: { pinned: false, title: "名称" } }))[key])
      .toEqual({ pinned: false, title: "名称" });
  });
  test("isolates repository aliases and normalizes repository paths", () => {
    const session = { id: "same" };
    expect(sidebarSessionPreferenceKey("/repo/", session)).toBe(sidebarSessionPreferenceKey("/repo", session));
    expect(sidebarSessionPreferenceKey("/other", session)).not.toBe(sidebarSessionPreferenceKey("/repo", session));
  });
});
