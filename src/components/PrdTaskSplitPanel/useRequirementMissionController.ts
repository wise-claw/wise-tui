import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelClusterDispatch,
  hydrateClusterRunFromRunDir,
  retryClusterFromRunDir,
  runMissionClusters,
  writeMissionToTrellis,
} from "../MissionControl/actions/runMissionActions";
import { useSplitWizardState } from "../PrdSplitWizard/useSplitWizardState";
import type { TrellisTarget } from "../PrdSplitWizard/targetModel";
import type { ClusterRunState, WizardState, WizardWriteResult } from "../PrdSplitWizard/types";
import type { ClusterPlanItem } from "../../services/prdSplit/clusterPlanner";
import type { ExecutionFanoutSnapshot } from "../../services/prdSplit/executionFanout";
import type { SplitResult } from "../../types";
import {
  mergeClusterSplitResults,
} from "../../services/prdSplit/clusterSplitResultMerge";

export interface RequirementMissionControllerInput {
  target: TrellisTarget | null;
}

export interface RequirementMissionRunResult {
  result: SplitResult;
  clusterRuns: ClusterRunState[];
  allClusterRuns: ClusterRunState[];
}

export interface RequirementMissionPlanSummary {
  clusters: ClusterPlanItem[];
  requirementCount: number;
}

export interface RequirementMissionMaterializeResult {
  parentTaskNames: string[];
  childTaskNames: string[];
  childTasks: Array<{
    sourceTaskId: string;
    taskName: string;
    taskPath: string;
  }>;
  failedCount: number;
  fanoutFailedCount: number;
  fanoutSnapshot: ExecutionFanoutSnapshot | null;
}

export interface MaterializeReviewedTasksOptions {
  sourceTaskIds?: readonly string[];
  onFanoutSnapshot?: (clusterId: string, snapshot: ExecutionFanoutSnapshot) => void;
}

export function useRequirementMissionController({ target }: RequirementMissionControllerInput) {
  const api = useSplitWizardState();
  const [busy, setBusy] = useState(false);
  const appliedTargetKeyRef = useRef<string | null>(null);
  const targetKey = target
    ? [
      target.kind,
      target.rootPath,
      target.repositories.map((repository) => repository.id).join(","),
      target.activeRepositoryId ?? "",
    ].join(":")
    : "__none__";

  useEffect(() => {
    if (appliedTargetKeyRef.current === targetKey) return;
    appliedTargetKeyRef.current = targetKey;
    if (!target) {
      api.reset(null, [], null);
      return;
    }
    api.reset(target.project, target.repositories, target.context);
  }, [api, target, targetKey]);

  const plan = useCallback(
    async (markdown: string): Promise<
      | { ok: true; summary: RequirementMissionPlanSummary }
      | { ok: false; reason: string }
    > => {
      const result = await api.parseAndPlanMarkdown(markdown);
      if (!result.ok) return result;
      return {
        ok: true,
        summary: {
          clusters: api.state.plan?.clusters ?? [],
          requirementCount: api.state.requirementsIndex?.requirements.length ?? 0,
        },
      };
    },
    [api],
  );

  const dispatchClusters = useCallback(async (): Promise<RequirementMissionRunResult | null> => {
    api.goToDispatch();
    setBusy(true);
    try {
      await runMissionClusters(api);
      return buildRunResult(api.state);
    } finally {
      setBusy(false);
    }
  }, [api]);

  const materializeReviewedTasks = useCallback(async (
    options: MaterializeReviewedTasksOptions = {},
  ): Promise<RequirementMissionMaterializeResult | null> => {
    setBusy(true);
    try {
      await writeMissionToTrellis(api, {
        sourceTaskIds: options.sourceTaskIds,
        onFanoutSnapshot: options.onFanoutSnapshot,
      });
      return summarizeWriteResults(api.state.writeResults);
    } finally {
      setBusy(false);
    }
  }, [api]);

  const retryCluster = useCallback(
    async (clusterId: string) => {
      const runId = api.state.clusterRuns[clusterId]?.raw?.runId ?? null;
      if (!runId) {
        api.setGlobalError(`无法重试分组 ${clusterId}：缺少 runId。`);
        return;
      }
      await retryClusterFromRunDir(runId, clusterId, api.state, api, api.state.activeMissionId);
    },
    [api],
  );

  const hydrateClusterRun = useCallback(
    async (
      clusterId: string,
      runId: string,
      runDir: string,
      terminalStatus?: "succeeded" | "failed" | "cancelled",
    ) => {
      await hydrateClusterRunFromRunDir(
        runId,
        runDir,
        clusterId,
        api.state,
        api,
        api.state.activeMissionId,
        terminalStatus,
      );
      return buildRunResult(api.state);
    },
    [api],
  );

  const cancelCluster = useCallback(
    async (clusterId: string) => {
      const runId = api.state.clusterRuns[clusterId]?.raw?.runId ?? null;
      if (!runId) {
        api.setGlobalError(`无法中断分组 ${clusterId}：缺少 runId。`);
        return;
      }
      await cancelClusterDispatch(runId, clusterId, api.state, api, api.state.activeMissionId);
    },
    [api],
  );

  return useMemo(
    () => ({
      api,
      busy,
      state: api.state,
      plan,
      dispatchClusters,
      materializeReviewedTasks,
      retryCluster,
      cancelCluster,
      hydrateClusterRun,
    }),
    [api, busy, cancelCluster, dispatchClusters, hydrateClusterRun, materializeReviewedTasks, plan, retryCluster],
  );
}

