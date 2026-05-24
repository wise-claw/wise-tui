import { describe, expect, it } from "bun:test";
import type { ClaudeSession, ProjectItem, Repository } from "../types";
import {
  collectProjectScopePathKeys,
  collectRepositoryScopePathKeys,
  isHostProcessInWorkspaceScope,
  isSessionInWorkspaceScope,
} from "./workspaceScopeClaudeProcessMatch";

function session(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: "tab-1",
    claudeSessionId: null,
    repositoryPath: "/work/vocs-web",
    repositoryName: "vocs-web",
    model: "sonnet",
    status: "idle",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
    ...overrides,
  };
}

describe("workspaceScopeClaudeProcessMatch", () => {
  it("collectRepositoryScopePathKeys normalizes path", () => {
    expect([...collectRepositoryScopePathKeys("/work/vocs-web/")]).toEqual(["/work/vocs-web"]);
  });

  it("matches sessions on exact repository path", () => {
    const scope = collectRepositoryScopePathKeys("/work/vocs-web");
    expect(isSessionInWorkspaceScope(session(), scope)).toBe(true);
  });

  it("matches project-root session covering nested repository path", () => {
    const scope = collectRepositoryScopePathKeys("/work/vocs-web/packages/app");
    expect(
      isSessionInWorkspaceScope(
        session({
          repositoryPath: "/work/vocs-web",
          repositoryName: "Project: 华澜",
        }),
        scope,
      ),
    ).toBe(true);
  });

  it("collectProjectScopePathKeys includes root and member repositories", () => {
    const project: ProjectItem = {
      id: "p1",
      name: "华澜",
      rootPath: "/work/vocs-web",
      repositoryIds: [1, 2],
      sddMode: null,
    };
    const repos: Repository[] = [
      {
        id: 1,
        name: "vocs-web",
        path: "/work/vocs-web",
        repositoryType: "frontend",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: 2,
        name: "vocs-api",
        path: "/work/vocs-api",
        repositoryType: "backend",
        createdAt: "",
        updatedAt: "",
      },
    ];
    const keys = collectProjectScopePathKeys(project, repos);
    expect(keys.has("/work/vocs-web")).toBe(true);
    expect(keys.has("/work/vocs-api")).toBe(true);
  });

  it("matches host process by correlated project path", () => {
    const scope = collectRepositoryScopePathKeys("/work/vocs-web");
    expect(
      isHostProcessInWorkspaceScope(
        { projectPath: "/work/vocs-web/packages/ui" },
        scope,
      ),
    ).toBe(true);
  });
});
