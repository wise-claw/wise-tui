import { useEffect, useRef } from "react";
import type {
  ClaudeComposerExecuteBubbleOptions,
  ClaudeSession,
  EmployeeItem,
  PendingExecutionTask,
  WorkflowTaskItem,
} from "../types";
import {
  flushBackgroundPendingTaskQueueForSession,
  pruneBackgroundPendingTaskQueueFlushState,
  scheduleBackgroundPendingFlushAfterIdle,
  type BackgroundPendingFlushContext,
} from "../services/backgroundPendingTaskQueueFlush";
import { subscribeSessionTurns, getActiveSessionTurnIdsSnapshot } from "../stores/sessionTurnStore";
import { getOmcDirectBatchPipelineBusySnapshot, subscribeOmcDirectBatchInvocations } from "../stores/omcDirectBatchInvocationsStore";

function isSessionActiveStatus(status: ClaudeSession["status"]): boolean {
  return status === "running" || status === "connecting";
}

export interface UseBackgroundPendingTaskQueueFlushInput {
  sessions: readonly ClaudeSession[];
  employees?: readonly EmployeeItem[];
  workflowTasks?: readonly WorkflowTaskItem[];
  taskPendingEmployeesByTaskId?: Readonly<
    Record<string, ReadonlyArray<{ employeeId: string; name: string }>>
  >;
  workflowGraphStatusByWorkflowId?: Readonly<Record<string, string>>;
  omcBatchPipelineActive?: boolean;
  onExecute: (
    sessionId: string,
    prompt: string,
    dispatchTarget?: Pick<
      PendingExecutionTask,
      "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName"
    >,
    executeOptions?: ClaudeComposerExecuteBubbleOptions,
  ) => boolean | void | Promise<boolean | void>;
}

/**
 * 为「当前无 ClaudeChat owner」的会话在空闲后继续消费待执行队列。
 * 解决：切到其它会话 / 多屏离屏壳替换完整聊天后，队列不再自动出队直至丢失体感。
 */
export function useBackgroundPendingTaskQueueFlush({
  sessions,
  employees = [],
  workflowTasks = [],
  taskPendingEmployeesByTaskId = {},
  workflowGraphStatusByWorkflowId = {},
  omcBatchPipelineActive = false,
  onExecute,
}: UseBackgroundPendingTaskQueueFlushInput): void {
  const prevActiveByIdRef = useRef<Map<string, boolean>>(new Map());
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const onExecuteRef = useRef(onExecute);
  onExecuteRef.current = onExecute;
  const employeesRef = useRef(employees);
  employeesRef.current = employees;
  const workflowTasksRef = useRef(workflowTasks);
  workflowTasksRef.current = workflowTasks;
  const taskPendingRef = useRef(taskPendingEmployeesByTaskId);
  taskPendingRef.current = taskPendingEmployeesByTaskId;
  const workflowStatusRef = useRef(workflowGraphStatusByWorkflowId);
  workflowStatusRef.current = workflowGraphStatusByWorkflowId;
  const omcBatchRef = useRef(omcBatchPipelineActive);
  omcBatchRef.current = omcBatchPipelineActive;

  const buildCtx = (): BackgroundPendingFlushContext => ({
    sessions: sessionsRef.current,
    employees: employeesRef.current,
    workflowTasks: workflowTasksRef.current,
    taskPendingEmployeesByTaskId: taskPendingRef.current,
    workflowGraphStatusByWorkflowId: workflowStatusRef.current,
    omcMonitorPipelineBusy:
      omcBatchRef.current || getOmcDirectBatchPipelineBusySnapshot(),
    onExecute: (...args) => onExecuteRef.current(...args),
  });

  const flushSafely = (session: ClaudeSession, ctx: BackgroundPendingFlushContext) => {
    void flushBackgroundPendingTaskQueueForSession(session, ctx).catch((error) => {
      console.error("Background pending task queue flush failed:", error);
    });
  };

  useEffect(() => {
    // 挂载时回收：应用重启 / 切仓后已空闲但仍有积压队列的会话。
    const ctx = buildCtx();
    for (const session of sessionsRef.current) {
      if (isSessionActiveStatus(session.status)) continue;
      flushSafely(session, ctx);
    }
  }, []);

  useEffect(() => {
    const prev = prevActiveByIdRef.current;
    const next = new Map<string, boolean>();
    const ctx = buildCtx();
    pruneBackgroundPendingTaskQueueFlushState(new Set(sessions.map((session) => session.id)));

    for (const session of sessions) {
      const active = isSessionActiveStatus(session.status);
      next.set(session.id, active);
      const wasActive = prev.get(session.id);
      if (wasActive === true && !active) {
        scheduleBackgroundPendingFlushAfterIdle(session, ctx);
      }
    }

    prevActiveByIdRef.current = next;
  }, [sessions]);

  useEffect(() => {
    let prevTurns = getActiveSessionTurnIdsSnapshot();
    return subscribeSessionTurns(() => {
      const nextTurns = getActiveSessionTurnIdsSnapshot();
      const ended: string[] = [];
      for (const id of prevTurns) {
        if (!nextTurns.has(id)) ended.push(id);
      }
      prevTurns = nextTurns;
      if (ended.length === 0) return;
      const ctx = buildCtx();
      const byId = new Map(sessionsRef.current.map((s) => [s.id, s]));
      for (const id of ended) {
        const session = byId.get(id);
        if (!session || isSessionActiveStatus(session.status)) continue;
        flushSafely(session, ctx);
      }
    });
  }, []);

  useEffect(() => {
    return subscribeOmcDirectBatchInvocations(() => {
      const ctx = buildCtx();
      for (const session of sessionsRef.current) {
        if (isSessionActiveStatus(session.status)) continue;
        flushSafely(session, ctx);
      }
    });
  }, []);
}
