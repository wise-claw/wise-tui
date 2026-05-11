import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { pickSessionForRepositorySidebarSelect } from "../utils/claudeSessionSelection";
import { OMC_MONITOR_EMPLOYEE_NAME } from "../constants/omcMonitor";
import {
  findLatestUserOmcDispatchPayload,
  parseOmcDispatchTaskIdFromUserText,
  parseOmcSlashCommandFromUserText,
  sessionHasOmcDispatchInAnyUserMessage,
} from "../utils/omcUserMessageText";
import { loadSessionOwnerHints } from "../utils/sessionOwnerHints";
import { isOmcBatchHistoryStubSessionId } from "../utils/omcEmployeeBatchHistory";
import type { WorkflowOmcBatchRuntimeDetail } from "../constants/workflowUiEvents";
import {
  getOmcDirectBatchInvocationsSnapshot,
  subscribeOmcDirectBatchInvocations,
} from "../stores/omcDirectBatchInvocationsStore";
import { sanitizeOmcDirectBatchPreviewLineForList } from "../utils/claudeInvocationText";
import { isOmcDirectBatchInvocationRunning } from "../utils/omcDirectBatchInvocationDisplay";
import { omcWorkerRepositoryBoundNameMatchers } from "../utils/omcMonitorEmployeeSession";
import { listRunningClaudeSessions } from "../services/claude";
import { isClaudeSessionRunningInHostOrUi } from "../services/claudeSessionState";
import type {
  ClaudeSession,
  EmployeeItem,
  EmployeeMonitorItem,
  MonitorStats,
  TeamMonitorItem,
  WorkflowGraph,
  WorkflowRuntimeStepSnapshot,
  WorkflowTaskEventItem,
  WorkflowTaskItem,
  WorkflowTemplateItem,
} from "../types";

interface UseMonitorOverviewInput {
  employees: EmployeeItem[];
  workflowTemplates: WorkflowTemplateItem[];
  workflowTasks: WorkflowTaskItem[];
  workflowGraphsByWorkflowId: Record<string, WorkflowGraph>;
  workflowTaskEventsByTaskId: Record<string, WorkflowTaskEventItem[]>;
  workflowRuntimeSnapshotsByTaskId: Record<string, WorkflowRuntimeStepSnapshot[]>;
  taskPendingEmployeesByTaskId: Record<string, Array<{ employeeId: string; name: string }>>;
  sessions: ClaudeSession[];
  omcBatchRuntime?: WorkflowOmcBatchRuntimeDetail | null;
}

interface MonitorLookup {
  employeeById: Map<string, EmployeeItem>;
  teamByWorkflowId: Map<string, WorkflowTemplateItem>;
}

interface UseMonitorOverviewResult {
  employeeMonitorItems: EmployeeMonitorItem[];
  teamMonitorItems: TeamMonitorItem[];
  stats: MonitorStats;
  lookup: MonitorLookup;
}

function truncateText(text: string, max = 60): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "暂无会话";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function extractSessionPreview(session: ClaudeSession | undefined): string {
  if (!session) return "暂无会话";
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role === "user" || msg.role === "assistant") {
      const text = msg.content.trim();
      if (text) return truncateText(text);
    }
  }
  return truncateText(session.diskPreview ?? "");
}

function extractBoundEmployeeName(repositoryName: string | undefined): string | null {
  const r = repositoryName ?? "";
  const marker = "员工:";
  const idx = r.lastIndexOf(marker);
  if (idx < 0) return null;
  const value = r.slice(idx + marker.length).trim();
  return value || null;
}

function getSessionUpdatedAt(session: ClaudeSession): number {
  const lastTs = session.messages[session.messages.length - 1]?.timestamp;
  return typeof lastTs === "number" ? lastTs : session.createdAt;
}

function findEmployeePreviewText(params: {
  activeTask: WorkflowTaskItem | undefined;
  workflowRuntimeSnapshotsByTaskId: Record<string, WorkflowRuntimeStepSnapshot[]>;
  sessionsById: Map<string, ClaudeSession>;
}): string {
  const snapshots = params.activeTask ? params.workflowRuntimeSnapshotsByTaskId[params.activeTask.id] ?? [] : [];
  const latestSnapshot = snapshots[snapshots.length - 1];
  if (latestSnapshot?.outputPreview?.trim()) return truncateText(latestSnapshot.outputPreview);
  if (latestSnapshot?.inputPreview?.trim()) return truncateText(latestSnapshot.inputPreview);
  const session = params.activeTask ? params.sessionsById.get(params.activeTask.creator) : undefined;
  return extractSessionPreview(session);
}

