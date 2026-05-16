import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ClusterPlan, ClusterPlanItem } from "../../../services/prdSplit/clusterPlanner";
import type { RequirementsIndexV2 } from "../../../services/prdSplit/requirementsIndexVersion";
import type { PrdDocument } from "../../../types";
import { emptyWizardState, type WizardState } from "../../PrdSplitWizard/types";
import type { UseSplitWizardStateApi } from "../../PrdSplitWizard/useSplitWizardState";

const dispatchClusterSplit = mock(async () => ({
  raw: {
    runId: "run-1",
    runDir: "/tmp/run-1",
    exitCode: 0,
    durationMs: 10,
    stdoutPath: "/tmp/run-1/claude.stdout.log",
    stderrPath: "/tmp/run-1/claude.stderr.log",
    rawResultPath: "/tmp/run-1/split-result.raw.json",
    rawOutput: { tasks: [] },
    stdoutTruncatedPreview: "",
    claudeSessionId: "claude-session-1",
  },
  normalized: {
    source: null,
    context: null,
    splitTasks: [],
    executableTasks: [],
    criticalPath: [],
    parallelGroups: [],
    unmetPreconditions: [],
  },
  validationIssues: [],
  errors: [],
}));
const retryClusterFromRunDir = mock(async () => ({
  newRunId: "run-2",
  newRunDir: "/tmp/run-2",
}));
const createParentTask = mock(async () => ({
  parentTaskName: "05-16-parent",
  parentTaskPath: ".trellis/tasks/05-16-parent",
}));
const renderParentPrd = mock((markdown: string) => markdown);
const markChildrenPlanning = mock(async () => ({ updatedChildNames: [], skipped: [] }));
const upsertMissionAgentAssignment = mock(async (input) => ({
  assignmentId: input.assignmentId,
  missionId: input.missionId,
  agentRunId: input.agentRunId,
  status: input.status,
}));
const completeMissionAgentAssignment = mock(async (input) => ({
  assignmentId: input.assignmentId,
  status: input.status,
}));
const appendMissionEvent = mock(async (input) => ({
  eventId: "event-1",
  missionId: input.missionId,
  eventType: input.eventType,
  timestamp: Date.now(),
  payload: input.payload,
}));
const attachMissionToSession = mock(async () => ({}));
const createOrResumeMission = mock(async () => ({
  missionId: "mission-p1-hash",
  projectId: "p1",
  rootPath: "/repo",
  title: "Mission",
  stage: "dispatch",
  status: "running",
  snapshot: {},
  createdAt: 1,
  updatedAt: 1,
}));
const trellisRuntimeUpsertAgentRunSafe = mock(async () => ({}));
const trellisRuntimeRecordEventSafe = mock(async () => ({}));
const trellisAgentHeartbeat = mock(async () => true);

mock.module("antd", () => ({
  message: {
    success: mock(() => {}),
    warning: mock(() => {}),
  },
}));
mock.module("antd/lib/index.js", () => ({
  message: {
    success: mock(() => {}),
    warning: mock(() => {}),
  },
}));
mock.module("../../../services/prdSplit/splitterDispatch", () => ({
  dispatchClusterSplit,
  retryClusterFromRunDir,
}));
mock.module("../../../services/prdSplit/trellisWriter", () => ({
  createParentTask,
  markChildrenPlanning,
  renderParentPrd,
  writeClusterTasks: mock(async () => ({ parentTaskName: "parent", childTaskNames: [], childTasks: [], warnings: [] })),
}));
mock.module("../../../services/missionControlBackend", () => ({
  appendMissionEvent,
  attachMissionToSession,
  completeMissionAgentAssignment,
  createOrResumeMission,
  upsertMissionAgentAssignment,
}));
mock.module("../../../services/trellisRuntime", () => ({
  compileTrellisWorkflow: mock(async () => ({
    projectId: "p1",
    rootPath: "/repo",
    workflowPath: "/repo/.trellis/workflow.md",
    phases: [],
    workflowStates: [],
    platformBlocks: [],
    validationIssues: [],
    compiledAt: 1,
  })),
  trellisAgentHeartbeat,
  trellisRuntimeRecordEventSafe,
  trellisRuntimeUpsertAgentRunSafe,
}));
mock.module("../../../services/workflowGraphs", () => ({ saveWorkflowGraph: mock(async () => ({ graph: { nodes: [], edges: [] }, status: "draft" })) }));
mock.module("../../../services/workflowTemplates", () => ({ saveWorkflowTemplate: mock(async (input) => ({ id: input.workflowId, name: input.name })) }));
mock.module("../../../services/projectPrdScope", () => ({ addProjectPrdWorkflow: mock(async () => {}) }));

