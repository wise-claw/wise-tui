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
const recoverClusterRunFromRunDir = mock(async () => ({
  raw: {
    runId: "run-2",
    runDir: "/tmp/run-2",
    exitCode: 0,
    durationMs: 10,
    stdoutPath: "/tmp/run-2/claude.stdout.log",
    stderrPath: "/tmp/run-2/claude.stderr.log",
    rawResultPath: "/tmp/run-2/split-result.raw.json",
    rawOutput: { tasks: [] },
    stdoutTruncatedPreview: "",
    claudeSessionId: "claude-session-2",
  },
  normalized: null,
  validationIssues: [],
  errors: [],
}));
const cancelClusterRun = mock(async () => ({
  runId: "run-1",
  runDir: "/tmp/run-1",
  clusterId: "cluster-fe",
  signalledRunningProcess: true,
  wroteRunResult: true,
  alreadyFinished: false,
}));
const createParentTask = mock(async () => ({
  parentTaskName: "05-16-parent",
  parentTaskPath: ".trellis/tasks/05-16-parent",
}));
const renderParentPrd = mock((markdown: string) => markdown);
const markChildrenPlanning = mock(async () => ({ updatedChildNames: [], skipped: [] }));
const writeClusterTasks = mock(async (input: {
  parentTaskName: string;
  normalized: {
    splitTasks: Array<{ id: string; title: string }>;
  };
}) => ({
  parentTaskName: "parent",
  childTaskNames: input.normalized.splitTasks.map((task) => `${task.id}-child`),
  childTasks: input.normalized.splitTasks.map((task) => ({
    sourceTaskId: task.id,
    taskName: `${task.id}-child`,
    taskPath: `.trellis/tasks/${input.parentTaskName}/${task.id}-child`,
  })),
  warnings: [],
}));
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
const dispatchWorkspaceTrellisMaterializedFanout = mock(async () => null);
const saveWorkflowGraph = mock(async (input) => ({ graph: input.graph, status: "draft" }));
const saveWorkflowTemplate = mock(async (input) => ({ id: input.workflowId, name: input.name }));
const resolveMaterializedFanoutRepositoryTarget = mock(() => ({
  repositoryPath: "/repo/web",
  repositoryMetadata: {
    ownerRepositoryId: 1,
    ownerRepositoryName: "web",
    ownerRepositoryPath: "/repo/web",
    repositoryType: "frontend",
  },
}));