function extractLatestEventEmployeeId(events: WorkflowTaskEventItem[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event.payloadJson) continue;
    try {
      const payload = JSON.parse(event.payloadJson) as { employeeId?: string };
      if (typeof payload.employeeId === "string" && payload.employeeId.trim()) return payload.employeeId;
    } catch {
      // ignore malformed payload
    }
  }
  return undefined;
}

function hasLatestDispatchError(events: WorkflowTaskEventItem[]): boolean {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.eventType === "workflow_runtime_dispatch_error") {
      return true;
    }
    if (event.eventType === "workflow_runtime_snapshot") {
      return false;
    }
  }
  return false;
}

function effectiveTaskStatus(task: WorkflowTaskItem, events: WorkflowTaskEventItem[]): WorkflowTaskItem["status"] {
  if (task.status === "in_progress" && hasLatestDispatchError(events)) {
    return "rejected";
  }
  return task.status;
}

interface OmcActiveExecutionSignal {
  taskId: string;
  message: string;
  updatedAt: number;
  sessionId?: string;
}

/** 仅 OMC 工作标签或直连批量锚点主会话可贡献「会话流式」OMC 运行态，避免 @ 普通员工时误点亮侧栏 OMC 员工。 */
function sessionEligibleForOmcRuntimeSignal(
  session: ClaudeSession,
  employees: readonly EmployeeItem[],
  directBatchTaskIdBySessionId: Map<string, string>,
): boolean {
  const bound = extractBoundEmployeeName(session.repositoryName);
  if (bound?.trim()) {
    return omcWorkerRepositoryBoundNameMatchers(employees).has(bound.trim());
  }
  return directBatchTaskIdBySessionId.has(session.id);
}

/** 与 `extractOmcActiveSignal` / `extractOmcSignalFromRunningSession` 区分来源，合并时优先真实执行标签 */
type TaggedOmcSignal = OmcActiveExecutionSignal & {
  signalSource: "workflow_task" | "running_session";
};

