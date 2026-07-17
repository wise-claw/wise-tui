import { describe, expect, test } from "bun:test";
import type { EmployeeItem, Repository } from "../types";
import {
  buildSessionEmptyChatPrompt,
  resolveClaudeProxyBypassForSessionSpawn,
  resolveEngineForSession,
  resolveEngineForSessionSpawn,
  resolveSessionExecutionEngine,
  resolveExecutionRepositoryPath,
  resolveRepositoryPathForSessionSpawn,
  resolveSessionPaneContextRepository,
  resolveDiskTranscriptSessionKey,
  sessionHasDiskTranscript,
  usesWiseTabIdForDiskTranscript,
} from "./sessionExecutionEngine";

const repo = (overrides: Partial<Repository> = {}): Repository =>
  ({
    id: 1,
    name: "demo",
    path: "/repo/demo",
    repositoryType: "frontend",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  }) as Repository;

const employee = (overrides: Partial<EmployeeItem> = {}): EmployeeItem =>
  ({
    id: "e1",
    name: "Alice",
    agentType: "executor",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    displayOrder: 0,
    repositoryIds: [1],
    projectIds: [],
    ...overrides,
  }) as EmployeeItem;

describe("resolveSessionExecutionEngine", () => {
  test("defaults to claude for main session", () => {
    expect(
      resolveSessionExecutionEngine(
        { repositoryPath: "/repo/demo", repositoryName: "demo" },
        [repo()],
        [],
      ),
    ).toBe("claude");
  });

  test("uses repository executionEngine for main session", () => {
    expect(
      resolveSessionExecutionEngine(
        { repositoryPath: "/repo/demo", repositoryName: "demo" },
        [repo({ executionEngine: "codex" })],
        [],
      ),
    ).toBe("codex");
  });

  test("uses cursor executionEngine when configured", () => {
    expect(
      resolveSessionExecutionEngine(
        { repositoryPath: "/repo/demo", repositoryName: "demo" },
        [repo({ executionEngine: "cursor" })],
        [],
      ),
    ).toBe("cursor");
  });

  test("uses employee executionEngine for employee session", () => {
    expect(
      resolveSessionExecutionEngine(
        { repositoryPath: "/repo/demo", repositoryName: "demo / 员工:Alice" },
        [repo({ executionEngine: "claude" })],
        [employee({ executionEngine: "codex" })],
      ),
    ).toBe("codex");
  });

  test("uses execution environment worker tab engine segment", () => {
    expect(
      resolveSessionExecutionEngine(
        {
          repositoryPath: "/repo/demo",
          repositoryName: "demo/执行环境:codex:任务 1",
        },
        [repo({ executionEngine: "claude" })],
        [],
      ),
    ).toBe("codex");
  });

  test("matches terminal employee binding with normalized numeric suffix", () => {
    expect(
      resolveSessionExecutionEngine(
        { repositoryPath: "/repo/demo", repositoryName: "demo/员工:终端01" },
        [repo({ executionEngine: "claude" })],
        [employee({ name: "终端1", executionEngine: "codex" })],
      ),
    ).toBe("codex");
  });

  test("uses activeRepository for project-root session", () => {
    expect(
      resolveSessionExecutionEngine(
        { repositoryPath: "/work/eco", repositoryName: "Project: eco" },
        [
          repo({ id: 1, name: "eco-ai-web", path: "/work/eco/eco-ai-web", executionEngine: "claude" }),
          repo({ id: 2, name: "eco-ai", path: "/work/eco/eco-ai", executionEngine: "codex" }),
        ],
        [],
        repo({ id: 2, name: "eco-ai", path: "/work/eco/eco-ai", executionEngine: "codex" }),
      ),
    ).toBe("codex");
  });

  test("spawn resolver uses session repo even when another repo would be sidebar-active", () => {
    const claudeRepo = repo({ id: 1, name: "frontend", path: "/repo/frontend", executionEngine: "claude" });
    const codexRepo = repo({ id: 2, name: "backend", path: "/repo/backend", executionEngine: "codex" });
    expect(
      resolveEngineForSessionSpawn(
        { id: "s-backend", repositoryPath: "/repo/backend", repositoryName: "backend" },
        [claudeRepo, codexRepo],
        [],
      ),
    ).toBe("codex");
    expect(
      resolveEngineForSessionSpawn(
        { id: "s-frontend", repositoryPath: "/repo/frontend", repositoryName: "frontend" },
        [claudeRepo, codexRepo],
        [],
      ),
    ).toBe("claude");
    expect(
      resolveRepositoryPathForSessionSpawn(
        { id: "s-backend", repositoryPath: "/repo/backend", repositoryName: "backend" },
        [claudeRepo, codexRepo],
        [],
      ),
    ).toBe("/repo/backend");
  });

  test("spawn resolver honors extra pane repositoryId for project-root session", () => {
    const claudeRepo = repo({
      id: 1,
      name: "eco-ai-web",
      path: "/work/eco/eco-ai-web",
      executionEngine: "claude",
    });
    const codexRepo = repo({
      id: 2,
      name: "eco-ai",
      path: "/work/eco/eco-ai",
      executionEngine: "codex",
    });
    const projectSession = {
      id: "pane-extra-1",
      repositoryPath: "/work/eco",
      repositoryName: "Project: eco",
    };
    const paneContext = {
      activeSessionId: "primary-1",
      chatContextRepository: claudeRepo,
      extraPanes: [{ sessionId: "pane-extra-1", repositoryId: 2 }],
    };
    expect(
      resolveEngineForSessionSpawn(projectSession, [claudeRepo, codexRepo], [], paneContext),
    ).toBe("codex");
    expect(
      resolveRepositoryPathForSessionSpawn(projectSession, [claudeRepo, codexRepo], [], paneContext),
    ).toBe("/work/eco/eco-ai");
  });

  test("spawn resolver honors primary pane chatContext for project-root session", () => {
    const codexRepo = repo({
      id: 2,
      name: "eco-ai",
      path: "/work/eco/eco-ai",
      executionEngine: "codex",
    });
    const projectSession = {
      id: "primary-1",
      repositoryPath: "/work/eco",
      repositoryName: "Project: eco",
    };
    const paneContext = {
      activeSessionId: "primary-1",
      chatContextRepository: codexRepo,
      extraPanes: [{ sessionId: "pane-extra-1", repositoryId: 1 }],
    };
    expect(
      resolveEngineForSessionSpawn(projectSession, [codexRepo], [], paneContext),
    ).toBe("codex");
  });

  test("resolveSessionPaneContextRepository prefers extra slot over primary chat context", () => {
    const claudeRepo = repo({ id: 1, executionEngine: "claude" });
    const codexRepo = repo({ id: 2, path: "/repo/codex", executionEngine: "codex" });
    expect(
      resolveSessionPaneContextRepository(
        { id: "extra", repositoryPath: "/work/eco", repositoryName: "Project: eco" },
        [claudeRepo, codexRepo],
        [],
        {
          activeSessionId: "primary",
          chatContextRepository: claudeRepo,
          extraPanes: [{ sessionId: "extra", repositoryId: 2 }],
        },
      ),
    ).toEqual(codexRepo);
  });

  test("spawn resolver honors pane executionEngine override on extra slot", () => {
    const claudeRepo = repo({ id: 1, executionEngine: "claude" });
    const codexRepo = repo({ id: 2, executionEngine: "codex" });
    const paneContext = {
      activeSessionId: "primary-1",
      chatContextRepository: claudeRepo,
      extraPanes: [
        {
          sessionId: "pane-extra-1",
          repositoryId: 1,
          executionEngine: "codex" as const,
        },
      ],
    };
    expect(
      resolveEngineForSessionSpawn(
        { id: "pane-extra-1", repositoryPath: "/repo/frontend", repositoryName: "frontend" },
        [claudeRepo, codexRepo],
        [],
        paneContext,
      ),
    ).toBe("codex");
  });

  test("spawn resolver honors primary pane runtime override", () => {
    const claudeRepo = repo({ id: 1, executionEngine: "claude" });
    const paneContext = {
      activeSessionId: "primary-1",
      chatContextRepository: claudeRepo,
      primaryPaneRuntime: { executionEngine: "codex" as const },
      extraPanes: [],
    };
    expect(
      resolveEngineForSessionSpawn(
        { id: "primary-1", repositoryPath: "/repo/frontend", repositoryName: "frontend" },
        [claudeRepo],
        [],
        paneContext,
      ),
    ).toBe("codex");
  });

  test("claude proxy bypass follows pane override", () => {
    const claudeRepo = repo({ id: 1, executionEngine: "claude" });
    const paneContext = {
      activeSessionId: "primary-1",
      chatContextRepository: claudeRepo,
      primaryPaneRuntime: { executionEngine: "claude" as const, claudeProxyRoute: "bypass" as const },
      extraPanes: [],
    };
    expect(
      resolveClaudeProxyBypassForSessionSpawn(
        { id: "primary-1", repositoryPath: "/repo/frontend", repositoryName: "frontend" },
        [claudeRepo],
        [],
        paneContext,
      ),
    ).toBe(true);
    expect(
      resolveClaudeProxyBypassForSessionSpawn(
        { id: "primary-1", repositoryPath: "/repo/frontend", repositoryName: "frontend" },
        [claudeRepo],
        [],
        {
          ...paneContext,
          primaryPaneRuntime: { executionEngine: "claude", claudeProxyRoute: "auto" },
        },
      ),
    ).toBe(false);
  });

  test("resolveEngineForSession matches composer when project session uses sidebar repo", () => {
    const ecoAiWeb = repo({
      id: 1,
      name: "eco-ai-web",
      path: "/work/eco/eco-ai-web",
      executionEngine: "cursor",
    });
    expect(
      resolveEngineForSession(
        { repositoryPath: "/work/eco", repositoryName: "Project: eco" },
        [ecoAiWeb],
        [],
        ecoAiWeb,
      ),
    ).toBe("cursor");
  });

  test("resolves execution repository path from activeRepository for project session", () => {
    expect(
      resolveExecutionRepositoryPath(
        { repositoryPath: "/work/eco", repositoryName: "Project: eco" },
        [repo({ id: 1, name: "eco-ai-web", path: "/work/eco/eco-ai-web" })],
        [],
        repo({ id: 1, name: "eco-ai-web", path: "/work/eco/eco-ai-web" }),
      ),
    ).toBe("/work/eco/eco-ai-web");
  });
});

