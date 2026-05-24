import { describe, expect, it, mock } from "bun:test";
import type { ClaudeHostProcess, ClaudeSession } from "../types";

const endClaudeProcessRow = mock(async () => {});

mock.module("../components/LeftSidebar/endClaudeProcessRow", () => ({
  endClaudeProcessRow,
}));

mock.module("./claude", () => ({
  cancelClaudeExecution: mock(async () => {}),
  listRunningClaudeSessions: mock(async () => []),
}));

mock.module("./systemResource", () => ({
  getSystemResourceSnapshot: mock(async () => ({
    claudeProcesses: [
      {
        pid: 52322,
        memoryBytes: 261 * 1024 * 1024,
        sessionId: "47c8f10c-af09-4c2b-b86b-920721a0d83d",
        projectPath: "/work/vocs-web",
        sessionSource: "lsof_jsonl",
      },
      {
        pid: 79109,
        memoryBytes: 211 * 1024 * 1024,
        sessionId: "47c8f10c-af09-4c2b-b86b-920721a0d83d",
        projectPath: "/work/vocs-web",
        sessionSource: "lsof_jsonl",
      },
    ] as ClaudeHostProcess[],
  })),
  killClaudeHostProcess: mock(async () => {}),
}));

const { releaseClaudeHostProcessesForRepositoryScope } = await import(
  "./releaseClaudeHostProcessesForWorkspaceScope"
);

function session(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: "tab-old",
    claudeSessionId: "47c8f10c-af09-4c2b-b86b-920721a0d83d",
    repositoryPath: "/work/vocs-web",
    repositoryName: "vocs-web",
    model: "sonnet",
    status: "running",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
    ...overrides,
  };
}

describe("releaseClaudeHostProcessesForRepositoryScope", () => {
  it("releases scoped wise tab when bound to claude session id", async () => {
    (endClaudeProcessRow as ReturnType<typeof mock>).mockClear();
    const releaseWiseTabSession = mock(async () => {});

    await releaseClaudeHostProcessesForRepositoryScope({
      repositoryPath: "/work/vocs-web",
      sessions: [session(), session({ id: "tab-new" })],
      excludeSessionId: "tab-new",
      releaseWiseTabSession,
    });

    expect(releaseWiseTabSession).toHaveBeenCalledWith("tab-old");
    expect(endClaudeProcessRow).not.toHaveBeenCalled();
  });

  it("ends host scan rows when no wise tab claims the scope", async () => {
    (endClaudeProcessRow as ReturnType<typeof mock>).mockClear();
    const releaseWiseTabSession = mock(async () => {});

    await releaseClaudeHostProcessesForRepositoryScope({
      repositoryPath: "/work/vocs-web",
      sessions: [session({ id: "tab-new", claudeSessionId: null, status: "idle" })],
      excludeSessionId: "tab-new",
      releaseWiseTabSession,
    });

    expect(releaseWiseTabSession).not.toHaveBeenCalled();
    expect(endClaudeProcessRow).toHaveBeenCalled();
  });
});
