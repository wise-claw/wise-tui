import { describe, expect, test } from "bun:test";
import {
  createFreshTerminalWorkerTab,
  findTerminalEmployeeByName,
  findTerminalMentionIndex,
  findTerminalWorkerTab,
  isDiskOnlyTerminalWorkerTab,
  isTerminalWorkerWiseTab,
  normalizeTerminalDispatchName,
  resolveOrCreateTerminalWorkerTab,
  resolveTerminalDispatchPrompts,
  resolveTerminalMentionsInPrompt,
  stripTerminalAgentSlashPrefix,
  formatTerminalDispatchRecord,
} from "./terminalDispatch";
import type { ClaudeSession, EmployeeItem } from "../types";

function employee(partial: Partial<EmployeeItem> & Pick<EmployeeItem, "id" | "name">): EmployeeItem {
  return {
    agentType: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  } as EmployeeItem;
}

describe("terminalDispatch", () => {
  test("normalizeTerminalDispatchName collapses numeric suffix", () => {
    expect(normalizeTerminalDispatchName("终端01")).toBe("终端1");
    expect(normalizeTerminalDispatchName("终端1")).toBe("终端1");
  });

  test("findTerminalMentionIndex respects word boundary", () => {
    expect(findTerminalMentionIndex("请 @终端1 处理", "终端1")).toBe(2);
    expect(findTerminalMentionIndex("foo@终端1", "终端1")).toBe(-1);
  });

  test("findTerminalEmployeeByName matches normalized names", () => {
    const list = [employee({ id: "e1", name: "终端1" })];
    expect(findTerminalEmployeeByName(list, "终端01")?.id).toBe("e1");
  });

  test("isTerminalWorkerWiseTab detects employee-bound repositoryName", () => {
    expect(isTerminalWorkerWiseTab({ repositoryName: "eco-ai/员工:终端01" })).toBe(true);
    expect(isTerminalWorkerWiseTab({ repositoryName: "eco-ai" })).toBe(false);
  });

  test("isDiskOnlyTerminalWorkerTab flags uuid-only ghost tabs", () => {
    const ghost = {
      id: "4fe67527-f93f-4d9c-94a6-4b0828c2f0c0",
      claudeSessionId: "4fe67527-f93f-4d9c-94a6-4b0828c2f0c0",
      repositoryName: "eco-ai-web/员工:终端01",
      repositoryPath: "/repo",
      messages: [],
      status: "idle",
    } as ClaudeSession;
    expect(isDiskOnlyTerminalWorkerTab(ghost)).toBe(true);
    expect(findTerminalWorkerTab([ghost], "/repo", "终端01")).toBeUndefined();
  });

  test("resolveTerminalDispatchPrompts omits agent slash from outbound and bubble", () => {
    const { outboundPrompt, userBubblePrompt } = resolveTerminalDispatchPrompts(
      "你好",
      "executor",
    );
    expect(outboundPrompt).toBe("你好");
    expect(userBubblePrompt).toBe("你好");
    expect(outboundPrompt).not.toContain("/executor");
  });

  test("stripTerminalAgentSlashPrefix cleans legacy injected prefix", () => {
    expect(stripTerminalAgentSlashPrefix("/executor\n你好", "executor")).toBe("你好");
    expect(stripTerminalAgentSlashPrefix("/executor \n 你好", "executor")).toBe("你好");
  });

  test("stripTerminalAgentSlashPrefix preserves user slash commands", () => {
    expect(stripTerminalAgentSlashPrefix("/add-dir 你好", "executor")).toBe("/add-dir 你好");
    expect(stripTerminalAgentSlashPrefix("/add-dir 你好", null)).toBe("/add-dir 你好");
    const { outboundPrompt } = resolveTerminalDispatchPrompts("/add-dir 你好", "executor");
    expect(outboundPrompt).toBe("/add-dir 你好");
  });

  test("resolveTerminalMentionsInPrompt picks earliest mention", () => {
    const list = [
      employee({ id: "a", name: "终端A" }),
      employee({ id: "b", name: "终端B" }),
    ];
    const hits = resolveTerminalMentionsInPrompt("@终端B 然后 @终端A", list);
    expect(hits.map((item) => item.id)).toEqual(["b", "a"]);
  });

  test("formatTerminalDispatchRecord includes dispatch content and session id", () => {
    const record = formatTerminalDispatchRecord("终端01", "tab-1", "请检查天气接口", "codex");
    expect(record).toContain("Codex");
    expect(record).toContain("终端01");
    expect(record).toContain("- 正文：请检查天气接口");
    expect(record).toContain("- 分发会话：tab-1");
  });

  test("createFreshTerminalWorkerTab always creates a new worker tab", async () => {
    const terminal = employee({ id: "e1", name: "终端01" });
    const existing = {
      id: "tab-existing",
      claudeSessionId: "claude-existing",
      repositoryName: "eco-ai/员工:终端01",
      repositoryPath: "/repo",
      messages: [{ id: "m1", role: "user", content: "hi", timestamp: 1 }],
      status: "idle",
    } as ClaudeSession;
    const sessions = [existing];
    let created = 0;
    const { workerTabId: reused } = await resolveOrCreateTerminalWorkerTab(
      {
        getSessions: () => sessions,
        createSession: async () => {
          created += 1;
          return "tab-new";
        },
      },
      "/repo",
      "eco-ai",
      terminal,
    );
    expect(reused).toBe("tab-existing");
    expect(created).toBe(0);

    const { workerTabId: fresh } = await createFreshTerminalWorkerTab(
      {
        getSessions: () => sessions,
        createSession: async () => {
          created += 1;
          return "tab-fresh";
        },
      },
      "/repo",
      "eco-ai",
      terminal,
    );
    expect(fresh).toBe("tab-fresh");
    expect(created).toBe(1);
  });
});