describe("disk transcript session keys", () => {
  test("codex and cursor use Wise tab id", () => {
    expect(usesWiseTabIdForDiskTranscript("codex")).toBe(true);
    expect(usesWiseTabIdForDiskTranscript("cursor")).toBe(true);
    expect(usesWiseTabIdForDiskTranscript("claude")).toBe(false);
    expect(
      resolveDiskTranscriptSessionKey(
        { id: "tab-1", claudeSessionId: "claude-uuid" },
        "codex",
      ),
    ).toBe("tab-1");
  });

  test("claude uses claudeSessionId", () => {
    expect(
      resolveDiskTranscriptSessionKey(
        { id: "tab-1", claudeSessionId: "claude-uuid" },
        "claude",
      ),
    ).toBe("claude-uuid");
    expect(
      sessionHasDiskTranscript({ id: "tab-1", claudeSessionId: null }, "codex"),
    ).toBe(true);
    expect(
      sessionHasDiskTranscript({ id: "tab-1", claudeSessionId: null }, "claude"),
    ).toBe(false);
  });
});

describe("buildSessionEmptyChatPrompt", () => {
  test("uses execution engine title in empty chat prompt", () => {
    expect(buildSessionEmptyChatPrompt("claude")).toBe("发送消息开始与 Claude Code 对话");
    expect(buildSessionEmptyChatPrompt("cursor")).toBe("发送消息开始与 Cursor CLI 对话");
    expect(buildSessionEmptyChatPrompt("codex")).toBe("发送消息开始与 Codex CLI 对话");
    expect(buildSessionEmptyChatPrompt("gemini")).toBe("发送消息开始与 Gemini CLI 对话");
    expect(buildSessionEmptyChatPrompt("opencode")).toBe("发送消息开始与 OpenCode 对话");
    expect(buildSessionEmptyChatPrompt("qoder")).toBe("发送消息开始与 Qoder CLI 对话");
  });
});
