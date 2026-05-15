import { describe, expect, test } from "bun:test";
import type { ClusterPlan, ClusterPlanItem } from "../../../services/prdSplit/clusterPlanner";
import type { RequirementsIndexV2 } from "../../../services/prdSplit/requirementsIndexVersion";
import type { PrdDocument, Repository, SplitResult, TaskItem } from "../../../types";
import type { WizardState } from "../../PrdSplitWizard/types";
import { emptyWizardState } from "../../PrdSplitWizard/types";
import { projectMission } from "./projectMission";
import type { MissionViewModel } from "./types";

const frontendRepo: Repository = {
  id: 1,
  name: "web",
  path: "/tmp/web",
  repositoryType: "frontend",
  createdAt: "",
  updatedAt: "",
};

const backendRepo: Repository = {
  id: 2,
  name: "api",
  path: "/tmp/api",
  repositoryType: "backend",
  createdAt: "",
  updatedAt: "",
};

const prd: PrdDocument = {
  title: "Mission",
  sourceType: "manual",
  sourceRef: null,
  background: [],
  goals: ["Ship the cockpit"],
  scenarios: [],
  functional: ["Show mission status", "Generate child tasks"],
  nonFunctional: [],
  acceptance: [],
};

const requirementsIndex: RequirementsIndexV2 = {
  schemaVersion: 2,
  version: "v",
  requirements: [
    { id: "REQ-1", content: "Show mission status across planning and write phases.", bodyHash: "aaaaaaaaaaaaaaaa" },
    { id: "REQ-2", content: "Generate child tasks and keep evidence visible.", bodyHash: "bbbbbbbbbbbbbbbb" },
  ],
};

function cluster(overrides: Partial<ClusterPlanItem> = {}): ClusterPlanItem {
  return {
    id: "c-a",
    title: "Build cockpit surface",
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

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "T-1",
    title: "Build mission canvas",
    description: "Render the core mission surface",
    role: "frontend",
    size: "M",
    estimateDays: 1,
    dependencies: [],
    sourceRefs: ["src/App.tsx:42"],
    sourceRequirementIds: ["REQ-1"],
    subtasks: ["Layout"],
    dod: ["Visible status"],
    executionStatus: "executable",
    flowStatus: "todo",
    taskAnchors: {
      from: 10,
      to: 80,
      contextBefore: "Show mission status",
      contextAfter: "Keep evidence visible",
    },
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

function snapshotViewModel(vm: MissionViewModel) {
  return {
    phase: vm.phase,
    title: vm.title,
    subtitle: vm.subtitle,
    project: vm.project,
    primaryCta: vm.primaryCta,
    phaseStrip: vm.phaseStrip,
    risks: vm.risks,
    requirements: vm.requirements.map((requirement) => ({
      id: requirement.id,
      taskCount: requirement.taskCount,
      crossGroup: requirement.hasCrossGroupTasks,
      highlighted: requirement.isHighlighted,
      owningTaskGroupIds: requirement.owningTaskGroupIds,
    })),
    layers: vm.taskGraph.layers.map((layer) => ({
      id: layer.id,
      index: layer.index,
      isParallel: layer.isParallel,
      isBottleneck: layer.isBottleneck,
      tasks: layer.tasks.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        statusLabel: item.statusLabel,
        repositoryLabel: item.repositoryLabel,
        dependencyTaskIds: item.dependencyTaskIds,
        sourceRequirementIds: item.sourceRequirementIds,
        highlighted: item.isHighlighted,
        dimmed: item.isDimmed,
        selected: item.isSelected,
        placeholder: item.isPlaceholder,
      })),
    })),
    selection: {
      requirementId: vm.selection.requirementId,
      taskId: vm.selection.taskId,
      highlightedTaskIds: [...vm.selection.highlightedTaskIds].sort(),
    },
    selectedEvidence: vm.selectedTaskEvidence
      ? {
          taskId: vm.selectedTaskEvidence.taskId,
          title: vm.selectedTaskEvidence.title,
          status: vm.selectedTaskEvidence.status,
          statusLabel: vm.selectedTaskEvidence.statusLabel,
          sourceRequirementIds: vm.selectedTaskEvidence.sourceRequirements.map((item) => item.id),
          taskAnchor: vm.selectedTaskEvidence.taskAnchor,
          prdAnchor: vm.selectedTaskEvidence.prdAnchor,
          codeAnchors: vm.selectedTaskEvidence.codeAnchors,
          subtasks: vm.selectedTaskEvidence.subtasks,
          dod: vm.selectedTaskEvidence.dod,
          isManual: vm.selectedTaskEvidence.isManual,
          isEdited: vm.selectedTaskEvidence.isEdited,
          technical: {
            clusterRequirementIds: vm.selectedTaskEvidence.technical.clusterRequirementIds,
            deletedTaskIds: vm.selectedTaskEvidence.technical.deletedTaskIds,
            dispatchRunId: vm.selectedTaskEvidence.technical.dispatchRaw?.runId ?? null,
          },
        }
      : null,
    engineering: {
      workflowGraph: vm.engineering.workflowGraph,
      clusters: vm.engineering.clusters.map((item) => ({
        id: item.id,
        runStatusInternal: item.runStatusInternal,
        diff: item.diff,
        validationIssueCount: item.validationIssues.length,
      })),
    },
  };
}

