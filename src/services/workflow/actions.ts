import type { TaskItem } from "../../types";
import type { TaskStateDTO, WorkflowFacade, WorkflowRunDTO, WorkflowStage } from "../../types/workflow";

export interface AdvanceStageWithGatesResult {
  ok: boolean;
  errorMessage?: string;
}

export async function advanceStageWithGates(params: {
  facade: WorkflowFacade;
  run: WorkflowRunDTO;
  toStage: WorkflowStage;
}): Promise<AdvanceStageWithGatesResult> {
  const { facade, run, toStage } = params;
  const gate = await facade.runGateChecks({
    workflowRunId: run.workflowRunId,
    stage: run.currentStage,
  });
  if (!gate.ok) {
    return { ok: false, errorMessage: gate.error.message };
  }
  if (!gate.data.allPassed) {
    const failed = gate.data.checks.filter((check) => !check.passed).map((check) => check.gateType);
    return { ok: false, errorMessage: `当前阶段 Gate 未通过：${failed.join("、") || "未知项"}` };
  }
  const advanced = await facade.advanceStage({
    workflowRunId: run.workflowRunId,
    fromStage: run.currentStage,
    toStage,
  });
  if (!advanced.ok) {
    return { ok: false, errorMessage: advanced.error.message };
  }
  return { ok: true };
}

export async function rollbackStage(params: {
  facade: WorkflowFacade;
  run: WorkflowRunDTO;
  toStage: WorkflowStage;
}): Promise<AdvanceStageWithGatesResult> {
  const { facade, run, toStage } = params;
  const rolled = await facade.advanceStage({
    workflowRunId: run.workflowRunId,
    fromStage: run.currentStage,
    toStage,
    force: true,
    reason: "manual rollback",
  });
  if (!rolled.ok) {
    return { ok: false, errorMessage: rolled.error.message };
  }
  return { ok: true };
}

export async function retryTaskWithTemplate(params: {
  facade: WorkflowFacade;
  run: WorkflowRunDTO;
  task: TaskStateDTO;
  templateOverride: "autopilot" | "ultraqa" | "verify" | "team";
}): Promise<boolean> {
  const { facade, run, task, templateOverride } = params;
  if (!task.latestTaskRunId) return false;
  const retried = await facade.retryTask({
    workflowRunId: run.workflowRunId,
    taskId: task.taskId,
    previousTaskRunId: task.latestTaskRunId,
    templateOverride,
  });
  return retried.ok;
}

export type RunTurnTaskLifecycleResult =
  | { status: "done" }
  | { status: "blocked"; message: string }
  | { status: "execute_failed"; message: string }
  | { status: "persist_failed"; message: string };

export async function runTurnTaskLifecycle(params: {
  facade: WorkflowFacade;
  workflowRunId: string;
  taskId: string;
  templateId?: string;
  subagentType?: string;
  /** 每次批量/重试传入不同值，避免 worktree 与 Claude 会话与上一轮粘连 */
  attemptFrom?: number;
}): Promise<RunTurnTaskLifecycleResult> {
  const { facade, workflowRunId, taskId, templateId, subagentType, attemptFrom } = params;
  const run = await facade.executeTask({
    workflowRunId,
    taskId,
    templateId,
    subagentType,
    attemptFrom,
  });
  if (!run.ok) {
    return { status: "execute_failed", message: run.error.message || "执行任务失败" };
  }
  /** 引擎已在非 succeeded 时将任务标为 blocked；禁止在「执行未成功」后仍走 Gate 并 markTaskDone（默认 Gate 恒通过会误标完成）。 */
  if (run.data.status !== "succeeded") {
    const message =
      run.data.status === "aborted"
        ? "任务执行已中断"
        : run.data.status === "failed"
          ? "任务执行未成功"
          : "任务执行未结束";
    return { status: "blocked", message };
  }
  const gates = await facade.runGateChecks({
    workflowRunId,
    taskId,
  });
  if (!gates.ok) {
    const blocked = await facade.markTaskBlocked({
      workflowRunId,
      taskId,
      blockerType: "environment",
      message: gates.error.message,
    });
    if (!blocked.ok) {
      return { status: "persist_failed", message: blocked.error.message || "更新任务状态失败" };
    }
    return { status: "blocked", message: gates.error.message };
  }
  if (gates.data.allPassed) {
    const done = await facade.markTaskDone({
      workflowRunId,
      taskId,
      evidenceRefs: gates.data.checks.flatMap((check) => check.evidenceRefs),
    });
    if (!done.ok) {
      return { status: "persist_failed", message: done.error.message || "标记任务完成失败" };
    }
    return { status: "done" };
  }
  const blocked = await facade.markTaskBlocked({
    workflowRunId,
    taskId,
    blockerType: "logic",
    message: "Gate 检查未通过",
  });
  if (!blocked.ok) {
    return { status: "persist_failed", message: blocked.error.message || "更新任务状态失败" };
  }
  return { status: "blocked", message: "Gate 检查未通过" };
}

