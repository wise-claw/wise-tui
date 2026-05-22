import { describe, expect, it, mock } from "bun:test";
import type { ClaudeSession } from "../types";

mock.module("./claude", () => ({
  cancelClaudeExecution: mock(async () => {}),
}));

mock.module("./systemResource", () => ({
  killClaudeHostProcess: mock(async () => {}),
}));

const { cancelClaudeExecution } = await import("./claude");
const { killClaudeHostProcess } = await import("./systemResource");
const { stopClaudeMainSession } = await import("./stopClaudeMainSession");

function session(claudeSessionId: string | null): ClaudeSession {
  return {
    id: "tab-1",
    claudeSessionId,
    repositoryPath: "/work/p",
    repositoryName: "p",
    model: "sonnet",
    status: "running",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
  };
}

describe("stopClaudeMainSession", () => {
  it("cancels by claude session id when bound", async () => {
    (cancelClaudeExecution as ReturnType<typeof mock>).mockClear();
    (killClaudeHostProcess as ReturnType<typeof mock>).mockClear();
    await stopClaudeMainSession({
      session: session("sid-a"),
      claudeProcesses: [],
    });
    expect(cancelClaudeExecution).toHaveBeenCalledWith("sid-a");
    expect(killClaudeHostProcess).not.toHaveBeenCalled();
  });

  it("kills host pids when session id is missing on tab", async () => {
    (cancelClaudeExecution as ReturnType<typeof mock>).mockClear();
    (killClaudeHostProcess as ReturnType<typeof mock>).mockClear();
    await stopClaudeMainSession({
      session: session(null),
      claudeProcesses: [
        { pid: 42, memoryBytes: 0, sessionId: null, projectPath: "/work/p", sessionSource: "lsof_jsonl" },
      ],
    });
    expect(cancelClaudeExecution).not.toHaveBeenCalled();
    expect(killClaudeHostProcess).toHaveBeenCalledWith(42);
  });
});
