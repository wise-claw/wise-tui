import { describe, expect, test } from "bun:test";
import type { ClusterPlan, ClusterPlanItem } from "../../../services/prdSplit/clusterPlanner";
import type { RequirementsIndexV2 } from "../../../services/prdSplit/requirementsIndexVersion";
import type { PrdDocument, Repository, SplitResult, TaskItem } from "../../../types";
import { emptyWizardState } from "../../PrdSplitWizard/types";
import type { WizardState } from "../../PrdSplitWizard/types";
import { projectMission, toMissionPhase } from "./projectMission";

const repo: Repository = {
  id: 1,
  name: "web",
  path: "/tmp/web",
  repositoryType: "frontend",
  createdAt: "",
  updatedAt: "",
};

function cluster(overrides: Partial<ClusterPlanItem> = {}): ClusterPlanItem {
  return {
    id: "c-a",
    title: "Web",
    primaryRepositoryId: 1,
    repositoryIds: [1],
    requirementIds: ["REQ-1"],
    dependencyClusterIds: [],
    ...overrides,
  };
}

function plan(clusters: ClusterPlanItem[]): ClusterPlan {
  return {
    clusters,
    diagnostics: {
      requirementsCoverage: { covered: clusters.flatMap((item) => item.requirementIds), orphan: [] },
      crossRepoRequirements: [],
    },
  };
}

const prd: PrdDocument = {
  title: "Mission",
  sourceType: "manual",
  sourceRef: null,
  background: [],
  goals: ["Goal"],
  scenarios: [],
  functional: ["Build cockpit"],
  nonFunctional: [],
  acceptance: [],
};

const index: RequirementsIndexV2 = {
  schemaVersion: 2,
  version: "v",
  requirements: [{ id: "REQ-1", content: "Build cockpit", bodyHash: "aaaaaaaaaaaaaaaa" }],
};

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "T-1",
    title: "Build UI",
    description: "Create the surface",
    role: "frontend",
    size: "M",
    estimateDays: 1,
    dependencies: [],
    sourceRefs: ["src/App.tsx:1"],
    sourceRequirementIds: ["REQ-1"],
    subtasks: ["Layout"],
    dod: ["Works"],
    executionStatus: "executable",
    flowStatus: "todo",
    ...overrides,
  };
}

function split(tasks: TaskItem[]): SplitResult {
  return {
    source: prd,
    context: null,
    splitTasks: tasks,
    executableTasks: [],
    criticalPath: [],
    parallelGroups: [],
    unmetPreconditions: [],
  };
}

function state(overrides: Partial<WizardState> = {}): WizardState {
  return { ...emptyWizardState(), ...overrides };
}

describe("toMissionPhase", () => {
  test("maps wizard stages to mission phases", () => {
    expect(toMissionPhase(state({ stage: "input" }))).toBe("drafting");
    expect(toMissionPhase(state({ stage: "plan" }))).toBe("planning");
    expect(toMissionPhase(state({ stage: "review" }))).toBe("verifying");
    expect(toMissionPhase(state({ stage: "done" }))).toBe("done");
  });
});

