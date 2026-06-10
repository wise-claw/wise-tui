import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { pruneRepoDiskIndexSessions } from "./useClaudeSessions";

const REPO = "/Users/dev/eco-ai-web";

function session(partial: Partial<ClaudeSession> & Pick<ClaudeSession, "id">): ClaudeSession {
  return {
    claudeSessionId: partial.claudeSessionId ?? null,
    repositoryPath: partial.repositoryPath ?? REPO,
    repositoryName: partial.repositoryName ?? "eco-ai-web",
    model: partial.model ?? "sonnet",
    status: partial.status ?? "completed",
    messages: partial.messages ?? [],
    createdAt: partial.createdAt ?? Date.now(),
    pendingPrompt: partial.pendingPrompt ?? "",
    ...partial,
  };
}

describe("pruneRepoDiskIndexSessions", () => {
  test("does not prune terminal worker wise tab with recycled messages", () => {
    const worker = session({
      id: "wise-tab-terminal-02",
      claudeSessionId: "0123456789abcdef0123456789abcdef",
      repositoryName: "eco-ai-web/员工:终端02",
      messages: [],
      createdAt: 1,
    });
    const diskOnlyRows = Array.from({ length: 30 }, (_, index) =>
      session({
        id: `disk-${index}`,
        claudeSessionId: `disk-${index}`,
        createdAt: 100 + index,
      }),
    );

    const next = pruneRepoDiskIndexSessions([worker, ...diskOnlyRows], REPO, 24);
    expect(next.some((row) => row.id === "wise-tab-terminal-02")).toBe(true);
  });
});