function makeCluster(overrides: Partial<ClusterPlanItem> = {}): ClusterPlanItem {
  return {
    id: "cluster-fe",
    title: "Frontend",
    primaryRepositoryId: 1,
    repositoryIds: [1],
    requirementIds: ["REQ-1"],
    dependencyClusterIds: [],
    ...overrides,
  };
}

function makeState(overrides: Partial<WizardState> = {}): WizardState {
  const cluster = makeCluster();
  const plan: ClusterPlan = {
    clusters: [cluster],
    diagnostics: { requirementsCoverage: { covered: ["REQ-1"], orphan: [] }, crossRepoRequirements: [] },
  };
  const prd: PrdDocument = {
    title: "Mission",
    sourceType: "manual",
    sourceRef: null,
    background: [],
    goals: [],
    scenarios: [],
    functional: ["Build UI"],
    nonFunctional: [],
    acceptance: [],
  };
  const requirementsIndex: RequirementsIndexV2 = {
    schemaVersion: 2,
    version: "v1",
    requirements: [{ id: "REQ-1", content: "Build UI", bodyHash: "aaaaaaaaaaaaaaaa" }],
  };
  return {
    ...emptyWizardState(),
    stage: "dispatch",
    project: { id: "p1", name: "Project", rootPath: "/repo" },
    repositories: [{ id: 1, name: "web", path: "/repo/web", type: "frontend" }],
    selectedRepositoryIds: [1],
    prdMarkdown: "# Mission",
    prd,
    requirementsIndex,
    plan,
    basePlan: plan,
    clusterRuns: {
      "cluster-fe": { clusterId: "cluster-fe", parentTaskName: null, parentTaskPath: null, status: "idle", errors: [] },
    },
    ...overrides,
  };
}

function makeApi(state = makeState()): UseSplitWizardStateApi {
  return {
    state,
    reset: mock(() => {}),
    setActiveMissionId: mock((missionId) => { state.activeMissionId = missionId; }),
    setProject: mock(() => {}),
    setSelectedRepos: mock(() => {}),
    setPrdMarkdown: mock(() => {}),
    parseAndPlan: mock(async () => ({ ok: true as const })),
    refreshExistingParents: mock(async () => {}),
    setReuseExistingParents: mock(() => {}),
    setDispatchOnlyDirty: mock(() => {}),
    patchTaskEdit: mock(() => {}),
    clearTaskEdit: mock(() => {}),
    clearTaskAnchorEdit: mock(() => {}),
    deleteTask: mock(() => {}),
    restoreTask: mock(() => {}),
    addManualTask: mock(() => {}),
    removeManualTask: mock(() => {}),
    patchManualTask: mock(() => {}),
    discardClusterEdits: mock(() => {}),
    goToDispatch: mock(() => {}),
    setClusterRun: mock((clusterId, run) => { state.clusterRuns[clusterId] = run; }),
    patchClusterRun: mock((clusterId, patch) => {
      state.clusterRuns[clusterId] = { ...state.clusterRuns[clusterId], ...patch };
    }),
    goToReview: mock(() => {}),
    beginWrite: mock(() => {}),
    addWriteResult: mock(() => {}),
    setWorkflowGraphResult: mock(() => {}),
    finishWrite: mock(() => {}),
    failWrite: mock(() => {}),
    setGlobalError: mock(() => {}),
    backToInput: mock(() => {}),
    backToPlan: mock(() => {}),
    backToDispatch: mock(() => {}),
    reassignRequirement: mock(() => {}),
    undoReassign: mock(() => {}),
    addManualCluster: mock(() => {}),
    renameCluster: mock(() => {}),
    resetClusterPlanEdits: mock(() => {}),
    markClusterNeedsResplit: mock(() => {}),
    clearClusterNeedsResplit: mock(() => {}),
  };
}

