import { describe, expect, test } from "bun:test";
import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
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
});
