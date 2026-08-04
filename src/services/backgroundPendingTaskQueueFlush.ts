import type {
  ClaudeComposerExecuteBubbleOptions,
  ClaudeSession,
  EmployeeItem,
  PendingExecutionTask,
  WorkflowTaskItem,
} from "../types";
import { OMC_MONITOR_EMPLOYEE_NAME } from "../constants/omcMonitor";
import { message } from "antd";
import {
  readDeferredSendNext,
  readPendingTaskQueue,
  writeDeferredSendNext,
  writePendingTaskQueue,
} from "./pendingTaskQueueStore";
import { hasPendingTaskQueueOwner } from "../stores/pendingTaskQueueOwnerStore";
import { hasActiveSessionTurn } from "../stores/sessionTurnStore";
import {
  findDispatchableHeadTasksPerLane,
  pendingTaskExecutorLaneKey,
} from "../utils/pendingQueueLanes";
import { extractBoundEmployeeNameFromDisplay } from "../utils/sessionOwnerHints";
import { createDispatchFailureTracker } from "../hooks/dispatchFailureTracker";

/** 与 claudeChatHelpers.extractEmployeeNameFromBracketPreview 同语义，避免 service→component 依赖。 */
function extractEmployeeNameFromBracketPreview(preview: string | undefined): string | null {
  if (!preview?.trim()) return null;
  const marker = "员工:";
  const open = preview.indexOf("[");
  const close = preview.indexOf("]", open + 1);
  if (open < 0 || close <= open) return null;
  const inner = preview.slice(open + 1, close);
  const idx = inner.lastIndexOf(marker);
  if (idx < 0) return null;
  const value = inner.slice(idx + marker.length).trim();
  return value || null;
}

export const POST_IDLE_BACKGROUND_PENDING_DISPATCH_DELAY_MS = 500;

export type BackgroundPendingExecute = (
  sessionId: string,
  prompt: string,
  dispatchTarget?: Pick<
    PendingExecutionTask,
    "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName"
  >,
  executeOptions?: ClaudeComposerExecuteBubbleOptions,
) => boolean | void | Promise<boolean | void>;

export interface BackgroundPendingFlushContext {
  sessions: readonly ClaudeSession[];
  employees: readonly EmployeeItem[];
  workflowTasks: readonly WorkflowTaskItem[];
  taskPendingEmployeesByTaskId: Readonly<
    Record<string, ReadonlyArray<{ employeeId: string; name: string }>>
  >;
  workflowGraphStatusByWorkflowId: Readonly<Record<string, string>>;
  omcMonitorPipelineBusy: boolean;
  onExecute: BackgroundPendingExecute;
}

const inFlightLanesBySession = new Map<string, Set<string>>();
const failureTrackersBySession = new Map<string, ReturnType<typeof createDispatchFailureTracker>>();
const holdUntilBySession = new Map<string, number>();
const holdTimersBySession = new Map<string, ReturnType<typeof setTimeout>>();
const sessionFlushChain = new Map<string, Promise<void>>();

function failureTrackerFor(sessionId: string) {
  let tracker = failureTrackersBySession.get(sessionId);
  if (!tracker) {
    tracker = createDispatchFailureTracker();
    failureTrackersBySession.set(sessionId, tracker);
  }
  return tracker;
}

function inFlightLanesFor(sessionId: string): Set<string> {
  let lanes = inFlightLanesBySession.get(sessionId);
  if (!lanes) {
    lanes = new Set();
    inFlightLanesBySession.set(sessionId, lanes);
  }
  return lanes;
}

function clearHoldTimer(sessionId: string): void {
  const timer = holdTimersBySession.get(sessionId);
  if (timer != null) {
    clearTimeout(timer);
    holdTimersBySession.delete(sessionId);
  }
}

export function shouldSkipBackgroundPendingFlush(session: Pick<ClaudeSession, "id" | "status">): boolean {
  if (hasPendingTaskQueueOwner(session.id)) return true;
  if (hasActiveSessionTurn(session.id)) return true;
  if (session.status === "running" || session.status === "connecting") return true;
  return false;
}

