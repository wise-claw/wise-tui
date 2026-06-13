import { describe, expect, test } from "bun:test";
import type { ClaudeSession, Repository } from "../types";
import {
  projectMainSessionBindingKey,
  normalizeRepositoryPathKey,
} from "./repositoryMainSessionBinding";
import { resolveWorkspaceMainSession } from "./resolveWorkspaceMainSession";

function session(
  id: string,
  path: string,
  name: string,
  overrides?: Partial<ClaudeSession>,
): ClaudeSession {
  return {
    id,
    claudeSessionId: `claude-${id}`,
    repositoryPath: path,
    repositoryName: name,
    model: "",
    status: "idle",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
    ...overrides,
  };
}

describe("resolveWorkspaceMainSession", () => {
  const repoPath = "/work/demo";
  const repoKey = normalizeRepositoryPathKey(repoPath);
  const repositories: Repository[] = [
    { id: 1, name: "demo", path: repoPath, projectId: "p1" },
  ];

  test("repository focus prefers bound main session", () => {
    const main = session("s-main", repoPath, "demo");
    const employee = session("s-emp", repoPath, "demo / 员工:Bot");
    const bindings = { [repoKey]: "s-main" };
    const resolved = resolveWorkspaceMainSession({
      sessions: [employee, main],
      bindings,
      repositories,
      activeRepository: repositories[0],
      activeWorkspaceFocus: "repository",
    });
    expect(resolved?.id).toBe("s-main");
  });

  test("falls back to active tab when it belongs to active repository", () => {
    const main = session("s-main", repoPath, "demo");
    const resolved = resolveWorkspaceMainSession({
      sessions: [main],
      bindings: {},
      repositories,
      activeRepository: repositories[0],
      activeWorkspaceFocus: "repository",
      activeSessionId: "s-main",
    });
    expect(resolved?.id).toBe("s-main");
  });

  test("project focus uses project binding key", () => {
    const projectMain = session("s-proj", "/work", "Project: HR");
    const bindings = { [projectMainSessionBindingKey("p1")]: projectMain.id };
    const resolved = resolveWorkspaceMainSession({
      sessions: [projectMain],
      bindings,
      repositories,
      activeRepository: repositories[0],
      activeProject: { id: "p1", name: "HR", repositoryIds: [1], createdAt: 0, updatedAt: 0, rootPath: "/work" },
      activeWorkspaceFocus: "project",
    });
    expect(resolved?.id).toBe(projectMain.id);
  });

  test("project focus without activeRepository falls back to activeSessionId Project tab", () => {
    const projectMain = session("s-proj", "/work", "Project: HR");
    const resolved = resolveWorkspaceMainSession({
      sessions: [projectMain],
      bindings: {},
      repositories,
      activeRepository: null,
      activeProject: { id: "p1", name: "HR", repositoryIds: [1], createdAt: 0, updatedAt: 0, rootPath: "/work" },
      activeWorkspaceFocus: "project",
      activeSessionId: "s-proj",
    });
    expect(resolved?.id).toBe("s-proj");
  });

  test("project focus resolves bound session without Project: prefix", () => {
    const projectMain = session("s-proj", "/work", "Trellis", {
      messages: [{ id: 1, role: "user", content: "hi", parts: [{ type: "text", text: "hi" }], timestamp: 1 }],
    });
    const bindings = { [projectMainSessionBindingKey("p1")]: projectMain.id };
    const resolved = resolveWorkspaceMainSession({
      sessions: [projectMain],
      bindings,
      repositories,
      activeRepository: repositories[0],
      activeProject: { id: "p1", name: "HR", repositoryIds: [1], createdAt: 0, updatedAt: 0, rootPath: "/work" },
      activeWorkspaceFocus: "project",
    });
    expect(resolved?.id).toBe("s-proj");
  });
});
