import type { TaskItem, TaskRole } from "../../types";
import type { RunSplitTasksOmcBatchResult } from "../workflow/actions";
import type { WorkflowFacade } from "../../types/workflow";
import type { WriteClusterTasksOutput } from "./trellisWriter";
import { TRELLIS_BATCH_TEMPLATE_ID } from "../../constants/omcBatchTemplates";
import { runSplitTasksOmcBatch } from "../workflow/actions";

export type ExecutionFanoutTaskStatus = "waiting" | "running" | "succeeded" | "failed";
export type ExecutionFanoutWaveStatus = "waiting" | "running" | "succeeded" | "failed";
export type ExecutionFanoutLoopStageKey = "dispatch" | "run" | "verify" | "spec";
export type ExecutionFanoutLoopStageStatus = "waiting" | "active" | "done" | "failed";
export type ExecutionFanoutBatchStage = "implement" | "check";

export interface ExecutionFanoutLoopStageSnapshot {
  key: ExecutionFanoutLoopStageKey;
  label: string;
  status: ExecutionFanoutLoopStageStatus;
  message?: string;
}

export interface ExecutionFanoutTaskSnapshot {
  sourceTaskId: string;
  workflowTaskId: string;
  title: string;
  status: ExecutionFanoutTaskStatus;
  taskName: string | null;
  taskPath: string | null;
  activeTaskPath: string | null;
  message?: string;
}

export interface ExecutionFanoutWaveSnapshot {
  waveIndex: number;
  status: ExecutionFanoutWaveStatus;
  tasks: ExecutionFanoutTaskSnapshot[];
}

export interface ExecutionFanoutSnapshot {
  status: "idle" | "running" | "succeeded" | "failed";
  workflowRunId: string | null;
  workflowRunIds?: string[];
  totalCount: number;
  doneCount: number;
  failedCount: number;
  verifyDoneCount?: number;
  verifyFailedCount?: number;
  waves: ExecutionFanoutWaveSnapshot[];
  lifecycleStages?: ExecutionFanoutLoopStageSnapshot[];
  message?: string;
}

export interface ExecutionFanoutResult extends ExecutionFanoutSnapshot {
  materializedResult: WriteClusterTasksOutput;
}

export interface ExecutionFanoutWaveRun {
  waveIndex: number;
  taskIds: string[];
  workflowTasks: TaskItem[];
}

interface MaterializedTaskForExecution {
  sourceTask: TaskItem;
  workflowTask: TaskItem;
  taskName: string;
  taskPath: string;
  activeTaskPath: string;
}

export type RunWaveBatch = (params: {
  tasks: TaskItem[];
  waveIndex: number;
  executionItems: MaterializedTaskForExecution[];
  boundWorkflowRunId: string | null;
  stage: ExecutionFanoutBatchStage;
  subagentType: string;
}) => Promise<RunSplitTasksOmcBatchResult>;

export interface RunMaterializedSplitTasksFanoutInput {
  facade: WorkflowFacade;
  sessionId: string;
  repositoryPath: string;
  projectRootPath: string;
  sourceTasks: TaskItem[];
  materializedResult: WriteClusterTasksOutput;
  parallelGroups: string[][];
  subagentType?: string;
  verifyAfterRun?: boolean;
  verifySubagentType?: string;
  repositoryMetadata?: {
    ownerRepositoryId?: number;
    ownerRepositoryName?: string;
    ownerRepositoryPath?: string;
    repositoryType?: TaskRole;
  };
  onSnapshot?: (snapshot: ExecutionFanoutSnapshot) => void;
  runWaveBatch?: RunWaveBatch;
  runVerifyBatch?: RunWaveBatch;
}

export function buildMaterializedExecutionWaves(input: {
  projectRootPath: string;
  sourceTasks: TaskItem[];
  materializedResult: WriteClusterTasksOutput;
  parallelGroups: string[][];
}): ExecutionFanoutWaveRun[] {
  const executionItems = buildMaterializedExecutionItems(input);
  const bySourceId = new Map(executionItems.map((item) => [item.sourceTask.id, item]));
  const used = new Set<string>();
  const waves: ExecutionFanoutWaveRun[] = [];
  const addWave = (ids: string[]) => {
    const items = ids
      .map((id) => bySourceId.get(id))
      .filter((item): item is MaterializedTaskForExecution => Boolean(item));
    if (items.length === 0) return;
    for (const item of items) used.add(item.sourceTask.id);
    waves.push({
      waveIndex: waves.length,
      taskIds: items.map((item) => item.sourceTask.id),
      workflowTasks: items.map((item) => item.workflowTask),
    });
  };

  for (const group of input.parallelGroups) {
    addWave(group.filter((id) => bySourceId.has(id) && !used.has(id)));
  }
  addWave(executionItems.map((item) => item.sourceTask.id).filter((id) => !used.has(id)));
  return waves;
}

