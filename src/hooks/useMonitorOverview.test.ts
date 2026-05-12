import { describe, expect, test } from "bun:test";
import type { WorkflowInvocationStreamDetail } from "../constants/workflowUiEvents";
import type { Repository } from "../types";
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
});