function isEmployeeIdle(
  employeeName: string | undefined,
  ctx: BackgroundPendingFlushContext,
  repositoryPath: string,
): boolean {
  const normalized = employeeName?.trim();
  if (!normalized) return true;
  const employee = ctx.employees.find((item) => item.name.trim() === normalized);
  if (!employee) return true;
  if (normalized === OMC_MONITOR_EMPLOYEE_NAME && ctx.omcMonitorPipelineBusy) {
    return false;
  }
  const hasRunningEmployeeSession = ctx.sessions.some((item) => {
    if (item.repositoryPath !== repositoryPath) return false;
    const ownerName =
      extractBoundEmployeeNameFromDisplay(item.repositoryName ?? "") ??
      extractEmployeeNameFromBracketPreview(item.diskPreview);
    if (!ownerName || ownerName.trim() !== normalized) return false;
    return item.status === "running" || item.status === "connecting";
  });
  if (hasRunningEmployeeSession) return false;
  return !ctx.workflowTasks.some((task) => {
    if (task.status !== "in_progress") return false;
    return (ctx.taskPendingEmployeesByTaskId[task.id] ?? []).some(
      (pending) => pending.employeeId === employee.id,
    );
  });
}

function isTeamIdle(workflowId: string | undefined, ctx: BackgroundPendingFlushContext): boolean {
  const targetWorkflowId = workflowId?.trim();
  if (!targetWorkflowId) return true;
  const status = (ctx.workflowGraphStatusByWorkflowId[targetWorkflowId] ?? "").toLowerCase();
  if (status !== "published") return false;
  return !ctx.workflowTasks.some(
    (task) => task.workflowId === targetWorkflowId && task.status === "in_progress",
  );
}

export function canBackgroundDispatchPendingTask(
  task: PendingExecutionTask,
  session: Pick<ClaudeSession, "id" | "status" | "repositoryPath">,
  ctx: BackgroundPendingFlushContext,
): boolean {
  const targetType = task.targetType ?? "main";
  if (targetType === "main") {
    if (hasActiveSessionTurn(session.id)) return false;
    return session.status !== "running" && session.status !== "connecting";
  }
  if (targetType === "employee") {
    return isEmployeeIdle(task.targetEmployeeName, ctx, session.repositoryPath);
  }
  if (targetType === "team") {
    return isTeamIdle(task.targetWorkflowId, ctx);
  }
  return true;
}

async function persistQueue(
  sessionId: string,
  repositoryPath: string,
  tasks: PendingExecutionTask[],
): Promise<void> {
  await writePendingTaskQueue(sessionId, repositoryPath, tasks);
}