export async function runMaterializedSplitTasksFanout(
  input: RunMaterializedSplitTasksFanoutInput,
): Promise<ExecutionFanoutResult> {
  const executionItems = buildMaterializedExecutionItems(input);
  assertAllSourceTasksMaterialized(input, executionItems);
  const itemBySourceId = new Map(executionItems.map((item) => [item.sourceTask.id, item]));
  const waves = buildMaterializedExecutionWaves(input);
  let workflowRunId: string | null = null;
  const workflowRunIds = new Set<string>();
  let doneCount = 0;
  let failedCount = 0;
  let verifyDoneCount = 0;
  let verifyFailedCount = 0;
  let waveSnapshots = buildInitialWaveSnapshots(waves, itemBySourceId);
  const implementSubagentType = input.subagentType?.trim() || "trellis-implement";
  const verifySubagentType = input.verifySubagentType?.trim() || "trellis-check";

  const emit = (
    patch?: Partial<ExecutionFanoutSnapshot>,
    activeStage: ExecutionFanoutLoopStageKey = "run",
  ) => {
    const failed = failedCount > 0;
    const complete = doneCount + failedCount >= executionItems.length;
    const baseStatus: ExecutionFanoutSnapshot["status"] = failed ? "failed" : complete ? "succeeded" : "running";
    const snapshotStatus = patch?.status ?? baseStatus;
    const snapshot: ExecutionFanoutSnapshot = {
      status: snapshotStatus,
      workflowRunId,
      workflowRunIds: Array.from(workflowRunIds),
      totalCount: executionItems.length,
      doneCount,
      failedCount,
      verifyDoneCount,
      verifyFailedCount,
      waves: waveSnapshots,
      lifecycleStages: buildExecutionFanoutLoopStages(snapshotStatus, activeStage),
      ...patch,
    };
    input.onSnapshot?.(snapshot);
    return snapshot;
  };

  emit(undefined, "dispatch");
  for (const wave of waves) {
    waveSnapshots = setWaveStatus(waveSnapshots, wave.waveIndex, "running");
    waveSnapshots = setWaveTaskStatus(waveSnapshots, wave.waveIndex, new Set(wave.taskIds), "running");
    emit({ message: `正在派发第 ${wave.waveIndex + 1} 波。` }, "run");

    const items = wave.taskIds.map((sourceId) => itemBySourceId.get(sourceId)).filter((item): item is MaterializedTaskForExecution => Boolean(item));
    const batch = await runFanoutBatch(input, input.runWaveBatch, {
      tasks: wave.workflowTasks,
      waveIndex: wave.waveIndex,
      executionItems: items,
      boundWorkflowRunId: workflowRunId,
      stage: "implement",
      subagentType: implementSubagentType,
    });

    workflowRunId = batch.workflowRunId ?? workflowRunId;
    if (batch.workflowRunId) workflowRunIds.add(batch.workflowRunId);
    doneCount += batch.doneCount;
    failedCount += batch.failedCount;
    const waveStatus: ExecutionFanoutWaveStatus = batch.failedCount > 0 ? "failed" : "succeeded";
    waveSnapshots = setWaveStatus(waveSnapshots, wave.waveIndex, waveStatus);
    waveSnapshots = setWaveTaskStatus(
      waveSnapshots,
      wave.waveIndex,
      new Set(wave.taskIds),
      batch.failedCount > 0 ? "failed" : "succeeded",
      batch.message,
    );
    emit({ message: batch.message }, "run");
    if (batch.failedCount > 0) break;
  }

  if (failedCount === 0 && input.verifyAfterRun) {
    emit({
      status: "running",
      message: `实现运行完成：成功 ${doneCount}，失败 0。正在启动 trellis-check 校验。`,
    }, "verify");
    const verifyBatch = await runFanoutBatch(input, input.runVerifyBatch, {
      tasks: executionItems.map((item) => item.workflowTask),
      waveIndex: waves.length,
      executionItems,
      boundWorkflowRunId: workflowRunId,
      stage: "check",
      subagentType: verifySubagentType,
    });
    workflowRunId = verifyBatch.workflowRunId ?? workflowRunId;
    if (verifyBatch.workflowRunId) workflowRunIds.add(verifyBatch.workflowRunId);
    verifyDoneCount = verifyBatch.doneCount;
    verifyFailedCount = verifyBatch.failedCount;
    const verifiedSnapshot = emit({
      status: verifyFailedCount > 0 ? "failed" : "succeeded",
      message: verifyFailedCount > 0
        ? `校验失败：通过 ${verifyDoneCount}，失败 ${verifyFailedCount}。Spec 反哺保持等待。`
        : `校验完成：通过 ${verifyDoneCount}，失败 0。等待 Spec 反哺。`,
    }, verifyFailedCount > 0 ? "verify" : "spec");
    return {
      ...verifiedSnapshot,
      materializedResult: input.materializedResult,
    };
  }

  const finalSnapshot = emit({
    status: failedCount > 0 ? "failed" : "succeeded",
    message: failedCount > 0
      ? `执行 fan-out 已停止：成功 ${doneCount}，失败 ${failedCount}。`
      : `实现运行完成：成功 ${doneCount}，失败 0。等待主会话进入校验与 Spec 反哺。`,
  }, failedCount > 0 ? "run" : "verify");
  return {
    ...finalSnapshot,
    materializedResult: input.materializedResult,
  };
}

