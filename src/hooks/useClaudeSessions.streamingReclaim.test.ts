import { describe, expect, test } from "bun:test";
import {
  buildStreamingProcessLiveEntries,
  forgetStreamingProcessActivity,
  touchStreamingProcessActivity,
  type StreamingProcessActivityEntry,
  type StreamingProcessByTabEntry,
} from "./useClaudeSessions.streamingReclaim";

describe("useClaudeSessions.streamingReclaim helpers", () => {
  test("touch creates spawnedAt then only refreshes lastActivity", () => {
    const map = new Map<string, StreamingProcessActivityEntry>();
    touchStreamingProcessActivity(map, "tab-1", 1000);
    expect(map.get("tab-1")).toEqual({ lastActivityAtMs: 1000, spawnedAtMs: 1000 });
    touchStreamingProcessActivity(map, "tab-1", 2000);
    expect(map.get("tab-1")).toEqual({ lastActivityAtMs: 2000, spawnedAtMs: 1000 });
  });

  test("forget removes activity", () => {
    const map = new Map<string, StreamingProcessActivityEntry>();
    touchStreamingProcessActivity(map, "tab-1", 1000);
    forgetStreamingProcessActivity(map, "tab-1");
    expect(map.has("tab-1")).toBe(false);
  });

  test("buildStreamingProcessLiveEntries merges activity defaults", () => {
    const procs = new Map<string, StreamingProcessByTabEntry>([
      ["a", { claudeSessionId: "sid-a" }],
      ["b", { claudeSessionId: null }],
    ]);
    const activity = new Map<string, StreamingProcessActivityEntry>([
      ["a", { lastActivityAtMs: 10, spawnedAtMs: 5, pinned: true }],
    ]);
    const live = buildStreamingProcessLiveEntries(procs, activity, 99);
    expect(live).toEqual([
      {
        tabId: "a",
        claudeSessionId: "sid-a",
        lastActivityAtMs: 10,
        spawnedAtMs: 5,
        pinned: true,
      },
      {
        tabId: "b",
        claudeSessionId: null,
        lastActivityAtMs: 99,
        spawnedAtMs: 99,
        pinned: undefined,
      },
    ]);
  });
});