function parseEventPayload(event: WorkflowTaskEventItem): Record<string, unknown> | null {
  if (!event.payloadJson) return null;
  try {
    return JSON.parse(event.payloadJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractOmcActiveSignal(task: WorkflowTaskItem, events: WorkflowTaskEventItem[]): OmcActiveExecutionSignal | null {
  if (task.status !== "in_progress") return null;
  let latestRunStageAt = -1;
  let latestRunStageType: "started" | "progressed" | "finished" | null = null;
  let latestSignalMessage = "";
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (
      event.eventType !== "task.run.started" &&
      event.eventType !== "task.run.progressed" &&
      event.eventType !== "task.run.succeeded" &&
      event.eventType !== "task.run.failed" &&
      event.eventType !== "task.run.aborted"
    ) {
      continue;
    }
    const payload = parseEventPayload(event);
    const payloadTaskId = typeof payload?.taskId === "string" ? payload.taskId.trim() : "";
    if (payloadTaskId !== task.id) continue;
    latestRunStageAt = event.createdAt;
    if (event.eventType === "task.run.progressed") {
      latestRunStageType = "progressed";
      const stage = typeof payload?.stage === "string" ? payload.stage.trim() : "";
      const message = typeof payload?.message === "string" ? payload.message.trim() : "";
      latestSignalMessage = [stage, message].filter(Boolean).join(" · ") || "执行中";
    } else if (event.eventType === "task.run.started") {
      latestRunStageType = "started";
      latestSignalMessage = "已启动";
    } else {
      latestRunStageType = "finished";
      latestSignalMessage = "";
    }
    break;
  }
  if (latestRunStageAt <= 0) return null;
  if (latestRunStageType === "finished") return null;
  return {
    taskId: task.id,
    message: latestSignalMessage || "执行中",
    updatedAt: latestRunStageAt,
    sessionId: task.creator,
  };
}

function extractOmcSignalFromRunningSession(
  session: ClaudeSession,
  directBatchTaskIdBySessionId: Map<string, string>,
  employees: EmployeeItem[],
  registryRunningClaudeSessionIds: ReadonlySet<string>,
): OmcActiveExecutionSignal | null {
  if (isOmcBatchHistoryStubSessionId(session.id)) return null;
  if (!isClaudeSessionRunningInHostOrUi(session, registryRunningClaudeSessionIds)) return null;
  if (!sessionEligibleForOmcRuntimeSignal(session, employees, directBatchTaskIdBySessionId)) return null;
  const hit = findLatestUserOmcDispatchPayload(session);
  if (!hit) return null;
  const command = parseOmcSlashCommandFromUserText(hit.text) ?? "OMC";
  let taskId = parseOmcDispatchTaskIdFromUserText(hit.text);
  if (taskId === "unknown-task") {
    const hinted = directBatchTaskIdBySessionId.get(session.id)?.trim();
    if (hinted) taskId = hinted;
  }
  return {
    taskId,
    message: `${command} · 后台执行中`,
    updatedAt: Math.max(hit.timestamp, getSessionUpdatedAt(session)),
    sessionId: session.id,
  };
}

/** 将 workflow / 流里带的 id 规范为当前标签页的 `session.id`（兼容临时 tab id 与 claudeSessionId）。 */
function resolveOmcSessionTabId(allSessions: ClaudeSession[], rawId: string | undefined): string | undefined {
  const t = rawId?.trim();
  if (!t) return undefined;
  const byId = allSessions.find((s) => s.id === t);
  if (byId) return byId.id;
  const byClaude = allSessions.find((s) => s.claudeSessionId === t);
  return byClaude?.id;
}

/** 从仍可见或可解析的信号上推断仓库路径，供无法解析到具体执行标签时回退到主会话。 */
function inferRepositoryPathForOmcJumpFallback(
  allSessions: ClaudeSession[],
  mergedSignals: OmcActiveExecutionSignal[],
  preferredSessionId: string | undefined,
  runtimeSessionId: string | undefined,
): string | undefined {
  const pathFromRawSessionRef = (raw: string | undefined): string | undefined => {
    const tabId = resolveOmcSessionTabId(allSessions, raw);
    if (!tabId) return undefined;
    return allSessions.find((s) => s.id === tabId)?.repositoryPath?.trim();
  };
  const p0 = pathFromRawSessionRef(preferredSessionId);
  if (p0) return p0;
  for (const sig of mergedSignals) {
    const p = pathFromRawSessionRef(sig.sessionId);
    if (p) return p;
  }
  return pathFromRawSessionRef(runtimeSessionId);
}

/**
 * 解析 OMC worker 监控项绑定的会话 id：优先真实执行标签；若信号 id 已失效，回退同仓库主标签。
 */
function resolveOmcWorkerBoundSessionId(
  preferredSessionId: string | undefined,
  mergedSignals: OmcActiveExecutionSignal[],
  allSessions: ClaudeSession[],
  sessionsById: Map<string, ClaudeSession>,
  repositoryPathFallback: string | undefined,
  employees: EmployeeItem[],
  directBatchTaskIdBySessionId: Map<string, string>,
  registryRunningClaudeSessionIds: ReadonlySet<string>,
): string | undefined {
  let sid = resolveOmcSessionTabId(allSessions, preferredSessionId);
  if (!sid) {
    for (const sig of mergedSignals) {
      const cand = resolveOmcSessionTabId(allSessions, sig.sessionId);
      if (cand) {
        sid = cand;
        break;
      }
    }
  }
  if (!sid) {
    const withOmcText = allSessions.filter((s) => sessionHasOmcDispatchInAnyUserMessage(s));
    const eligible = withOmcText.filter((s) =>
      sessionEligibleForOmcRuntimeSignal(s, employees, directBatchTaskIdBySessionId),
    );
    const running = eligible.filter((s) => isClaudeSessionRunningInHostOrUi(s, registryRunningClaudeSessionIds));
    const pool = running.length > 0 ? running : eligible;
    if (pool.length > 0) {
      pool.sort((a, b) => getSessionUpdatedAt(b) - getSessionUpdatedAt(a));
      sid = pool[0]!.id;
    }
  }
  const repo = repositoryPathFallback?.trim();
  if (!sid && repo) {
    const mainPick = pickSessionForRepositorySidebarSelect(allSessions, repo, loadSessionOwnerHints());
    sid = mainPick?.id;
  }
  if (!sid) {
    return undefined;
  }
  return sessionsById.has(sid) ? sid : undefined;
}

function extractOmcProgressText(
  events: WorkflowTaskEventItem[],
  active: boolean,
): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.eventType !== "task.run.progressed") continue;
    if (!event.payloadJson) continue;
    try {
      const payload = JSON.parse(event.payloadJson) as {
        stage?: string;
        message?: string;
      };
      const message = payload.message?.trim();
      const stage = payload.stage?.trim();
      if (message && stage) return `OMC · ${stage} · ${message}`;
      if (message) return `OMC · ${message}`;
      if (stage) return `OMC · ${stage}`;
    } catch {
      // ignore malformed payload
    }
  }
  if (!active) {
    return undefined;
  }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.eventType === "task.run.started") {
      return "OMC · 已启动";
    }
  }
  return undefined;
}

