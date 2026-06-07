import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  collectLiveSessionSidecarKeys,
  pruneOrphanClaudeSessionSidecarMaps,
  type ClaudeSessionSidecarMaps,
} from "./claudeSessionSidecarMaps";

function emptyMaps(): ClaudeSessionSidecarMaps {
  return {
    sessionIdMap: new Map(),
    expectedTurnNonceByTabId: new Map(),
    assistantStreamTextByTab: new Map(),
    lastStreamLineBySession: new Map(),
    lastStreamTextBySession: new Map(),
    registryBootstrapDeadlineByClaudeSid: new Map(),
    streamingProcessByTab: new Map(),
    streamingSessionStreamDetachByTab: new Map(),
    diskLoadDone: new Set(),
    diskTailLinesBySession: new Map(),
    executeSessionRetryCount: new Map(),
    workflowRunBySession: new Map(),
    trellisContextIdBySession: new Map(),
    streamStallHookExtendedByTab: new Set(),
    recentExecutePromptBySession: new Map(),
  };
}

describe("claudeSessionSidecarMaps", () => {
  test("collectLiveSessionSidecarKeys includes tab id and claude sid", () => {
    const sessions = [
      { id: "tab-1", claudeSessionId: "sid-a" },
      { id: "tab-2", claudeSessionId: null },
    ] as ClaudeSession[];
    expect([...collectLiveSessionSidecarKeys(sessions)].sort()).toEqual(["sid-a", "tab-1", "tab-2"]);
  });

  test("pruneOrphanClaudeSessionSidecarMaps removes stale entries and detaches streams", () => {
    const maps = emptyMaps();
    maps.assistantStreamTextByTab.set("dead-tab", "partial");
    maps.streamingProcessByTab.set("dead-tab", { claudeSessionId: "sid-dead" });
    let detached = false;
    maps.streamingSessionStreamDetachByTab.set("dead-tab", () => {
      detached = true;
    });
    maps.sessionIdMap.set("dead-tab", "sid-dead");
    maps.recentExecutePromptBySession.set("dead-tab", { prompt: "hi", at: Date.now() });

    const liveKeys = collectLiveSessionSidecarKeys([{ id: "live-tab", claudeSessionId: "sid-live" } as ClaudeSession]);
    expect(pruneOrphanClaudeSessionSidecarMaps(maps, liveKeys)).toBe(true);
    expect(maps.assistantStreamTextByTab.has("dead-tab")).toBe(false);
    expect(maps.recentExecutePromptBySession.has("dead-tab")).toBe(false);
    expect(maps.streamingProcessByTab.has("dead-tab")).toBe(false);
    expect(maps.streamingSessionStreamDetachByTab.has("dead-tab")).toBe(false);
    expect(maps.sessionIdMap.has("dead-tab")).toBe(false);
    expect(detached).toBe(true);
  });
});
