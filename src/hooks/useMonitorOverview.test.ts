import { describe, expect, test } from "bun:test";
import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
import type { TrellisAgentRun } from "../services/trellisRuntime";
import type { EmployeeItem, EmployeeMonitorItem, ProjectItem, Repository } from "../types";
import {
  buildRepositoryMemberMonitorItems,
  isRepositoryMemberMainSessionSubagent,
  resolveTeamPanelEmployeeMonitorItems,
} from "./useMonitorOverview";

function repo(input: Partial<Repository> & Pick<Repository, "id" | "path">): Repository {
  return {
    id: input.id,
    name: input.name ?? "frontend app",
    path: input.path,
    repositoryType: input.repositoryType ?? "frontend",
    sddMode: input.sddMode,
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
}

function project(input: Partial<ProjectItem> & Pick<ProjectItem, "id">): ProjectItem {
  return {
    id: input.id,
    name: input.name ?? "Demo",
    repositoryIds: input.repositoryIds ?? [],
    createdAt: input.createdAt ?? 0,
    updatedAt: input.updatedAt ?? 0,
    sddMode: input.sddMode,
  };
}

function agentRun(input: Partial<TrellisAgentRun> & Pick<TrellisAgentRun, "agentRunId" | "rootPath" | "agentType" | "status">): TrellisAgentRun {
  return {
    agentRunId: input.agentRunId,
    projectId: input.projectId ?? null,
    rootPath: input.rootPath,
    sessionId: input.sessionId ?? "session-1",
    taskPath: input.taskPath ?? null,
    taskId: input.taskId ?? null,
    repositoryId: input.repositoryId ?? null,
    repositoryPath: input.repositoryPath ?? null,
    agentType: input.agentType,
    stage: input.stage ?? null,
    status: input.status,
    currentFile: input.currentFile ?? null,
    startedAt: input.startedAt ?? 100,
    updatedAt: input.updatedAt ?? 200,
    completedAt: input.completedAt ?? null,
    lastHeartbeatAt: input.lastHeartbeatAt ?? input.updatedAt ?? 200,
    metadata: input.metadata ?? {},
  };
}

describe("buildRepositoryMemberMonitorItems", () => {
  test("groups Trellis subagents under the repository member", () => {
    const invocations: WorkflowInvocationStreamDetail[] = [
      {
        phase: "progress",
        invocationKey: "inv-implement",
        sessionId: "session-1",
        repositoryPath: "/repo/frontend",
        templateId: "trellis",
        ownerKind: "repository",
        ownerRepositoryId: 1,
        ownerRepositoryName: "frontend app",
        ownerRepositoryPath: "/repo/frontend",
        repositoryType: "frontend",
        stage: "implement",
        subagentType: "trellis-implement",
        taskId: "task-1",
      },
      {
        phase: "complete",
        invocationKey: "inv-check",
        sessionId: "session-1",
        repositoryPath: "/repo/frontend",
        templateId: "trellis",
        ownerKind: "repository",
        ownerRepositoryId: 1,
        ownerRepositoryName: "frontend app",
        ownerRepositoryPath: "/repo/frontend",
        repositoryType: "frontend",
        stage: "check",
        subagentType: "trellis-check",
        taskId: "task-1",
        success: true,
      },
    ];

    const items = buildRepositoryMemberMonitorItems([repo({ id: 1, path: "/repo/frontend" })], invocations);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      repositoryId: 1,
      repositoryName: "frontend app",
      repositoryPath: "/repo/frontend",
      repositoryType: "frontend",
      status: "in_progress",
      activeSubagentCount: 1,
    });
    expect(items[0]?.subagents.map((item) => item.subagentType).sort()).toEqual([
      "trellis-check",
      "trellis-implement",
    ]);
  });

  test("dedupes stale running invocation when Trellis agent run already completed", () => {
    const invocations: WorkflowInvocationStreamDetail[] = [
      {
        phase: "progress",
        invocationKey: "agent-run-1",
        sessionId: "session-1",
        repositoryPath: "/repo/frontend",
        templateId: "trellis",
        ownerKind: "repository",
        ownerRepositoryId: 1,
        subagentType: "Explore",
        stage: "research",
      },
    ];
    const runs: TrellisAgentRun[] = [
      agentRun({
        agentRunId: "agent-run-1",
        rootPath: "/repo",
        agentType: "Explore",
        stage: "research",
        status: "succeeded",
        repositoryPath: "/repo/frontend",
        metadata: { toolUseId: "tool-1", source: "external-claude-cli" },
      }),
    ];
    const items = buildRepositoryMemberMonitorItems(
      [repo({ id: 1, path: "/repo/frontend" })],
      invocations,
      [],
      runs,
    );
    expect(items[0]?.status).toBe("idle");
    expect(items[0]?.activeSubagentCount).toBe(0);
    expect(items[0]?.subagents[0]?.status).toBe("completed");
  });

  test("shows idle Wise Trellis repositories as repository members", () => {
    const items = buildRepositoryMemberMonitorItems(
      [
        repo({
          id: 1,
          name: "frontend app",
          path: "/repo/frontend",
          repositoryType: "frontend",
          sddMode: "wise_trellis",
        }),
        repo({
          id: 2,
          name: "backend api",
          path: "/repo/backend",
          repositoryType: "backend",
          sddMode: "off",
        }),
      ],
      [],
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      repositoryId: 1,
      repositoryName: "frontend app",
      repositoryPath: "/repo/frontend",
      repositoryType: "frontend",
      status: "idle",
      activeSubagentCount: 0,
      subagents: [],
    });
  });

  test("project-level sddMode supersedes legacy repo.sddMode", () => {
    const items = buildRepositoryMemberMonitorItems(
      [
        repo({
          id: 1,
          name: "frontend app",
          path: "/repo/frontend",
          repositoryType: "frontend",
          sddMode: "off",
        }),
      ],
      [],
      [project({ id: "p1", repositoryIds: [1], sddMode: "wise_trellis" })],
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.repositoryId).toBe(1);
    expect(items[0]?.status).toBe("idle");
  });

  test("project_owned project hides the repo even if repo.sddMode says wise_trellis", () => {
    const items = buildRepositoryMemberMonitorItems(
      [
        repo({
          id: 1,
          path: "/repo/frontend",
          sddMode: "wise_trellis",
        }),
      ],
      [],
      [project({ id: "p1", repositoryIds: [1], sddMode: "project_owned" })],
    );

    expect(items).toHaveLength(0);
  });

  test("merges external Claude CLI agent runs into repository members", () => {
    const items = buildRepositoryMemberMonitorItems(
      [
        repo({
          id: 1,
          name: "frontend app",
          path: "/work/wise/apps/frontend",
          repositoryType: "frontend",
        }),
        repo({
          id: 2,
          name: "backend api",
          path: "/work/wise/services/api",
          repositoryType: "backend",
        }),
      ],
      [],
      [project({ id: "p1", repositoryIds: [1, 2], rootPath: "/work/wise", sddMode: "wise_trellis" })],
      [
        agentRun({
          agentRunId: "external-1",
          projectId: "p1",
          rootPath: "/work/wise",
          repositoryPath: "/work/wise/apps/frontend",
          agentType: "trellis-research",
          stage: "research",
          status: "running",
          metadata: { description: "Explore Mission Control frontend" },
          updatedAt: 300,
        }),
      ],
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      repositoryId: 1,
      status: "in_progress",
      activeSubagentCount: 1,
      previewText: "Explore Mission Control frontend",
    });
    expect(items[0]?.subagents[0]).toMatchObject({
      invocationKey: "external-1",
      sessionId: "session-1",
      rootPath: "/work/wise",
      repositoryPath: "/work/wise/apps/frontend",
      subagentType: "trellis-research",
      stage: "research",
      status: "running",
      taskTitle: "Explore Mission Control frontend",
      source: "trellis-runtime",
    });
    expect(items[1]).toMatchObject({
      repositoryId: 2,
      status: "idle",
      activeSubagentCount: 0,
    });
  });

  test("uses prompt path hints when the external CLI session is rooted at the project root", () => {
    const items = buildRepositoryMemberMonitorItems(
      [
        repo({ id: 1, name: "frontend app", path: "/work/wise/apps/frontend", repositoryType: "frontend" }),
        repo({ id: 2, name: "backend api", path: "/work/wise/services/api", repositoryType: "backend" }),
      ],
      [],
      [project({ id: "p1", repositoryIds: [1, 2], rootPath: "/work/wise", sddMode: "wise_trellis" })],
      [
        agentRun({
          agentRunId: "external-rooted",
          sessionId: "session-rooted",
          projectId: "p1",
          rootPath: "/work/wise",
          repositoryPath: "/work/wise",
          agentType: "Explore",
          stage: "research",
          status: "stale",
          metadata: {
            promptExcerpt: "Audit the backend api under /work/wise/services/api and report risks.",
          },
          updatedAt: 400,
        }),
      ],
      new Set(["session-rooted"]),
    );

    const backend = items.find((item) => item.repositoryId === 2);
    expect(backend).toMatchObject({
      status: "in_progress",
      activeSubagentCount: 1,
    });
    expect(backend?.subagents[0]).toMatchObject({
      invocationKey: "external-rooted",
      subagentType: "Explore",
      status: "stale",
      promptExcerpt: "Audit the backend api under /work/wise/services/api and report risks.",
    });
  });

  test("isRepositoryMemberMainSessionSubagent detects main-session rows", () => {
    expect(
      isRepositoryMemberMainSessionSubagent({ stage: "main-session", subagentType: "claude-cli" }),
    ).toBe(true);
    expect(
      isRepositoryMemberMainSessionSubagent({ stage: "implement", subagentType: "trellis-implement" }),
    ).toBe(false);
  });

  test("reclaims external Claude CLI runs that are no longer in the host process registry", () => {
    const items = buildRepositoryMemberMonitorItems(
      [repo({ id: 1, path: "/work/wise", sddMode: "wise_trellis" })],
      [],
      [],
      [
        agentRun({
          agentRunId: "external-stopped",
          sessionId: "stopped-session",
          rootPath: "/work/wise",
          repositoryPath: "/work/wise",
          agentType: "claude-cli",
          stage: "main-session",
          status: "stale",
          metadata: { source: "external-claude-cli", kind: "main-session" },
          updatedAt: 500,
        }),
      ],
      new Set(),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      status: "idle",
      activeSubagentCount: 0,
      subagents: [],
    });
  });

  test("gives fresh external Claude CLI running rows a short registry bootstrap grace window", () => {
    const items = buildRepositoryMemberMonitorItems(
      [repo({ id: 1, path: "/work/wise", sddMode: "wise_trellis" })],
      [],
      [],
      [
        agentRun({
          agentRunId: "external-fresh",
          sessionId: "fresh-session",
          rootPath: "/work/wise",
          repositoryPath: "/work/wise",
          agentType: "claude-cli",
          stage: "main-session",
          status: "running",
          metadata: { source: "external-claude-cli", kind: "main-session" },
          updatedAt: Date.now(),
        }),
      ],
      new Set(),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      status: "idle",
      activeSubagentCount: 0,
      subagents: [],
    });
  });

  test("keeps external Claude CLI runs active while the host process registry still owns the session", () => {
    const items = buildRepositoryMemberMonitorItems(
      [repo({ id: 1, path: "/work/wise", sddMode: "wise_trellis" })],
      [],
      [],
      [
        agentRun({
          agentRunId: "external-running",
          sessionId: "running-session",
          rootPath: "/work/wise",
          repositoryPath: "/work/wise",
          agentType: "claude-cli",
          stage: "main-session",
          status: "stale",
          metadata: { source: "external-claude-cli", kind: "main-session" },
          updatedAt: 500,
        }),
      ],
      new Set(["running-session"]),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      status: "idle",
      activeSubagentCount: 0,
      subagents: [],
    });
  });

  test("treats terminal external runs as inactive history rows", () => {
    const items = buildRepositoryMemberMonitorItems(
      [repo({ id: 1, path: "/work/wise", sddMode: "wise_trellis" })],
      [],
      [],
      [
        agentRun({
          agentRunId: "external-succeeded",
          rootPath: "/work/wise",
          repositoryPath: "/work/wise",
          agentType: "trellis-check",
          status: "succeeded",
          updatedAt: 300,
        }),
        agentRun({
          agentRunId: "external-failed",
          rootPath: "/work/wise",
          repositoryPath: "/work/wise",
          agentType: "trellis-implement",
          status: "failed",
          updatedAt: 200,
        }),
        agentRun({
          agentRunId: "external-cancelled",
          rootPath: "/work/wise",
          repositoryPath: "/work/wise",
          agentType: "trellis-implement",
          status: "cancelled",
          updatedAt: 100,
        }),
      ],
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      status: "idle",
      activeSubagentCount: 0,
    });
    expect(items[0]?.subagents.map((item) => item.status)).toEqual(["completed", "failed", "cancelled"]);
  });
});

