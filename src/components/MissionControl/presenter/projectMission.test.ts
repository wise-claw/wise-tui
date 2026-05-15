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
});