mock.module("antd", () => ({
  message: {
    success: mock(() => {}),
    warning: mock(() => {}),
    error: mock(() => {}),
  },
}));
mock.module("antd/lib/index.js", () => ({
  message: {
    success: mock(() => {}),
    warning: mock(() => {}),
    error: mock(() => {}),
  },
}));
mock.module("../../../services/prdSplit/splitterDispatch", () => ({
  cancelClusterRun,
  dispatchClusterSplit,
  recoverClusterRunFromRunDir,
  retryClusterFromRunDir,
}));
mock.module("../../../services/prdSplit/trellisWriter", () => ({
  createParentTask,
  markChildrenPlanning,
  renderParentPrd,
  writeClusterTasks,
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
mock.module("../../../services/workflowGraphs", () => ({ saveWorkflowGraph }));
mock.module("../../../services/workflowTemplates", () => ({ saveWorkflowTemplate }));
mock.module("../../../services/projectPrdScope", () => ({ addProjectPrdWorkflow: mock(async () => {}) }));
mock.module("../../../services/prdSplit/materializedFanoutBridge", () => ({
  dispatchWorkspaceTrellisMaterializedFanout,
  resolveMaterializedFanoutRepositoryTarget,
}));

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
      cancelClusterRun,
      completeMissionAgentAssignment,
      createOrResumeMission,
      createParentTask,
      dispatchClusterSplit,
      retryClusterFromRunDir,
      recoverClusterRunFromRunDir,
      markChildrenPlanning,
      renderParentPrd,
      writeClusterTasks,
      trellisAgentHeartbeat,
      trellisRuntimeRecordEventSafe,
      trellisRuntimeUpsertAgentRunSafe,
      upsertMissionAgentAssignment,
      dispatchWorkspaceTrellisMaterializedFanout,
      saveWorkflowGraph,
      saveWorkflowTemplate,
    ]) {
      fn.mockClear();
    }
    cancelClusterRun.mockResolvedValue({
      runId: "run-1",
      runDir: "/tmp/run-1",
      clusterId: "cluster-fe",
      signalledRunningProcess: true,
      wroteRunResult: true,
      alreadyFinished: false,
    });
    dispatchWorkspaceTrellisMaterializedFanout.mockResolvedValue(null);
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

  test("cancelClusterDispatch stops the splitter run and marks ledger state cancelled", async () => {
    const { cancelClusterDispatch } = await import("./runMissionActions");
    const state = makeState({
      activeMissionId: "mission-p1-hash",
      clusterRuns: {
        "cluster-fe": {
          clusterId: "cluster-fe",
          parentTaskName: "05-16-parent",
          parentTaskPath: ".trellis/tasks/05-16-parent",
          status: "dispatching",
          errors: [],
          startedAt: 100,
          raw: {
            runId: "run-1",
            runDir: "/tmp/run-1",
            exitCode: 0,
            durationMs: 0,
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

    await cancelClusterDispatch("run-1", "cluster-fe", state, api, state.activeMissionId);

    expect(cancelClusterRun).toHaveBeenCalledWith({ runId: "run-1" });
    expect(state.clusterRuns["cluster-fe"]).toMatchObject({
      status: "cancelled",
      raw: {
        runId: "run-1",
        exitCode: 130,
      },
      progress: {
        status: "cancelled",
        stageLabel: "已中断",
      },
    });
    expect(completeMissionAgentAssignment).toHaveBeenCalledWith(expect.objectContaining({
      assignmentId: "mission-p1-hash-cluster-fe-splitter",
      status: "cancelled",
    }));
    expect(trellisRuntimeRecordEventSafe).toHaveBeenCalledWith(expect.objectContaining({
      eventKind: "trellis.agent.cancelled",
      correlationId: "mission-p1-hash-cluster-fe-splitter",
    }));
    expect(appendMissionEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "mission.cluster.cancelled",
      payload: expect.objectContaining({
        runId: "run-1",
        signalledRunningProcess: true,
      }),
    }));
  });

  test("cancelClusterDispatch does not overwrite a run that already finished before cancellation", async () => {
    const { cancelClusterDispatch } = await import("./runMissionActions");
    cancelClusterRun.mockResolvedValueOnce({
      runId: "run-1",
      runDir: "/tmp/run-1",
      clusterId: "cluster-fe",
      signalledRunningProcess: false,
      wroteRunResult: false,
      alreadyFinished: true,
    });
    const state = makeState({
      activeMissionId: "mission-p1-hash",
      clusterRuns: {
        "cluster-fe": {
          clusterId: "cluster-fe",
          parentTaskName: "05-16-parent",
          parentTaskPath: ".trellis/tasks/05-16-parent",
          status: "succeeded",
          errors: [],
          startedAt: 100,
          endedAt: 200,
        },
      },
    });
    const api = makeApi(state);

    await cancelClusterDispatch("run-1", "cluster-fe", state, api, state.activeMissionId);

    expect(state.clusterRuns["cluster-fe"].status).toBe("succeeded");
    expect(completeMissionAgentAssignment).not.toHaveBeenCalled();
    expect(trellisRuntimeRecordEventSafe).not.toHaveBeenCalled();
    expect(appendMissionEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "mission.cluster.cancel_ignored",
      payload: expect.objectContaining({
        reason: "already_finished",
      }),
    }));
    expect(api.setGlobalError).toHaveBeenCalledWith("子代理已经结束，未覆盖已有运行结果；正在刷新后台状态。");
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

	  test("writeMissionToTrellis dispatches materialized child tasks to Trellis implement fan-out", async () => {
    const { writeMissionToTrellis } = await import("./runMissionActions");
    const state = makeState({
      stage: "review",
      activeMissionId: "mission-p1-hash",
      clusterRuns: {
        "cluster-fe": {
          clusterId: "cluster-fe",
          parentTaskName: "05-16-parent",
          parentTaskPath: ".trellis/tasks/05-16-parent",
          status: "succeeded",
          errors: [],
          normalized: {
            source: null,
            context: null,
            splitTasks: [{
              id: "task-a",
              title: "Build UI",
              description: "",
              role: "frontend",
              size: "M",
              estimateDays: 1,
              dependencies: [],
              sourceRefs: [],
              sourceRequirementIds: ["REQ-1"],
              subtasks: [],
              dod: [],
              executionStatus: "executable",
              flowStatus: "todo",
            }],
            executableTasks: [],
            criticalPath: [],
            parallelGroups: [],
            unmetPreconditions: [],
          },
        },
      },
    });
    const api = makeApi(state);

    await writeMissionToTrellis(api);

	    expect(dispatchWorkspaceTrellisMaterializedFanout).toHaveBeenCalledWith(expect.objectContaining({
	      sessionId: "prd-split:parent",
	      projectId: "p1",
	      projectRootPath: "/repo",
	      repositoryPath: "/repo/web",
      sourceTasks: expect.arrayContaining([expect.objectContaining({ id: "task-a" })]),
      materializedResult: expect.objectContaining({ parentTaskName: "parent" }),
      repositoryMetadata: expect.objectContaining({
        ownerRepositoryId: 1,
        ownerRepositoryPath: "/repo/web",
	      }),
	    }));
	  });

  test("writeMissionToTrellis reports fanout failures in write results", async () => {
    const { writeMissionToTrellis } = await import("./runMissionActions");
    dispatchWorkspaceTrellisMaterializedFanout.mockRejectedValueOnce(new Error("fanout failed"));
    const state = makeState({
      stage: "review",
      activeMissionId: "mission-p1-hash",
      clusterRuns: {
        "cluster-fe": {
          clusterId: "cluster-fe",
          parentTaskName: "05-16-parent",
          parentTaskPath: ".trellis/tasks/05-16-parent",
          status: "succeeded",
          errors: [],
          normalized: {
            source: makeState().prd!,
            context: null,
            splitTasks: [{
              id: "task-a",
              title: "Build UI",
              description: "",
              role: "frontend",
              size: "M",
              estimateDays: 1,
              dependencies: [],
              sourceRefs: [],
              sourceRequirementIds: ["REQ-1"],
              subtasks: [],
              dod: [],
              executionStatus: "executable",
              flowStatus: "todo",
            }],
            executableTasks: [],
            criticalPath: [],
            parallelGroups: [],
            unmetPreconditions: [],
          },
        },
      },
    });
    const api = makeApi(state);

    await writeMissionToTrellis(api);

    expect(api.addWriteResult).toHaveBeenCalledWith(expect.objectContaining({
      clusterId: "cluster-fe",
      childTasks: [expect.objectContaining({ sourceTaskId: "task-a" })],
      fanoutFailedCount: 1,
    }));
  });

  test("writeMissionToTrellis stores fanout snapshots and streams them to callers", async () => {
    const { writeMissionToTrellis } = await import("./runMissionActions");
    const fanoutSnapshot = {
      status: "succeeded" as const,
      workflowRunId: "wf-1",
      workflowRunIds: ["wf-1"],
      totalCount: 1,
      doneCount: 1,
      failedCount: 0,
      waves: [],
      lifecycleStages: [
        { key: "dispatch" as const, label: "Dispatch", status: "done" as const },
        { key: "run" as const, label: "Run", status: "done" as const },
        { key: "verify" as const, label: "Verify", status: "active" as const },
        { key: "spec" as const, label: "Spec", status: "waiting" as const },
      ],
      message: "实现运行完成：成功 1，失败 0。",
    };
    dispatchWorkspaceTrellisMaterializedFanout.mockImplementationOnce(async (input: {
      onSnapshot?: (snapshot: typeof fanoutSnapshot) => void;
    }) => {
      input.onSnapshot?.(fanoutSnapshot);
      return fanoutSnapshot;
    });
    const snapshots: string[] = [];
    const state = makeState({
      stage: "review",
      activeMissionId: "mission-p1-hash",
      clusterRuns: {
        "cluster-fe": {
          clusterId: "cluster-fe",
          parentTaskName: "05-16-parent",
          parentTaskPath: ".trellis/tasks/05-16-parent",
          status: "succeeded",
          errors: [],
          normalized: {
            source: makeState().prd!,
            context: null,
            splitTasks: [{
              id: "task-a",
              title: "Build UI",
              description: "",
              role: "frontend",
              size: "M",
              estimateDays: 1,
              dependencies: [],
              sourceRefs: [],
              sourceRequirementIds: ["REQ-1"],
              subtasks: [],
              dod: [],
              executionStatus: "executable",
              flowStatus: "todo",
            }],
            executableTasks: [],
            criticalPath: [],
            parallelGroups: [],
            unmetPreconditions: [],
          },
        },
      },
    });
    const api = makeApi(state);

    await writeMissionToTrellis(api, {
      onFanoutSnapshot: (clusterId, snapshot) => snapshots.push(`${clusterId}:${snapshot.workflowRunId}:${snapshot.status}`),
    });

    expect(snapshots).toContain("cluster-fe:wf-1:succeeded");
    expect(api.addWriteResult).toHaveBeenCalledWith(expect.objectContaining({
      clusterId: "cluster-fe",
      fanoutSnapshot: expect.objectContaining({
        workflowRunId: "wf-1",
        lifecycleStages: expect.arrayContaining([
          expect.objectContaining({ key: "verify", status: "active" }),
        ]),
      }),
    }));
  });

  test("writeMissionToTrellis maps namespaced UI task ids back to cluster output ids before materializing", async () => {
    const { writeMissionToTrellis } = await import("./runMissionActions");
    const state = makeState({
      stage: "review",
      activeMissionId: "mission-p1-hash",
      clusterRuns: {
        "cluster-fe": {
          clusterId: "cluster-fe",
          parentTaskName: "05-16-parent",
          parentTaskPath: ".trellis/tasks/05-16-parent",
          status: "succeeded",
          errors: [],
          normalized: {
            source: makeState().prd!,
            context: null,
            splitTasks: [
              {
                id: "task-1",
                title: "Build base UI",
                description: "",
                role: "frontend",
                size: "M",
                estimateDays: 1,
                dependencies: [],
                sourceRefs: [],
                sourceRequirementIds: ["REQ-1"],
                subtasks: [],
                dod: [],
                executionStatus: "executable",
                flowStatus: "todo",
              },
              {
                id: "task-2",
                title: "Wire UI flow",
                description: "",
                role: "frontend",
                size: "M",
                estimateDays: 1,
                dependencies: ["task-1"],
                sourceRefs: [],
                sourceRequirementIds: ["REQ-1"],
                subtasks: [],
                dod: [],
                executionStatus: "executable",
                flowStatus: "todo",
              },
            ],
            executableTasks: [],
            criticalPath: [],
            parallelGroups: [],
            unmetPreconditions: [],
            claudeSplitMapping: {
              version: 1,
              taskRequirementLinks: [
                { taskId: "cluster-fe-task-1", requirementIds: ["REQ-1"] },
                { taskId: "cluster-fe-task-2", requirementIds: ["REQ-1"] },
              ],
              idRemap: [
                { from: "task-1", to: "cluster-fe-task-1" },
                { from: "task-2", to: "cluster-fe-task-2" },
              ],
              capturedAtMs: 1,
            },
          },
        },
      },
    });
    const api = makeApi(state);

    await writeMissionToTrellis(api, { sourceTaskIds: ["cluster-fe-task-2"] });

    expect(writeClusterTasks).toHaveBeenCalledTimes(1);
    expect(writeClusterTasks.mock.calls[0]?.[0].normalized.splitTasks.map((task) => task.id)).toEqual(["task-2"]);
    expect(api.addWriteResult).toHaveBeenCalledWith(expect.objectContaining({
      childTasks: [
        expect.objectContaining({
          sourceTaskId: "cluster-fe-task-2",
          taskName: "task-2-child",
        }),
      ],
    }));
    expect(dispatchWorkspaceTrellisMaterializedFanout).toHaveBeenCalledWith(expect.objectContaining({
      sourceTasks: [expect.objectContaining({ id: "task-2" })],
      materializedResult: expect.objectContaining({
        childTasks: [expect.objectContaining({ sourceTaskId: "task-2" })],
      }),
    }));
    const graph = saveWorkflowGraph.mock.calls[0]?.[0].graph;
    const taskNode = graph.nodes.find((node: { data?: { sourceTaskId?: string } }) =>
      node.data?.sourceTaskId === "cluster-fe-task-2"
    );
    expect(taskNode?.data.dependencies).toEqual(["cluster-fe-task-1"]);
  });

  test("hydrateClusterRunFromRunDir records recovered retry output into the cluster run and ledgers", async () => {
    const { hydrateClusterRunFromRunDir } = await import("./runMissionActions");
    recoverClusterRunFromRunDir.mockResolvedValueOnce({
      raw: {
        runId: "run-2",
        runDir: "/tmp/run-2",
        exitCode: 0,
        durationMs: 10,
        stdoutPath: "/tmp/run-2/claude.stdout.log",
        stderrPath: "/tmp/run-2/claude.stderr.log",
        rawResultPath: "/tmp/run-2/split-result.raw.json",
        rawOutput: { tasks: [] },
        stdoutTruncatedPreview: "",
        claudeSessionId: "claude-session-2",
      },
      normalized: {
        source: null,
        context: null,
        splitTasks: [{
          id: "task-a",
          title: "Recovered UI",
          description: "",
          role: "frontend",
          size: "M",
          estimateDays: 1,
          dependencies: [],
          sourceRefs: [],
          sourceRequirementIds: ["REQ-1"],
          subtasks: [],
          dod: [],
          executionStatus: "executable",
          flowStatus: "todo",
        }],
        executableTasks: [],
        criticalPath: [],
        parallelGroups: [],
        unmetPreconditions: [],
      },
      validationIssues: [],
      errors: [],
    });
    const state = makeState({
      activeMissionId: "mission-p1-hash",
      clusterRuns: {
        "cluster-fe": {
          clusterId: "cluster-fe",
          parentTaskName: "05-16-parent",
          parentTaskPath: ".trellis/tasks/05-16-parent",
          status: "dispatching",
          errors: [],
          startedAt: 100,
          raw: {
            runId: "run-2",
            runDir: "/tmp/run-2",
            exitCode: 0,
            durationMs: 0,
            stdoutPath: "/tmp/run-2/claude.stdout.log",
            stderrPath: "/tmp/run-2/claude.stderr.log",
            rawResultPath: "/tmp/run-2/split-result.raw.json",
            rawOutput: null,
            stdoutTruncatedPreview: "",
            claudeSessionId: null,
          },
        },
      },
    });
    const api = makeApi(state);

    await hydrateClusterRunFromRunDir("run-2", "/tmp/run-2", "cluster-fe", state, api, state.activeMissionId, "succeeded");

    expect(recoverClusterRunFromRunDir).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-2",
      runDir: "/tmp/run-2",
      cluster: expect.objectContaining({ id: "cluster-fe" }),
    }));
    expect(state.clusterRuns["cluster-fe"]).toMatchObject({
      status: "succeeded",
      raw: { runId: "run-2", claudeSessionId: "claude-session-2" },
      normalized: { splitTasks: [expect.objectContaining({ id: "task-a" })] },
      progress: { status: "succeeded", progressPercent: 100 },
    });
    expect(completeMissionAgentAssignment).toHaveBeenCalledWith(expect.objectContaining({
      assignmentId: "mission-p1-hash-cluster-fe-splitter-retry",
      status: "succeeded",
    }));
    expect(trellisRuntimeRecordEventSafe).toHaveBeenCalledWith(expect.objectContaining({
      eventKind: "trellis.agent.completed",
      correlationId: "mission-p1-hash-cluster-fe-splitter-retry",
      payload: expect.objectContaining({
        runDir: "/tmp/run-2",
        rawResultPath: "/tmp/run-2/split-result.raw.json",
      }),
    }));
    expect(attachMissionToSession).toHaveBeenCalledWith({
      missionId: "mission-p1-hash",
      sessionId: "claude-session-2",
    });
  });
	});
