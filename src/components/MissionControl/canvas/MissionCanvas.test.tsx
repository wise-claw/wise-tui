import { describe, expect, mock, test } from "bun:test";
import { create, act, type ReactTestRenderer } from "react-test-renderer";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";
import type { ProjectItem, Repository } from "../../../types";
import type { ClusterPlan } from "../../../services/prdSplit/clusterPlanner";
import type { RequirementsIndexV2 } from "../../../services/prdSplit/requirementsIndexVersion";
import { emptyWizardState, type WizardState } from "../../PrdSplitWizard/types";
import type { UseSplitWizardStateApi } from "../../PrdSplitWizard/useSplitWizardState";
import { projectMission } from "../presenter/projectMission";

mock.module("antd", () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode }) => <button {...props}>{children}</button>,
  Card: ({ children }: { children?: React.ReactNode }) => <section>{children}</section>,
  Select: () => <select />,
  Space: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  message: {
    success: mock(() => {}),
    warning: mock(() => {}),
  },
  Typography: {
    Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    Paragraph: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
  },
}));

mock.module("../../../hooks/useTrellisRuntime", () => ({
  useTrellisRuntime: () => {
    const [agentGraph] = useState(null);
    useEffect(() => {}, []);
    return { agentGraph };
  },
}));

mock.module("./RequirementsTree", () => ({
  RequirementsTree: () => <section data-testid="requirements-tree" />,
}));

mock.module("./TaskSwimlane", () => ({
  TaskSwimlane: () => <section data-testid="task-swimlane" />,
}));

mock.module("./AgentExecutionPanel", () => ({
  AgentExecutionPanel: () => <section data-testid="agent-execution-panel" />,
}));

mock.module("./RequirementWorkspaceOverview", () => ({
  RequirementWorkspaceOverview: () => <section data-testid="requirement-workspace" />,
}));

mock.module("../setup/PrdImportPage", () => ({
  PrdImportPage: () => <section data-testid="prd-import-page" />,
}));

mock.module("../details/MissionReplayPanel", () => ({
  MissionReplayPanel: () => <section data-testid="mission-replay" />,
}));

mock.module("./AgentOwnershipGraph", () => ({
  AgentOwnershipGraph: () => <section data-testid="agent-graph" />,
}));

mock.module("./RuntimeEventFeed", () => ({
  RuntimeEventFeed: () => <section data-testid="runtime-feed" />,
}));

mock.module("./SpecRevisionTimeline", () => ({
  SpecRevisionTimeline: () => <section data-testid="spec-timeline" />,
}));

mock.module("./OnboardingChecklist", () => ({
  OnboardingChecklist: () => <section data-testid="onboarding" />,
}));

mock.module("./WorkspaceSnapshotViewer", () => ({
  WorkspaceSnapshotViewer: () => <section data-testid="snapshot-viewer" />,
}));

mock.module("../details/RequirementTracePanel", () => ({
  RequirementTracePanel: () => <section data-testid="trace-panel" />,
}));

const repo: Repository = {
  id: 1,
  name: "web",
  path: "/tmp/wise/web",
  repositoryType: "frontend",
  createdAt: "",
  updatedAt: "",
};

const project: ProjectItem = {
  id: "p",
  name: "Wise",
  rootPath: "/tmp/wise",
  repositoryIds: [1],
  sddMode: "wise_trellis",
  createdAt: 0,
  updatedAt: 0,
};

const requirementsIndex: RequirementsIndexV2 = {
  schemaVersion: 2,
  version: "v",
  requirements: [{ id: "REQ-1", content: "Build Mission Control", bodyHash: "aaaaaaaaaaaaaaaa" }],
};

const plan: ClusterPlan = {
  clusters: [
    {
      id: "cluster-web",
      title: "Web",
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
};

function makeApi(state: WizardState): UseSplitWizardStateApi {
  return {
    state,
    reset: () => {},
    setActiveMissionId: () => {},
    setProject: () => {},
    setSelectedRepos: () => {},
    setPrdMarkdown: () => {},
    parseAndPlan: async () => ({ ok: true }),
    refreshExistingParents: async () => {},
    setReuseExistingParents: () => {},
    setDispatchOnlyDirty: () => {},
    patchTaskEdit: () => {},
    clearTaskEdit: () => {},
    clearTaskAnchorEdit: () => {},
    deleteTask: () => {},
    restoreTask: () => {},
    addManualTask: () => {},
    removeManualTask: () => {},
    patchManualTask: () => {},
    discardClusterEdits: () => {},
    goToDispatch: () => {},
    setClusterRun: () => {},
    patchClusterRun: () => {},
    goToReview: () => {},
    beginWrite: () => {},
    addWriteResult: () => {},
    setWorkflowGraphResult: () => {},
    finishWrite: () => {},
    failWrite: () => {},
    setGlobalError: () => {},
    backToInput: () => {},
    backToPlan: () => {},
    backToDispatch: () => {},
    reassignRequirement: () => {},
    undoReassign: () => {},
    addManualCluster: () => {},
    renameCluster: () => {},
    resetClusterPlanEdits: () => {},
  };
}

function renderProps(state: WizardState): ComponentProps<typeof MissionCanvas> {
  const api = makeApi(state);
  return {
    viewModel: projectMission({
      state,
      selection: { requirementId: null, taskId: null },
      repositories: [repo],
      projects: [project],
    }),
    api,
    projects: [project],
    repositories: [repo],
    stdoutMap: {},
    onSelectRequirement: () => {},
    onSelectTask: () => {},
    onHoverRequirement: () => {},
    onHoverTask: () => {},
    onMoveRequirement: () => {},
    onOpenLegacyImport: () => {},
    workspaceMode: "editor",
  };
}

const { MissionCanvas } = await import("./MissionCanvas");

describe("MissionCanvas", () => {
  test("keeps hook order stable when PRD parsing switches from drafting to planned canvas", () => {
    const draftingState: WizardState = {
      ...emptyWizardState(),
      project: { id: "p", name: "Wise", rootPath: "/tmp/wise" },
      repositories: [{ id: 1, name: "web", path: "/tmp/wise/web", type: "frontend" }],
      selectedRepositoryIds: [1],
      prdMarkdown: "# PRD\n\nBuild Mission Control",
    };
    const plannedState: WizardState = {
      ...draftingState,
      stage: "plan",
      prd: {
        title: "Mission Control",
        sourceType: "markdown",
        sourceRef: null,
        background: [],
        goals: ["Build Mission Control"],
        scenarios: [],
        functional: ["Build Mission Control"],
        nonFunctional: [],
        acceptance: [],
      },
      requirementsIndex,
      plan,
      basePlan: plan,
      clusterRuns: {
        "cluster-web": {
          clusterId: "cluster-web",
          parentTaskName: null,
          parentTaskPath: null,
          status: "idle",
          errors: [],
        },
      },
    };

    let renderer: ReactTestRenderer | null = null;
    expect(() => {
      act(() => {
        renderer = create(<MissionCanvas {...renderProps(draftingState)} />);
      });
      act(() => {
        renderer?.update(<MissionCanvas {...renderProps(plannedState)} />);
      });
    }).not.toThrow();

    renderer?.unmount();
  });
});