async function runFanoutBatch(
  input: RunMaterializedSplitTasksFanoutInput,
  overrideBatch: RunWaveBatch | undefined,
  params: Parameters<RunWaveBatch>[0],
): Promise<RunSplitTasksOmcBatchResult> {
  if (overrideBatch) return overrideBatch(params);
  return runSplitTasksOmcBatch({
    facade: input.facade,
    sessionId: input.sessionId,
    repositoryPath: input.repositoryPath,
    tasks: params.tasks,
    templateId: TRELLIS_BATCH_TEMPLATE_ID,
    subagentType: params.subagentType,
    executionMetadata: {
      ownerKind: "repository",
      ...(input.repositoryMetadata ?? {}),
      stage: params.stage,
      subagentType: params.subagentType,
      parentTaskName: input.materializedResult.parentTaskName,
      waveIndex: params.waveIndex,
    },
    executionMetadataByTaskId: Object.fromEntries(params.executionItems.map((item) => [item.workflowTask.id, {
      activeTaskPath: item.activeTaskPath,
      sourceTaskId: item.sourceTask.id,
      childTaskName: item.taskName,
    }])),
    concurrency: Math.max(1, params.tasks.length),
    boundWorkflowRunId: params.boundWorkflowRunId,
  });
}

export function buildExecutionFanoutLoopStages(
  status: ExecutionFanoutSnapshot["status"],
  activeStage: ExecutionFanoutLoopStageKey,
): ExecutionFanoutLoopStageSnapshot[] {
  const order: Array<Pick<ExecutionFanoutLoopStageSnapshot, "key" | "label">> = [
    { key: "dispatch", label: "Dispatch" },
    { key: "run", label: "Run" },
    { key: "verify", label: "Verify" },
    { key: "spec", label: "Spec" },
  ];
  const activeIndex = order.findIndex((stage) => stage.key === activeStage);
  return order.map((stage, index) => {
    let stageStatus: ExecutionFanoutLoopStageStatus = index < activeIndex ? "done" : index === activeIndex ? "active" : "waiting";
    if (status === "failed" && stage.key === activeStage) stageStatus = "failed";
    if (status === "succeeded" && stage.key === "run") stageStatus = "done";
    return {
      ...stage,
      status: stageStatus,
      message: loopStageMessage(stage.key, stageStatus),
    };
  });
}

function loopStageMessage(
  stage: ExecutionFanoutLoopStageKey,
  status: ExecutionFanoutLoopStageStatus,
): string {
  if (stage === "dispatch") return status === "done" ? "任务已派发" : "写入并派发任务";
  if (stage === "run") return status === "done" ? "实现运行完成" : status === "failed" ? "实现运行失败" : "实现运行中";
  if (stage === "verify") {
    if (status === "done") return "校验完成";
    if (status === "failed") return "校验失败";
    return status === "active" ? "校验接续中" : "等待校验";
  }
  return status === "active" ? "Spec 反哺中" : "等待反哺";
}

