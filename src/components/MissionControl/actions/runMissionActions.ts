import { message } from "antd";
import type { ClusterPlanItem } from "../../../services/prdSplit/clusterPlanner";
import { buildClusterDispatchContext } from "../../../services/prdSplit/clusterDispatchContext";
import {
  cancelClusterRun,
  dispatchClusterSplit,
  recoverClusterRunFromRunDir,
  retryClusterFromRunDir as retryClusterRunFromDir,
  type DispatchClusterResult,
} from "../../../services/prdSplit/splitterDispatch";
import { createParentTask, markChildrenPlanning, renderParentPrd, writeClusterTasks } from "../../../services/prdSplit/trellisWriter";
import {
  buildPrdSplitWorkflowArtifacts,
  type PrdSplitWorkflowClusterInput,
} from "../../../services/prdSplit/workflowGraphFromSplit";
import { saveWorkflowGraph } from "../../../services/workflowGraphs";
import { saveWorkflowTemplate } from "../../../services/workflowTemplates";
import { addProjectPrdWorkflow } from "../../../services/projectPrdScope";
import { refreshSplitResultDerivedFields } from "../../../services/taskSplitter";
import {
  dispatchWorkspaceTrellisMaterializedFanout,
  resolveMaterializedFanoutRepositoryTarget,
} from "../../../services/prdSplit/materializedFanoutBridge";
import {
  buildPrdSplitMissionAssignmentId,
  buildPrdSplitMissionId,
} from "../../../services/prdSplit/missionIds";
import {
  appendMissionEvent,
  attachMissionToSession,
  completeMissionAgentAssignment,
  createOrResumeMission,
  upsertMissionAgentAssignment,
  type MissionSnapshotRecord,
} from "../../../services/missionControlBackend";
import { WORKFLOW_UI_EVENT_WORKFLOW_GRAPH_CHANGED } from "../../../constants/workflowUiEvents";
import {
  trellisAgentHeartbeat,
  trellisRuntimeRecordEventSafe,
  trellisRuntimeUpsertAgentRunSafe,
  type TrellisAgentRunInput,
} from "../../../services/trellisRuntime";
import { applyEditsToSplitResult } from "../../PrdSplitWizard/taskEdits";
import type { UseSplitWizardStateApi } from "../../PrdSplitWizard/useSplitWizardState";
import type { ClusterRunState, WizardWorkflowGraphResult, WizardWriteResult } from "../../PrdSplitWizard/types";
import type { SplitResult } from "../../../types";

const MISSION_SCHEMA_VERSION = 1;
const SPLITTER_HEARTBEAT_INTERVAL_MS = 30_000;

export interface WriteMissionToTrellisOptions {
  sourceTaskIds?: readonly string[];
}

interface SourceTaskSelectionMatch {
  taskId: string;
  outputSourceTaskId: string;
}

export async function runMissionClusters(api: UseSplitWizardStateApi): Promise<void> {
  const { state } = api;
  if (!state.plan || !state.prd || !state.requirementsIndex || !state.project) return;
  const mission = await persistMissionSnapshot(api, "dispatch", "running", "mission.dispatch.started", {
    clusterCount: state.plan.clusters.length,
  }, undefined, {
    stage: "dispatch",
  });
  api.setActiveMissionId(mission?.missionId ?? null);
  const settled = await Promise.allSettled(
    state.plan.clusters.map((cluster) => runSingleCluster(cluster, state, api, mission?.missionId)),
  );
  const completedRuns = { ...state.clusterRuns };
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      completedRuns[result.value.clusterId] = result.value;
    }
  }
  await persistMissionSnapshot(api, "review", "running", "mission.dispatch.completed", {
    succeededCount: Object.values(completedRuns).filter((run) => run.status === "succeeded").length,
    failedCount: Object.values(completedRuns).filter((run) => run.status === "failed").length,
  }, mission?.missionId, {
    stage: "review",
    clusterRuns: completedRuns,
    activeMissionId: mission?.missionId ?? null,
  });
}