function summarizeWriteResults(writeResults: WizardWriteResult[]): RequirementMissionMaterializeResult | null {
  if (writeResults.length === 0) return null;
  const successful = writeResults.filter((result) => !result.error);
  const failedWriteCount = writeResults.length - successful.length;
  const fanoutFailedCount = successful.reduce((count, result) => count + (result.fanoutFailedCount ?? 0), 0);
  return {
    parentTaskNames: successful.map((result) => result.parentTaskName).filter((name) => name.trim().length > 0),
    childTaskNames: successful.flatMap((result) => result.childTaskNames),
    childTasks: successful.flatMap((result) => result.childTasks),
    failedCount: failedWriteCount + fanoutFailedCount,
    fanoutFailedCount,
    fanoutSnapshot: mergeWriteResultFanoutSnapshots(successful),
  };
}

function mergeWriteResultFanoutSnapshots(results: WizardWriteResult[]): ExecutionFanoutSnapshot | null {
  const snapshots = results
    .map((result) => result.fanoutSnapshot)
    .filter((snapshot): snapshot is ExecutionFanoutSnapshot => Boolean(snapshot));
  if (snapshots.length === 0) return null;
  const failedCount = snapshots.reduce((count, snapshot) => count + snapshot.failedCount, 0);
  const doneCount = snapshots.reduce((count, snapshot) => count + snapshot.doneCount, 0);
  const totalCount = snapshots.reduce((count, snapshot) => count + snapshot.totalCount, 0);
  const workflowRunIds = [...new Set(snapshots.flatMap((snapshot) => [
    ...(snapshot.workflowRunIds ?? []),
    ...(snapshot.workflowRunId ? [snapshot.workflowRunId] : []),
  ]))];
  const status = failedCount > 0
    ? "failed"
    : snapshots.some((snapshot) => snapshot.status === "running")
      ? "running"
      : "succeeded";
  const lastSnapshot = snapshots[snapshots.length - 1]!;
  return {
    status,
    workflowRunId: workflowRunIds[0] ?? lastSnapshot.workflowRunId ?? null,
    workflowRunIds,
    totalCount,
    doneCount,
    failedCount,
    waves: snapshots.flatMap((snapshot) => snapshot.waves).map((wave, waveIndex) => ({
      ...wave,
      waveIndex,
    })),
    lifecycleStages: lastSnapshot.lifecycleStages,
    message: status === "failed"
      ? `执行链路有失败：成功 ${doneCount}，失败 ${failedCount}。`
      : lastSnapshot.message,
  };
}

function buildRunResult(state: WizardState): RequirementMissionRunResult | null {
  if (!state.prd) return null;
  const successfulRuns = Object.values(state.clusterRuns).filter((run) => (
    run.status === "succeeded" && Boolean(run.normalized)
  ));
  if (successfulRuns.length === 0) return null;
  const result = mergeClusterSplitResults(
    state.prd,
    state.context,
    successfulRuns.map((run) => ({
      clusterId: run.clusterId,
      result: run.normalized!,
    })),
    state.prdMarkdown,
  );
  return {
    result,
    clusterRuns: successfulRuns,
    allClusterRuns: Object.values(state.clusterRuns),
  };
}
