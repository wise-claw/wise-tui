import { describe, expect, test } from "bun:test";
import {
  buildMonitorEmployeeHistorySessionsByName,
  pickLatestMonitorEmployeeHistorySession,
  pickMonitorTerminalDrawerSession,
} from "./omcEmployeeMonitorHistory";
import { setTerminalDefaultWorkerTab, resetTerminalDefaultWorkerTabsForTests } from "../services/terminalDispatch";
import type { ClaudeSession } from "../types";

const REPO = "/repo/eco-ai-web";

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

describe("pickMonitorTerminalDrawerSession", () => {
  test("prefers pinned default worker tab after 新增会话 over latest history session", () => {
    resetTerminalDefaultWorkerTabsForTests();
    const history = workerSession({
      id: "wise-tab-history",
      repositoryName: "eco-ai-web/员工:终端02",
      claudeSessionId: "0123456789abcdef0123456789abcdef",
      messages: [{ role: "assistant", content: "old reply", timestamp: 500 }],
      status: "completed",
      createdAt: 10,
    });
    const fresh = workerSession({
      id: "wise-tab-fresh",
      repositoryPath: REPO,
      repositoryName: "eco-ai-web/员工:终端02",
      createdAt: 900,
    });
    setTerminalDefaultWorkerTab(REPO, "终端02", "wise-tab-fresh");
    const map = buildMonitorEmployeeHistorySessionsByName([history, fresh]);
    expect(pickLatestMonitorEmployeeHistorySession(map, "终端02")?.id).toBe("wise-tab-history");

    const picked = pickMonitorTerminalDrawerSession([history, fresh], REPO, "终端02", map);
    expect(picked?.id).toBe("wise-tab-fresh");
    expect(picked?.messages.length).toBe(0);
    resetTerminalDefaultWorkerTabsForTests();
  });
});
