import { describe, expect, it } from "bun:test";
import type { ClaudeSession } from "../types";
import { pickSessionForRepositorySidebarSelect } from "./claudeSessionSelection";

function sess(
  id: string,
  path: string,
  repositoryName: string,
  ts: number,
): ClaudeSession {
  return {
    id,
    claudeSessionId: null,
    repositoryPath: path,
    repositoryName,
    model: "sonnet",
    status: "idle",
    messages: [{ role: "user", content: "x", timestamp: ts }],
    createdAt: ts,
    pendingPrompt: "",
  };
}

describe("pickSessionForRepositorySidebarSelect", () => {
  it("prefers configured main owner agent tab when present", () => {
    const path = "/p/myrepo";
    const sessions: ClaudeSession[] = [
      sess("human", path, "myrepo", 10),
      sess("agent", path, "myrepo/员工:executor", 50),
    ];
    const picked = pickSessionForRepositorySidebarSelect(sessions, path, {}, {
      mainOwnerAgentName: "executor",
    });
    expect(picked?.id).toBe("agent");
  });

  it("falls back to human main when agent tab missing", () => {
    const path = "/p/myrepo";
    const sessions: ClaudeSession[] = [sess("human", path, "myrepo", 10)];
    const picked = pickSessionForRepositorySidebarSelect(sessions, path, {}, {
      mainOwnerAgentName: "executor",
    });
    expect(picked?.id).toBe("human");
  });
});
