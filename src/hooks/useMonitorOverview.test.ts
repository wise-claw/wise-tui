import { describe, expect, test } from "bun:test";
import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
import type { TrellisAgentRun } from "../services/trellisRuntime";
import type { ProjectItem, Repository } from "../types";
import { buildRepositoryMemberMonitorItems } from "./useMonitorOverview";

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

  test("treats completed and failed external runs as inactive history rows", () => {
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
      ],
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      status: "idle",
      activeSubagentCount: 0,
    });
    expect(items[0]?.subagents.map((item) => item.status)).toEqual(["completed", "failed"]);
  });
});