describe("projectMission snapshots", () => {
  test("drafting state", () => {
    const vm = projectMission({
      state: state(),
      selection: { requirementId: null, taskId: null },
      repositories: [frontendRepo, backendRepo],
    });
    expect(snapshotViewModel(vm)).toMatchSnapshot();
  });

  test("planning state with dependency layers", () => {
    const first = cluster();
    const second = cluster({
      id: "c-b",
      title: "Connect writer",
      primaryRepositoryId: 2,
      repositoryIds: [2],
      requirementIds: ["REQ-2"],
      dependencyClusterIds: ["c-a"],
    });
    const vm = projectMission({
      state: state({
        stage: "plan",
        project: { id: "p", name: "Wise", rootPath: "/tmp/wise" },
        repositories: [
          { id: 1, name: "web", path: "/tmp/web", type: "frontend" },
          { id: 2, name: "api", path: "/tmp/api", type: "backend" },
        ],
        selectedRepositoryIds: [1, 2],
        prd,
        requirementsIndex,
        plan: plan([first, second]),
        clusterRuns: {
          "c-a": { clusterId: "c-a", parentTaskName: null, parentTaskPath: null, status: "idle", errors: [] },
          "c-b": { clusterId: "c-b", parentTaskName: null, parentTaskPath: null, status: "idle", errors: [] },
        },
      }),
      selection: { requirementId: "REQ-1", taskId: null },
      repositories: [frontendRepo, backendRepo],
    });
    expect(snapshotViewModel(vm)).toMatchSnapshot();
  });

  test("verifying state with selected evidence", () => {
    const c = cluster();
    const vm = projectMission({
      state: state({
        stage: "dispatch",
        project: { id: "p", name: "Wise", rootPath: "/tmp/wise" },
        repositories: [{ id: 1, name: "web", path: "/tmp/web", type: "frontend" }],
        selectedRepositoryIds: [1],
        prd,
        requirementsIndex,
        plan: plan([c]),
        clusterRuns: {
          "c-a": {
            clusterId: "c-a",
            parentTaskName: "parent",
            parentTaskPath: "/tmp/wise/.trellis/tasks/parent",
            status: "succeeded",
            normalized: split([task()]),
            errors: [],
          },
        },
      }),
      selection: { requirementId: null, taskId: "T-1" },
      repositories: [frontendRepo],
    });
    expect(snapshotViewModel(vm)).toMatchSnapshot();
  });

  test("done state with workflow graph", () => {
    const vm = projectMission({
      state: state({
        stage: "done",
        project: { id: "p", name: "Wise", rootPath: "/tmp/wise" },
        workflowGraphResult: {
          workflowId: "wf-1",
          workflowName: "Mission workflow",
          status: "draft",
          nodeCount: 4,
          edgeCount: 3,
        },
      }),
      selection: { requirementId: null, taskId: null },
      repositories: [frontendRepo],
    });
    expect(snapshotViewModel(vm)).toMatchSnapshot();
  });
});