async function dispatchOne(
  session: ClaudeSession,
  task: PendingExecutionTask,
  ctx: BackgroundPendingFlushContext,
  queueSnapshot: PendingExecutionTask[],
): Promise<PendingExecutionTask[]> {
  const laneKey = pendingTaskExecutorLaneKey(task);
  const lanes = inFlightLanesFor(session.id);
  if (lanes.has(laneKey)) return queueSnapshot;
  lanes.add(laneKey);

  const failureFp = `${task.targetType ?? "main"}|${task.targetEmployeeName ?? ""}|${task.targetWorkflowId ?? ""}|${task.promptText}`;
  let nextQueue = queueSnapshot.filter((row) => row.id !== task.id);

  try {
    const started = await Promise.resolve(
      ctx.onExecute(
        session.id,
        task.promptText,
        {
          targetType: task.targetType,
          targetEmployeeName: task.targetEmployeeName,
          targetWorkflowId: task.targetWorkflowId,
          targetWorkflowName: task.targetWorkflowName,
        },
        task.executeBubbleOptions,
      ),
    );
    if (started === false) {
      // 未真正派发：任务留在队列，等下次条件变化再试。
      nextQueue = queueSnapshot;
      return nextQueue;
    }
    failureTrackerFor(session.id).onSuccess(failureFp);
    await persistQueue(session.id, session.repositoryPath, nextQueue);
    return nextQueue;
  } catch (error) {
    console.error("Background pending task dispatch failed:", error);
    const outcome = failureTrackerFor(session.id).onFailure(failureFp);
    if (outcome.action === "drop") {
      await persistQueue(session.id, session.repositoryPath, nextQueue);
      void message.error(
        `后台会话任务连续分发失败 ${outcome.count} 次，已从队列移除，请检查执行环境后重试。`,
      );
      return nextQueue;
    }
    // 退避重入队：先落盘去掉旧 id，再延迟写回新条目（由调用方 schedule）。
    await persistQueue(session.id, session.repositoryPath, nextQueue);
    window.setTimeout(() => {
      void (async () => {
        if (hasPendingTaskQueueOwner(session.id)) return;
        const latest = await readPendingTaskQueue(session.id, session.repositoryPath);
        const requeued: PendingExecutionTask = {
          ...task,
          id: `ptq_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          createdAt: Date.now(),
        };
        await persistQueue(session.id, session.repositoryPath, [...latest, requeued]);
        void flushBackgroundPendingTaskQueueForSession(session, ctx);
      })();
    }, outcome.backoffMs);
    return nextQueue;
  } finally {
    lanes.delete(laneKey);
  }
}

/**
 * 对无 UI owner 的空闲会话尝试出队。
 * 与 ClaudeChat 前台 flush 互斥（owner / turn / status 门闸）。
 */
export async function flushBackgroundPendingTaskQueueForSession(
  session: ClaudeSession,
  ctx: BackgroundPendingFlushContext,
): Promise<void> {
  const sessionId = session.id.trim();
  if (!sessionId) return;

  const prev = sessionFlushChain.get(sessionId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      if (shouldSkipBackgroundPendingFlush(session)) return;

      if (session.status === "error" || session.status === "cancelled") {
        const deferred = await readDeferredSendNext(sessionId, session.repositoryPath);
        if (deferred) {
          await writeDeferredSendNext(sessionId, session.repositoryPath, false);
        }
        return;
      }

      const deferred = await readDeferredSendNext(sessionId, session.repositoryPath);
      let tasks = await readPendingTaskQueue(sessionId, session.repositoryPath);
      if (tasks.length === 0) {
        if (deferred) {
          await writeDeferredSendNext(sessionId, session.repositoryPath, false);
        }
        return;
      }

      if (deferred) {
        await writeDeferredSendNext(sessionId, session.repositoryPath, false);
      }

      const holdUntil = holdUntilBySession.get(sessionId) ?? 0;
      const holdDelay = Math.max(0, holdUntil - Date.now());
      if (holdDelay > 0) {
        clearHoldTimer(sessionId);
        holdTimersBySession.set(
          sessionId,
          setTimeout(() => {
            holdTimersBySession.delete(sessionId);
            void flushBackgroundPendingTaskQueueForSession(session, ctx);
          }, holdDelay),
        );
        return;
      }
      clearHoldTimer(sessionId);

      const dispatchable = findDispatchableHeadTasksPerLane(tasks, (task) =>
        canBackgroundDispatchPendingTask(task, session, ctx),
      );
      if (dispatchable.length === 0) return;

      for (const task of dispatchable) {
        if (shouldSkipBackgroundPendingFlush(session)) return;
        if (hasActiveSessionTurn(sessionId)) return;
        tasks = await dispatchOne(session, task, ctx, tasks);
      }
    });

  sessionFlushChain.set(sessionId, next);
  await next;
}

/** 会话刚从 running/connecting 进入空闲时调用，启动短延迟后再 flush。 */
export function scheduleBackgroundPendingFlushAfterIdle(
  session: ClaudeSession,
  ctx: BackgroundPendingFlushContext,
): void {
  if (shouldSkipBackgroundPendingFlush(session)) return;
  holdUntilBySession.set(session.id, Date.now() + POST_IDLE_BACKGROUND_PENDING_DISPATCH_DELAY_MS);
  clearHoldTimer(session.id);
  holdTimersBySession.set(
    session.id,
    setTimeout(() => {
      holdTimersBySession.delete(session.id);
      void flushBackgroundPendingTaskQueueForSession(session, ctx);
    }, POST_IDLE_BACKGROUND_PENDING_DISPATCH_DELAY_MS),
  );
}

/** @internal test helper */
export function resetBackgroundPendingTaskQueueFlushForTests(): void {
  inFlightLanesBySession.clear();
  failureTrackersBySession.clear();
  holdUntilBySession.clear();
  for (const timer of holdTimersBySession.values()) {
    clearTimeout(timer);
  }
  holdTimersBySession.clear();
  sessionFlushChain.clear();
}
