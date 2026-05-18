import { describe, expect, test } from "bun:test";
import type { ClusterPlan } from "../../services/prdSplit/clusterPlanner";
import type { MissionSnapshotRecord } from "../../services/missionControlBackend";
import type { ProjectItem, Repository, SplitResult, TaskItem } from "../../types";
import { emptyWizardState, type WizardState } from "../PrdSplitWizard/types";
import { projectMission } from "./presenter/projectMission";
import { buildMissionWorkspaceActionTarget } from "./contextTarget";

const project: ProjectItem = {
  id: "p1",
  name: "Wise",
  repositoryIds: [1, 2],
  rootPath: "/work/wise",
  sddMode: "wise_trellis",
  createdAt: 1,
  updatedAt: 1,
};

const repositories: Repository[] = [
  {
    id: 1,
    name: "frontend",
    path: "/work/wise/frontend",
    repositoryType: "frontend",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: 2,
    name: "backend",
    path: "/work/wise/backend",
    repositoryType: "backend",
    createdAt: "",
    updatedAt: "",
  },
];

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "T-1",
    title: "Build mission links",
    description: "Connect mission surfaces",
    role: "frontend",
    size: "M",
    estimateDays: 1,
    dependencies: [],
    sourceRefs: ["src/AppImpl.tsx:42"],
    sourceRequirementIds: ["REQ-1"],
    subtasks: ["Switchboard"],
    dod: ["Links open"],
    executionStatus: "executable",
    flowStatus: "todo",
    ...overrides,
  };
}

function state(overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...emptyWizardState(),
    stage: "dispatch",
    project: { id: project.id, name: project.name, rootPath: project.rootPath ?? "" },
    repositories: repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      path: repo.path,
      type: repo.repositoryType,
    })),
    selectedRepositoryIds: [1, 2],
    requirementsIndex: {
      schemaVersion: 2,
      version: "v1",
      requirements: [{ id: "REQ-1", content: "Connect existing Wise modules", bodyHash: "aaaaaaaaaaaaaaaa" }],
    },
    plan: {
      clusters: [
        {
          id: "cluster-fe",
          title: "Frontend shell",
          primaryRepositoryId: 1,
          repositoryIds: [1],
          requirementIds: ["REQ-1"],
          dependencyClusterIds: [],
        },
      ],
      diagnostics: {
        requirementsCoverage: { covered: ["REQ-1"], orphan: [] },
        crossRepoRequirements: [],
      },
    } satisfies ClusterPlan,
    clusterRuns: {
      "cluster-fe": {
        clusterId: "cluster-fe",
        parentTaskName: "mission-links",
        parentTaskPath: "/work/wise/.trellis/tasks/mission-links",
        status: "succeeded",
        errors: [],
        normalized: {
          source: {
            title: "Mission",
            sourceType: "manual",
            sourceRef: null,
            background: [],
            goals: [],
            scenarios: [],
            functional: [],
            nonFunctional: [],
            acceptance: [],
          },
          context: null,
          splitTasks: [task()],
          executableTasks: [],
          criticalPath: [],
          parallelGroups: [],
        } satisfies SplitResult,
      },
    },
    workflowGraphResult: {
      workflowId: "wf-1",
      workflowName: "Wise delivery",
      status: "draft",
      nodeCount: 2,
      edgeCount: 1,
    },
    ...overrides,
  };
}

describe("buildMissionWorkspaceActionTarget", () => {
  test("projects selected task context into cross-module action target", () => {
    const wizardState = state();
    const viewModel = projectMission({
      state: wizardState,
      selection: { requirementId: "REQ-1", taskId: "T-1" },
      repositories,
      projects: [project],
    });
    const target = buildMissionWorkspaceActionTarget({
      activeMission: {
        missionId: "mission-1",
        projectId: project.id,
        projectName: project.name,
        rootPath: project.rootPath ?? "",
        title: "Mission",
        stage: "dispatch",
        status: "running",
        snapshot: {},
        createdAt: 1,
        updatedAt: 2,
      } satisfies MissionSnapshotRecord,
      api: { state: wizardState } as never,
      projects: [project],
      repositories,
      viewModel,
    });

    expect(target).toMatchObject({
      missionId: "mission-1",
      projectId: "p1",
      projectName: "Wise",
      rootPath: "/work/wise",
      primaryRepositoryId: 1,
      repositoryIds: [1],
      selectedRequirementId: "REQ-1",
      selectedTaskId: "T-1",
      selectedClusterId: "cluster-fe",
      workflowId: "wf-1",
    });
    expect(target.selectedCodeAnchor).toMatchObject({
      repositoryId: 1,
      filePath: "src/AppImpl.tsx",
      line: 42,
    });
  });

  test("falls back to selected repositories when no task is selected", () => {
    const wizardState = state({ plan: null, workflowGraphResult: null });
    const viewModel = projectMission({
      state: wizardState,
      selection: { requirementId: null, taskId: null },
      repositories,
      projects: [project],
    });
    const target = buildMissionWorkspaceActionTarget({
      activeMission: null,
      api: { state: wizardState } as never,
      projects: [project],
      repositories,
      viewModel,
    });

    expect(target.repositoryIds).toEqual([1, 2]);
    expect(target.primaryRepositoryId).toBe(1);
    expect(target.selectedCodeAnchor).toBeNull();
    expect(target.workflowId).toBeNull();
  });
});
