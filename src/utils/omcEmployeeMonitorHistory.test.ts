import { describe, expect, test } from "bun:test";
import {
  buildMonitorEmployeeHistorySessionsByName,
  pickLatestMonitorEmployeeHistorySession,
} from "./omcEmployeeMonitorHistory";
import type { ClaudeSession } from "../types";

function workerSession(partial: Partial<ClaudeSession> & Pick<ClaudeSession, "id">): ClaudeSession {
  return {
    claudeSessionId: null,
    repositoryPath: "/repo/eco-ai-web",
    repositoryName: "eco-ai-web/员工:终端01",
    model: "sonnet",
    status: "idle",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
    ...partial,
  };
}

describe("buildMonitorEmployeeHistorySessionsByName", () => {
  test("includes terminal wise tab with evicted messages but bound claudeSessionId", () => {
    const sessions = [
      workerSession({
        id: "wise-tab-1",
        claudeSessionId: "4fe67527-f93f-4d9c-94a6-4b0828c2f0c0",
        messages: [],
        status: "idle",
      }),
      workerSession({
        id: "4fe67527-f93f-4d9c-94a6-4b0828c2f0c0",
        claudeSessionId: "4fe67527-f93f-4d9c-94a6-4b0828c2f0c0",
        messages: [],
        status: "idle",
      }),
    ];
    const map = buildMonitorEmployeeHistorySessionsByName(sessions);
    const list = map.get("终端1") ?? [];
    expect(list.map((s) => s.id)).toEqual(["wise-tab-1"]);
  });

  test("includes running terminal tab before disk preview exists", () => {
    const sessions = [
      workerSession({
        id: "wise-tab-2",
        status: "running",
        messages: [],
      }),
    ];
    const map = buildMonitorEmployeeHistorySessionsByName(sessions);
    expect((map.get("终端1") ?? []).length).toBe(1);
  });

  test("pickLatestMonitorEmployeeHistorySession returns newest bound session", () => {
    const sessions = [
      workerSession({
        id: "older",
        messages: [{ role: "assistant", content: "a", timestamp: 100 }],
      }),
      workerSession({
        id: "newer",
        messages: [{ role: "assistant", content: "b", timestamp: 200 }],
      }),
    ];
    const map = buildMonitorEmployeeHistorySessionsByName(sessions);
    expect(pickLatestMonitorEmployeeHistorySession(map, "终端01")?.id).toBe("newer");
  });
});
