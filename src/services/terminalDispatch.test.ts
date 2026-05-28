import { describe, expect, test } from "bun:test";
import {
  findTerminalEmployeeByName,
  findTerminalMentionIndex,
  findTerminalWorkerTab,
  isDiskOnlyTerminalWorkerTab,
  isTerminalWorkerWiseTab,
  normalizeTerminalDispatchName,
  resolveTerminalDispatchPrompts,
  resolveTerminalMentionsInPrompt,
  stripTerminalAgentSlashPrefix,
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

  test("resolveTerminalMentionsInPrompt picks earliest mention", () => {
    const list = [
      employee({ id: "a", name: "终端A" }),
      employee({ id: "b", name: "终端B" }),
    ];
    const hits = resolveTerminalMentionsInPrompt("@终端B 然后 @终端A", list);
    expect(hits.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
