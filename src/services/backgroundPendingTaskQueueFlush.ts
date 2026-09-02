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
type RetryHandle = {
  timer: ReturnType<typeof setTimeout>;
  cancelled: boolean;
};
const retryHandlesBySession = new Map<string, Set<RetryHandle>>();
const lifecycleTokensBySession = new Map<string, object>();

function lifecycleTokenFor(sessionId: string): object {
  let token = lifecycleTokensBySession.get(sessionId);
  if (!token) {
    token = {};
    lifecycleTokensBySession.set(sessionId, token);
  }
  return token;
}

function isLifecycleCurrent(sessionId: string, token: object): boolean {
  return lifecycleTokensBySession.get(sessionId) === token;
}

function retryHandlesFor(sessionId: string): Set<RetryHandle> {
  let handles = retryHandlesBySession.get(sessionId);
  if (!handles) {
    handles = new Set();
    retryHandlesBySession.set(sessionId, handles);
  }
  return handles;
}

function releaseRetryHandle(sessionId: string, handle: RetryHandle): void {
  const handles = retryHandlesBySession.get(sessionId);
  if (!handles) return;
  handles.delete(handle);
  if (handles.size > 0) return;
  retryHandlesBySession.delete(sessionId);
  if (
    !holdTimersBySession.has(sessionId) &&
    !sessionFlushChain.has(sessionId) &&
    (inFlightLanesBySession.get(sessionId)?.size ?? 0) === 0
  ) {
    failureTrackersBySession.delete(sessionId);
    holdUntilBySession.delete(sessionId);
    lifecycleTokensBySession.delete(sessionId);
  }
}

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
  lifecycleToken: object,
): Promise<PendingExecutionTask[]> {
  if (!isLifecycleCurrent(session.id, lifecycleToken)) return queueSnapshot;
  const laneKey = pendingTaskExecutorLaneKey(task);
  const lanes = inFlightLanesFor(session.id);
  if (lanes.has(laneKey)) return queueSnapshot;
  lanes.add(laneKey);

  const failureFp = `${task.targetType ?? "main"}|${task.targetEmployeeName ?? ""}|${task.targetWorkflowId ?? ""}|${task.promptText}`;
  let nextQueue = queueSnapshot.filter((row) => row.id !== task.id);

  try {
    if (!isLifecycleCurrent(session.id, lifecycleToken)) return queueSnapshot;
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
    if (!isLifecycleCurrent(session.id, lifecycleToken)) return nextQueue;
    // 没有失败历史时无需为了 success 创建一个空 tracker 并常驻 Map。
    failureTrackersBySession.get(session.id)?.onSuccess(failureFp);
    await persistQueue(session.id, session.repositoryPath, nextQueue);
    return nextQueue;
  } catch (error) {
    // 会话可能在 onExecute 等待期间已关闭；此时不再改写其持久队列或创建重试器。
    if (!isLifecycleCurrent(session.id, lifecycleToken)) return queueSnapshot;
    console.error("Background pending task dispatch failed:", error);
    const outcome = failureTrackerFor(session.id).onFailure(failureFp);
    if (outcome.action === "drop") {
      await persistQueue(session.id, session.repositoryPath, nextQueue);
      if (!isLifecycleCurrent(session.id, lifecycleToken)) return nextQueue;
      void message.error(
        `后台会话任务连续分发失败 ${outcome.count} 次，已从队列移除，请检查执行环境后重试。`,
      );
      return nextQueue;
    }
    // 保留原任务的持久化记录，只延迟再次消费。旧实现会先删、延迟后再写回，
    // 应用退出或前台 owner 在退避期接管时会留下任务丢失窗口。
    const retryAt = Date.now() + outcome.backoffMs;
    holdUntilBySession.set(session.id, retryAt);
    const handle = { timer: 0 as unknown as ReturnType<typeof setTimeout>, cancelled: false };
    retryHandlesFor(session.id).add(handle);
    handle.timer = globalThis.setTimeout(() => {
      void (async () => {
        try {
          if (handle.cancelled || !isLifecycleCurrent(session.id, lifecycleToken)) return;
          clearHoldTimer(session.id);
          holdUntilBySession.delete(session.id);
          if (hasPendingTaskQueueOwner(session.id)) return;
          await flushBackgroundPendingTaskQueueForSession(session, ctx);
        } catch (retryError) {
          console.error("Background pending task retry failed:", retryError);
        } finally {
          releaseRetryHandle(session.id, handle);
        }
      })();
    }, outcome.backoffMs);
    return queueSnapshot;
  } finally {
    lanes.delete(laneKey);
    if (lanes.size === 0) inFlightLanesBySession.delete(session.id);
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
  const lifecycleToken = lifecycleTokenFor(sessionId);
  let queueDrained = false;

  const prev = sessionFlushChain.get(sessionId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      if (!isLifecycleCurrent(sessionId, lifecycleToken)) return;
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
      if (!isLifecycleCurrent(sessionId, lifecycleToken)) return;
      if (tasks.length === 0) {
        queueDrained = true;
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
            if (!isLifecycleCurrent(sessionId, lifecycleToken)) return;
            void flushBackgroundPendingTaskQueueForSession(session, ctx).catch((error) => {
              console.error("Background pending task delayed flush failed:", error);
            });
          }, holdDelay),
        );
        return;
      }
      holdUntilBySession.delete(sessionId);
      clearHoldTimer(sessionId);

      const dispatchable = findDispatchableHeadTasksPerLane(tasks, (task) =>
        canBackgroundDispatchPendingTask(task, session, ctx),
      );
      if (dispatchable.length === 0) return;

      for (const task of dispatchable) {
        if (!isLifecycleCurrent(sessionId, lifecycleToken)) return;
        if (shouldSkipBackgroundPendingFlush(session)) return;
        if (hasActiveSessionTurn(sessionId)) return;
        tasks = await dispatchOne(session, task, ctx, tasks, lifecycleToken);
      }
      queueDrained = tasks.length === 0;
    });

  sessionFlushChain.set(sessionId, next);
  try {
    await next;
  } finally {
    if (sessionFlushChain.get(sessionId) === next) {
      sessionFlushChain.delete(sessionId);
    }
    const hasRetries = (retryHandlesBySession.get(sessionId)?.size ?? 0) > 0;
    const hasHold = holdTimersBySession.has(sessionId);
    const hasLanes = (inFlightLanesBySession.get(sessionId)?.size ?? 0) > 0;
    if (queueDrained && !hasRetries) failureTrackersBySession.delete(sessionId);
    if (!hasRetries && !hasHold && !hasLanes && !sessionFlushChain.has(sessionId)) {
      holdUntilBySession.delete(sessionId);
      if (lifecycleTokensBySession.get(sessionId) === lifecycleToken) {
        lifecycleTokensBySession.delete(sessionId);
      }
    }
  }
}