export async function runSingleCluster(
  cluster: ClusterPlanItem,
  state: UseSplitWizardStateApi["state"],
  api: UseSplitWizardStateApi,
  missionId?: string | null,
): Promise<ClusterRunState | null> {
  const diff = state.diffByCluster[cluster.id];
  if (state.dispatchOnlyDirty && diff?.kind === "unchanged") {
    const skippedRun: ClusterRunState = {
      clusterId: cluster.id,
      parentTaskName: diff.existingParent.parentTaskName,
      parentTaskPath: diff.existingParent.parentTaskPath,
      status: "skipped-clean",
      errors: [],
      startedAt: Date.now(),
      endedAt: Date.now(),
    };
    api.setClusterRun(cluster.id, skippedRun);
    await appendMissionEventSafe(missionId, "mission.cluster.skipped", {
      clusterId: cluster.id,
      reason: "unchanged",
    });
    return skippedRun;
  }

  const runStart: ClusterRunState = {
    clusterId: cluster.id,
    parentTaskName: null,
    parentTaskPath: null,
    status: "creating-parent",
    errors: [],
    startedAt: Date.now(),
  };
  api.setClusterRun(cluster.id, runStart);
  const assignmentId = missionId ? missionAssignmentId(missionId, cluster.id, "splitter") : null;
  const repositoryPath = resolveClusterRepositoryPath(cluster, state.repositories);
  const assignmentMetadata = {
    clusterTitle: cluster.title,
    requirementIds: cluster.requirementIds,
  };
  await upsertMissionAgentAssignmentSafe(missionId, {
    assignmentId,
    agentRunId: assignmentId,
    clusterId: cluster.id,
    repositoryId: cluster.primaryRepositoryId,
    repositoryPath,
    agentType: "trellis-splitter",
    stage: "split",
    status: "running",
    metadata: assignmentMetadata,
  });
  await upsertSplitterAgentRunSafe(missionId, state, {
    agentRunId: assignmentId,
    cluster,
    repositoryPath,
    status: "running",
    metadata: assignmentMetadata,
    startedAt: runStart.startedAt,
  });
  await appendMissionEventSafe(missionId, "mission.cluster.dispatch_started", {
    clusterId: cluster.id,
    title: cluster.title,
    requirementIds: cluster.requirementIds,
    repositoryIds: cluster.repositoryIds,
  });

  let parentTaskName: string;
  let parentTaskPath: string;
  const reuse = state.reuseExistingParents && diff && diff.kind !== "new" ? diff : null;

  if (reuse) {
    parentTaskName = reuse.existingParent.parentTaskName;
    parentTaskPath = reuse.existingParent.parentTaskPath;
    api.patchClusterRun(cluster.id, { parentTaskName, parentTaskPath, status: "dispatching" });
    if (diff?.kind === "dirty") {
      try {
        const result = await markChildrenPlanning({
          projectRootPath: state.project!.rootPath,
          parentTaskName,
        });
        if (result.updatedChildNames.length > 0) {
          api.patchClusterRun(cluster.id, {
            errors: [
              `[info] 已把 ${result.updatedChildNames.length} 个旧子任务回退到 planning：${result.updatedChildNames.join(", ")}`,
            ],
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        api.patchClusterRun(cluster.id, {
          errors: [`标记旧子任务失败（继续生成）：${errorMessage}`],
        });
      }
    }
  } else {
    try {
      const parentMarkdown = renderParentPrd(state.prdMarkdown, {
        id: cluster.id,
        title: cluster.title,
        primaryRepositoryId: cluster.primaryRepositoryId,
        repositoryIds: cluster.repositoryIds,
      });
      const out = await createParentTask({
        projectRootPath: state.project!.rootPath,
        cluster: {
          id: cluster.id,
          title: cluster.title,
          primaryRepositoryId: cluster.primaryRepositoryId,
          repositoryIds: cluster.repositoryIds,
        },
        prdMarkdown: parentMarkdown,
        requirementsIndexJson: JSON.stringify(state.requirementsIndex!, null, 2),
        description: `任务分组 ${cluster.id} · ${cluster.requirementIds.length} 条需求`,
      });
      parentTaskName = out.parentTaskName;
      parentTaskPath = out.parentTaskPath;
      api.patchClusterRun(cluster.id, { parentTaskName, parentTaskPath, status: "dispatching" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      api.patchClusterRun(cluster.id, {
        status: "failed",
        errors: [`创建父任务失败: ${errorMessage}`],
        endedAt: Date.now(),
      });
      const failedRun: ClusterRunState = {
        ...runStart,
        status: "failed",
        errors: [`创建父任务失败: ${errorMessage}`],
        endedAt: Date.now(),
        progress: {
          status: "failed",
          progressPercent: 0,
          stageLabel: errorMessage,
          elapsedMs: Date.now() - (runStart.startedAt ?? Date.now()),
          error: {
            summary: errorMessage,
            exitCode: null,
            stdoutPath: "",
            stderrPath: "",
          },
        },
      };
      await completeMissionAgentAssignmentSafe(assignmentId, "failed", {
        clusterId: cluster.id,
        error: errorMessage,
        phase: "create-parent",
      });
      await upsertSplitterAgentRunSafe(missionId, state, {
        agentRunId: assignmentId,
        cluster,
        repositoryPath,
        status: "failed",
        taskPath: null,
        metadata: {
          ...assignmentMetadata,
          error: errorMessage,
          phase: "create-parent",
        },
        startedAt: runStart.startedAt,
        completedAt: failedRun.endedAt,
      });
      await recordSplitterTerminalRuntimeEventSafe(missionId, state, assignmentId, {
        clusterId: cluster.id,
        status: "failed",
        error: errorMessage,
        phase: "create-parent",
      });
      await appendMissionEventSafe(missionId, "mission.cluster.failed", {
        clusterId: cluster.id,
        error: errorMessage,
        phase: "create-parent",
      });
      api.setGlobalError(`创建父任务失败：${errorMessage}`);
      return failedRun;
    }
  }

  const stopHeartbeat = startSplitterHeartbeat(assignmentId);
  const isCancelledDuringDispatch = () => api.state.clusterRuns[cluster.id]?.status === "cancelled";
  try {
    const result = await dispatchWithRetry(cluster.id, async (attempt) => {
      if (isCancelledDuringDispatch()) {
        throw new Error("PRD split run cancelled by user");
      }
      if (attempt > 0) {
        const delay = Math.min(5_000 * Math.pow(2, attempt - 1), 30_000);
        api.patchClusterRun(cluster.id, {
          status: "dispatching",
          errors: [`API 错误，第 ${attempt + 1} 次重试（${delay / 1000}s 后）…`],
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return dispatchClusterSplit({
        projectRootPath: state.project!.rootPath,
        parentTaskPath,
        cluster,
        prd: state.prd!,
        requirementsIndex: state.requirementsIndex!,
        context: buildClusterDispatchContext({
          baseContext: state.context,
          cluster,
          repositories: state.repositories,
        }),
      });
    });
    if (isCancelledDuringDispatch()) {
      return api.state.clusterRuns[cluster.id] ?? null;
    }

    const finalRun: ClusterRunState = {
      ...runStart,
      parentTaskName,
      parentTaskPath,
      status: result.normalized && result.errors.length === 0 ? "succeeded" : "failed",
      raw: result.raw,
      normalized: result.normalized ?? undefined,
      validationIssues: result.validationIssues,
      errors: result.errors,
      endedAt: Date.now(),
      progress: {
        status: result.normalized && result.errors.length === 0 ? "succeeded" : "failed",
        progressPercent: result.normalized && result.errors.length === 0 ? 100 : 0,
        stageLabel: result.normalized && result.errors.length === 0 ? "完成" : result.errors[0] ?? "失败",
        elapsedMs: Date.now() - (runStart.startedAt ?? Date.now()),
        error: result.normalized && result.errors.length === 0
          ? null
          : {
            summary: result.errors[0] ?? "任务生成失败",
            exitCode: result.raw?.exitCode ?? null,
            stdoutPath: result.raw?.stdoutPath ?? "",
            stderrPath: result.raw?.stderrPath ?? "",
          },
      },
    };
    api.patchClusterRun(cluster.id, finalRun);
    if (finalRun.status === "succeeded") {
      api.clearClusterNeedsResplit(cluster.id);
    }
    const terminalStatus = result.normalized && result.errors.length === 0 ? "succeeded" : "failed";
    const terminalMetadata = {
      ...assignmentMetadata,
      clusterId: cluster.id,
      status: terminalStatus,
      parentTaskName,
      parentTaskPath,
      taskCount: result.normalized?.splitTasks.length ?? 0,
      validationIssueCount: result.validationIssues.length,
      errorCount: result.errors.length,
      exitCode: result.raw?.exitCode ?? null,
      stdoutPath: result.raw?.stdoutPath ?? null,
      stderrPath: result.raw?.stderrPath ?? null,
      runDir: result.raw?.runDir ?? null,
      rawResultPath: result.raw?.rawResultPath ?? null,
    };
    await completeMissionAgentAssignmentSafe(
      assignmentId,
      terminalStatus,
      {
        clusterId: terminalMetadata.clusterId,
        parentTaskName: terminalMetadata.parentTaskName,
        parentTaskPath: terminalMetadata.parentTaskPath,
        taskCount: terminalMetadata.taskCount,
        validationIssueCount: terminalMetadata.validationIssueCount,
        errorCount: terminalMetadata.errorCount,
      },
    );
    await upsertSplitterAgentRunSafe(missionId, state, {
      agentRunId: assignmentId,
      cluster,
      repositoryPath,
      status: terminalStatus,
      taskPath: parentTaskPath,
      metadata: terminalMetadata,
      startedAt: runStart.startedAt,
      completedAt: finalRun.endedAt,
    });
    await recordSplitterTerminalRuntimeEventSafe(missionId, state, assignmentId, terminalMetadata);
    await appendMissionEventSafe(missionId, "mission.cluster.dispatch_completed", {
      clusterId: cluster.id,
      parentTaskName,
      parentTaskPath,
      taskCount: result.normalized?.splitTasks.length ?? 0,
      status: result.normalized && result.errors.length === 0 ? "succeeded" : "failed",
      errorCount: result.errors.length,
    });
    // Link Claude session to Mission for bidirectional traceability
    if (missionId && result.raw?.claudeSessionId) {
      await attachMissionToSessionSafe(missionId, result.raw.claudeSessionId);
    }
    return finalRun;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (api.state.clusterRuns[cluster.id]?.status === "cancelled" || /cancelled/i.test(errorMessage)) {
      const endedAt = Date.now();
      const cancelledRun: ClusterRunState = {
        ...(api.state.clusterRuns[cluster.id] ?? runStart),
        status: "cancelled",
        errors: uniqueMessages([...(api.state.clusterRuns[cluster.id]?.errors ?? runStart.errors), "PRD split run cancelled by user"]),
        endedAt,
        progress: {
          status: "cancelled",
          progressPercent: 0,
          stageLabel: "已中断",
          elapsedMs: endedAt - (runStart.startedAt ?? endedAt),
          error: {
            summary: "PRD split run cancelled by user",
            exitCode: 130,
            stdoutPath: api.state.clusterRuns[cluster.id]?.raw?.stdoutPath ?? "",
            stderrPath: api.state.clusterRuns[cluster.id]?.raw?.stderrPath ?? "",
          },
        },
      };
      api.patchClusterRun(cluster.id, cancelledRun);
      await completeMissionAgentAssignmentSafe(assignmentId, "cancelled", {
        clusterId: cluster.id,
        phase: "dispatch",
        reason: "user_cancelled",
      });
      await upsertSplitterAgentRunSafe(missionId, state, {
        agentRunId: assignmentId,
        cluster,
        repositoryPath,
        status: "cancelled",
        taskPath: parentTaskPath,
        metadata: {
          ...assignmentMetadata,
          clusterId: cluster.id,
          parentTaskName,
          parentTaskPath,
          reason: "user_cancelled",
        },
        startedAt: runStart.startedAt,
        completedAt: endedAt,
      });
      await recordSplitterTerminalRuntimeEventSafe(missionId, state, assignmentId, {
        clusterId: cluster.id,
        parentTaskName,
        parentTaskPath,
        status: "cancelled",
        reason: "user_cancelled",
      });
      await appendMissionEventSafe(missionId, "mission.cluster.cancelled", {
        clusterId: cluster.id,
        phase: "dispatch",
      });
      return cancelledRun;
    }
    const failedRun: ClusterRunState = {
      ...runStart,
      status: "failed",
      errors: [`任务生成失败: ${errorMessage}`],
      endedAt: Date.now(),
      progress: {
        status: "failed",
        progressPercent: 0,
        stageLabel: errorMessage,
        elapsedMs: Date.now() - (runStart.startedAt ?? Date.now()),
        error: {
          summary: errorMessage,
          exitCode: null,
          stdoutPath: "",
          stderrPath: "",
        },
      },
    };
    api.patchClusterRun(cluster.id, failedRun);
    await completeMissionAgentAssignmentSafe(assignmentId, "failed", {
      clusterId: cluster.id,
      error: errorMessage,
      phase: "dispatch",
    });
    await upsertSplitterAgentRunSafe(missionId, state, {
      agentRunId: assignmentId,
      cluster,
      repositoryPath,
      status: "failed",
      taskPath: parentTaskPath,
      metadata: {
        ...assignmentMetadata,
        clusterId: cluster.id,
        parentTaskName,
        parentTaskPath,
        error: errorMessage,
        phase: "dispatch",
      },
      startedAt: runStart.startedAt,
      completedAt: failedRun.endedAt,
    });
    await recordSplitterTerminalRuntimeEventSafe(missionId, state, assignmentId, {
      clusterId: cluster.id,
      parentTaskName,
      parentTaskPath,
      status: "failed",
      error: errorMessage,
      phase: "dispatch",
    });
    await appendMissionEventSafe(missionId, "mission.cluster.failed", {
      clusterId: cluster.id,
      error: errorMessage,
      phase: "dispatch",
    });
    api.setGlobalError(`任务生成失败：${errorMessage}`);
    return failedRun;
  } finally {
    stopHeartbeat();
  }
}

export async function retryClusterFromRunDir(
  runId: string,
  clusterId: string,
  state: UseSplitWizardStateApi["state"],
  api: UseSplitWizardStateApi,
  missionId?: string | null,
): Promise<void> {
  if (!state.project) return;
  const cluster = state.plan?.clusters.find((candidate) => candidate.id === clusterId) ?? null;
  if (!cluster) {
    api.setGlobalError(`找不到任务分组：${clusterId}`);
    return;
  }
  const currentRun = state.clusterRuns[clusterId];
  const startedAt = Date.now();
  const assignmentId = missionId ? missionAssignmentId(missionId, clusterId, "splitter-retry") : null;
  const repositoryPath = resolveClusterRepositoryPath(cluster, state.repositories);
  const retryRun: ClusterRunState = {
    clusterId,
    parentTaskName: currentRun?.parentTaskName ?? null,
    parentTaskPath: currentRun?.parentTaskPath ?? null,
    status: "dispatching",
    errors: [`Retrying from runDir: ${runId}`],
    startedAt,
    progress: {
      status: "running",
      progressPercent: 5,
      stageLabel: "从 runDir 重试中…",
      elapsedMs: 0,
      error: null,
    },
  };
  api.patchClusterRun(clusterId, retryRun);
  await upsertMissionAgentAssignmentSafe(missionId, {
    assignmentId,
    agentRunId: assignmentId,
    clusterId,
    repositoryId: cluster.primaryRepositoryId,
    repositoryPath,
    agentType: "trellis-splitter",
    stage: "split",
    status: "running",
    metadata: {
      clusterTitle: cluster.title,
      retryFromRunId: runId,
      requirementIds: cluster.requirementIds,
    },
  });
  await upsertSplitterAgentRunSafe(missionId, state, {
    agentRunId: assignmentId,
    cluster,
    repositoryPath,
    status: "running",
    taskPath: currentRun?.parentTaskPath ?? null,
    metadata: {
      retryFromRunId: runId,
      clusterTitle: cluster.title,
      requirementIds: cluster.requirementIds,
    },
    startedAt,
  });
  await appendMissionEventSafe(missionId, "mission.cluster.retry_started", {
    clusterId,
    runId,
  });

  const stopHeartbeat = startSplitterHeartbeat(assignmentId);
  try {
    const output = await retryClusterRunFromDir({
      runId,
      projectRootPath: state.project.rootPath,
      missionId: missionId ?? null,
      clusterId,
    });
    api.patchClusterRun(clusterId, {
      raw: {
        runId: output.newRunId,
        runDir: output.newRunDir,
        exitCode: 0,
        durationMs: 0,
        stdoutPath: `${output.newRunDir}/claude.stdout.log`,
        stderrPath: `${output.newRunDir}/claude.stderr.log`,
        rawResultPath: `${output.newRunDir}/split-result.raw.json`,
        rawOutput: null,
        stdoutTruncatedPreview: "",
        claudeSessionId: null,
      },
      errors: [],
      progress: {
        status: "running",
        progressPercent: 10,
        stageLabel: `重试运行已启动：${output.newRunId}`,
        elapsedMs: Date.now() - startedAt,
        error: null,
      },
    });
    await appendMissionEventSafe(missionId, "mission.cluster.retried", {
      clusterId,
      oldRunId: runId,
      newRunId: output.newRunId,
      newRunDir: output.newRunDir,
    });
    await upsertSplitterAgentRunSafe(missionId, state, {
      agentRunId: assignmentId,
      cluster,
      repositoryPath,
      status: "running",
      taskPath: currentRun?.parentTaskPath ?? null,
      metadata: {
        retryFromRunId: runId,
        newRunId: output.newRunId,
        newRunDir: output.newRunDir,
      },
      startedAt,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    const endedAt = Date.now();
    api.patchClusterRun(clusterId, {
      status: "failed",
      errors: [`从 runDir 重试失败: ${messageText}`],
      endedAt,
      progress: {
        status: "failed",
        progressPercent: 0,
        stageLabel: messageText,
        elapsedMs: endedAt - startedAt,
        error: {
          summary: messageText,
          exitCode: null,
          stdoutPath: currentRun?.raw?.stdoutPath ?? currentRun?.progress?.error?.stdoutPath ?? "",
          stderrPath: currentRun?.raw?.stderrPath ?? currentRun?.progress?.error?.stderrPath ?? "",
        },
      },
    });
    await completeMissionAgentAssignmentSafe(assignmentId, "failed", {
      clusterId,
      retryFromRunId: runId,
      error: messageText,
    });
    await upsertSplitterAgentRunSafe(missionId, state, {
      agentRunId: assignmentId,
      cluster,
      repositoryPath,
      status: "failed",
      taskPath: currentRun?.parentTaskPath ?? null,
      metadata: {
        retryFromRunId: runId,
        error: messageText,
      },
      startedAt,
      completedAt: endedAt,
    });
    await recordSplitterTerminalRuntimeEventSafe(missionId, state, assignmentId, {
      clusterId,
      status: "failed",
      retryFromRunId: runId,
      error: messageText,
    });
    api.setGlobalError(`从 runDir 重试失败：${messageText}`);
  } finally {
    stopHeartbeat();
  }
}

export async function hydrateClusterRunFromRunDir(
  runId: string,
  runDir: string,
  clusterId: string,
  state: UseSplitWizardStateApi["state"],
  api: UseSplitWizardStateApi,
  missionId?: string | null,
  terminalStatus?: "succeeded" | "failed" | "cancelled",
): Promise<void> {
  if (!state.project || !state.prd || !state.requirementsIndex) return;
  const cluster = state.plan?.clusters.find((candidate) => candidate.id === clusterId) ?? null;
  if (!cluster) {
    api.setGlobalError(`找不到任务分组：${clusterId}`);
    return;
  }
  const currentRun = state.clusterRuns[clusterId];
  const startedAt = currentRun?.startedAt ?? Date.now();
  const endedAt = Date.now();
  try {
    const result = await recoverClusterRunFromRunDir({
      runId,
      runDir,
      prd: state.prd,
      cluster,
      requirementsIndex: state.requirementsIndex,
      context: buildClusterDispatchContext({
        baseContext: state.context,
        cluster,
        repositories: state.repositories,
      }),
    });
    const finalStatus = terminalStatus === "cancelled" || result.raw.exitCode === 130
      ? "cancelled"
      : result.normalized && result.errors.length === 0
        ? "succeeded"
        : "failed";
    api.patchClusterRun(clusterId, {
      status: finalStatus,
      raw: result.raw,
      normalized: result.normalized ?? undefined,
      validationIssues: result.validationIssues,
      errors: result.errors,
      endedAt,
      progress: {
        status: finalStatus,
        progressPercent: finalStatus === "succeeded" ? 100 : 0,
        stageLabel: finalStatus === "succeeded" ? "重试完成" : result.errors[0] ?? "重试失败",
        elapsedMs: endedAt - startedAt,
        error: finalStatus === "succeeded"
          ? null
          : {
            summary: result.errors[0] ?? "重试失败",
            exitCode: result.raw.exitCode,
            stdoutPath: result.raw.stdoutPath,
            stderrPath: result.raw.stderrPath,
          },
      },
    });
    if (finalStatus === "succeeded") {
      api.clearClusterNeedsResplit(clusterId);
    }
    const assignmentId = missionId ? missionAssignmentId(missionId, clusterId, "splitter-retry") : null;
    const repositoryPath = resolveClusterRepositoryPath(cluster, state.repositories);
    const metadata = {
      clusterId,
      status: finalStatus,
      parentTaskName: currentRun?.parentTaskName ?? null,
      parentTaskPath: currentRun?.parentTaskPath ?? null,
      taskCount: result.normalized?.splitTasks.length ?? 0,
      validationIssueCount: result.validationIssues.length,
      errorCount: result.errors.length,
      exitCode: result.raw.exitCode,
      stdoutPath: result.raw.stdoutPath,
      stderrPath: result.raw.stderrPath,
      runDir: result.raw.runDir,
      rawResultPath: result.raw.rawResultPath,
    };
    await completeMissionAgentAssignmentSafe(assignmentId, finalStatus, metadata);
    await upsertSplitterAgentRunSafe(missionId, state, {
      agentRunId: assignmentId,
      cluster,
      repositoryPath,
      status: finalStatus,
      taskPath: currentRun?.parentTaskPath ?? null,
      metadata,
      startedAt,
      completedAt: endedAt,
    });
    await recordSplitterTerminalRuntimeEventSafe(missionId, state, assignmentId, metadata);
    await appendMissionEventSafe(missionId, "mission.cluster.retry_completed", metadata);
    if (missionId && result.raw.claudeSessionId) {
      await attachMissionToSessionSafe(missionId, result.raw.claudeSessionId);
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    api.patchClusterRun(clusterId, {
      status: "failed",
      errors: [`读取重试结果失败: ${messageText}`],
      endedAt,
      progress: {
        status: "failed",
        progressPercent: 0,
        stageLabel: messageText,
        elapsedMs: endedAt - startedAt,
        error: {
          summary: messageText,
          exitCode: null,
          stdoutPath: currentRun?.raw?.stdoutPath ?? "",
          stderrPath: currentRun?.raw?.stderrPath ?? "",
        },
      },
    });
    api.setGlobalError(`读取重试结果失败：${messageText}`);
  }
}

export async function cancelClusterDispatch(
  runId: string,
  clusterId: string,
  state: UseSplitWizardStateApi["state"],
  api: UseSplitWizardStateApi,
  missionId?: string | null,
): Promise<void> {
  const currentRun = state.clusterRuns[clusterId];
  const startedAt = currentRun?.startedAt ?? Date.now();
  const endedAt = Date.now();
  try {
    const output = await cancelClusterRun({ runId });
    const runDir = output.runDir || currentRun?.raw?.runDir || "";
    const stdoutPath = currentRun?.raw?.stdoutPath || (runDir ? `${runDir}/claude.stdout.log` : "");
    const stderrPath = currentRun?.raw?.stderrPath || (runDir ? `${runDir}/claude.stderr.log` : "");
    const rawResultPath = currentRun?.raw?.rawResultPath || (runDir ? `${runDir}/split-result.raw.json` : "");
    const cancelMessage = output.signalledRunningProcess
      ? "PRD split run cancelled by user"
      : output.alreadyFinished
        ? "PRD split run already finished before cancel request"
        : "PRD split run was not registered; marked cancelled for recovery";
    if (output.alreadyFinished && !output.signalledRunningProcess) {
      await appendMissionEventSafe(missionId, "mission.cluster.cancel_ignored", {
        clusterId,
        runId: output.runId,
        runDir,
        reason: "already_finished",
      });
      api.setGlobalError("子代理已经结束，未覆盖已有运行结果；正在刷新后台状态。");
      return;
    }
    api.patchClusterRun(clusterId, {
      status: "cancelled",
      endedAt,
      raw: {
        runId: output.runId,
        runDir,
        exitCode: 130,
        durationMs: 0,
        stdoutPath,
        stderrPath,
        rawResultPath,
        rawOutput: null,
        stdoutTruncatedPreview: currentRun?.raw?.stdoutTruncatedPreview ?? "",
        claudeSessionId: currentRun?.raw?.claudeSessionId ?? null,
      },
      errors: uniqueMessages([...(currentRun?.errors ?? []), cancelMessage]),
      progress: {
        status: "cancelled",
        progressPercent: 0,
        stageLabel: "已中断",
        elapsedMs: endedAt - startedAt,
        error: {
          summary: cancelMessage,
          exitCode: 130,
          stdoutPath,
          stderrPath,
        },
      },
    });

    const cluster = state.plan?.clusters.find((candidate) => candidate.id === clusterId) ?? null;
    const assignmentId = missionId ? missionAssignmentId(missionId, clusterId, "splitter") : null;
    await completeMissionAgentAssignmentSafe(assignmentId, "cancelled", {
      clusterId,
      runId: output.runId,
      runDir,
      reason: "user_cancelled",
      signalledRunningProcess: output.signalledRunningProcess,
    });
    if (cluster) {
      await upsertSplitterAgentRunSafe(missionId, state, {
        agentRunId: assignmentId,
        cluster,
        repositoryPath: resolveClusterRepositoryPath(cluster, state.repositories),
        status: "cancelled",
        taskPath: currentRun?.parentTaskPath ?? null,
        metadata: {
          clusterId,
          runId: output.runId,
          runDir,
          reason: "user_cancelled",
          signalledRunningProcess: output.signalledRunningProcess,
        },
        startedAt,
        completedAt: endedAt,
      });
    }
    await recordSplitterTerminalRuntimeEventSafe(missionId, state, assignmentId, {
      clusterId,
      status: "cancelled",
      runId: output.runId,
      runDir,
      reason: "user_cancelled",
    });
    await appendMissionEventSafe(missionId, "mission.cluster.cancelled", {
      clusterId,
      runId: output.runId,
      runDir,
      signalledRunningProcess: output.signalledRunningProcess,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    api.setGlobalError(`中断子代理失败：${messageText}`);
  }
}

// ── Retry logic for API errors ──────────────────────────────────────

const MAX_RETRIES = 3;
const API_ERROR_PATTERNS = [
  /429/i,                        // Too Many Requests
  /rate.?limit/i,                // Rate limit exceeded
  /500|502|503|504/i,            // Server errors
  /overload/i,                   // Overloaded
  /service.?unavailable/i,       // Service unavailable
  /too many requests/i,
  /try again/i,                  // Generic retry request
  /timeout|timed.?out/i,         // Network timeout
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT/i, // Network errors
  /connection.*error/i,
  /internal.*server.*error/i,
];

function isRetryableApiError(result: DispatchClusterResult): boolean {
  const text = [
    ...result.errors,
    result.raw?.stdoutTruncatedPreview ?? "",
  ].join("\n");
  return API_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

async function dispatchWithRetry(
  clusterId: string,
  dispatch: (attempt: number) => Promise<DispatchClusterResult>,
): Promise<DispatchClusterResult> {
  let lastResult: DispatchClusterResult | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await dispatch(attempt);
    lastResult = result;

    // Success
    if (result.normalized && result.errors.length === 0) {
      return result;
    }

    // Don't retry on the last attempt
    if (attempt >= MAX_RETRIES) break;

    // Only retry on API-level errors, not validation/parsing errors
    if (!isRetryableApiError(result)) {
      return result;
    }

    console.warn(
      `[dispatchWithRetry] cluster=${clusterId} attempt=${attempt + 1}/${MAX_RETRIES + 1} — API error detected, retrying`,
    );
  }

  return lastResult!;
}

// ────────────────────────────────────────────────────────────────────

export async function writeMissionToTrellis(
  api: UseSplitWizardStateApi,
  options: WriteMissionToTrellisOptions = {},
): Promise<void> {
  const { state } = api;
  if (!state.project || !state.prd) return;
  const sourceTaskIdSet = new Set((options.sourceTaskIds ?? []).map((id) => id.trim()).filter(Boolean));
  const mission = await persistMissionSnapshot(api, "writing", "running", "mission.write.started", {
    succeededClusterCount: Object.values(state.clusterRuns).filter((run) => run.status === "succeeded").length,
    sourceTaskIds: sourceTaskIdSet.size > 0 ? Array.from(sourceTaskIdSet) : null,
  }, undefined, {
    stage: "writing",
  });
  const clusters = state.plan?.clusters ?? [];
  const succeededClusters = clusters.filter((cluster) => state.clusterRuns[cluster.id]?.status === "succeeded");
  const writeResults: WizardWriteResult[] = [];
  api.beginWrite();
  try {
    const graphInputs: PrdSplitWorkflowClusterInput[] = [];
    const fanoutPromises: Promise<unknown>[] = [];
    for (const cluster of succeededClusters) {
      const run = state.clusterRuns[cluster.id];
      if (!run?.normalized || !run.parentTaskName) {
        const result: WizardWriteResult = {
          clusterId: cluster.id,
          parentTaskName: run?.parentTaskName ?? "",
          childTaskNames: [],
          childTasks: [],
          warnings: [],
          error: "缺少拆分结果或父任务名，无法落盘",
        };
        writeResults.push(result);
        api.addWriteResult(result);
        continue;
      }
      const effectiveAll = applyEditsToSplitResult(run.normalized, state.editsByCluster[cluster.id]);
      const selectedTasks = sourceTaskIdSet.size === 0
        ? effectiveAll.splitTasks.map((task): SourceTaskSelectionMatch => ({ taskId: task.id, outputSourceTaskId: task.id }))
        : collectSelectedClusterTasks(effectiveAll, cluster.id, sourceTaskIdSet);
      const outputSourceTaskIdByTaskId = new Map(selectedTasks.map((item) => [item.taskId, item.outputSourceTaskId]));
      const effective = sourceTaskIdSet.size === 0
        ? effectiveAll
        : refreshSplitResultDerivedFields({
          ...effectiveAll,
          splitTasks: effectiveAll.splitTasks.filter((task) => outputSourceTaskIdByTaskId.has(task.id)),
          executableTasks: [],
        });
      if (effective.splitTasks.length === 0) {
        continue;
      }
      try {
        const out = await writeClusterTasks({
          projectRootPath: state.project.rootPath,
          parentTaskName: run.parentTaskName,
          cluster: {
            id: cluster.id,
            title: cluster.title,
            primaryRepositoryId: cluster.primaryRepositoryId,
            repositoryIds: cluster.repositoryIds,
          },
          normalized: effective,
          prdSource: state.prd,
        });
        const displayChildTasks = out.childTasks.map((task) => ({
          ...task,
          sourceTaskId: outputSourceTaskIdByTaskId.get(task.sourceTaskId) ?? task.sourceTaskId,
        }));
        const uiTaskIdByOutputTaskId = buildUiTaskIdByOutputTaskId(effectiveAll);
        const toDisplayTaskId = (taskId: string) =>
          outputSourceTaskIdByTaskId.get(taskId) ?? uiTaskIdByOutputTaskId.get(taskId) ?? taskId;
        const result: WizardWriteResult = {
          clusterId: cluster.id,
          parentTaskName: out.parentTaskName,
          childTaskNames: out.childTaskNames,
          childTasks: displayChildTasks,
          warnings: out.warnings,
        };
        writeResults.push(result);
        api.addWriteResult(result);
        const target = resolveMaterializedFanoutRepositoryTarget(cluster, state.repositories);
        fanoutPromises.push(dispatchWorkspaceTrellisMaterializedFanout({
          sessionId: `prd-split:${out.parentTaskName}`,
          projectId: state.project.id,
          projectRootPath: state.project.rootPath,
          repositoryPath: target.repositoryPath,
          sourceTasks: effective.splitTasks,
          materializedResult: out,
          repositoryMetadata: target.repositoryMetadata,
        }));
        graphInputs.push({
          cluster,
          parentTaskName: out.parentTaskName,
          childTasks: displayChildTasks,
          tasks: effective.splitTasks.map((task) => ({
            sourceTaskId: toDisplayTaskId(task.id),
            title: task.title,
            role: task.role,
            dependencies: task.dependencies.map(toDisplayTaskId),
            sourceRequirementIds: task.sourceRequirementIds,
            sourceRefs: task.sourceRefs,
            taskAnchors: task.taskAnchors,
          })),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const result: WizardWriteResult = {
          clusterId: cluster.id,
          parentTaskName: run.parentTaskName,
          childTaskNames: [],
          childTasks: [],
          warnings: [],
          error: errorMessage,
        };
        writeResults.push(result);
        api.addWriteResult(result);
      }
    }
    if (writeResults.length === 0) {
      throw new Error("没有匹配的可落盘任务。");
    }
    const workflowGraphResult = await persistMissionWorkflowGraph(api, graphInputs);
    api.finishWrite();
    const fanoutResults = await Promise.allSettled(fanoutPromises);
    const fanoutFailedCount = fanoutResults.filter((result) => result.status === "rejected").length;
    await persistMissionSnapshot(api, "done", "completed", "mission.write.completed", {
      writeResultCount: writeResults.length,
      workflowId: workflowGraphResult?.workflowId ?? null,
      fanoutFailedCount,
    }, mission?.missionId, {
      stage: "done",
      writeResults,
      workflowGraphResult,
      fanoutFailedCount,
    });
    if (fanoutFailedCount > 0) {
      message.error(`Trellis 任务已落盘，但 ${fanoutFailedCount} 个分组派发失败，请查看运行队列或重试。`);
    } else {
      message.success("Trellis 任务已落盘，已启动实现子代理派发");
    }
  } catch (error) {
    api.failWrite(error instanceof Error ? error.message : String(error));
    await persistMissionSnapshot(api, "writing", "failed", "mission.write.failed", {
      error: error instanceof Error ? error.message : String(error),
    }, mission?.missionId, {
      stage: "writing",
      writeResults,
    });
  }
}

function collectSelectedClusterTasks(
  result: SplitResult,
  clusterId: string,
  sourceTaskIdSet: Set<string>,
): SourceTaskSelectionMatch[] {
  const outputByUiId = buildOutputTaskIdByUiTaskId(result);
  return result.splitTasks
    .map((task): SourceTaskSelectionMatch | null => {
      const directId = task.id.trim();
      const uiIds = Array.from(new Set([
        directId,
        `${clusterId}-${directId}`,
        ...Array.from(outputByUiId.entries())
          .filter(([, outputTaskId]) => outputTaskId === directId)
          .map(([uiTaskId]) => uiTaskId),
      ]));
      if (!uiIds.some((id) => sourceTaskIdSet.has(id))) return null;
      const selectedUiId = uiIds.find((id) => sourceTaskIdSet.has(id)) ?? directId;
      return {
        taskId: directId,
        outputSourceTaskId: selectedUiId,
      };
    })
    .filter((item): item is SourceTaskSelectionMatch => Boolean(item));
}

function buildOutputTaskIdByUiTaskId(result: Pick<SplitResult, "claudeSplitMapping">): Map<string, string> {
  const out = new Map<string, string>();
  for (const remap of result.claudeSplitMapping?.idRemap ?? []) {
    const from = remap.from.trim();
    const to = remap.to.trim();
    if (!from || !to) continue;
    out.set(to, from);
  }
  return out;
}

function buildUiTaskIdByOutputTaskId(result: Pick<SplitResult, "claudeSplitMapping">): Map<string, string> {
  const out = new Map<string, string>();
  for (const remap of result.claudeSplitMapping?.idRemap ?? []) {
    const from = remap.from.trim();
    const to = remap.to.trim();
    if (!from || !to) continue;
    out.set(from, to);
  }
  return out;
}

async function persistMissionWorkflowGraph(
  api: UseSplitWizardStateApi,
  clustersForGraph: PrdSplitWorkflowClusterInput[],
): Promise<WizardWorkflowGraphResult | null> {
  const { state } = api;
  if (!state.project || clustersForGraph.length === 0) return null;
  try {
    const artifacts = buildPrdSplitWorkflowArtifacts({
      projectId: state.project.id,
      projectName: state.project.name,
      projectRootPath: state.project.rootPath,
      requirementsIndex: state.requirementsIndex,
      clusters: clustersForGraph,
    });
    const savedTemplate = await saveWorkflowTemplate({
      workflowId: artifacts.workflowId,
      name: artifacts.name,
      isDefault: false,
      stages: artifacts.stages,
      projectIds: state.context?.mode === "project" ? [state.project.id] : [],
    });
    const savedGraph = await saveWorkflowGraph({
      workflowId: savedTemplate.id,
      graph: artifacts.graph,
      status: "draft",
    });
    if (state.context?.mode === "project") {
      await addProjectPrdWorkflow(state.project.id, savedTemplate.id);
    }
    const result: WizardWorkflowGraphResult = {
      workflowId: savedTemplate.id,
      workflowName: savedTemplate.name,
      status: "draft",
      nodeCount: savedGraph.graph.nodes.length,
      edgeCount: savedGraph.graph.edges.length,
      graph: savedGraph.graph,
    };
    api.setWorkflowGraphResult(result);
    window.dispatchEvent(
      new CustomEvent(WORKFLOW_UI_EVENT_WORKFLOW_GRAPH_CHANGED, {
        detail: {
          workflowId: savedTemplate.id,
          status: savedGraph.status,
          projectId: state.context?.mode === "project" ? state.project.id : undefined,
        },
      }),
    );
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const result: WizardWorkflowGraphResult = {
      workflowId: "",
      workflowName: "PRD Split workflow",
      status: "draft",
      nodeCount: 0,
      edgeCount: 0,
      error: errorMessage,
    };
    api.setWorkflowGraphResult(result);
    message.warning(`Trellis 任务已写入，但 workflow graph 保存失败：${errorMessage}`);
    return result;
  }
}

async function persistMissionSnapshot(
  api: UseSplitWizardStateApi,
  stage: string,
  status: string,
  eventType?: string,
  eventPayload: Record<string, unknown> = {},
  existingMissionId?: string | null,
  snapshotPatch: Record<string, unknown> = {},
): Promise<MissionSnapshotRecord | null> {
  const { state } = api;
  if (!state.project) return null;
  const missionId = existingMissionId ?? buildPrdSplitMissionId(state.project.id, state.prdMarkdown);
  try {
    const mission = await createOrResumeMission({
      missionId,
      projectId: state.project.id,
      projectName: state.project.name,
      rootPath: state.project.rootPath,
      prdHash: await sha256Hex(state.prdMarkdown),
      title: state.prd?.title || state.project.name || "Mission",
      stage,
      status,
      snapshot: buildMissionSnapshot(api, snapshotPatch),
    });
    if (eventType) {
      await appendMissionEventSafe(mission.missionId, eventType, eventPayload);
    }
    return mission;
  } catch (error) {
    console.warn("[MissionControl] failed to persist mission snapshot", error);
    return null;
  }
}

function buildMissionSnapshot(
  api: UseSplitWizardStateApi,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  const { state } = api;
  return {
    schemaVersion: MISSION_SCHEMA_VERSION,
    stage: state.stage,
    project: state.project,
    repositories: state.repositories,
    prdMarkdown: state.prdMarkdown,
    prd: state.prd,
    requirementsIndex: state.requirementsIndex,
    plan: state.plan,
    basePlan: state.basePlan,
    clusterPlanEdits: state.clusterPlanEdits,
    selectedRepositoryIds: state.selectedRepositoryIds,
    clusterRuns: state.clusterRuns,
    activeMissionId: state.activeMissionId,
    context: state.context,
    writeResults: state.writeResults,
    workflowGraphResult: state.workflowGraphResult,
    diffByCluster: state.diffByCluster,
    reuseExistingParents: state.reuseExistingParents,
    dispatchOnlyDirty: state.dispatchOnlyDirty,
    clusterNeedsResplit: state.clusterNeedsResplit,
    editsByCluster: state.editsByCluster,
    ...patch,
  };
}

function missionAssignmentId(missionId: string, clusterId: string, stage: string): string {
  return buildPrdSplitMissionAssignmentId(missionId, clusterId, stage);
}

function uniqueMessages(messages: string[]): string[] {
  return [...new Set(messages.filter((message) => message.trim().length > 0))];
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return buildPrdSplitMissionId("hash", value);
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function appendMissionEventSafe(
  missionId: string | null | undefined,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!missionId) return;
  try {
    await appendMissionEvent({
      missionId,
      eventType,
      payload,
    });
  } catch (error) {
    console.warn("[MissionControl] failed to append mission event", eventType, error);
  }
}

async function upsertSplitterAgentRunSafe(
  missionId: string | null | undefined,
  state: UseSplitWizardStateApi["state"],
  input: {
    agentRunId: string | null;
    cluster: ClusterPlanItem;
    repositoryPath: string | null;
    status: string;
    taskPath?: string | null;
    metadata: Record<string, unknown>;
    startedAt?: number;
    completedAt?: number;
  },
): Promise<void> {
  if (!missionId || !input.agentRunId || !state.project) return;
  const payload: TrellisAgentRunInput = {
    agentRunId: input.agentRunId,
    projectId: state.project.id,
    rootPath: state.project.rootPath,
    taskPath: input.taskPath ?? null,
    repositoryId: input.cluster.primaryRepositoryId,
    repositoryPath: input.repositoryPath,
    agentType: "trellis-splitter",
    stage: "split",
    status: input.status,
    startedAt: input.startedAt ?? null,
    metadata: {
      missionId,
      clusterId: input.cluster.id,
      ...input.metadata,
    },
  };
  if (input.completedAt != null) {
    payload.lastHeartbeatAt = input.completedAt;
    payload.metadata = { ...payload.metadata, completedAt: input.completedAt };
  }
  await trellisRuntimeUpsertAgentRunSafe(missionId, payload);
}

function startSplitterHeartbeat(agentRunId: string | null): () => void {
  if (!agentRunId) return () => {};
  const timer = globalThis.setInterval(() => {
    trellisAgentHeartbeat(agentRunId).catch((error) => {
      console.warn("[MissionControl] splitter heartbeat failed", error);
    });
  }, SPLITTER_HEARTBEAT_INTERVAL_MS);
  return () => globalThis.clearInterval(timer);
}

async function recordSplitterTerminalRuntimeEventSafe(
  missionId: string | null | undefined,
  state: UseSplitWizardStateApi["state"],
  agentRunId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!missionId || !agentRunId || !state.project) return;
  const eventKind = payload.status === "cancelled" ? "trellis.agent.cancelled" : "trellis.agent.completed";
  await trellisRuntimeRecordEventSafe({
    projectId: state.project.id,
    rootPath: state.project.rootPath,
    eventKind,
    platform: "wise",
    actor: "trellis-splitter",
    correlationId: agentRunId,
    payload: {
      missionId,
      agentRunId,
      ...payload,
    },
  });
}

async function upsertMissionAgentAssignmentSafe(
  missionId: string | null | undefined,
  input: {
    assignmentId: string | null;
    agentRunId?: string | null;
    clusterId: string;
    repositoryId: number | null;
    repositoryPath: string | null;
    agentType: string;
    stage: string;
    status: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  if (!missionId || !input.assignmentId) return;
  try {
    await upsertMissionAgentAssignment({
      assignmentId: input.assignmentId,
      agentRunId: input.agentRunId ?? input.assignmentId,
      missionId,
      clusterId: input.clusterId,
      repositoryId: input.repositoryId,
      repositoryPath: input.repositoryPath,
      agentType: input.agentType,
      stage: input.stage,
      status: input.status,
      metadata: input.metadata,
    });
  } catch (error) {
    console.warn("[MissionControl] failed to upsert mission assignment", error);
  }
}

async function completeMissionAgentAssignmentSafe(
  assignmentId: string | null,
  status: "succeeded" | "failed" | "cancelled" | "completed",
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!assignmentId) return;
  try {
    await completeMissionAgentAssignment({
      assignmentId,
      status,
      metadata,
    });
  } catch (error) {
    console.warn("[MissionControl] failed to complete mission assignment", error);
  }
}

async function attachMissionToSessionSafe(
  missionId: string,
  sessionId: string,
): Promise<void> {
  try {
    await attachMissionToSession({ missionId, sessionId });
  } catch (error) {
    console.warn("[MissionControl] failed to attach session to mission", error);
  }
}

function resolveClusterRepositoryPath(
  cluster: ClusterPlanItem,
  repositories: UseSplitWizardStateApi["state"]["repositories"],
): string | null {
  const repoId = cluster.primaryRepositoryId ?? cluster.repositoryIds[0] ?? null;
  if (repoId == null) return null;
  return repositories.find((repo) => repo.id === repoId)?.path ?? null;
}
