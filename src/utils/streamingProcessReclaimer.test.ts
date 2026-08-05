import { describe, expect, test } from "bun:test";
import {
  isStreamingProcessProtectedFromReclaim,
  selectIdleStreamingTabsToReclaim,
  selectLruStreamingTabsToEvictForCap,
  selectStreamingTabsToReclaim,
  type StreamingProcessLiveEntry,
  type StreamingProcessReclaimPolicy,
  type StreamingProcessReclaimSessionView,
} from "./streamingProcessReclaimer";

const policy: StreamingProcessReclaimPolicy = {
  enabled: true,
  idleMs: 10 * 60_000,
  maxLiveProcesses: 10,
  graceMs: 60_000,
};

function entry(
  partial: Partial<StreamingProcessLiveEntry> & Pick<StreamingProcessLiveEntry, "tabId">,
): StreamingProcessLiveEntry {
  return {
    claudeSessionId: partial.claudeSessionId ?? `sid-${partial.tabId}`,
    lastActivityAtMs: partial.lastActivityAtMs ?? 0,
    spawnedAtMs: partial.spawnedAtMs ?? 0,
    pinned: partial.pinned,
    tabId: partial.tabId,
  };
}

function session(
  id: string,
  status: StreamingProcessReclaimSessionView["status"],
): StreamingProcessReclaimSessionView {
  return { id, status };
}

describe("streamingProcessReclaimer", () => {
  test("protects running, pinned, pending control, and grace window", () => {
    const now = 1_000_000;
    expect(
      isStreamingProcessProtectedFromReclaim({
        entry: entry({ tabId: "a", spawnedAtMs: now - 120_000 }),
        session: session("a", "running"),
        pendingControlCount: 0,
        nowMs: now,
        graceMs: policy.graceMs,
      }),
    ).toBe(true);
    expect(
      isStreamingProcessProtectedFromReclaim({
        entry: entry({ tabId: "b", spawnedAtMs: now - 120_000, pinned: true }),
        session: session("b", "idle"),
        pendingControlCount: 0,
        nowMs: now,
        graceMs: policy.graceMs,
      }),
    ).toBe(true);
    expect(
      isStreamingProcessProtectedFromReclaim({
        entry: entry({ tabId: "c", spawnedAtMs: now - 120_000 }),
        session: session("c", "idle"),
        pendingControlCount: 1,
        nowMs: now,
        graceMs: policy.graceMs,
      }),
    ).toBe(true);
    expect(
      isStreamingProcessProtectedFromReclaim({
        entry: entry({ tabId: "d", spawnedAtMs: now - 10_000 }),
        session: session("d", "idle"),
        pendingControlCount: 0,
        nowMs: now,
        graceMs: policy.graceMs,
      }),
    ).toBe(true);
    expect(
      isStreamingProcessProtectedFromReclaim({
        entry: entry({ tabId: "e", spawnedAtMs: now - 120_000 }),
        session: session("e", "idle"),
        pendingControlCount: 0,
        nowMs: now,
        graceMs: policy.graceMs,
      }),
    ).toBe(false);
  });

  test("idle TTL reclaims oldest idle first and skips protected", () => {
    const now = 2_000_000;
    const idleAgo = now - policy.idleMs - 1;
    const live = [
      entry({ tabId: "run", lastActivityAtMs: idleAgo, spawnedAtMs: idleAgo }),
      entry({ tabId: "old", lastActivityAtMs: idleAgo - 5_000, spawnedAtMs: idleAgo }),
      entry({ tabId: "newer-idle", lastActivityAtMs: idleAgo - 1_000, spawnedAtMs: idleAgo }),
      entry({ tabId: "fresh", lastActivityAtMs: now - 1_000, spawnedAtMs: now - 120_000 }),
    ];
    const tabs = selectIdleStreamingTabsToReclaim({
      nowMs: now,
      policy,
      live,
      sessions: [
        session("run", "running"),
        session("old", "idle"),
        session("newer-idle", "completed"),
        session("fresh", "idle"),
      ],
      pendingControlCountByTabId: new Map(),
    });
    expect(tabs).toEqual(["old", "newer-idle"]);
  });

  test("LRU cap evicts to leave room for spawn when over maxLive=10", () => {
    const now = 3_000_000;
    const live = Array.from({ length: 10 }, (_, i) =>
      entry({
        tabId: `t${i}`,
        lastActivityAtMs: now - 200_000 - i * 1_000,
        spawnedAtMs: now - 200_000,
      }),
    );
    const sessions = live.map((e) => session(e.tabId, "idle"));
    const tabs = selectLruStreamingTabsToEvictForCap({
      nowMs: now,
      policy,
      live,
      sessions,
      pendingControlCountByTabId: new Map(),
      reserveSlotForSpawn: true,
    });
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toBe("t9");
  });

  test("LRU cap does not evict when under max live", () => {
    const now = 4_000_000;
    const live = [
      entry({ tabId: "a", lastActivityAtMs: now - 300_000, spawnedAtMs: now - 300_000 }),
    ];
    expect(
      selectLruStreamingTabsToEvictForCap({
        nowMs: now,
        policy,
        live,
        sessions: [session("a", "idle")],
        pendingControlCountByTabId: new Map(),
        reserveSlotForSpawn: true,
      }),
    ).toEqual([]);
  });

  test("disabled policy returns no reclaim targets", () => {
    const now = 5_000_000;
    expect(
      selectStreamingTabsToReclaim({
        nowMs: now,
        policy: { ...policy, enabled: false },
        live: [entry({ tabId: "a", lastActivityAtMs: 0, spawnedAtMs: 0 })],
        sessions: [session("a", "idle")],
        pendingControlCountByTabId: new Map(),
        reserveSlotForSpawn: true,
      }),
    ).toEqual([]);
  });

  test("merge TTL and cap prefers unique tabs", () => {
    const now = 6_000_000;
    const idleAgo = now - policy.idleMs - 1;
    const live = Array.from({ length: 11 }, (_, i) =>
      entry({
        tabId: `t${i}`,
        lastActivityAtMs: idleAgo - i * 1_000,
        spawnedAtMs: idleAgo,
      }),
    );
    const sessions = live.map((e) => session(e.tabId, "idle"));
    const tabs = selectStreamingTabsToReclaim({
      nowMs: now,
      policy,
      live,
      sessions,
      pendingControlCountByTabId: new Map(),
      reserveSlotForSpawn: false,
    });
    expect(tabs.length).toBeGreaterThanOrEqual(1);
    expect(new Set(tabs).size).toBe(tabs.length);
  });
});
