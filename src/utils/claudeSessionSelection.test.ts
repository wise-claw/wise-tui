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

  it("prefers recoverable history over newer empty shell tabs", () => {
    const path = "/p/myrepo";
    const emptyShell: ClaudeSession = {
      id: "session_new_empty",
      claudeSessionId: null,
      repositoryPath: path,
      repositoryName: "myrepo",
      model: "sonnet",
      status: "idle",
      messages: [],
      createdAt: 9_000,
      pendingPrompt: "",
    };
    const withDisk: ClaudeSession = {
      id: "uuid-old",
      claudeSessionId: "uuid-old",
      repositoryPath: path,
      repositoryName: "myrepo",
      model: "sonnet",
      status: "idle",
      messages: [],
      createdAt: 100,
      pendingPrompt: "",
      diskPreview: "上次对话预览",
    };
    const withMessages = sess("with-msg", path, "myrepo", 200);
    const picked = pickSessionForRepositorySidebarSelect(
      [emptyShell, withDisk, withMessages],
      path,
      {},
    );
    expect(picked?.id).toBe("with-msg");
  });

  it("prefers disk-backed empty transcript over brand-new empty shell", () => {
    const path = "/p/myrepo";
    const emptyShell: ClaudeSession = {
      id: "session_new_empty",
      claudeSessionId: null,
      repositoryPath: path,
      repositoryName: "myrepo",
      model: "sonnet",
      status: "idle",
      messages: [],
      createdAt: 9_000,
      pendingPrompt: "",
    };
    const withDisk: ClaudeSession = {
      id: "uuid-old",
      claudeSessionId: "uuid-old",
      repositoryPath: path,
      repositoryName: "myrepo",
      model: "sonnet",
      status: "idle",
      messages: [],
      createdAt: 100,
      pendingPrompt: "",
      diskPreview: "可从磁盘恢复",
    };
    const picked = pickSessionForRepositorySidebarSelect([emptyShell, withDisk], path, {});
    expect(picked?.id).toBe("uuid-old");
  });
});
