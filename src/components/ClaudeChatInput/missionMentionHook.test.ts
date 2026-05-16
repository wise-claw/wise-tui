import { describe, expect, mock, test } from "bun:test";
import type { MissionAgentCommand, MissionEventRecord, MissionSnapshotRecord } from "../../services/missionControlBackend";
import {
  extractMissionMentions,
  missionMessageSnippet,
  recordMissionComposerMessage,
  type MissionMentionHookDeps,
} from "./missionMentionHook";

function activeMission(): MissionSnapshotRecord {
  return {
    missionId: "m1",
    projectId: "p1",
    projectName: "Project",
    rootPath: "/work/project",
    prdHash: null,
    title: "Mission",
    stage: "dispatch",
    status: "running",
    snapshot: {},
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("missionMentionHook", () => {
  test("extracts unique text mentions from mixed Chinese and path text", () => {
    expect(extractMissionMentions("修改需求 @后端 加缓存 @docs/readme.md，再通知 @后端")).toEqual([
      "后端",
      "docs/readme.md",
    ]);
  });

  test("truncates message snippets", () => {
    const long = "x".repeat(220);
    expect(missionMessageSnippet(long)).toHaveLength(180);
    expect(missionMessageSnippet(long).endsWith("...")).toBe(true);
  });

  test("records mention commands and a session message event", async () => {
    const command: MissionAgentCommand = {
      commandId: "cmd1",
      missionId: "m1",
      commandType: "mention",
      targetKind: "text",
      targetId: "后端",
      status: "pending",
      requestedAt: 1,
      completedAt: null,
      result: {},
    };
    const event: MissionEventRecord = {
      eventId: "event1",
      missionId: "m1",
      eventType: "mission.session.message",
      timestamp: 2,
      actor: null,
      payload: {},
    };
    const deps: MissionMentionHookDeps = {
      ensureSessionBoundToActiveMission: mock(async () => ({
        mission: activeMission(),
        binding: null,
        didAttach: false,
      })),
      recordMissionAgentCommand: mock(async () => command),
      appendMissionEvent: mock(async () => event),
    };

    const result = await recordMissionComposerMessage(
      {
        sessionId: "s1",
        projectId: "p1",
        rootPath: "/work/project",
        text: "修改需求 @后端 加缓存",
      },
      deps,
    );

    expect(result.missionId).toBe("m1");
    expect(result.mentions).toEqual(["后端"]);
    expect(deps.recordMissionAgentCommand).toHaveBeenCalledWith({
      missionId: "m1",
      commandType: "mention",
      targetKind: "text",
      targetId: "后端",
      result: {
        sessionId: "s1",
        source: "main_chat",
      },
    });
    expect(deps.appendMissionEvent).toHaveBeenCalledWith({
      missionId: "m1",
      eventType: "mission.session.message",
      payload: {
        sessionId: "s1",
        snippet: "修改需求 @后端 加缓存",
        mentions: ["后端"],
      },
    });
  });

  test("silently skips when no active mission is available", async () => {
    const deps: MissionMentionHookDeps = {
      ensureSessionBoundToActiveMission: mock(async () => ({
        mission: null,
        binding: null,
        didAttach: false,
      })),
      recordMissionAgentCommand: mock(async () => {
        throw new Error("should not record command");
      }),
      appendMissionEvent: mock(async () => {
        throw new Error("should not append event");
      }),
    };

    const result = await recordMissionComposerMessage({ sessionId: "s1", text: "@后端 hello" }, deps);

    expect(result).toEqual({ missionId: null, mentions: [], commands: [], event: null });
    expect(deps.recordMissionAgentCommand).not.toHaveBeenCalled();
    expect(deps.appendMissionEvent).not.toHaveBeenCalled();
  });
});
