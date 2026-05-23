import { describe, expect, it, mock } from "bun:test";
import type { ClaudeSession } from "../../types";
import { HOST_PROCESS_ROW_ID_PREFIX, REGISTRY_ORPHAN_ROW_ID_PREFIX } from "./systemSessions";

mock.module("../../services/claude", () => ({
  cancelClaudeExecution: mock(async () => {}),
}));

mock.module("../../services/systemResource", () => ({
  killClaudeHostProcess: mock(async () => {}),
}));

const { cancelClaudeExecution } = await import("../../services/claude");
const { killClaudeHostProcess } = await import("../../services/systemResource");
const { endClaudeProcessRow } = await import("./endClaudeProcessRow");

function session(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: "tab-1",
    claudeSessionId: null,
    repositoryPath: "/work/p",
    repositoryName: "p",
    model: "sonnet",
    status: "running",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
    ...overrides,
  };
}

describe("endClaudeProcessRow", () => {
  it("cancels registry orphan row by parsed sid", async () => {
    (cancelClaudeExecution as ReturnType<typeof mock>).mockClear();
    await endClaudeProcessRow({
      rowSessionId: `${REGISTRY_ORPHAN_ROW_ID_PREFIX}orphan-sid`,
    });
    expect(cancelClaudeExecution).toHaveBeenCalledWith("orphan-sid");
  });

  it("kills host pid when tab has no claude session id", async () => {
    (killClaudeHostProcess as ReturnType<typeof mock>).mockClear();
    await endClaudeProcessRow({
      rowSessionId: `${HOST_PROCESS_ROW_ID_PREFIX}99`,
      rowSession: session(),
    });
    expect(killClaudeHostProcess).toHaveBeenCalledWith(99);
  });

  it("delegates wise tab rows to onCancelTabSession", async () => {
    const onCancel = mock(() => {});
    await endClaudeProcessRow({
      rowSessionId: "tab-1",
      rowSession: session({ id: "tab-1" }),
      onCancelTabSession: onCancel,
    });
    expect(onCancel).toHaveBeenCalledWith("tab-1");
  });
});
