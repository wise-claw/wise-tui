import { describe, expect, test } from "bun:test";
import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { projectMainSessionBindingKey } from "./repositoryMainSessionBinding";
import {
  buildWorkspaceLastSelection,
  canEnterMultiPaneLayout,
  isChatSurfaceReady,
  resolveChatContextRepository,
  resolveChatTopbarContext,
  resolveClaudeProjectSkillsScopePath,
  resolveClaudePanelActiveSession,
  resolveClaudeWorkspaceMainSession,
  resolveProjectComposerRepository,
  resolveScheduledTasksRepository,
  WORKSPACE_SCOPED_VIRTUAL_REPOSITORY_ID,
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

describe("resolveClaudeProjectSkillsScopePath", () => {
  const repositories = [repo(1, "/eco/eco-ai-web"), repo(2, "/eco/eco-ai")];

  test("project focus uses workspace anchor instead of member repo", () => {
    const eco = project({ id: "eco", repositoryIds: [1, 2], rootPath: "/eco" });
    expect(
      resolveClaudeProjectSkillsScopePath({
        activeWorkspaceFocus: "project",
        activeProject: eco,
        activeRepository: null,
        repositories,
      }),
    ).toBe("/eco");
  });

  test("repository focus uses active repository path", () => {
    const eco = project({ id: "eco", repositoryIds: [1, 2], rootPath: "/eco" });
    expect(
      resolveClaudeProjectSkillsScopePath({
        activeWorkspaceFocus: "repository",
        activeProject: eco,
        activeRepository: repositories[1],
        repositories,
      }),
    ).toBe("/eco/eco-ai");
  });
});

describe("resolveChatTopbarContext", () => {
  const repositories = [repo(1, "/eco/web"), repo(2, "/eco/ai")];

  test("project focus prefers workspace rootPath for openPath", () => {
    const eco = project({ id: "eco", repositoryIds: [1, 2], rootPath: "/eco" });
    const resolved = resolveChatTopbarContext({
      activeRepository: null,
      activeProject: eco,
      activeWorkspaceFocus: "project",
      repositories,
      sessionRepositoryPath: "/eco",
    });
    expect(resolved.openPath).toBe("/eco");
    expect(resolved.contextRepository?.id).toBe(1);
  });

  test("repository focus uses active repository path", () => {
    const eco = project({ id: "eco", repositoryIds: [1, 2], rootPath: "/eco" });
    const resolved = resolveChatTopbarContext({
      activeRepository: repositories[1],
      activeProject: eco,
      activeWorkspaceFocus: "repository",
      repositories,
    });
    expect(resolved.openPath).toBe("/eco/ai");
    expect(resolved.contextRepository?.id).toBe(2);
  });
});

describe("canEnterMultiPaneLayout", () => {
  const repositories = [repo(1, "/eco/web"), repo(2, "/eco/ai")];

  test("project focus with workspace rootPath can enter multi-pane without active repository", () => {
    const eco = project({ id: "eco", repositoryIds: [1, 2], rootPath: "/eco" });
    expect(
      canEnterMultiPaneLayout({
        activeRepository: null,
        activeProject: eco,
        activeWorkspaceFocus: "project",
        repositories,
        sessionRepositoryPath: "/eco",
      }),
    ).toBe(true);
  });

  test("returns false when no workspace or repository path is available", () => {
    expect(
      canEnterMultiPaneLayout({
        activeRepository: null,
        activeProject: null,
        activeWorkspaceFocus: "repository",
        repositories,
      }),
    ).toBe(false);
  });
});

describe("resolveChatContextRepository", () => {
  const repositories = [repo(1, "/eco/web"), repo(2, "/eco/ai")];

  test("project focus without active repository falls back to member repo", () => {
    const eco = project({ id: "eco", repositoryIds: [1, 2], rootPath: "/eco" });
    const resolved = resolveChatContextRepository({
      activeRepository: null,
      activeProject: eco,
      activeWorkspaceFocus: "project",
      repositories,
      sessionRepositoryPath: "/eco",
      sessionRepositoryName: "Project: eco",
    });
    expect(resolved?.id).toBe(1);
    expect(resolved?.path).toBe("/eco/web");
  });

  test("uses virtual repository scoped to workspace path when no member repo exists", () => {
    const eco = project({ id: "eco", repositoryIds: [], rootPath: "/eco" });
    const resolved = resolveChatContextRepository({
      activeRepository: null,
      activeProject: eco,
      activeWorkspaceFocus: "project",
      repositories,
      sessionRepositoryPath: "/eco",
      sessionRepositoryName: "Project: eco",
    });
    expect(resolved?.id).toBe(WORKSPACE_SCOPED_VIRTUAL_REPOSITORY_ID);
    expect(resolved?.path).toBe("/eco");
    expect(resolved?.name).toBe("eco");
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

describe("resolveScheduledTasksRepository", () => {
  test("uses active repository when repository focus", () => {
    const repositories = [repo(1), repo(2)];
    const target = resolveScheduledTasksRepository({
      activeRepository: repositories[1],
      activeProject: project({ id: "eco", repositoryIds: [1, 2] }),
      activeWorkspaceFocus: "repository",
      repositories,
    });
    expect(target?.id).toBe(2);
  });

  test("falls back to project member repository on project focus", () => {
    const repositories = [repo(10), repo(20)];
    const eco = project({ id: "eco", repositoryIds: [10, 20] });
    const target = resolveScheduledTasksRepository({
      activeRepository: null,
      activeProject: eco,
      activeWorkspaceFocus: "project",
      repositories,
    });
    expect(target?.id).toBe(10);
  });

  test("prefers repository with scheduled tasks when summary map is provided", () => {
    const repositories = [repo(1), repo(2)];
    const eco = project({ id: "eco", repositoryIds: [1, 2] });
    const target = resolveScheduledTasksRepository({
      activeRepository: null,
      activeProject: eco,
      activeWorkspaceFocus: "project",
      repositories,
      scheduledTasksByRepoId: { 2: { total: 3 } },
    });
    expect(target?.id).toBe(2);
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
