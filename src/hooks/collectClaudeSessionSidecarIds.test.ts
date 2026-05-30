import { describe, expect, test } from "bun:test";
import {
  collectClaudeSessionSidecarIds,
  purgeClaudeSessionStreamSidecarRefs,
} from "./useClaudeSessions";

describe("collectClaudeSessionSidecarIds", () => {
  test("collects tab id, mapped claude sid, and reverse temp mappings", () => {
    const sessionIdMap = new Map<string, string>([
      ["wise-tab-1", "claude-sid-a"],
      ["wise-tab-2", "claude-sid-b"],
    ]);

    const ids = collectClaudeSessionSidecarIds("wise-tab-1", sessionIdMap, "claude-sid-a");

    expect([...ids].sort()).toEqual(["claude-sid-a", "wise-tab-1"]);
  });

  test("includes claude sid even when map is empty", () => {
    const ids = collectClaudeSessionSidecarIds("wise-tab-9", new Map(), "claude-sid-9");
    expect([...ids].sort()).toEqual(["claude-sid-9", "wise-tab-9"]);
  });
});

describe("purgeClaudeSessionStreamSidecarRefs", () => {
  test("clears sidecar maps and session id aliases", () => {
    const sessionIdMap = new Map<string, string>([["wise-tab-1", "claude-sid-a"]]);
    const expectedTurnNonceByTabId = new Map<string, number>([
      ["wise-tab-1", 3],
      ["claude-sid-a", 3],
    ]);
    const assistantStreamTextByTab = new Map<string, string>([["wise-tab-1", "partial"]]);
    const lastStreamLineBySession = new Map<string, { line: string; at: number }>([
      ["claude-sid-a", { line: "x", at: 1 }],
    ]);
    const lastStreamTextBySession = new Map<string, { text: string; at: number }>();
    const registryBootstrapDeadlineByClaudeSid = new Map<string, number>([["claude-sid-a", 999]]);
    const streamingTargetIdRef = { current: "wise-tab-1" as string | null };

    purgeClaudeSessionStreamSidecarRefs(
      "wise-tab-1",
      {
        sessionIdMap,
        expectedTurnNonceByTabId,
        assistantStreamTextByTab,
        lastStreamLineBySession,
        lastStreamTextBySession,
        registryBootstrapDeadlineByClaudeSid,
      },
      streamingTargetIdRef,
      "claude-sid-a",
    );

    expect(sessionIdMap.size).toBe(0);
    expect(expectedTurnNonceByTabId.size).toBe(0);
    expect(assistantStreamTextByTab.size).toBe(0);
    expect(lastStreamLineBySession.size).toBe(0);
    expect(registryBootstrapDeadlineByClaudeSid.size).toBe(0);
    expect(streamingTargetIdRef.current).toBeNull();
  });
});
