import { describe, expect, test } from "bun:test";
import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { projectMainSessionBindingKey } from "./repositoryMainSessionBinding";
import {
  buildWorkspaceLastSelection,
  isChatSurfaceReady,
  resolveClaudePanelActiveSession,
  resolveClaudeWorkspaceMainSession,
  resolveProjectComposerRepository,
} from "./workspaceSelectionState";

function repo(id: number, path = `/r/${id}`): Repository {
  return {
    id,
    name: `repo-${id}`,
    path,
    repositoryType: "frontend",
    createdAt: "0",
    updatedAt: "0",
  };
}

function project(input: Partial<ProjectItem> & Pick<ProjectItem, "id">): ProjectItem {
  return {
    id: input.id,
    name: input.name ?? "eco",
    repositoryIds: input.repositoryIds ?? [],
    createdAt: 0,
    updatedAt: 0,
    rootPath: input.rootPath,
  };
}

function session(
  id: string,
  path: string,
  name: string,
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
  };
}

describe("buildWorkspaceLastSelection", () => {
  test("project focus clears repositoryId in snapshot", () => {
    expect(
      buildWorkspaceLastSelection({
        focus: "project",
        projectId: "eco",
        repositoryId: 99,
      }),
    ).toEqual({ focus: "project", projectId: "eco", repositoryId: null });
  });

  test("repository focus keeps repositoryId", () => {
    expect(
      buildWorkspaceLastSelection({
        focus: "repository",
        projectId: "eco",
        repositoryId: 2,
      }),
    ).toEqual({ focus: "repository", projectId: "eco", repositoryId: 2 });
  });
});

describe("resolveProjectComposerRepository", () => {
  test("returns first member in project order", () => {
    const repositories = [repo(1), repo(2), repo(3)];
    const eco = project({ id: "eco", repositoryIds: [2, 1, 3] });
    expect(resolveProjectComposerRepository(eco, repositories)?.id).toBe(2);
  });
});

describe("isChatSurfaceReady", () => {
  test("project focus without active repository is ready", () => {
    const eco = project({ id: "eco", repositoryIds: [1] });
    expect(
      isChatSurfaceReady({
        activeRepository: null,
        activeWorkspaceFocus: "project",
        activeProject: eco,
      }),
    ).toBe(true);
  });

  test("no project and no repository is not ready", () => {
    expect(
      isChatSurfaceReady({
        activeRepository: null,
        activeWorkspaceFocus: "repository",
        activeProject: null,
      }),
    ).toBe(false);
  });
});

describe("resolveClaudePanelActiveSession", () => {
  const repositories = [repo(1, "/eco/web"), repo(2, "/eco/ai")];
  const eco = project({ id: "eco", repositoryIds: [1, 2], rootPath: "/eco" });
  const projectMain = session("s-proj", "/eco", "Project: eco");
  const repoMain = session("s-repo", "/eco/web", "eco-ai-web");

  test("project focus uses workspace main session when activeSessionId missing", () => {
    const resolved = resolveClaudePanelActiveSession({
      sessions: [projectMain],
      allSessions: [projectMain, repoMain],
      activeSessionId: null,
      activeWorkspaceFocus: "project",
      activeProject: eco,
      activeRepository: null,
      repositories,
      repositoryMainBindings: {
        [projectMainSessionBindingKey("eco")]: projectMain.id,
      },
      workspaceMainSession: projectMain,
    });
    expect(resolved?.id).toBe("s-proj");
  });

  test("project focus prefers active Project: tab", () => {
    const resolved = resolveClaudePanelActiveSession({
      sessions: [projectMain, repoMain],
      allSessions: [projectMain, repoMain],
      activeSessionId: "s-proj",
      activeWorkspaceFocus: "project",
      activeProject: eco,
      activeRepository: null,
      repositories,
      repositoryMainBindings: {},
      workspaceMainSession: projectMain,
    });
    expect(resolved?.id).toBe("s-proj");
  });

  test("repository focus requires active repository match", () => {
    const resolved = resolveClaudePanelActiveSession({
      sessions: [repoMain],
      allSessions: [repoMain, projectMain],
      activeSessionId: "s-repo",
      activeWorkspaceFocus: "repository",
      activeProject: eco,
      activeRepository: repositories[0],
      repositories,
      repositoryMainBindings: {},
      workspaceMainSession: null,
    });
    expect(resolved?.id).toBe("s-repo");
  });

  test("repository focus returns undefined without active repository", () => {
    expect(
      resolveClaudePanelActiveSession({
        sessions: [repoMain],
        allSessions: [repoMain],
        activeSessionId: "s-repo",
        activeWorkspaceFocus: "repository",
        activeProject: eco,
        activeRepository: null,
        repositories,
        repositoryMainBindings: {},
        workspaceMainSession: null,
      }),
    ).toBeUndefined();
  });
});

describe("resolveClaudeWorkspaceMainSession", () => {
  test("project focus resolves without activeRepository", () => {
    const repositories = [repo(1)];
    const eco = project({ id: "eco", repositoryIds: [1], rootPath: "/eco" });
    const projectMain = session("s-proj", "/eco", "Project: eco");
    const resolved = resolveClaudeWorkspaceMainSession({
      sessions: [projectMain],
      repositoryMainBindings: { [projectMainSessionBindingKey("eco")]: "s-proj" },
      repositories,
      activeRepository: null,
      activeProject: eco,
      activeWorkspaceFocus: "project",
      activeSessionId: "s-proj",
    });
    expect(resolved?.id).toBe("s-proj");
  });
});