describe("resolveTeamPanelEmployeeMonitorItems", () => {
  const ws = project({ id: "ws-1", repositoryIds: [10] });

  function employee(overrides: Partial<EmployeeItem> = {}): EmployeeItem {
    return {
      id: overrides.id ?? "e1",
      name: overrides.name ?? "Alice",
      agentType: "frontend",
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      displayOrder: 0,
      repositoryIds: [],
      projectIds: [],
      ...overrides,
    };
  }

  test("trellis scope includes team-assigned employees as idle when absent from monitor list", () => {
    const employees = [
      employee({ id: "e-team", name: "Team Dev", projectIds: ["ws-1"] }),
      employee({ id: "e-free", name: "Solo Dev", projectIds: ["ws-1"] }),
    ];
    const monitorItems: EmployeeMonitorItem[] = [
      {
        employeeId: "e-free",
        name: "Solo Dev",
        agentType: "frontend",
        status: "idle",
        updatedAt: 1,
      },
    ];

    const result = resolveTeamPanelEmployeeMonitorItems(monitorItems, employees, {
      activeProjectId: "ws-1",
      projects: [ws],
      restrictToProjectScope: true,
    });

    expect(result.map((item) => item.employeeId).sort()).toEqual(["e-free", "e-team"]);
    expect(result.find((item) => item.employeeId === "e-team")).toMatchObject({
      name: "Team Dev",
      status: "idle",
    });
  });

  test("non-trellis mode keeps legacy filter on monitor items only", () => {
    const employees = [employee({ id: "e1", projectIds: ["ws-1"] }), employee({ id: "e2", projectIds: ["other"] })];
    const monitorItems: EmployeeMonitorItem[] = [
      { employeeId: "e1", name: "Alice", agentType: "frontend", status: "idle", updatedAt: 1 },
      { employeeId: "e2", name: "Bob", agentType: "frontend", status: "idle", updatedAt: 2 },
    ];

    const result = resolveTeamPanelEmployeeMonitorItems(monitorItems, employees, {
      activeProjectId: "ws-1",
      projects: [ws],
      restrictToProjectScope: false,
    });

    expect(result.map((item) => item.employeeId)).toEqual(["e1", "e2"]);
  });
});