/** 会话刚从 running/connecting 进入空闲时调用，启动短延迟后再 flush。 */
export function scheduleBackgroundPendingFlushAfterIdle(
  session: ClaudeSession,
  ctx: BackgroundPendingFlushContext,
): void {
  if (shouldSkipBackgroundPendingFlush(session)) return;
  const lifecycleToken = lifecycleTokenFor(session.id);
  holdUntilBySession.set(session.id, Date.now() + POST_IDLE_BACKGROUND_PENDING_DISPATCH_DELAY_MS);
  clearHoldTimer(session.id);
  holdTimersBySession.set(
    session.id,
    setTimeout(() => {
      holdTimersBySession.delete(session.id);
      if (!isLifecycleCurrent(session.id, lifecycleToken)) return;
      void flushBackgroundPendingTaskQueueForSession(session, ctx).catch((error) => {
        console.error("Background pending task idle flush failed:", error);
      });
    }, POST_IDLE_BACKGROUND_PENDING_DISPATCH_DELAY_MS),
  );
}

/**
 * 会话列表裁剪时取消其等待中的 hold/retry，并让已在途的异步步骤失效。
 * 底层 onExecute 若已经开始无法撤销，但之后不会再写回已关闭会话的队列。
 */
export function pruneBackgroundPendingTaskQueueFlushState(liveSessionIds: ReadonlySet<string>): void {
  const knownSessionIds = new Set<string>([
    ...inFlightLanesBySession.keys(),
    ...failureTrackersBySession.keys(),
    ...holdUntilBySession.keys(),
    ...holdTimersBySession.keys(),
    ...sessionFlushChain.keys(),
    ...retryHandlesBySession.keys(),
    ...lifecycleTokensBySession.keys(),
  ]);
  for (const sessionId of knownSessionIds) {
    if (liveSessionIds.has(sessionId)) continue;
    lifecycleTokensBySession.delete(sessionId);
    clearHoldTimer(sessionId);
    holdUntilBySession.delete(sessionId);
    const retries = retryHandlesBySession.get(sessionId);
    if (retries) {
      for (const handle of retries) {
        handle.cancelled = true;
        clearTimeout(handle.timer);
      }
      retryHandlesBySession.delete(sessionId);
    }
    inFlightLanesBySession.delete(sessionId);
    failureTrackersBySession.delete(sessionId);
    sessionFlushChain.delete(sessionId);
  }
}

/** @internal test helper */
export function getBackgroundPendingTaskQueueFlushStateForTests() {
  let retryCount = 0;
  for (const handles of retryHandlesBySession.values()) retryCount += handles.size;
  return {
    inFlightLaneSessions: inFlightLanesBySession.size,
    failureTrackers: failureTrackersBySession.size,
    holdDeadlines: holdUntilBySession.size,
    holdTimers: holdTimersBySession.size,
    flushChains: sessionFlushChain.size,
    retryCount,
    lifecycleTokens: lifecycleTokensBySession.size,
  };
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
  for (const handles of retryHandlesBySession.values()) {
    for (const handle of handles) {
      handle.cancelled = true;
      clearTimeout(handle.timer);
    }
  }
  retryHandlesBySession.clear();
  sessionFlushChain.clear();
  lifecycleTokensBySession.clear();
}