function assertAllSourceTasksMaterialized(
  input: Pick<RunMaterializedSplitTasksFanoutInput, "sourceTasks" | "materializedResult">,
  executionItems: MaterializedTaskForExecution[],
) {
  const mappedSourceIds = new Set(executionItems.map((item) => item.sourceTask.id));
  const missingIds = input.sourceTasks
    .map((task) => task.id)
    .filter((id) => !mappedSourceIds.has(id));
  if (missingIds.length === 0) return;
  const materializedIds = input.materializedResult.childTasks.map((task) => task.sourceTaskId).join(", ") || "none";
  throw new Error(
    `Materialized task output is missing Trellis paths for source task ids: ${missingIds.join(", ")}. ` +
    `Materialized source ids: ${materializedIds}.`,
  );
}

function buildMaterializedExecutionItems(input: {
  projectRootPath: string;
  sourceTasks: TaskItem[];
  materializedResult: WriteClusterTasksOutput;
}): MaterializedTaskForExecution[] {
  const materializedBySourceId = new Map(input.materializedResult.childTasks.map((task) => [task.sourceTaskId, task]));
  const activePathBySourceId = new Map<string, string>();
  for (const task of input.sourceTasks) {
    const materialized = materializedBySourceId.get(task.id);
    if (!materialized) continue;
    activePathBySourceId.set(task.id, toTrellisTaskRef(input.projectRootPath, materialized.taskPath));
  }

  return input.sourceTasks.flatMap((sourceTask) => {
    const materialized = materializedBySourceId.get(sourceTask.id);
    const activeTaskPath = activePathBySourceId.get(sourceTask.id);
    if (!materialized || !activeTaskPath) return [];
    const dependencies = sourceTask.dependencies
      .map((dependencyId) => activePathBySourceId.get(dependencyId))
      .filter((dependency): dependency is string => Boolean(dependency));
    const workflowTask: TaskItem = {
      ...sourceTask,
      id: activeTaskPath,
      dependencies,
      splitSourceTaskId: sourceTask.id,
    };
    return [{
      sourceTask,
      workflowTask,
      taskName: materialized.taskName,
      taskPath: materialized.taskPath,
      activeTaskPath,
    }];
  });
}

function buildInitialWaveSnapshots(
  waves: ExecutionFanoutWaveRun[],
  itemBySourceId: Map<string, MaterializedTaskForExecution>,
): ExecutionFanoutWaveSnapshot[] {
  return waves.map((wave) => ({
    waveIndex: wave.waveIndex,
    status: "waiting",
    tasks: wave.taskIds
      .map((sourceTaskId) => itemBySourceId.get(sourceTaskId))
      .filter((item): item is MaterializedTaskForExecution => Boolean(item))
      .map((item) => ({
        sourceTaskId: item.sourceTask.id,
        workflowTaskId: item.workflowTask.id,
        title: item.sourceTask.title,
        status: "waiting",
        taskName: item.taskName,
        taskPath: item.taskPath,
        activeTaskPath: item.activeTaskPath,
      })),
  }));
}

function setWaveStatus(
  waves: ExecutionFanoutWaveSnapshot[],
  waveIndex: number,
  status: ExecutionFanoutWaveStatus,
): ExecutionFanoutWaveSnapshot[] {
  return waves.map((wave) => (wave.waveIndex === waveIndex ? { ...wave, status } : wave));
}

function setWaveTaskStatus(
  waves: ExecutionFanoutWaveSnapshot[],
  waveIndex: number,
  sourceTaskIds: Set<string>,
  status: ExecutionFanoutTaskStatus,
  message?: string,
): ExecutionFanoutWaveSnapshot[] {
  return waves.map((wave) => {
    if (wave.waveIndex !== waveIndex) return wave;
    return {
      ...wave,
      tasks: wave.tasks.map((task) => (
        sourceTaskIds.has(task.sourceTaskId) ? { ...task, status, message } : task
      )),
    };
  });
}

function toTrellisTaskRef(projectRootPath: string, taskPath: string): string {
  const root = normalizePath(projectRootPath);
  const task = normalizePath(taskPath);
  if (root && task.startsWith(`${root}/`)) return task.slice(root.length + 1);
  const marker = "/.trellis/tasks/";
  const markerIndex = task.indexOf(marker);
  if (markerIndex >= 0) return task.slice(markerIndex + 1);
  return task;
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}