describe("runMissionActions · runtime ledger parity", () => {
  beforeEach(() => {
    for (const fn of [
      appendMissionEvent,
      attachMissionToSession,
      completeMissionAgentAssignment,
      createOrResumeMission,
      createParentTask,
      dispatchClusterSplit,
      retryClusterFromRunDir,
      markChildrenPlanning,
      renderParentPrd,
      trellisAgentHeartbeat,
      trellisRuntimeRecordEventSafe,
      trellisRuntimeUpsertAgentRunSafe,
      upsertMissionAgentAssignment,
    ]) {
      fn.mockClear();
    }
  });

  test("runMissionClusters stores active mission id before dispatching clusters", async () => {
    const { runMissionClusters } = await import("./runMissionActions");
    const state = makeState();
    const api = makeApi(state);

    await runMissionClusters(api);

    expect(api.setActiveMissionId).toHaveBeenCalledWith("mission-p1-hash");
    expect(upsertMissionAgentAssignment.mock.calls[0]?.[0]).toMatchObject({
      assignmentId: "mission-p1-hash-cluster-fe-splitter",
      agentRunId: "mission-p1-hash-cluster-fe-splitter",
      missionId: "mission-p1-hash",
    });
  });

  test("runSingleCluster double-writes splitter assignment to trellis agent run and terminal event", async () => {
    const { runSingleCluster } = await import("./runMissionActions");
    const state = makeState({ activeMissionId: "mission-p1-hash" });
    const api = makeApi(state);

    await runSingleCluster(state.plan!.clusters[0], state, api, state.activeMissionId);

    expect(trellisRuntimeUpsertAgentRunSafe).toHaveBeenCalledTimes(2);
    expect(trellisRuntimeUpsertAgentRunSafe.mock.calls[0]?.[0]).toBe("mission-p1-hash");
    expect(trellisRuntimeUpsertAgentRunSafe.mock.calls[0]?.[1]).toMatchObject({
      agentRunId: "mission-p1-hash-cluster-fe-splitter",
      projectId: "p1",
      rootPath: "/repo",
      repositoryId: 1,
      repositoryPath: "/repo/web",
      agentType: "trellis-splitter",
      stage: "split",
      status: "running",
    });
    expect(trellisRuntimeUpsertAgentRunSafe.mock.calls[1]?.[1]).toMatchObject({
      agentRunId: "mission-p1-hash-cluster-fe-splitter",
      status: "succeeded",
      taskPath: ".trellis/tasks/05-16-parent",
      metadata: {
        missionId: "mission-p1-hash",
        clusterId: "cluster-fe",
        runDir: "/tmp/run-1",
        exitCode: 0,
      },
    });
    expect(trellisRuntimeRecordEventSafe).toHaveBeenCalledWith(expect.objectContaining({
      eventKind: "trellis.agent.completed",
      correlationId: "mission-p1-hash-cluster-fe-splitter",
      payload: expect.objectContaining({
        missionId: "mission-p1-hash",
        agentRunId: "mission-p1-hash-cluster-fe-splitter",
        status: "succeeded",
        runDir: "/tmp/run-1",
      }),
    }));
  });

  test("runSingleCluster with no mission id leaves runtime ledger untouched", async () => {
    const { runSingleCluster } = await import("./runMissionActions");
    const state = makeState({ activeMissionId: null });
    const api = makeApi(state);

    await runSingleCluster(state.plan!.clusters[0], state, api, null);

    expect(upsertMissionAgentAssignment).not.toHaveBeenCalled();
    expect(trellisRuntimeUpsertAgentRunSafe).not.toHaveBeenCalled();
    expect(trellisRuntimeRecordEventSafe).not.toHaveBeenCalled();
  });

  test("retryClusterFromRunDir invokes run-dir retry command and records retry metadata", async () => {
    const { retryClusterFromRunDir: retryAction } = await import("./runMissionActions");
    const state = makeState({
      activeMissionId: "mission-p1-hash",
      clusterRuns: {
        "cluster-fe": {
          clusterId: "cluster-fe",
          parentTaskName: "05-16-parent",
          parentTaskPath: ".trellis/tasks/05-16-parent",
          status: "failed",
          errors: ["Claude failed"],
          raw: {
            runId: "run-1",
            runDir: "/tmp/run-1",
            exitCode: 1,
            durationMs: 10,
            stdoutPath: "/tmp/run-1/claude.stdout.log",
            stderrPath: "/tmp/run-1/claude.stderr.log",
            rawResultPath: "/tmp/run-1/split-result.raw.json",
            rawOutput: null,
            stdoutTruncatedPreview: "",
            claudeSessionId: null,
          },
        },
      },
    });
    const api = makeApi(state);

    await retryAction("run-1", "cluster-fe", state, api, state.activeMissionId);

    expect(retryClusterFromRunDir).toHaveBeenCalledWith({
      runId: "run-1",
      projectRootPath: "/repo",
      missionId: "mission-p1-hash",
      clusterId: "cluster-fe",
    });
    expect(appendMissionEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "mission.cluster.retried",
      payload: expect.objectContaining({
        oldRunId: "run-1",
        newRunId: "run-2",
        newRunDir: "/tmp/run-2",
      }),
    }));
    expect(trellisRuntimeUpsertAgentRunSafe).toHaveBeenCalledWith(
      "mission-p1-hash",
      expect.objectContaining({
        agentRunId: "mission-p1-hash-cluster-fe-splitter-retry",
        status: "running",
        taskPath: ".trellis/tasks/05-16-parent",
        metadata: expect.objectContaining({
          retryFromRunId: "run-1",
          newRunId: "run-2",
          newRunDir: "/tmp/run-2",
        }),
      }),
    );
    expect(state.clusterRuns["cluster-fe"].raw?.runId).toBe("run-2");
    expect(state.clusterRuns["cluster-fe"].raw?.stdoutPath).toBe("/tmp/run-2/claude.stdout.log");
    expect(state.clusterRuns["cluster-fe"].progress?.stageLabel).toContain("run-2");
  });

  test("runSingleCluster sends heartbeat while splitter dispatch is pending", async () => {
    const { runSingleCluster } = await import("./runMissionActions");
    const state = makeState({ activeMissionId: "mission-p1-hash" });
    const api = makeApi(state);
    let finishDispatch!: () => void;
    dispatchClusterSplit.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finishDispatch = resolve;
      });
      return {
        raw: {
          runId: "run-1",
          runDir: "/tmp/run-1",
          exitCode: 0,
          durationMs: 10,
          stdoutPath: "/tmp/run-1/claude.stdout.log",
          stderrPath: "/tmp/run-1/claude.stderr.log",
          rawResultPath: "/tmp/run-1/split-result.raw.json",
          rawOutput: { tasks: [] },
          stdoutTruncatedPreview: "",
          claudeSessionId: "claude-session-1",
        },
        normalized: {
          source: null,
          context: null,
          splitTasks: [],
          executableTasks: [],
          criticalPath: [],
          parallelGroups: [],
          unmetPreconditions: [],
        },
        validationIssues: [],
        errors: [],
      };
    });

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalCallback: (() => void) | null = null;
    let cleared = false;
    globalThis.setInterval = ((callback: TimerHandler, delay?: number) => {
      expect(delay).toBe(30_000);
      intervalCallback = typeof callback === "function" ? callback as () => void : () => {};
      return 123 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    globalThis.clearInterval = ((timerId?: number) => {
      expect(timerId).toBe(123);
      cleared = true;
    }) as typeof clearInterval;

    try {
      const running = runSingleCluster(state.plan!.clusters[0], state, api, state.activeMissionId);
      for (let i = 0; i < 10 && !intervalCallback; i += 1) {
        await Promise.resolve();
      }
      expect(intervalCallback).not.toBeNull();
      intervalCallback?.();
      await Promise.resolve();
      expect(trellisAgentHeartbeat).toHaveBeenCalledWith("mission-p1-hash-cluster-fe-splitter");
      finishDispatch();
      await running;
      expect(cleared).toBe(true);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });
});