export type OmcBatchTemplateId = "autopilot" | "ultraqa" | "verify" | "team";

/** `runSplitTasksOmcBatch` 的完整返回，便于主会话写入系统摘要。 */
export interface RunSplitTasksOmcBatchResult {
  message: string;
  workflowRunId: string | null;
  taskCount: number;
  templateId: OmcBatchTemplateId;
  subagentType: string;
  concurrency: number;
  doneCount: number;
  failedCount: number;
  /** 用户在侧栏手动终止 OMC 批量；与 `WorkflowOmcBatchRuntimeDetail.abortedByUser` 对应 */
  userAborted?: boolean;
}

async function resolveOrCreateWorkflowRunId(
  facade: WorkflowFacade,
  sessionId: string,
  repositoryPath: string,
): Promise<string | null> {
  const listed = await facade.listRuns({ repositoryPath, limit: 100 });
  if (listed.ok) {
    const bound = listed.data.find((item) => item.sessionId === sessionId);
    if (bound) return bound.workflowRunId;
  }
  const created = await facade.createRun({
    sessionId,
    repositoryPath,
    taskSnapshotId: `omc-batch:${Date.now()}`,
    startStage: "implement",
  });
  return created.ok ? created.data.workflowRunId : null;
}

/**
 * 将拆分任务同步到本地工作流编排，并按 OMC 适配层在后台启动 Claude Code（oneshot，提示词含 git worktree），
 * 与 `ClaudeOmcWorkflowAdapter` + `runTurnTaskLifecycle` 路径一致。
 */
export async function runSplitTasksOmcBatch(params: {
  facade: WorkflowFacade;
  sessionId: string;
  repositoryPath: string;
  tasks: TaskItem[];
  templateId: OmcBatchTemplateId;
  subagentType?: string;
  /** 同时执行的 OMC/Claude 调用数，建议与仓库 Claude 并发槽位对齐 */
  concurrency: number;
  /** 若 UI 已持有当前会话绑定的工作流 id，可传入以避免每次 listRuns */
  boundWorkflowRunId?: string | null;
}): Promise<RunSplitTasksOmcBatchResult> {
  const { facade, sessionId, repositoryPath, tasks, templateId, subagentType } = params;
  const parallel = Math.max(1, Math.min(10, Math.floor(params.concurrency)));
  const subagentLabel = subagentType?.trim() || "executor";
  const baseMeta = (): Omit<RunSplitTasksOmcBatchResult, "message"> => ({
    workflowRunId: null,
    taskCount: tasks.length,
    templateId,
    subagentType: subagentLabel,
    concurrency: parallel,
    doneCount: 0,
    failedCount: 0,
  });

  if (tasks.length === 0) {
    return {
      message: "没有可执行的任务。",
      ...baseMeta(),
      taskCount: 0,
    };
  }
  const cachedRunId = params.boundWorkflowRunId?.trim();
  const workflowRunId =
    cachedRunId && cachedRunId.length > 0
      ? cachedRunId
      : await resolveOrCreateWorkflowRunId(facade, sessionId, repositoryPath);
  if (!workflowRunId) {
    return {
      message: "无法创建或绑定工作流运行，请稍后重试。",
      ...baseMeta(),
    };
  }
  const upserted = await facade.upsertTasks({
    workflowRunId,
    tasks: tasks.map((task) => ({
      taskId: task.id,
      title: task.title,
      dependencies: task.dependencies,
    })),
  });
  if (!upserted.ok) {
    return {
      message: upserted.error.message || "同步任务到编排失败。",
      ...baseMeta(),
      workflowRunId,
    };
  }

  const queue = tasks.slice();
  let cursor = 0;
  let doneCount = 0;
  let failedCount = 0;
  /** 为同批每条任务分配不同 attempt，驱动适配层独立 worktree + 独立 Claude Code 进程语义 */
  const batchEpoch = Date.now();
  const workers = Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const task = queue[index];
      const result = await runTurnTaskLifecycle({
        facade,
        workflowRunId,
        taskId: task.id,
        templateId,
        subagentType,
        attemptFrom: batchEpoch + index + 1,
      });
      if (result.status === "done") doneCount += 1;
      else failedCount += 1;
    }
  });
  await Promise.all(workers);
  return {
    message: `OMC 后台执行结束（git worktree + Claude Code oneshot）：成功 ${doneCount}，失败 ${failedCount}。`,
    workflowRunId,
    taskCount: tasks.length,
    templateId,
    subagentType: subagentLabel,
    concurrency: parallel,
    doneCount,
    failedCount,
  };
}