export function useMonitorOverview({
  employees,
  workflowTemplates,
  workflowTasks,
  workflowGraphsByWorkflowId,
  workflowTaskEventsByTaskId,
  workflowRuntimeSnapshotsByTaskId,
  taskPendingEmployeesByTaskId,
  sessions,
  omcBatchRuntime = null,
}: UseMonitorOverviewInput): UseMonitorOverviewResult {
  const [registryRunningClaudeSessionIds, setRegistryRunningClaudeSessionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => {
    let cancelled = false;
    const VISIBLE_POLL_INTERVAL_MS = 8000;
    const HIDDEN_POLL_INTERVAL_MS = 20000;
    const tick = async () => {
      try {
        const list = await listRunningClaudeSessions();
        if (cancelled) return;
        const ids = new Set(
          list
            .filter((item) => item.status === "running")
            .map((item) => item.session_id.trim())
            .filter((id) => id.length > 0),
        );
        setRegistryRunningClaudeSessionIds(ids);
      } catch {
        /* 与侧栏一致：失败时保留上一轮，避免误判闪断 */
      }
    };
    void tick();
    const intervalMs =
      typeof document !== "undefined" && document.visibilityState === "visible"
        ? VISIBLE_POLL_INTERVAL_MS
        : HIDDEN_POLL_INTERVAL_MS;
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void tick();
    }, intervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void tick();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []);

  const directBatchInvocationsSnap = useSyncExternalStore(
    subscribeOmcDirectBatchInvocations,
    getOmcDirectBatchInvocationsSnapshot,
    getOmcDirectBatchInvocationsSnapshot,
  );
  const hasRunningDirectBatchInvocationRows = directBatchInvocationsSnap.some(isOmcDirectBatchInvocationRunning);
  return useMemo(() => {
    const directBatchTaskIdBySessionId = (() => {
      const m = new Map<string, string>();
      for (const inv of directBatchInvocationsSnap) {
        if (!isOmcDirectBatchInvocationRunning(inv)) continue;
        const sid = inv.sessionId?.trim();
        const tid = inv.taskId?.trim();
        if (!sid || !tid) continue;
        m.set(sid, tid);
      }
      return m;
    })();
    const employeeById = new Map(employees.map((item) => [item.id, item] as const));
    const employeeByName = new Map(employees.map((item) => [item.name.trim(), item] as const));
    const teamEmployeeIds = new Set<string>();
    for (const template of workflowTemplates) {
      for (const stage of template.stages) {
        for (const assignee of stage.assignees) {
          if (assignee.employeeId?.trim()) {
            teamEmployeeIds.add(assignee.employeeId);
          }
        }
      }
    }
    for (const graph of Object.values(workflowGraphsByWorkflowId)) {
      for (const node of graph.nodes ?? []) {
        const employeeId = typeof node.data?.employeeId === "string" ? node.data.employeeId.trim() : "";
        if (employeeId) {
          teamEmployeeIds.add(employeeId);
        }
      }
    }
    for (const task of workflowTasks) {
      const events = workflowTaskEventsByTaskId[task.id] ?? [];
      for (const event of events) {
        if (!event.payloadJson) continue;
        try {
          const payload = JSON.parse(event.payloadJson) as { employeeId?: string };
          if (typeof payload.employeeId === "string" && payload.employeeId.trim()) {
            teamEmployeeIds.add(payload.employeeId);
          }
        } catch {
          // ignore malformed payload
        }
      }
    }
    const monitoredEmployees = employees.filter((item) => item.enabled && !teamEmployeeIds.has(item.id));
    const sessionsById = new Map(sessions.map((item) => [item.id, item] as const));
    const runningEmployeeSessionByName = new Map<string, ClaudeSession>();
    const allEmployeeSessionsByName = new Map<string, ClaudeSession[]>();
    for (const session of sessions) {
      if (isOmcBatchHistoryStubSessionId(session.id)) continue;
      const employeeName = extractBoundEmployeeName(session.repositoryName);
      if (employeeName) {
        const rows = allEmployeeSessionsByName.get(employeeName) ?? [];
        rows.push(session);
        allEmployeeSessionsByName.set(employeeName, rows);
      }
      if (!isClaudeSessionRunningInHostOrUi(session, registryRunningClaudeSessionIds)) continue;
      if (!employeeName) continue;
      const previous = runningEmployeeSessionByName.get(employeeName);
      if (!previous || getSessionUpdatedAt(session) > getSessionUpdatedAt(previous)) {
        runningEmployeeSessionByName.set(employeeName, session);
      }
    }
    const templateById = new Map(workflowTemplates.map((item) => [item.id, item] as const));

    const employeeMonitorItems: EmployeeMonitorItem[] = monitoredEmployees.map((employee) => {
      const inProgressTasksByEmployee = workflowTasks.filter((task) => {
        if (task.status !== "in_progress") return false;
        const pending = taskPendingEmployeesByTaskId[task.id] ?? [];
        if (pending.some((person) => person.employeeId === employee.id)) {
          return true;
        }
        const fallbackEmployeeId = extractLatestEventEmployeeId(workflowTaskEventsByTaskId[task.id] ?? []);
        return fallbackEmployeeId === employee.id;
      });
      const activeTask = inProgressTasksByEmployee.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const runningEmployeeSession = runningEmployeeSessionByName.get(employee.name.trim());
      const completedTasksByEmployee = workflowTasks
        .filter((task) => {
          if (task.status === "in_progress") return false;
          const pending = taskPendingEmployeesByTaskId[task.id] ?? [];
          if (pending.some((person) => person.employeeId === employee.id)) {
            return true;
          }
          const fallbackEmployeeId = extractLatestEventEmployeeId(workflowTaskEventsByTaskId[task.id] ?? []);
          return fallbackEmployeeId === employee.id;
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const latestCompletedTaskAt = completedTasksByEmployee[0]?.updatedAt;
      const latestSettledTaskStatus = completedTasksByEmployee[0]?.status;
      const employeeSessions = allEmployeeSessionsByName.get(employee.name.trim()) ?? [];
      const latestSettledSessionAt = employeeSessions
        .filter((item) => !isClaudeSessionRunningInHostOrUi(item, registryRunningClaudeSessionIds))
        .map((item) => getSessionUpdatedAt(item))
        .sort((a, b) => b - a)[0];
      const session = activeTask ? sessionsById.get(activeTask.creator) : undefined;
      const previewSession = session ?? runningEmployeeSession;
      return {
        employeeId: employee.id,
        name: employee.name,
        agentType: employee.agentType,
        status: activeTask || runningEmployeeSession ? "in_progress" : "idle",
        executionSource: activeTask ? "workflow" : runningEmployeeSession ? "employee_session" : undefined,
        latestTaskStatus: activeTask?.status ?? latestSettledTaskStatus,
        lastCompletedTaskAt:
          latestCompletedTaskAt && latestSettledSessionAt
            ? Math.max(latestCompletedTaskAt, latestSettledSessionAt)
            : latestCompletedTaskAt ?? latestSettledSessionAt,
        previewText: activeTask
          ? findEmployeePreviewText({
              activeTask,
              workflowRuntimeSnapshotsByTaskId,
              sessionsById,
            })
          : extractSessionPreview(previewSession),
        activeTaskId: activeTask?.id,
        sessionId: activeTask?.creator ?? runningEmployeeSession?.id,
        repositoryPath: previewSession?.repositoryPath,
        repositoryName: previewSession?.repositoryName,
        updatedAt: activeTask?.updatedAt ?? (previewSession ? getSessionUpdatedAt(previewSession) : employee.updatedAt),
      };
    });

    const omcTaskSignals: TaggedOmcSignal[] = workflowTasks
      .map((task) => extractOmcActiveSignal(task, workflowTaskEventsByTaskId[task.id] ?? []))
      .filter((item): item is OmcActiveExecutionSignal => Boolean(item))
      .map((item) => ({ ...item, signalSource: "workflow_task" as const }));
    const omcRunningSessionSignals: TaggedOmcSignal[] = sessions
      .map((session) =>
        extractOmcSignalFromRunningSession(session, directBatchTaskIdBySessionId, employees, registryRunningClaudeSessionIds),
      )
      .filter((item): item is OmcActiveExecutionSignal => Boolean(item))
      .map((item) => ({ ...item, signalSource: "running_session" as const }));
    /** 优先「运行中会话」上的 OMC 用户行（真实 worker 标签），再考虑 workflow task.creator */
    const mergedOmcSignals: TaggedOmcSignal[] = [...omcTaskSignals, ...omcRunningSessionSignals].sort((a, b) => {
      const pri = (s: TaggedOmcSignal) => (s.signalSource === "running_session" ? 0 : 1);
      const d = pri(a) - pri(b);
      if (d !== 0) return d;
      return b.updatedAt - a.updatedAt;
    });
    const runtimeSignal = omcBatchRuntime?.active
      ? {
          taskId: "omc-batch",
          message: "后台批量执行中",
          updatedAt: omcBatchRuntime.updatedAt,
          sessionId: omcBatchRuntime.sessionId,
        }
      : null;
    const allOmcSignals = runtimeSignal ? [runtimeSignal, ...mergedOmcSignals] : mergedOmcSignals;
    const hasOmcActivity =
      mergedOmcSignals.length > 0 ||
      Boolean(omcBatchRuntime?.active) ||
      hasRunningDirectBatchInvocationRows;
    const omcMonitorItem: EmployeeMonitorItem = (() => {
      if (!hasOmcActivity) {
        const boundOmcSessionId = resolveOmcWorkerBoundSessionId(
          undefined,
          [],
          sessions,
          sessionsById,
          undefined,
          employees,
          directBatchTaskIdBySessionId,
          registryRunningClaudeSessionIds,
        );
        const latestSession = boundOmcSessionId ? sessionsById.get(boundOmcSessionId) : undefined;
        return {
          employeeId: "omc-worker",
          name: OMC_MONITOR_EMPLOYEE_NAME,
          agentType: "omc",
          status: "idle",
          previewText: "暂无运行中的 OMC 任务",
          sessionId: boundOmcSessionId,
          repositoryPath: latestSession?.repositoryPath,
          repositoryName: latestSession?.repositoryName,
          updatedAt: 0,
        };
      }
      // 优先使用真正运行中的 OMC 会话信号，避免 runtime 占位信号覆盖可跳转会话。
      const latestExecutionSignal = mergedOmcSignals[0] ?? null;
      const inv0 = directBatchInvocationsSnap[0];
      /** 仅侧栏直连批量列表有数据、尚无 workflow/会话流式信号时，用首条 invocation 合成占位，避免 `latest` 为空。 */
      const syntheticDirectBatchSignal: OmcActiveExecutionSignal | null =
        !runtimeSignal && !latestExecutionSignal && inv0
          ? {
              taskId: inv0.taskId?.trim() || "omc-direct-batch",
              message:
                inv0.taskTitle?.trim() ||
                sanitizeOmcDirectBatchPreviewLineForList(inv0.previewLine)?.slice(0, 80) ||
                "直连批量 OMC",
              updatedAt: Date.now(),
              sessionId: inv0.sessionId,
            }
          : null;
      const latest: OmcActiveExecutionSignal =
        latestExecutionSignal ??
        runtimeSignal ??
        mergedOmcSignals[0] ??
        syntheticDirectBatchSignal ?? {
          taskId: "omc-batch",
          message: "OMC 活动",
          updatedAt: omcBatchRuntime?.updatedAt ?? Date.now(),
          sessionId: omcBatchRuntime?.sessionId,
        };
      const preferredSessionId = latestExecutionSignal?.sessionId ?? latest.sessionId;
      const omcRepoFallback = inferRepositoryPathForOmcJumpFallback(
        sessions,
        mergedOmcSignals,
        preferredSessionId,
        omcBatchRuntime?.sessionId,
      );
      const repoFallbackMerged = omcRepoFallback;
      const boundOmcSessionId = resolveOmcWorkerBoundSessionId(
        preferredSessionId,
        mergedOmcSignals,
        sessions,
        sessionsById,
        repoFallbackMerged,
        employees,
        directBatchTaskIdBySessionId,
        registryRunningClaudeSessionIds,
      );
      const latestSession = boundOmcSessionId ? sessionsById.get(boundOmcSessionId) : undefined;
      const runningCount =
        runtimeSignal?.taskId === "omc-batch"
          ? Math.max(1, omcBatchRuntime?.runningCount ?? mergedOmcSignals.length)
          : allOmcSignals.length;
      const directTotal = omcBatchRuntime?.directBatchTaskTotal;
      const directFinished = omcBatchRuntime?.directBatchTaskFinished;
      const directSessions = omcBatchRuntime?.directBatchClaudeCodeSessions;
      const previewForOmc =
        runtimeSignal?.taskId === "omc-batch"
          ? typeof directTotal === "number"
            ? `批量OMC · ${typeof directSessions === "number" ? `${directSessions} 路 Claude Code` : "Claude Code"} · 进度 ${typeof directFinished === "number" ? directFinished : 0}/${directTotal} · ${latest.message}`
            : `执行中 ${runningCount} 项 · ${latest.message}`
          : `执行中 ${runningCount} 路 · ${latest.message}`;
      return {
        employeeId: "omc-worker",
        name: OMC_MONITOR_EMPLOYEE_NAME,
        agentType: "omc",
        status: "in_progress",
        executionSource: "workflow",
        latestTaskStatus: "in_progress",
        previewText: previewForOmc,
        activeTaskId: latest.taskId,
        sessionId: boundOmcSessionId,
        repositoryPath: latestSession?.repositoryPath,
        repositoryName: latestSession?.repositoryName,
        updatedAt: latest.updatedAt,
      };
    })();
    employeeMonitorItems.push(omcMonitorItem);

    const workflowIds = Array.from(new Set([...workflowTemplates.map((item) => item.id), ...workflowTasks.map((item) => item.workflowId)]));
    const teamMonitorItems: TeamMonitorItem[] = workflowIds.map((workflowId) => {
      const template = templateById.get(workflowId);
      const tasks = workflowTasks.filter((task) => task.workflowId === workflowId);
      const memberIds = new Set<string>();
      const memberNamesFromRuntime = new Set<string>();
      const graph = workflowGraphsByWorkflowId[workflowId];
      for (const node of graph?.nodes ?? []) {
        const employeeId = typeof node.data?.employeeId === "string" ? node.data.employeeId.trim() : "";
        if (employeeId) {
          memberIds.add(employeeId);
          continue;
        }
        if (node.type === "task" || node.type === "approval") {
          const nodeLabel = typeof node.data?.label === "string" ? node.data.label.trim() : "";
          if (!nodeLabel) {
            continue;
          }
          const matchedEmployee = employees.find((item) => item.name.trim() === nodeLabel);
          if (matchedEmployee) {
            memberIds.add(matchedEmployee.id);
          } else {
            memberNamesFromRuntime.add(nodeLabel);
          }
        }
      }
      for (const stage of template?.stages ?? []) {
        for (const assignee of stage.assignees) {
          if (assignee.employeeId?.trim()) {
            memberIds.add(assignee.employeeId);
          }
        }
      }
      for (const task of tasks) {
        const events = workflowTaskEventsByTaskId[task.id] ?? [];
        for (const event of events) {
          if (!event.payloadJson) continue;
          try {
            const payload = JSON.parse(event.payloadJson) as {
              employeeId?: string;
              employeeName?: string;
              snapshot?: { toNodeName?: string };
              toNodeName?: string;
            };
            if (typeof payload.employeeId === "string" && payload.employeeId.trim()) {
              memberIds.add(payload.employeeId);
            }
            if (typeof payload.employeeName === "string" && payload.employeeName.trim()) {
              const employee = employeeByName.get(payload.employeeName.trim());
              if (employee) {
                memberIds.add(employee.id);
              }
            }
            if (typeof payload.toNodeName === "string" && payload.toNodeName.trim()) {
              const employee = employeeByName.get(payload.toNodeName.trim());
              if (employee) {
                memberIds.add(employee.id);
              }
            }
            if (typeof payload.snapshot?.toNodeName === "string" && payload.snapshot.toNodeName.trim()) {
              const employee = employeeByName.get(payload.snapshot.toNodeName.trim());
              if (employee) {
                memberIds.add(employee.id);
              }
            }
          } catch {
            // ignore malformed payload
          }
        }
      }
      const memberNames = Array.from(
        new Set([
          ...Array.from(memberIds).map((employeeId) => employeeById.get(employeeId)?.name ?? employeeId),
          ...Array.from(memberNamesFromRuntime),
        ]),
      ).sort((a, b) => a.localeCompare(b, "zh-CN"));
      const activeTask = tasks
        .filter((task) => effectiveTaskStatus(task, workflowTaskEventsByTaskId[task.id] ?? []) === "in_progress")
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const latestTask = tasks.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const targetTask = activeTask ?? latestTask;
      const latestCompletedTaskAt = tasks
        .filter((task) => effectiveTaskStatus(task, workflowTaskEventsByTaskId[task.id] ?? []) !== "in_progress")
        .map((task) => task.updatedAt)
        .sort((a, b) => b - a)[0];
      const latestSettledTaskStatus = tasks
        .filter((task) => effectiveTaskStatus(task, workflowTaskEventsByTaskId[task.id] ?? []) !== "in_progress")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((task) => effectiveTaskStatus(task, workflowTaskEventsByTaskId[task.id] ?? []))[0];
      const stageCount = template?.stages.length;
      const pendingEmployees = targetTask ? taskPendingEmployeesByTaskId[targetTask.id] ?? [] : [];
      const fallbackEmployeeId = targetTask ? extractLatestEventEmployeeId(workflowTaskEventsByTaskId[targetTask.id] ?? []) : undefined;
      const fallbackEmployee = fallbackEmployeeId ? employees.find((item) => item.id === fallbackEmployeeId) : undefined;
      const currentEmployee = pendingEmployees[0] ?? (fallbackEmployee ? { employeeId: fallbackEmployee.id, name: fallbackEmployee.name } : undefined);
      const snapshots = targetTask ? workflowRuntimeSnapshotsByTaskId[targetTask.id] ?? [] : [];
      const latestSnapshot = snapshots[snapshots.length - 1];
      const targetSession = targetTask ? sessionsById.get(targetTask.creator) : undefined;
      const previewText = latestSnapshot?.outputPreview?.trim()
        ? truncateText(latestSnapshot.outputPreview)
        : latestSnapshot?.inputPreview?.trim()
          ? truncateText(latestSnapshot.inputPreview)
          : targetTask
            ? extractSessionPreview(sessionsById.get(targetTask.creator))
            : "暂无会话";
      const targetTaskStatus = targetTask ? effectiveTaskStatus(targetTask, workflowTaskEventsByTaskId[targetTask.id] ?? []) : undefined;
      const targetTaskEvents = targetTask ? workflowTaskEventsByTaskId[targetTask.id] ?? [] : [];
      const progressText = targetTask
        ? targetTaskStatus === "rejected"
          ? `阶段 ${targetTask.currentStageIndex + 1}${stageCount ? `/${stageCount}` : ""} · 分发失败`
          : `阶段 ${targetTask.currentStageIndex + 1}${stageCount ? `/${stageCount}` : ""}${activeTask ? " · 执行中" : " · 空闲"}`
        : "暂无任务";
      const omcProgressText = targetTask
        ? extractOmcProgressText(targetTaskEvents, Boolean(activeTask))
        : undefined;
      return {
        workflowId,
        workflowName: template?.name ?? `未命名团队(${workflowId.slice(0, 8)})`,
        status: activeTask ? "in_progress" : "idle",
        latestTaskStatus: targetTaskStatus ?? latestSettledTaskStatus,
        lastCompletedTaskAt: latestCompletedTaskAt,
        repositoryPath: targetSession?.repositoryPath,
        repositoryName: targetSession?.repositoryName,
        previewText,
        activeTaskId: targetTask?.id,
        sessionId: targetTask?.creator,
        currentEmployeeId: currentEmployee?.employeeId,
        currentEmployeeName: currentEmployee?.name,
        currentStageIndex: targetTask?.currentStageIndex,
        stageCount,
        memberCount: memberNames.length,
        memberNames,
        progressText,
        omcProgressText,
        updatedAt: targetTask?.updatedAt ?? template?.updatedAt ?? 0,
      };
    });

    employeeMonitorItems.sort((a, b) => {
      if (a.status !== b.status) return a.status === "in_progress" ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    teamMonitorItems.sort((a, b) => {
      if (a.status !== b.status) return a.status === "in_progress" ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });

    const employeesInProgress = employeeMonitorItems.filter((item) => item.status === "in_progress").length;
    const teamsInProgress = teamMonitorItems.filter((item) => item.status === "in_progress").length;
    const stats: MonitorStats = {
      activeEmployees: employeeMonitorItems.length,
      employeesInProgress,
      employeesIdle: employeeMonitorItems.length - employeesInProgress,
      teamsTotal: teamMonitorItems.length,
      teamsInProgress,
      teamsIdle: teamMonitorItems.length - teamsInProgress,
    };

    return {
      employeeMonitorItems,
      teamMonitorItems,
      stats,
      lookup: {
        employeeById,
        teamByWorkflowId: templateById,
      },
    };
  }, [
    employees,
    sessions,
    taskPendingEmployeesByTaskId,
    workflowRuntimeSnapshotsByTaskId,
    workflowTaskEventsByTaskId,
    workflowTasks,
    workflowTemplates,
    workflowGraphsByWorkflowId,
    omcBatchRuntime,
    directBatchInvocationsSnap,
    registryRunningClaudeSessionIds,
  ]);
}