describe("projectMission", () => {
  test("empty state opens setup", () => {
    const vm = projectMission({ state: state(), selection: { requirementId: null, taskId: null }, repositories: [repo] });
    expect(vm.phase).toBe("drafting");
    expect(vm.primaryCta.kind).toBe("open-setup");
    expect(vm.taskGraph.layers).toEqual([]);
  });

  test("planned state projects requirements and placeholder task layer", () => {
    const c = cluster();
    const vm = projectMission({
      state: state({
        stage: "plan",
        project: { id: "p", name: "P", rootPath: "/tmp" },
        repositories: [{ id: 1, name: "web", path: "/tmp/web", type: "frontend" }],
        selectedRepositoryIds: [1],
        prd,
        requirementsIndex: index,
        plan: plan([c]),
        clusterRuns: { "c-a": { clusterId: "c-a", parentTaskName: null, parentTaskPath: null, status: "idle", errors: [] } },
      }),
      selection: { requirementId: "REQ-1", taskId: null },
      repositories: [repo],
    });
    expect(vm.phase).toBe("planning");
    expect(vm.requirements[0].isHighlighted).toBe(true);
    expect(vm.taskGraph.layers[0].tasks[0].isPlaceholder).toBe(true);
    expect(vm.taskGraph.layers[0].tasks[0].isHighlighted).toBe(true);
  });

  test("succeeded run exposes evidence and write cta", () => {
    const c = cluster();
    const vm = projectMission({
      state: state({
        stage: "dispatch",
        project: { id: "p", name: "P", rootPath: "/tmp" },
        repositories: [{ id: 1, name: "web", path: "/tmp/web", type: "frontend" }],
        selectedRepositoryIds: [1],
        prd,
        requirementsIndex: index,
        plan: plan([c]),
        clusterRuns: {
          "c-a": {
            clusterId: "c-a",
            parentTaskName: "parent",
            parentTaskPath: "/tmp/.trellis/tasks/parent",
            status: "succeeded",
            normalized: split([task()]),
            errors: [],
          },
        },
      }),
      selection: { requirementId: null, taskId: "T-1" },
      repositories: [repo],
    });
    expect(vm.phase).toBe("verifying");
    expect(vm.primaryCta.kind).toBe("write-trellis");
    expect(vm.selectedTaskEvidence?.codeAnchors[0]).toMatchObject({ filePath: "src/App.tsx", line: 1 });
  });

  test("run state prefers streamed splitter progress over static dispatch fallback", () => {
    const c = cluster();
    const vm = projectMission({
      state: state({
        stage: "dispatch",
        project: { id: "p", name: "P", rootPath: "/tmp" },
        repositories: [{ id: 1, name: "web", path: "/tmp/web", type: "frontend" }],
        selectedRepositoryIds: [1],
        prd,
        requirementsIndex: index,
        plan: plan([c]),
        clusterRuns: {
          "c-a": {
            clusterId: "c-a",
            parentTaskName: "parent",
            parentTaskPath: "/tmp/.trellis/tasks/parent",
            status: "dispatching",
            errors: [],
            startedAt: 100,
            progress: {
              status: "running",
              progressPercent: 80,
              stageLabel: "校验结果中…",
              elapsedMs: 2500,
              error: null,
            },
          },
        },
      }),
      selection: { requirementId: null, taskId: null },
      repositories: [repo],
    });

    expect(vm.runState.clusters["c-a"].progressPercent).toBe(80);
    expect(vm.runState.clusters["c-a"].stageLabel).toBe("校验结果中…");
  });

  test("hover task highlights its source requirement without replacing click selection", () => {
    const c = cluster();
    const vm = projectMission({
      state: state({
        stage: "dispatch",
        project: { id: "p", name: "P", rootPath: "/tmp" },
        repositories: [{ id: 1, name: "web", path: "/tmp/web", type: "frontend" }],
        selectedRepositoryIds: [1],
        prd,
        requirementsIndex: index,
        plan: plan([c]),
        clusterRuns: {
          "c-a": {
            clusterId: "c-a",
            parentTaskName: "parent",
            parentTaskPath: "/tmp/.trellis/tasks/parent",
            status: "succeeded",
            normalized: split([task()]),
            errors: [],
          },
        },
      }),
      selection: { requirementId: null, taskId: null, hoverTaskId: "T-1" },
      repositories: [repo],
    });

    expect(vm.selection.hoverTaskId).toBe("T-1");
    expect(vm.selection.highlightedTaskIds.has("T-1")).toBe(true);
    expect(vm.requirementTree[0].isHighlighted).toBe(true);
  });

  test("hover and click selections both contribute to highlighted tasks", () => {
    const vm = projectMission({
      state: state({
        stage: "dispatch",
        project: { id: "p", name: "P", rootPath: "/tmp" },
        repositories: [{ id: 1, name: "web", path: "/tmp/web", type: "frontend" }],
        selectedRepositoryIds: [1],
        prd,
        requirementsIndex: {
          ...index,
          requirements: [
            { id: "REQ-1", content: "One", bodyHash: "aaaaaaaaaaaaaaaa" },
            { id: "REQ-2", content: "Two", bodyHash: "bbbbbbbbbbbbbbbb" },
          ],
        },
        plan: plan([cluster({ requirementIds: ["REQ-1", "REQ-2"] })]),
        clusterRuns: {
          "c-a": {
            clusterId: "c-a",
            parentTaskName: "parent",
            parentTaskPath: "/tmp/.trellis/tasks/parent",
            status: "succeeded",
            normalized: split([
              task({ id: "T-1", sourceRequirementIds: ["REQ-1"] }),
              task({ id: "T-2", sourceRequirementIds: ["REQ-2"] }),
            ]),
            errors: [],
          },
        },
      }),
      selection: { requirementId: "REQ-1", taskId: null, hoverRequirementId: "REQ-2" },
      repositories: [repo],
    });

    expect([...vm.selection.highlightedTaskIds].sort()).toEqual(["T-1", "T-2"]);
  });

  test("separates editable task dependencies from derived cluster dependencies", () => {
    const first = cluster({
      id: "c-a",
      title: "First",
      requirementIds: ["REQ-1"],
    });
    const second = cluster({
      id: "c-b",
      title: "Second",
      requirementIds: ["REQ-1"],
      dependencyClusterIds: ["c-a"],
    });
    const vm = projectMission({
      state: state({
        stage: "dispatch",
        project: { id: "p", name: "P", rootPath: "/tmp" },
        repositories: [{ id: 1, name: "web", path: "/tmp/web", type: "frontend" }],
        selectedRepositoryIds: [1],
        prd,
        requirementsIndex: index,
        plan: plan([first, second]),
        clusterRuns: {
          "c-a": {
            clusterId: "c-a",
            parentTaskName: "parent-a",
            parentTaskPath: "/tmp/.trellis/tasks/parent-a",
            status: "succeeded",
            normalized: split([task({ id: "T-1", title: "A" })]),
            errors: [],
          },
          "c-b": {
            clusterId: "c-b",
            parentTaskName: "parent-b",
            parentTaskPath: "/tmp/.trellis/tasks/parent-b",
            status: "succeeded",
            normalized: split([task({ id: "T-2", title: "B", dependencies: ["T-1"] })]),
            errors: [],
          },
        },
      }),
      selection: { requirementId: null, taskId: null },
      repositories: [repo],
    });

    const secondTask = vm.taskSwimlane.flatMap((lane) => lane.tasks).find((item) => item.id === "T-2");
    expect(secondTask?.dependencyTaskIds).toEqual(["T-1"]);
    expect(secondTask?.editableDependencyTaskIds).toEqual(["T-1"]);

    const clusterOnlyVm = projectMission({
      state: state({
        stage: "dispatch",
        project: { id: "p", name: "P", rootPath: "/tmp" },
        repositories: [{ id: 1, name: "web", path: "/tmp/web", type: "frontend" }],
        selectedRepositoryIds: [1],
        prd,
        requirementsIndex: index,
        plan: plan([first, second]),
        clusterRuns: {
          "c-a": {
            clusterId: "c-a",
            parentTaskName: "parent-a",
            parentTaskPath: "/tmp/.trellis/tasks/parent-a",
            status: "succeeded",
            normalized: split([task({ id: "T-1", title: "A" })]),
            errors: [],
          },
          "c-b": {
            clusterId: "c-b",
            parentTaskName: "parent-b",
            parentTaskPath: "/tmp/.trellis/tasks/parent-b",
            status: "succeeded",
            normalized: split([task({ id: "T-2", title: "B", dependencies: [] })]),
            errors: [],
          },
        },
      }),
      selection: { requirementId: null, taskId: null },
      repositories: [repo],
    });

    const clusterOnlyTask = clusterOnlyVm.taskSwimlane.flatMap((lane) => lane.tasks).find((item) => item.id === "T-2");
    expect(clusterOnlyTask?.dependencyTaskIds).toEqual(["T-1"]);
    expect(clusterOnlyTask?.editableDependencyTaskIds).toEqual([]);
  });

  test("done state points at workflow", () => {
    const vm = projectMission({
      state: state({
        stage: "done",
        workflowGraphResult: {
          workflowId: "wf-1",
          workflowName: "Workflow",
          status: "draft",
          nodeCount: 3,
          edgeCount: 2,
        },
      }),
      selection: { requirementId: null, taskId: null },
      repositories: [repo],
    });
    expect(vm.phase).toBe("done");
    expect(vm.primaryCta).toMatchObject({ kind: "open-workflow", workflowId: "wf-1" });
  });

  test("stale assignment marks related task card as stale", () => {
    const c = cluster();
    const vm = projectMission({
      state: state({
        stage: "dispatch",
        project: { id: "p", name: "P", rootPath: "/tmp" },
        repositories: [{ id: 1, name: "web", path: "/tmp/web", type: "frontend" }],
        selectedRepositoryIds: [1],
        prd,
        requirementsIndex: index,
        plan: plan([c]),
        clusterRuns: {
          "c-a": {
            clusterId: "c-a",
            parentTaskName: "parent",
            parentTaskPath: "/tmp/.trellis/tasks/parent",
            status: "dispatching",
            normalized: split([task()]),
            errors: [],
          },
        },
      }),
      selection: { requirementId: null, taskId: null },
      repositories: [repo],
      agentAssignments: [{
        clusterId: "c-a",
        agentType: "trellis-splitter",
        stage: "split",
        status: "stale",
        lastHeartbeatAt: 123,
      }],
    });

    const card = vm.taskSwimlane.flatMap((lane) => lane.tasks)[0];
    expect(card.status).toBe("stale");
    expect(card.agentStatus).toMatchObject({
      agentName: "trellis-splitter",
      status: "stale",
      lastHeartbeatAt: 123,
    });
  });
});
