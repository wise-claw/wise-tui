import { describe, expect, it } from "bun:test";
import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { CONVENTIONAL_COMMIT_PROMPT_HEAD } from "./conventionalCommitMessage";
import {
  collectRepositoryPathListingCandidates,
  dedupeClaudeSessionsByIdentity,
  listSessionsForHistoryScope,
  listSessionsForRepositoryPath,
  normalizeSessionRepositoryPath,
  resolveHistoryDiskScopePath,
} from "./sessionHistoryScope";

function session(partial: Partial<ClaudeSession> & Pick<ClaudeSession, "id">): ClaudeSession {
  return {
    claudeSessionId: null,
    repositoryPath: "/work/repo",
    repositoryName: "repo",
    model: "sonnet",
    status: "completed",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
    ...partial,
  };
}

describe("sessionHistoryScope", () => {
  it("normalizeSessionRepositoryPath trims trailing slash", () => {
    expect(normalizeSessionRepositoryPath("/work/repo/")).toBe("/work/repo");
  });

  it("listSessionsForRepositoryPath matches path variants", () => {
    const sessions = [
      session({ id: "a", repositoryPath: "/work/repo/" }),
      session({ id: "b", repositoryPath: "/work/other" }),
    ];
    expect(listSessionsForRepositoryPath(sessions, "/work/repo").map((s) => s.id)).toEqual(["a"]);
  });

  it("listSessionsForRepositoryPath includes project-rooted session for member repo scope", () => {
    const sessions = [
      session({
        id: "project-main",
        repositoryPath: "/eco",
        repositoryName: "Project: eco",
      }),
      session({ id: "member", repositoryPath: "/eco/eco-ai-web" }),
    ];
    expect(listSessionsForRepositoryPath(sessions, "/eco/eco-ai-web").map((s) => s.id).sort()).toEqual([
      "member",
      "project-main",
    ]);
  });

  it("dedupeClaudeSessionsByIdentity keeps richer row", () => {
    const sid = "0123456789abcdef0123456789abcdef";
    const sparse = session({
      id: sid,
      claudeSessionId: sid,
      messages: [],
      createdAt: 10,
    });
    const rich = session({
      id: "tab-local",
      claudeSessionId: sid,
      messages: [{ role: "user", content: "hi", timestamp: 100 }],
      createdAt: 5,
    });
    const next = dedupeClaudeSessionsByIdentity([sparse, rich]);
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("tab-local");
  });

  it("collectRepositoryPathListingCandidates gathers alias paths from sessions", () => {
    const candidates = collectRepositoryPathListingCandidates("/work/repo", [
      session({ id: "x", repositoryPath: "/work/repo/" }),
      session({ id: "y", repositoryPath: "/work/other" }),
    ]);
    expect(candidates).toContain("/work/repo");
    expect(candidates).toContain("/work/repo/");
    expect(candidates).not.toContain("/work/other");
  });

  it("listClaudeDiskSessionsForRepositoryScope resolves without throwing for missing paths", async () => {
    const { listClaudeDiskSessionsForRepositoryScope: listScope } = await import("./sessionHistoryScope");
    const result = await listScope("/tmp/wise-nonexistent-session-history-path", []);
    expect(Array.isArray(result.disk)).toBe(true);
    expect(result.listingPath).toBe("/tmp/wise-nonexistent-session-history-path");
  });

  it("listSessionsForHistoryScope project focus includes anchor-path session without Project prefix", () => {
    const project = {
      id: "ai-research",
      name: "ai-research",
      repositoryIds: [1, 2],
      rootPath: "/work/ai-research",
      createdAt: 0,
      updatedAt: 0,
    };
    const repositories = [
      { id: 1, name: "Trellis", path: "/work/ai-research/trellis", repositoryType: "frontend" as const, createdAt: "0", updatedAt: "0" },
      { id: 2, name: "wise", path: "/work/ai-research/wise", repositoryType: "frontend" as const, createdAt: "0", updatedAt: "0" },
    ];
    const sessions = [
      session({ id: "workspace-today", repositoryPath: "/work/ai-research", repositoryName: "Trellis" }),
      session({ id: "trellis", repositoryPath: "/work/ai-research/trellis", repositoryName: "Trellis" }),
    ];
    const scoped = listSessionsForHistoryScope(sessions, {
      repositoryScopePath: "/work/ai-research/trellis",
      activeProject: project,
      activeWorkspaceFocus: "project",
      activeRepositoryId: 1,
      repositories,
      workspaceMode: "multi_repo",
    });
    expect(scoped.map((s) => s.id)).toEqual(["workspace-today"]);
  });

  it("listSessionsForHistoryScope project focus excludes member repo sessions", () => {
    const project = {
      id: "ai-research",
      name: "ai-research",
      repositoryIds: [1, 2],
      rootPath: "/work/ai-research",
      createdAt: 0,
      updatedAt: 0,
    };
    const repositories = [
      { id: 1, name: "Trellis", path: "/work/ai-research/trellis", repositoryType: "frontend" as const, createdAt: "0", updatedAt: "0" },
      { id: 2, name: "wise", path: "/work/ai-research/wise", repositoryType: "frontend" as const, createdAt: "0", updatedAt: "0" },
    ];
    const sessions = [
      session({ id: "project-main", repositoryPath: "/work/ai-research", repositoryName: "Project: ai-research" }),
      session({ id: "trellis", repositoryPath: "/work/ai-research/trellis", repositoryName: "Trellis" }),
      session({ id: "wise", repositoryPath: "/work/ai-research/wise", repositoryName: "wise" }),
    ];
    const scoped = listSessionsForHistoryScope(sessions, {
      repositoryScopePath: "/work/ai-research/trellis",
      activeProject: project,
      activeWorkspaceFocus: "project",
      activeRepositoryId: 1,
      repositories,
      workspaceMode: "multi_repo",
    });
    expect(scoped.map((s) => s.id)).toEqual(["project-main"]);
  });

  it("listSessionsForHistoryScope repository focus excludes Project sessions", () => {
    const project = {
      id: "ai-research",
      name: "ai-research",
      repositoryIds: [1],
      rootPath: "/work/ai-research",
      createdAt: 0,
      updatedAt: 0,
    };
    const repositories = [
      { id: 1, name: "Trellis", path: "/work/ai-research/trellis", repositoryType: "frontend" as const, createdAt: "0", updatedAt: "0" },
    ];
    const sessions = [
      session({ id: "project-main", repositoryPath: "/work/ai-research", repositoryName: "Project: ai-research" }),
      session({ id: "trellis", repositoryPath: "/work/ai-research/trellis", repositoryName: "Trellis" }),
    ];
    const scoped = listSessionsForHistoryScope(sessions, {
      repositoryScopePath: "/work/ai-research/trellis",
      activeProject: project,
      activeWorkspaceFocus: "repository",
      activeRepositoryId: 1,
      repositories,
      workspaceMode: "multi_repo",
    });
    expect(scoped.map((s) => s.id)).toEqual(["trellis"]);
  });

  it("resolveHistoryDiskScopePath uses project anchor when workspace focus is project", () => {
    const project = {
      id: "ai-research",
      name: "ai-research",
      repositoryIds: [1],
      rootPath: "/work/ai-research",
      createdAt: 0,
      updatedAt: 0,
    };
    const repositories = [
      { id: 1, name: "Trellis", path: "/work/ai-research/trellis", repositoryType: "frontend" as const, createdAt: "0", updatedAt: "0" },
    ];
    expect(
      resolveHistoryDiskScopePath({
        repositoryScopePath: "/work/ai-research/trellis",
        activeProject: project,
        activeWorkspaceFocus: "project",
        repositories,
        workspaceMode: "multi_repo",
      }),
    ).toBe("/work/ai-research");
  });

  it("listSessionsForHistoryScope hides AI conventional-commit prompt sessions", () => {
    const sessions = [
      session({
        id: "ai-commit",
        messages: [
          {
            id: 1,
            role: "user",
            content: `${CONVENTIONAL_COMMIT_PROMPT_HEAD}\n要求：`,
            parts: [{ type: "text", text: CONVENTIONAL_COMMIT_PROMPT_HEAD }],
            timestamp: 1,
          },
        ],
      }),
      session({
        id: "disk-ai-commit",
        messages: [],
        diskPreview: CONVENTIONAL_COMMIT_PROMPT_HEAD,
      }),
      session({
        id: "real",
        messages: [
          {
            id: 2,
            role: "user",
            content: "将1.3.0到现在的功能梳理一下",
            parts: [{ type: "text", text: "将1.3.0到现在的功能梳理一下" }],
            timestamp: 2,
          },
        ],
      }),
    ];
    const scoped = listSessionsForHistoryScope(sessions, {
      repositoryScopePath: "/work/repo",
    });
    expect(scoped.map((s) => s.id)).toEqual(["real"]);
  });

  it("listSessionsForHistoryScope hides session-feedback-loop oneshot sessions", () => {
    const sessions = [
      session({
        id: "fb-repo-marker",
        repositoryName: "wise/神经网:优化-1",
        messages: [
          {
            id: 1,
            role: "user",
            content: "随便写点",
            parts: [{ type: "text", text: "随便写点" }],
            timestamp: 1,
          },
        ],
      }),
      session({
        id: "fb-prompt",
        messages: [
          {
            id: 2,
            role: "user",
            content: "你是 Wise **会话反馈神经网** 的优化节点。\n\n请分析",
            parts: [
              {
                type: "text",
                text: "你是 Wise **会话反馈神经网** 的优化节点。",
              },
            ],
            timestamp: 2,
          },
        ],
      }),
      session({
        id: "fb-disk",
        messages: [],
        diskPreview: "你是 Wise **会话反馈神经网** 的总结节点。",
      }),
      session({
        id: "real",
        messages: [
          {
            id: 3,
            role: "user",
            content: "继续实现终端滚动",
            parts: [{ type: "text", text: "继续实现终端滚动" }],
            timestamp: 3,
          },
        ],
      }),
    ];
    const scoped = listSessionsForHistoryScope(sessions, {
      repositoryScopePath: "/work/repo",
    });
    expect(scoped.map((s) => s.id)).toEqual(["real"]);
  });
});
