import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { message } from "antd";
import type {
  ClaudeComposerExecuteBubbleOptions,
  ClaudeSession,
  EmployeeItem,
  EmployeeTaskCountItem,
  PendingExecutionTask,
  WorkflowGraph,
  WorkflowGraphNode,
  WorkflowGraphNodeType,
  WorkflowRuntimeStepSnapshot,
  WorkflowTaskEventItem,
  WorkflowTaskItem,
  WorkflowTemplateItem,
  Repository,
} from "../types";
import type { ClaudeTurnCompletePayload } from "./useClaudeSessions";
import {
  appendTaskEvent,
  createWorkflowTask,
  decideWorkflowTaskStage,
  endWorkflowTask,
  listTaskEvents,
  listTaskPendingEmployees,
} from "../services/workflowTasks";
import { getWorkflowGraph } from "../services/workflowGraphs";
import { listEmployeeTaskCounts, listEmployees } from "../services/employees";
import { notificationHub } from "../notifications";
import {
  WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_SUBMITTED,
  WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_UNRESOLVED,
} from "../constants/workflowEvents";
import {
  parseAcceptanceVerdictPayload,
  resolveAcceptanceVerdictWithGate,
  type AcceptanceDecision,
} from "../services/workflow/acceptanceVerdict";
import {
  advanceWorkflowGraph,
  composeDispatchInput,
  createWorkflowRuntimeState,
  resolveWorkflowDispatchNodeType,
  resolveGraphRollbackNode,
  type WorkflowGraphRuntimeState,
} from "../services/workflowGraphRuntime";
import {
  buildTeamWorkerExecutePrompt,
  candidateInProgressTasksForSession,
  eventHasCorrelationId,
  extractBoundEmployeeNameFromSessionRepositoryName,
  lastUserMessageIsTeamAutoDriver,
  logWorkflowTrace,
  makePreviewText,
  orderedExecutableNodes,
  resolveTeamDispatchTargetEmployee,
  sha256Hex,
  snapshotTeamWorkerExecuteInput,
  snapshotWorkflowAssistantOutput,
  snapshotWorkflowDispatchInput,
} from "../services/workflowGraphHelpers";
import { extractLatestAssistantPlainText, mergeAssistantPlainTextPreferLonger } from "../services/claudeSessionState";
import {
  extractRepositoryBoundEmployeeName,
  isOmcMonitorEmployeeRecord,
  omcWorkerRepositoryBoundNameMatchers,
  resolveConfiguredOmcEmployee,
} from "../utils/omcMonitorEmployeeSession";
import {
  isRepositoryMainSessionTab,
  normalizeRepositoryPathKey as normalizeRepositoryPathForMatch,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "../utils/repositoryMainSessionBinding";
import { extractBoundEmployeeNameFromDisplay } from "../utils/sessionOwnerHints";
import type { WorkflowVerdictMode } from "../constants/workflowVerdictMode";

type CreateSession = (
  repositoryPath: string,
  repositoryName: string,
  opts?: { skipActivate?: boolean },
) => Promise<string>;

type ExecuteSession = (
  sessionId: string,
  prompt: string,
  opts?: ClaudeComposerExecuteBubbleOptions,
) => boolean;

type WorkflowEventMap = Record<string, WorkflowTaskEventItem[]>;
type PendingEmployeeMap = Record<string, Array<{ employeeId: string; name: string }>>;
type RuntimeStateMap = Record<string, WorkflowGraphRuntimeState>;
type RuntimeSnapshotMap = Record<string, WorkflowRuntimeStepSnapshot[]>;

interface FlushDingTalkAutomationReplyForTurnInput {
  assistantPreviewRaw: string;
  payloadSessionId: string;
  session: ClaudeSession | undefined;
  success: boolean;
}

interface UseWorkflowTeamAutomationOptions {
  activeSessionId: string | null;
  appendSystemMessage: (sessionId: string, text: string) => void;
  closeSession: (sessionId: string) => void;
  createSession: CreateSession;
  employees: EmployeeItem[];
  executeSession: ExecuteSession;
  flushDingTalkAutomationReplyForTurn: (input: FlushDingTalkAutomationReplyForTurnInput) => boolean;
  repositoryMainSessionBindings: Record<string, string>;
  repositories: Repository[];
  sessions: ClaudeSession[];
  setEmployeeTaskCounts: Dispatch<SetStateAction<EmployeeTaskCountItem[]>>;
  setEmployees: Dispatch<SetStateAction<EmployeeItem[]>>;
  setTaskPendingEmployeesByTaskId: Dispatch<SetStateAction<PendingEmployeeMap>>;
  setWorkflowRuntimeSnapshotsByTaskId: Dispatch<SetStateAction<RuntimeSnapshotMap>>;
  setWorkflowRuntimeStateByTaskId: Dispatch<SetStateAction<RuntimeStateMap>>;
  setWorkflowTaskEventsByTaskId: Dispatch<SetStateAction<WorkflowEventMap>>;
  setWorkflowTasks: Dispatch<SetStateAction<WorkflowTaskItem[]>>;
  taskPendingEmployeesByTaskId: PendingEmployeeMap;
  workflowGraphStatusByWorkflowId: Record<string, string>;
  workflowGraphsByWorkflowId: Record<string, WorkflowGraph>;
  workflowRuntimeSnapshotsByTaskId: RuntimeSnapshotMap;
  workflowRuntimeStateByTaskId: RuntimeStateMap;
  workflowTaskEventsByTaskId: WorkflowEventMap;
  workflowTasks: WorkflowTaskItem[];
  workflowTemplates: WorkflowTemplateItem[];
  workflowVerdictMode: WorkflowVerdictMode;
}

function updateSnapshotOutput(
  snapshots: WorkflowRuntimeStepSnapshot[],
  output: string,
): { snapshots: WorkflowRuntimeStepSnapshot[]; filledDispatchSnapshotId?: string } {
  if (!output.trim()) {
    return { snapshots };
  }
  const nextSnapshots = [...snapshots];
  const latestDispatchIndex = [...nextSnapshots]
    .reverse()
    .findIndex((item) => item.phase === "dispatch" && item.outputPreview === "(待执行)");
  if (latestDispatchIndex < 0) {
    return { snapshots: nextSnapshots };
  }
  const targetIndex = nextSnapshots.length - 1 - latestDispatchIndex;
  const filledDispatchSnapshotId = nextSnapshots[targetIndex]?.id;
  if (!filledDispatchSnapshotId) {
    return { snapshots: nextSnapshots };
  }
  nextSnapshots[targetIndex] = {
    ...nextSnapshots[targetIndex],
    outputPreview: snapshotWorkflowAssistantOutput(output),
  };
  return { snapshots: nextSnapshots, filledDispatchSnapshotId };
}

export function useWorkflowTeamAutomation({
  activeSessionId,
  appendSystemMessage,
  closeSession,
  createSession,
  employees,
  executeSession,
  flushDingTalkAutomationReplyForTurn,
  repositoryMainSessionBindings,
  repositories,
  sessions,
  setEmployeeTaskCounts,
  setEmployees,
  setTaskPendingEmployeesByTaskId,
  setWorkflowRuntimeSnapshotsByTaskId,
  setWorkflowRuntimeStateByTaskId,
  setWorkflowTaskEventsByTaskId,
  setWorkflowTasks,
  taskPendingEmployeesByTaskId,
  workflowGraphStatusByWorkflowId,
  workflowRuntimeStateByTaskId,
  workflowTaskEventsByTaskId,
  workflowTasks,
  workflowTemplates,
  workflowVerdictMode,
}: UseWorkflowTeamAutomationOptions) {
  const employeeSessionIdByKeyRef = useRef<Map<string, string>>(new Map());
  const employeeSessionCreateByKeyRef = useRef<Map<string, Promise<string>>>(new Map());
  const workflowTaskByWorkerSessionRef = useRef<Map<string, string>>(new Map());
  const acceptanceCompletionGuardRef = useRef<Set<string>>(new Set());

  const activeSessionIdRef = useRef(activeSessionId);
  const employeesRef = useRef(employees);
  const repositoryMainSessionBindingsRef = useRef(repositoryMainSessionBindings);
  const repositoriesRef = useRef(repositories);
  const sessionsRef = useRef(sessions);
  const taskPendingEmployeesByTaskIdRef = useRef(taskPendingEmployeesByTaskId);
  const workflowRuntimeStateByTaskIdRef = useRef(workflowRuntimeStateByTaskId);
  const workflowTaskEventsByTaskIdRef = useRef(workflowTaskEventsByTaskId);
  const workflowTasksRef = useRef(workflowTasks);

  activeSessionIdRef.current = activeSessionId;
  employeesRef.current = employees;
  repositoryMainSessionBindingsRef.current = repositoryMainSessionBindings;
  repositoriesRef.current = repositories;
  sessionsRef.current = sessions;
  taskPendingEmployeesByTaskIdRef.current = taskPendingEmployeesByTaskId;
  workflowRuntimeStateByTaskIdRef.current = workflowRuntimeStateByTaskId;
  workflowTaskEventsByTaskIdRef.current = workflowTaskEventsByTaskId;
  workflowTasksRef.current = workflowTasks;

  const refreshEmployeeData = useCallback(async () => {
    const [employeeList, counts] = await Promise.all([listEmployees(), listEmployeeTaskCounts()]);
    setEmployees(employeeList);
    setEmployeeTaskCounts(counts);
  }, [setEmployeeTaskCounts, setEmployees]);

  const moveWorkflowAutomationSessionId = useCallback((fromTabId: string, toClaudeSessionId: string) => {
    const empMap = employeeSessionIdByKeyRef.current;
    for (const [k, v] of [...empMap.entries()]) {
      if (v === fromTabId) {
        empMap.set(k, toClaudeSessionId);
      }
    }
  }, []);

  const ensureEmployeeWorkerTabSessionId = useCallback(
    async (
      repositoryPath: string,
      repositoryName: string,
      employee: EmployeeItem,
    ): Promise<{ sessionId: string; deferExecute: boolean }> => {
      const key = `${repositoryPath}::${employee.id}`;
      const sessionsNow = sessionsRef.current;
      const cachedId = employeeSessionIdByKeyRef.current.get(key);
      if (cachedId) {
        const hit = sessionsNow.find((item) => item.id === cachedId || item.claudeSessionId === cachedId);
        if (hit) {
          if (hit.id !== cachedId) {
            employeeSessionIdByKeyRef.current.set(key, hit.id);
          }
          return { sessionId: hit.id, deferExecute: false };
        }
        const migratedHit = sessionsNow.find(
          (item) =>
            item.repositoryPath === repositoryPath &&
            extractBoundEmployeeNameFromSessionRepositoryName(item.repositoryName) === employee.name.trim(),
        );
        if (migratedHit) {
          employeeSessionIdByKeyRef.current.set(key, migratedHit.id);
          return { sessionId: migratedHit.id, deferExecute: false };
        }
        employeeSessionIdByKeyRef.current.delete(key);
      }
      const inflight = employeeSessionCreateByKeyRef.current.get(key);
      if (inflight) {
        const sessionId = await inflight;
        return { sessionId, deferExecute: true };
      }
      const createPromise = (async (): Promise<string> => {
        const createdSessionId = await createSession(repositoryPath, `${repositoryName}/员工:${employee.name}`, { skipActivate: true });
        employeeSessionIdByKeyRef.current.set(key, createdSessionId);
        return createdSessionId;
      })();
      employeeSessionCreateByKeyRef.current.set(key, createPromise);
      void createPromise.finally(() => {
        employeeSessionCreateByKeyRef.current.delete(key);
      });
      const sessionId = await createPromise;
      return { sessionId, deferExecute: true };
    },
    [createSession],
  );

  const prepareFreshOmcEmployeeWorkerForDirectBatch = useCallback(
    async (input: { repositoryPath: string; repositoryDisplayName: string }) => {
      const rp = input.repositoryPath.trim();
      if (!rp) return;
      const pathKey = normalizeRepositoryPathForMatch(rp);
      const snapshot = sessionsRef.current;
      const omcBoundNames = omcWorkerRepositoryBoundNameMatchers(employeesRef.current);
      const toClose = snapshot
        .filter((s) => {
          if (normalizeRepositoryPathForMatch(s.repositoryPath ?? "") !== pathKey) return false;
          const bound = extractRepositoryBoundEmployeeName(s.repositoryName);
          return bound !== null && omcBoundNames.has(bound);
        })
        .map((s) => s.id);
      if (toClose.length > 0) {
        flushSync(() => {
          for (const id of toClose) {
            closeSession(id);
          }
        });
      }
      const employee = resolveConfiguredOmcEmployee(employeesRef.current);
      if (!employee) return;
      const mapKey = `${rp}::${employee.id}`;
      employeeSessionIdByKeyRef.current.delete(mapKey);
      employeeSessionCreateByKeyRef.current.delete(mapKey);
      const disp = input.repositoryDisplayName.trim() || rp;
      await ensureEmployeeWorkerTabSessionId(rp, disp, employee);
    },
    [closeSession, ensureEmployeeWorkerTabSessionId],
  );

  const notifyOmcEmployeeDirectBatchTaskDone = useCallback(
    (input: { repositoryPath: string; repositoryDisplayName: string; employeeMessage: string }) => {
      void (async () => {
        const rp = input.repositoryPath.trim();
        const text = input.employeeMessage.trim();
        if (!rp || !text) return;
        const disp = input.repositoryDisplayName.trim() || rp;
        const employee = resolveConfiguredOmcEmployee(employeesRef.current);
        let targetSessionId: string | null = null;
        const pathKey = normalizeRepositoryPathForMatch(rp);
        const omcBoundNames = omcWorkerRepositoryBoundNameMatchers(employeesRef.current);
        if (employee) {
          const { sessionId } = await ensureEmployeeWorkerTabSessionId(rp, disp, employee);
          targetSessionId = sessionId;
        } else {
          for (const s of sessionsRef.current) {
            if (normalizeRepositoryPathForMatch(s.repositoryPath ?? "") !== pathKey) continue;
            const bound = extractRepositoryBoundEmployeeName(s.repositoryName);
            if (bound !== null && omcBoundNames.has(bound)) {
              targetSessionId = s.id;
              break;
            }
          }
        }
        if (!targetSessionId) return;
        appendSystemMessage(targetSessionId, text);
      })();
    },
    [appendSystemMessage, ensureEmployeeWorkerTabSessionId],
  );

  const persistRuntimeSnapshotExecutor = useCallback(
    async (input: { taskId: string; snapshotId: string; executorSessionId: string }) => {
      const { taskId, snapshotId, executorSessionId } = input;
      setWorkflowRuntimeSnapshotsByTaskId((prev) => {
        const list = prev[taskId] ?? [];
        const next = list.map((s) => (s.id === snapshotId ? { ...s, executorSessionId } : s));
        return { ...prev, [taskId]: next };
      });
      try {
        const ev = await appendTaskEvent({
          taskId,
          eventType: "workflow_runtime_snapshot_executor",
          payloadJson: JSON.stringify({
            action: "runtime_snapshot_executor",
            snapshotId,
            executorSessionId,
          }),
        });
        setWorkflowTaskEventsByTaskId((prev) => ({
          ...prev,
          [taskId]: [...(prev[taskId] ?? []), ev],
        }));
      } catch (e) {
        console.error("Failed to persist workflow runtime snapshot executor:", e);
      }
    },
    [setWorkflowRuntimeSnapshotsByTaskId, setWorkflowTaskEventsByTaskId],
  );

  const dispatchTeamStepToEmployeeSession = useCallback(
    async (input: {
      task: WorkflowTaskItem;
      dispatch: {
        employeeId?: string;
        employeeName: string;
        nodeType: WorkflowGraphNodeType;
        input: string;
      };
      previousNodeLabel: string;
      decision?: "pass" | "reject";
      /** 派发快照 id：派发成功绑定员工会话后写入 `executorSessionId` */
      attachExecutorToSnapshotId?: string;
    }): Promise<boolean> => {
      const { task, dispatch } = input;
      const ownerSession = sessionsRef.current.find((item) => item.id === task.creator);
      if (!ownerSession) {
        return false;
      }
      const targetEmployeeName = dispatch.employeeName.trim();
      const pendingEmployees = taskPendingEmployeesByTaskIdRef.current[task.id] ?? [];
      const targetEmployee = resolveTeamDispatchTargetEmployee(dispatch, employeesRef.current, pendingEmployees);
      if (!targetEmployee) {
        const targetEmployeeId = dispatch.employeeId?.trim();
        const employeeHint = targetEmployeeId ? `${targetEmployeeName}（ID: ${targetEmployeeId}）` : targetEmployeeName;
        const errorText = `团队流程分发失败：未找到员工「${employeeHint}」，请检查团队节点配置。`;
        appendSystemMessage(ownerSession.id, errorText);
        const failedSnapshot: WorkflowRuntimeStepSnapshot = {
          id: `${task.id}-dispatch-error-${Date.now()}`,
          taskId: task.id,
          phase: "dispatch",
          fromNodeId: undefined,
          toNodeId: undefined,
          toNodeName: targetEmployeeName,
          toNodeType: dispatch.nodeType,
          inputPreview: snapshotWorkflowDispatchInput(buildTeamWorkerExecutePrompt(dispatch.input, undefined)),
          outputPreview: errorText,
          createdAt: Date.now(),
        };
        setWorkflowRuntimeSnapshotsByTaskId((prev) => ({
          ...prev,
          [task.id]: [...(prev[task.id] ?? []), failedSnapshot],
        }));
        try {
          const runtimeEvent = await appendTaskEvent({
            taskId: task.id,
            eventType: "workflow_runtime_dispatch_error",
            payloadJson: JSON.stringify({
              action: "dispatch_error",
              employeeId: targetEmployeeId,
              employeeName: targetEmployeeName,
              reason: errorText,
              snapshot: failedSnapshot,
            }),
          });
          setWorkflowTaskEventsByTaskId((prev) => ({
            ...prev,
            [task.id]: [...(prev[task.id] ?? []), runtimeEvent],
          }));
        } catch (runtimeEventError) {
          console.error("Failed to persist workflow runtime dispatch error:", runtimeEventError);
        }
        return false;
      }
      const { sessionId: targetSessionId, deferExecute: executeAfterCreate } = await ensureEmployeeWorkerTabSessionId(
        ownerSession.repositoryPath,
        ownerSession.repositoryName,
        targetEmployee,
      );
      if (!targetSessionId) {
        return false;
      }
      const attachId = input.attachExecutorToSnapshotId?.trim();
      if (attachId) {
        await persistRuntimeSnapshotExecutor({
          taskId: task.id,
          snapshotId: attachId,
          executorSessionId: targetSessionId,
        });
      }
      const autoPrompt = buildTeamWorkerExecutePrompt(dispatch.input, targetEmployee.agentType?.trim());
      workflowTaskByWorkerSessionRef.current.set(targetSessionId, task.id);
      const targetSession = sessionsRef.current.find((item) => item.id === targetSessionId);
      const targetClaudeSessionId = targetSession?.claudeSessionId?.trim();
      if (targetClaudeSessionId) {
        workflowTaskByWorkerSessionRef.current.set(targetClaudeSessionId, task.id);
      }
      if (executeAfterCreate) {
        return await new Promise<boolean>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve(executeSession(targetSessionId, autoPrompt) !== false);
            });
          });
        });
      }
      return executeSession(targetSessionId, autoPrompt) !== false;
    },
    [
      appendSystemMessage,
      ensureEmployeeWorkerTabSessionId,
      executeSession,
      persistRuntimeSnapshotExecutor,
      setWorkflowRuntimeSnapshotsByTaskId,
      setWorkflowTaskEventsByTaskId,
    ],
  );

  const handleComposerExecute = useCallback(
    async (
      sessionId: string,
      prompt: string,
      dispatchTarget?: Pick<PendingExecutionTask, "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName">,
      executeOptions?: ClaudeComposerExecuteBubbleOptions,
    ): Promise<boolean> => {
      const runExecute = (targetSid: string, promptText: string) => {
        const sameTab = targetSid === sessionId;
        const replaceAt =
          executeOptions?.replaceUserBubbleAtIndex !== undefined &&
          Number.isFinite(executeOptions.replaceUserBubbleAtIndex) &&
          sameTab
            ? Math.floor(executeOptions.replaceUserBubbleAtIndex)
            : undefined;
        const replaceLast =
          executeOptions?.replaceLastUserBubble === true && sameTab && replaceAt === undefined;
        const replaceFirst =
          executeOptions?.replaceFirstUserBubble === true && sameTab && !replaceLast && replaceAt === undefined;
        return executeSession(
          targetSid,
          promptText,
          replaceAt !== undefined
            ? { replaceUserBubbleAtIndex: replaceAt }
            : replaceLast
              ? { replaceLastUserBubble: true }
              : replaceFirst
                ? { replaceFirstUserBubble: true }
                : undefined,
        );
      };
      notificationHub.setControlDockMirror(sessionId, null);

      const applyEmployeeControlDockMirror = (targetTid: string, dispatchFromTid: string) => {
        const targetSess = sessionsRef.current.find((item) => item.id === targetTid);
        if (!targetSess) return;
        if (!extractBoundEmployeeNameFromDisplay(targetSess.repositoryName ?? "")) return;
        const pathKey = normalizeRepositoryPathForMatch(targetSess.repositoryPath);
        const mainOwner = resolveMainOwnerAgentNameForRepositoryPath(
          repositoriesRef.current,
          targetSess.repositoryPath,
        );
        let viewer: string | null =
          resolveBoundMainSessionId(
            targetSess.repositoryPath,
            repositoryMainSessionBindingsRef.current,
            sessionsRef.current,
            mainOwner,
          ) ?? null;
        if (!viewer || viewer === targetTid) {
          const fb = sessionsRef.current.find(
            (s) => isRepositoryMainSessionTab(s, pathKey, mainOwner) && s.id !== targetTid,
          );
          viewer = fb?.id ?? null;
        }
        if (!viewer || viewer === targetTid) {
          if (dispatchFromTid !== targetTid) viewer = dispatchFromTid;
          else return;
        }
        notificationHub.setControlDockMirror(viewer, targetTid);
      };

      let executePrompt = prompt;
      let targetSessionId = sessionId;
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      if (session) {
        const mentionedEmployees = employeesRef.current
          .filter((employee) => !isOmcMonitorEmployeeRecord(employee))
          .map((employee) => ({
            employee,
            mentionIndex: prompt.indexOf(`@${employee.name}`),
          }))
          .filter((entry) => entry.mentionIndex >= 0)
          .sort((left, right) => left.mentionIndex - right.mentionIndex)
          .map((entry) => entry.employee);
        const explicitTargetType = dispatchTarget?.targetType ?? "main";
        const explicitTargetEmployeeName = dispatchTarget?.targetEmployeeName?.trim();
        const explicitTargetWorkflowId = dispatchTarget?.targetWorkflowId?.trim();
        const explicitTargetWorkflowName = dispatchTarget?.targetWorkflowName?.trim();
        if (explicitTargetType === "employee") {
          const targetEmployeeRaw =
            (explicitTargetEmployeeName
              ? employeesRef.current.find((employee) => employee.name.trim() === explicitTargetEmployeeName)
              : undefined) ?? mentionedEmployees[0];
          const targetEmployee =
            targetEmployeeRaw && !isOmcMonitorEmployeeRecord(targetEmployeeRaw) ? targetEmployeeRaw : undefined;
          let executeAfterCreate = false;
          if (targetEmployee) {
            const agentType = targetEmployee.agentType?.trim();
            const trimmedPrompt = executePrompt.trimStart();
            const hasLeadingSlashCommand = trimmedPrompt.startsWith("/");
            if (agentType && !hasLeadingSlashCommand) {
              executePrompt = `/${agentType}\n${executePrompt}`;
            }
            const { sessionId: resolvedEmployeeSessionId, deferExecute } = await ensureEmployeeWorkerTabSessionId(
              session.repositoryPath,
              session.repositoryName,
              targetEmployee,
            );
            targetSessionId = resolvedEmployeeSessionId;
            executeAfterCreate = deferExecute;
          }
          if (!targetEmployee) {
            if (explicitTargetEmployeeName) {
              const warningText = `未找到终端「${explicitTargetEmployeeName}」，请检查终端名称后重试。`;
              message.warning(warningText);
              appendSystemMessage(sessionId, warningText);
              return false;
            }
            return runExecute(sessionId, executePrompt) !== false;
          }
          appendSystemMessage(
            sessionId,
            [
              "任务分发记录",
              `- 类型：员工独立会话`,
              `- 目标：${targetEmployee.name}`,
              `- 分发会话：${targetSessionId}`,
              `- 时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
            ].join("\n"),
          );
          applyEmployeeControlDockMirror(targetSessionId, sessionId);
          if (executeAfterCreate) {
            return await new Promise<boolean>((resolve) => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  resolve(runExecute(targetSessionId, executePrompt) !== false);
                });
              });
            });
          }
          return runExecute(targetSessionId, executePrompt) !== false;
        }

        const templatesByNameLen = [...workflowTemplates].sort((a, b) => b.name.length - a.name.length);
        const publishedTemplates = workflowTemplates.filter(
          (item) => (workflowGraphStatusByWorkflowId[item.id] ?? "").toLowerCase() === "published",
        );
        const genericTeamMentionMatched = prompt.includes("@团队") || prompt.includes("＠团队");
        const teamDispatchRequested = explicitTargetType === "team" || genericTeamMentionMatched;
        const explicitTeam =
          explicitTargetType === "team"
            ? (explicitTargetWorkflowId
                ? workflowTemplates.find((item) => item.id === explicitTargetWorkflowId)
                : undefined) ??
              (explicitTargetWorkflowName
                ? workflowTemplates.find((item) => item.name.trim() === explicitTargetWorkflowName)
                : undefined) ??
              (genericTeamMentionMatched ? publishedTemplates[0] : undefined)
            : undefined;
        const mentionedTeam = explicitTeam ?? templatesByNameLen.find((t) => prompt.includes(`@${t.name}`));
        if (teamDispatchRequested && !mentionedTeam) {
          const warningText = "未找到可用团队流程，请先在「团队」中发布至少一个流程。";
          message.warning(warningText);
          appendSystemMessage(sessionId, warningText);
          return false;
        }
        if (mentionedTeam) {
          try {
            const taskTitle = prompt.split("\n")[0]?.slice(0, 80) || "新任务";
            const task = await createWorkflowTask({
              title: taskTitle,
              content: prompt,
              creator: sessionId,
              workflowId: mentionedTeam?.id,
            });
            setWorkflowTasks((prev) => [task, ...prev]);
            const events = await listTaskEvents(task.id);
            const pendingEmployees = await listTaskPendingEmployees(task.id);
            setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [task.id]: events }));
            setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [task.id]: pendingEmployees }));
            appendSystemMessage(
              sessionId,
              [
                "任务分发记录",
                `- 类型：团队流程`,
                `- 目标：${mentionedTeam.name}`,
                `- 任务ID：${task.id}`,
                `- 时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
              ].join("\n"),
            );
            try {
              logWorkflowTrace("team.dispatch.bootstrap.start", {
                taskId: task.id,
                workflowId: task.workflowId,
                sessionId,
              });
              const graphItem = await getWorkflowGraph({ workflowId: task.workflowId });
              if (graphItem?.graph?.nodes?.length) {
                const runtimeState = createWorkflowRuntimeState(graphItem.graph);
                const firstStep = advanceWorkflowGraph({
                  graph: graphItem.graph,
                  state: runtimeState,
                  startContent: task.content,
                });
                setWorkflowRuntimeStateByTaskId((prev) => ({ ...prev, [task.id]: firstStep.state }));
                if (firstStep.dispatch) {
                  logWorkflowTrace("team.dispatch.bootstrap.next", {
                    taskId: task.id,
                    nodeId: firstStep.dispatch.nodeId,
                    nodeType: firstStep.dispatch.nodeType,
                    employeeName: firstStep.dispatch.employeeName,
                  });
                  const dispatchSnapshot: WorkflowRuntimeStepSnapshot = {
                    id: `${task.id}-dispatch-${Date.now()}`,
                    taskId: task.id,
                    phase: "dispatch",
                    fromNodeId: firstStep.state.lastNodeId,
                    toNodeId: firstStep.dispatch.nodeId,
                    toNodeName: firstStep.dispatch.employeeName,
                    toNodeType: firstStep.dispatch.nodeType,
                    inputPreview: snapshotTeamWorkerExecuteInput(firstStep.dispatch, employeesRef.current, pendingEmployees),
                    outputPreview: "(待执行)",
                    createdAt: Date.now(),
                  };
                  setWorkflowRuntimeSnapshotsByTaskId((prev) => ({
                    ...prev,
                    [task.id]: [...(prev[task.id] ?? []), dispatchSnapshot],
                  }));
                  try {
                    const runtimeEvent = await appendTaskEvent({
                      taskId: task.id,
                      eventType: "workflow_runtime_snapshot",
                      payloadJson: JSON.stringify({
                        action: "runtime_snapshot",
                        snapshot: dispatchSnapshot,
                      }),
                    });
                    setWorkflowTaskEventsByTaskId((prev) => ({
                      ...prev,
                      [task.id]: [...(prev[task.id] ?? []), runtimeEvent],
                    }));
                  } catch (runtimeEventError) {
                    console.error("Failed to persist workflow runtime dispatch snapshot:", runtimeEventError);
                  }
                  const dispatched = await dispatchTeamStepToEmployeeSession({
                    task,
                    dispatch: {
                      employeeId: firstStep.dispatch.employeeId,
                      employeeName: firstStep.dispatch.employeeName,
                      nodeType: firstStep.dispatch.nodeType,
                      input: firstStep.dispatch.input,
                    },
                    previousNodeLabel: "开始",
                    attachExecutorToSnapshotId: dispatchSnapshot.id,
                  });
                  if (!dispatched) {
                    const warningText = `团队流程「${mentionedTeam.name}」首步派发失败，请检查终端配置或执行引擎。`;
                    message.warning(warningText);
                    appendSystemMessage(sessionId, warningText);
                    return false;
                  }
                } else {
                  const warningText = `团队流程「${mentionedTeam.name}」未找到可执行节点。`;
                  message.warning(warningText);
                  appendSystemMessage(sessionId, warningText);
                  return false;
                }
              }
            } catch (runtimeError) {
              console.error("Failed to bootstrap workflow graph runtime:", runtimeError);
            }
          } catch (error) {
            console.error("Failed to create workflow task from mention:", error);
            const errorText = error instanceof Error ? error.message : String(error);
            const warningText = `团队任务创建失败：${errorText || "未知错误"}`;
            message.error(warningText);
            appendSystemMessage(sessionId, warningText);
            return false;
          }
          return true;
        } else if (mentionedEmployees.length > 0) {
          const targetEmployee = mentionedEmployees[0];
          const agentType = targetEmployee?.agentType?.trim();
          const trimmedPrompt = executePrompt.trimStart();
          const hasLeadingSlashCommand = trimmedPrompt.startsWith("/");
          if (agentType && !hasLeadingSlashCommand) {
            executePrompt = `/${agentType}\n${executePrompt}`;
          }
        }
      }
      applyEmployeeControlDockMirror(targetSessionId, sessionId);
      return runExecute(targetSessionId, executePrompt) !== false;
    },
    [
      appendSystemMessage,
      dispatchTeamStepToEmployeeSession,
      ensureEmployeeWorkerTabSessionId,
      executeSession,
      setTaskPendingEmployeesByTaskId,
      setWorkflowRuntimeSnapshotsByTaskId,
      setWorkflowRuntimeStateByTaskId,
      setWorkflowTaskEventsByTaskId,
      setWorkflowTasks,
      workflowGraphStatusByWorkflowId,
      workflowTemplates,
    ],
  );

  const handleSendMessageWithTask = useCallback(
    (prompt: string) => {
      if (!activeSessionIdRef.current) {
        return;
      }
      void handleComposerExecute(activeSessionIdRef.current, prompt);
    },
    [handleComposerExecute],
  );

  const handleClaudeTurnComplete = useCallback(
    async (payload: ClaudeTurnCompletePayload) => {
      const payloadSessionId = payload.sessionId?.trim();
      if (!payloadSessionId) {
        return;
      }
      const session =
        sessionsRef.current.find((item) => item.id === payloadSessionId) ??
        sessionsRef.current.find((item) => item.claudeSessionId?.trim() === payloadSessionId);

      if (!payload.success) {
        flushDingTalkAutomationReplyForTurn({
          assistantPreviewRaw: payload.assistantPreviewRaw ?? "",
          payloadSessionId,
          session,
          success: false,
        });
        return;
      }

      const boundTaskId =
        workflowTaskByWorkerSessionRef.current.get(payloadSessionId) ??
        (session ? workflowTaskByWorkerSessionRef.current.get(session.id) : undefined) ??
        (session?.claudeSessionId?.trim()
          ? workflowTaskByWorkerSessionRef.current.get(session.claudeSessionId.trim())
          : undefined);
      const mergedForWorkflow = mergeAssistantPlainTextPreferLonger(payload.assistantPreviewRaw ?? "", session);
      flushDingTalkAutomationReplyForTurn({
        assistantPreviewRaw: payload.assistantPreviewRaw ?? "",
        payloadSessionId,
        session,
        success: true,
      });
      const output = mergedForWorkflow.trim();
      if (!output.trim()) {
        return;
      }
      let task: WorkflowTaskItem | undefined;
      const tasksNow = workflowTasksRef.current;
      const runtimeNow = workflowRuntimeStateByTaskIdRef.current;
      const pendingNow = taskPendingEmployeesByTaskIdRef.current;
      if (boundTaskId) {
        task = tasksNow.find((item) => item.id === boundTaskId);
      } else if (session && lastUserMessageIsTeamAutoDriver(session)) {
        const mergedTasks = candidateInProgressTasksForSession(session, tasksNow).filter((t) => runtimeNow[t.id]);
        mergedTasks.sort((a, b) => b.updatedAt - a.updatedAt);
        task = mergedTasks[0];
      }
      if (!task && session) {
        const employeeName = extractBoundEmployeeNameFromSessionRepositoryName(session.repositoryName);
        const employeeId = employeeName ? employeesRef.current.find((item) => item.name.trim() === employeeName.trim())?.id : undefined;
        if (employeeName || employeeId) {
          const fallbackTasks = tasksNow
            .filter((item) => item.status === "in_progress")
            .filter((item) => {
              const owner =
                sessionsRef.current.find((s) => s.id === item.creator) ??
                sessionsRef.current.find((s) => s.claudeSessionId != null && s.claudeSessionId === item.creator);
              return owner?.repositoryPath === session.repositoryPath;
            })
            .filter((item) => runtimeNow[item.id])
            .filter((item) => {
              const pending = pendingNow[item.id] ?? [];
              return pending.some((p) => {
                if (employeeId && p.employeeId === employeeId) return true;
                return employeeName ? p.name.trim() === employeeName.trim() : false;
              });
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);
          task = fallbackTasks[0];
        }
      }
      if (!task) return;
      const runtimeState = runtimeNow[task.id];
      if (!runtimeState) {
        return;
      }
      try {
        const graphItem = await getWorkflowGraph({ workflowId: task.workflowId });
        if (!graphItem?.graph?.nodes?.length) {
          return;
        }

        const currentNode = graphItem.graph.nodes.find((n) => n.id === runtimeState.currentNodeId) as
          | WorkflowGraphNode
          | undefined;
        if (!currentNode || currentNode.type === "start" || currentNode.type === "end") {
          return;
        }

        let acceptanceDecision: AcceptanceDecision | undefined;
        let updatedTaskAfterDecision: WorkflowTaskItem | undefined;
        let pendingEmployeesAfterDecision: Array<{ employeeId: string; name: string }> | undefined;
        const currentNodeAcceptanceEnabled =
          currentNode.type === "approval" && currentNode.data.conditionElsePrompt?.trim() === "acceptance_enabled";

        if (currentNode.type === "task") {
          const taskEmpId = currentNode.data.employeeId?.trim();
          if (taskEmpId) {
            try {
              const stageIndexBeforeDecide =
                workflowTasksRef.current.find((x) => x.id === task.id)?.currentStageIndex ?? task.currentStageIndex;
              const updatedTask = await decideWorkflowTaskStage({
                taskId: task.id,
                employeeId: taskEmpId,
                decision: "approved",
                reason: "节点执行输出完成",
              });
              updatedTaskAfterDecision = updatedTask;
              setWorkflowTasks((prev) => prev.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
              const events = await listTaskEvents(updatedTask.id);
              const pendingEmployees = await listTaskPendingEmployees(updatedTask.id);
              pendingEmployeesAfterDecision = pendingEmployees;
              setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
              setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
              const stageUnchanged = updatedTask.currentStageIndex === stageIndexBeforeDecide;
              if (stageUnchanged && pendingEmployees.length > 0) {
                logWorkflowTrace("team.task.stage_pending_others", {
                  taskId: task.id,
                  nodeId: currentNode.id,
                  pendingCount: pendingEmployees.length,
                });
                await refreshEmployeeData();
                return;
              }
            } catch (e) {
              console.error("Team auto: decideWorkflowTaskStage (task node) failed:", e);
              return;
            }
          }
        }

        if (currentNode.type === "approval") {
          if (currentNodeAcceptanceEnabled) {
            const outputHash = await sha256Hex(output.trim());
            const correlationId = `${task.id}|${currentNode.id}|${outputHash}`;
            const existingEvents = workflowTaskEventsByTaskIdRef.current[task.id] ?? [];
            if (acceptanceCompletionGuardRef.current.has(correlationId) || existingEvents.some((e) => eventHasCorrelationId(e, correlationId))) {
              logWorkflowTrace("team.decision.duplicate_completion_skipped", {
                taskId: task.id,
                nodeId: currentNode.id,
                correlationId,
              });
              return;
            }
            acceptanceCompletionGuardRef.current.add(correlationId);
            const structuredParsed = parseAcceptanceVerdictPayload(payload.structuredVerdict);
            const verdictResolution = (() => {
              if (structuredParsed.ok) {
                return {
                  ok: true as const,
                  gate: "schema" as const,
                  decision: structuredParsed.value.workflowAcceptanceVerdict === "approve" ? "pass" as const : "reject" as const,
                  payload: structuredParsed.value,
                };
              }
              if (workflowVerdictMode === "structured_only") {
                return { ok: false as const };
              }
              if (workflowVerdictMode === "heuristic") {
                const inferred = resolveAcceptanceVerdictWithGate(output, {
                  taskId: task.id,
                  graphNodeId: currentNode.id,
                });
                if (!inferred.ok) return inferred;
                return { ...inferred, gate: "inferred" as const };
              }
              return resolveAcceptanceVerdictWithGate(output, {
                taskId: task.id,
                graphNodeId: currentNode.id,
              });
            })();
            const verdictSource =
              structuredParsed.ok ? "complete_payload" : workflowVerdictMode === "structured_only" ? "structured_only" : "output_fallback";
            const unresolvedReason =
              workflowVerdictMode === "structured_only"
                ? payload.structuredVerdict == null
                  ? "structured_missing"
                  : "structured_invalid"
                : "parse_failed";
            if (!verdictResolution.ok) {
              try {
                const unresolvedEvent = await appendTaskEvent({
                  taskId: task.id,
                  eventType: WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_UNRESOLVED,
                  payloadJson: JSON.stringify({
                    schemaVersion: 1,
                    taskId: task.id,
                    graphNodeId: currentNode.id,
                    currentStageIndex: task.currentStageIndex,
                    source: "claude_turn_complete",
                    correlationId,
                    payloadSha256: outputHash,
                    reason: unresolvedReason,
                    verdictSource,
                    verdictMode: workflowVerdictMode,
                    outputChars: output.length,
                    createdAt: Date.now(),
                  }),
                });
                setWorkflowTaskEventsByTaskId((prev) => ({
                  ...prev,
                  [task.id]: [...(prev[task.id] ?? []), unresolvedEvent],
                }));
              } catch (verdictEventError) {
                console.error("Failed to persist acceptance unresolved event:", verdictEventError);
              }
              logWorkflowTrace("team.decision.pending_manual", {
                taskId: task.id,
                nodeId: currentNode.id,
                outputPreview: makePreviewText(output),
              });
              return;
            }
            acceptanceDecision = verdictResolution.decision;
            try {
              const verdictPayloadBase = {
                schemaVersion: 1,
                taskId: task.id,
                graphNodeId: currentNode.id,
                nodeId: currentNode.id,
                currentStageIndex: task.currentStageIndex,
                workflowAcceptanceVerdict: verdictResolution.decision === "pass" ? "approve" : "reject",
                acceptanceGate: verdictResolution.gate,
                verdictSource,
                verdictMode: workflowVerdictMode,
                fromStructuredVerdict: structuredParsed.ok,
                source: "claude_turn_complete",
                correlationId,
                payloadSha256: outputHash,
                outputChars: output.length,
                createdAt: Date.now(),
                ...(verdictResolution.gate === "schema"
                  ? {
                      validatedVerdictPayload: verdictResolution.payload,
                    }
                  : {}),
              };
              const verdictEvent = await appendTaskEvent({
                taskId: task.id,
                eventType: WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_SUBMITTED,
                payloadJson: JSON.stringify(verdictPayloadBase),
              });
              setWorkflowTaskEventsByTaskId((prev) => ({
                ...prev,
                [task.id]: [...(prev[task.id] ?? []), verdictEvent],
              }));
            } catch (verdictEventError) {
              console.error("Failed to persist acceptance verdict event:", verdictEventError);
            }
            logWorkflowTrace("team.decision.auto", {
              taskId: task.id,
              nodeId: currentNode.id,
              decision: verdictResolution.decision,
              acceptanceGate: verdictResolution.gate,
              verdictSource,
              verdictMode: workflowVerdictMode,
              fromStructuredVerdict: structuredParsed.ok,
            });
          }
          const pendingForDecide = taskPendingEmployeesByTaskIdRef.current[task.id] ?? [];
          const nodeEmpId = currentNode.data.employeeId?.trim();
          const empId =
            nodeEmpId && pendingForDecide.some((p) => p.employeeId === nodeEmpId)
              ? nodeEmpId
              : pendingForDecide.length === 1
                ? pendingForDecide[0]!.employeeId.trim()
                : nodeEmpId ?? pendingForDecide[0]?.employeeId?.trim() ?? "";
          if (currentNodeAcceptanceEnabled && !empId) {
            logWorkflowTrace("team.decision.pending_manual", {
              taskId: task.id,
              nodeId: currentNode.id,
              reason: "approval_node_employee_missing",
            });
            return;
          }
          if (empId) {
            try {
              const nodeDecision = currentNodeAcceptanceEnabled ? acceptanceDecision : "pass";
              const updatedTask = await decideWorkflowTaskStage({
                taskId: task.id,
                employeeId: empId,
                decision: nodeDecision === "pass" ? "approved" : "rejected",
                reason: currentNodeAcceptanceEnabled
                  ? nodeDecision === "pass"
                    ? "自动验收：通过"
                    : "自动验收：驳回"
                  : "自动流转到下一阶段",
              });
              updatedTaskAfterDecision = updatedTask;
              setWorkflowTasks((prev) => prev.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
              const events = await listTaskEvents(updatedTask.id);
              const pendingEmployees = await listTaskPendingEmployees(updatedTask.id);
              pendingEmployeesAfterDecision = pendingEmployees;
              setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
              setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
            } catch (e) {
              console.error("Team auto: decideWorkflowTaskStage failed:", e);
              return;
            }
          }
        }

        if (
          currentNodeAcceptanceEnabled &&
          acceptanceDecision === "reject" &&
          updatedTaskAfterDecision &&
          updatedTaskAfterDecision.status === "in_progress"
        ) {
          const rollbackPending = pendingEmployeesAfterDecision ?? [];
          const rollbackNode =
            resolveGraphRollbackNode(graphItem.graph, runtimeState, currentNode.id) ??
            orderedExecutableNodes(graphItem.graph)[updatedTaskAfterDecision.currentStageIndex];
          const rollbackEmployeeId = rollbackPending[0]?.employeeId ?? rollbackNode?.data.employeeId;
          const rollbackEmployeeName = rollbackPending[0]?.name ?? rollbackNode?.data.label ?? "回退阶段执行";
          if (rollbackEmployeeId) {
            const rollbackDispatch = {
              employeeId: rollbackEmployeeId,
              employeeName: rollbackEmployeeName,
              nodeType: rollbackNode ? resolveWorkflowDispatchNodeType(rollbackNode) : ("task" as WorkflowGraphNodeType),
              input: rollbackNode ? composeDispatchInput(rollbackNode, task.content, graphItem.graph) : task.content.trim(),
            };
            setWorkflowRuntimeStateByTaskId((prev) => ({
              ...prev,
              [task.id]: {
                ...runtimeState,
                currentNodeId: rollbackNode?.id ?? runtimeState.currentNodeId,
                lastOutput: output,
                trace: rollbackNode ? [...runtimeState.trace, rollbackNode.id] : runtimeState.trace,
              },
            }));
            let filledDispatchSnapshotIdForReject: string | undefined;
            let rollbackDispatchSnapshotForReject: WorkflowRuntimeStepSnapshot | undefined;
            setWorkflowRuntimeSnapshotsByTaskId((prev) => {
              const updated = updateSnapshotOutput([...(prev[task.id] ?? [])], output);
              filledDispatchSnapshotIdForReject = updated.filledDispatchSnapshotId;
              const nextSnapshots = updated.snapshots;
              const rollbackDispatchSnapshot: WorkflowRuntimeStepSnapshot = {
                id: `${task.id}-dispatch-${Date.now()}`,
                taskId: task.id,
                phase: "dispatch",
                fromNodeId: runtimeState.currentNodeId,
                toNodeId: rollbackNode?.id,
                toNodeName: rollbackDispatch.employeeName,
                toNodeType: rollbackDispatch.nodeType,
                inputPreview: snapshotTeamWorkerExecuteInput(rollbackDispatch, employeesRef.current, rollbackPending),
                outputPreview: "(待执行)",
                createdAt: Date.now(),
              };
              rollbackDispatchSnapshotForReject = rollbackDispatchSnapshot;
              nextSnapshots.push(rollbackDispatchSnapshot);
              return {
                ...prev,
                [task.id]: nextSnapshots,
              };
            });
            if (output.trim() && filledDispatchSnapshotIdForReject) {
              try {
                const updateEvent = await appendTaskEvent({
                  taskId: task.id,
                  eventType: "workflow_runtime_snapshot_update",
                  payloadJson: JSON.stringify({
                    action: "runtime_snapshot_output_update",
                    snapshotId: filledDispatchSnapshotIdForReject,
                    outputPreview: snapshotWorkflowAssistantOutput(output),
                    createdAt: Date.now(),
                  }),
                });
                setWorkflowTaskEventsByTaskId((prev) => ({
                  ...prev,
                  [task.id]: [...(prev[task.id] ?? []), updateEvent],
                }));
              } catch (runtimeUpdateEventError) {
                console.error("Failed to persist workflow runtime snapshot update (reject rollback):", runtimeUpdateEventError);
              }
            }
            if (rollbackDispatchSnapshotForReject) {
              try {
                const rollbackRuntimeEvent = await appendTaskEvent({
                  taskId: task.id,
                  eventType: "workflow_runtime_snapshot",
                  payloadJson: JSON.stringify({
                    action: "runtime_snapshot",
                    snapshot: rollbackDispatchSnapshotForReject,
                  }),
                });
                setWorkflowTaskEventsByTaskId((prev) => ({
                  ...prev,
                  [task.id]: [...(prev[task.id] ?? []), rollbackRuntimeEvent],
                }));
              } catch (runtimeEventError) {
                console.error("Failed to persist workflow runtime rollback dispatch snapshot:", runtimeEventError);
              }
            }
            await dispatchTeamStepToEmployeeSession({
              task: updatedTaskAfterDecision,
              dispatch: rollbackDispatch,
              previousNodeLabel: currentNode.data.label,
              decision: "reject",
              attachExecutorToSnapshotId: rollbackDispatchSnapshotForReject?.id,
            });
            await refreshEmployeeData();
            return;
          }
        }

        const nextStep = advanceWorkflowGraph({
          graph: graphItem.graph,
          state: runtimeState,
          startContent: task.content,
          lastOutput: output,
          acceptanceDecision: currentNode.type === "approval" ? acceptanceDecision : undefined,
        });
        let effectiveDispatch = nextStep.dispatch;
        let effectiveState = nextStep.state;
        let effectiveCompleted = nextStep.completed;
        if (
          currentNodeAcceptanceEnabled &&
          acceptanceDecision === "reject" &&
          updatedTaskAfterDecision &&
          updatedTaskAfterDecision.status === "in_progress"
        ) {
          const rollbackNode =
            resolveGraphRollbackNode(graphItem.graph, runtimeState, currentNode.id) ??
            orderedExecutableNodes(graphItem.graph)[updatedTaskAfterDecision.currentStageIndex];
          const pendingFallback = pendingEmployeesAfterDecision?.[0];
          const fallbackEmployeeId = pendingFallback?.employeeId ?? rollbackNode?.data.employeeId;
          const fallbackEmployeeName = pendingFallback?.name ?? rollbackNode?.data.label ?? "回退阶段执行";
          if (fallbackEmployeeId) {
            effectiveDispatch = {
              nodeId: rollbackNode?.id ?? `rollback-fallback-${task.id}`,
              nodeType: rollbackNode?.type ?? "task",
              employeeId: fallbackEmployeeId,
              employeeName: fallbackEmployeeName,
              input: rollbackNode ? composeDispatchInput(rollbackNode, task.content, graphItem.graph) : task.content.trim(),
            };
            effectiveState = {
              ...nextStep.state,
              currentNodeId: rollbackNode?.id ?? nextStep.state.currentNodeId,
            };
            effectiveCompleted = false;
          }
        }
        logWorkflowTrace("team.advance.next", {
          taskId: task.id,
          currentNodeId: runtimeState.currentNodeId,
          nextNodeId: effectiveState.currentNodeId,
          completed: effectiveCompleted,
          hasDispatch: Boolean(effectiveDispatch),
        });

        const decision: "pass" | "reject" | undefined =
          currentNode.type === "approval" && currentNodeAcceptanceEnabled ? acceptanceDecision : undefined;
        const pendingForSnapshotPreview = pendingEmployeesAfterDecision ?? taskPendingEmployeesByTaskIdRef.current[task.id] ?? [];
        const decisionSnapshot: WorkflowRuntimeStepSnapshot = {
          id: `${task.id}-decision-${Date.now()}`,
          taskId: task.id,
          phase: "decision",
          fromNodeId: runtimeState.currentNodeId,
          toNodeId: effectiveDispatch?.nodeId ?? effectiveState.currentNodeId,
          toNodeName: effectiveDispatch?.employeeName,
          toNodeType: effectiveDispatch?.nodeType,
          decision,
          executorSessionId: session?.id,
          inputPreview: effectiveDispatch ? snapshotWorkflowDispatchInput(effectiveDispatch.input) : "(流程已结束)",
          outputPreview: snapshotWorkflowAssistantOutput(output),
          createdAt: Date.now(),
        };

        setWorkflowRuntimeStateByTaskId((prev) => ({ ...prev, [task.id]: effectiveState }));
        let filledDispatchSnapshotIdForPersist: string | undefined;
        let nextDispatchSnapshotForPersist: WorkflowRuntimeStepSnapshot | undefined;
        setWorkflowRuntimeSnapshotsByTaskId((prev) => {
          const updated = updateSnapshotOutput([...(prev[task.id] ?? [])], output);
          filledDispatchSnapshotIdForPersist = updated.filledDispatchSnapshotId;
          const nextSnapshots = updated.snapshots;
          nextSnapshots.push(decisionSnapshot);
          if (effectiveDispatch && !effectiveCompleted) {
            const nextDispatchSnapshot: WorkflowRuntimeStepSnapshot = {
              id: `${task.id}-dispatch-${Date.now()}`,
              taskId: task.id,
              phase: "dispatch",
              fromNodeId: effectiveState.lastNodeId,
              toNodeId: effectiveDispatch.nodeId,
              toNodeName: effectiveDispatch.employeeName,
              toNodeType: effectiveDispatch.nodeType,
              inputPreview: snapshotTeamWorkerExecuteInput(effectiveDispatch, employeesRef.current, pendingForSnapshotPreview),
              outputPreview: "(待执行)",
              createdAt: Date.now(),
            };
            nextDispatchSnapshotForPersist = nextDispatchSnapshot;
            nextSnapshots.push(nextDispatchSnapshot);
          }
          return { ...prev, [task.id]: nextSnapshots };
        });

        if (output.trim() && filledDispatchSnapshotIdForPersist) {
          try {
            const updateEvent = await appendTaskEvent({
              taskId: task.id,
              eventType: "workflow_runtime_snapshot_update",
              payloadJson: JSON.stringify({
                action: "runtime_snapshot_output_update",
                snapshotId: filledDispatchSnapshotIdForPersist,
                outputPreview: snapshotWorkflowAssistantOutput(output),
                createdAt: Date.now(),
              }),
            });
            setWorkflowTaskEventsByTaskId((prev) => ({
              ...prev,
              [task.id]: [...(prev[task.id] ?? []), updateEvent],
            }));
          } catch (runtimeUpdateEventError) {
            console.error("Failed to persist workflow runtime snapshot update:", runtimeUpdateEventError);
          }
        }
        try {
          const runtimeEvent = await appendTaskEvent({
            taskId: task.id,
            eventType: "workflow_runtime_snapshot",
            payloadJson: JSON.stringify({
              action: "runtime_snapshot",
              snapshot: decisionSnapshot,
            }),
          });
          setWorkflowTaskEventsByTaskId((prev) => ({
            ...prev,
            [task.id]: [...(prev[task.id] ?? []), runtimeEvent],
          }));
        } catch (runtimeEventError) {
          console.error("Failed to persist workflow runtime decision snapshot:", runtimeEventError);
        }

        if (nextDispatchSnapshotForPersist) {
          try {
            const nextDispatchRuntimeEvent = await appendTaskEvent({
              taskId: task.id,
              eventType: "workflow_runtime_snapshot",
              payloadJson: JSON.stringify({
                action: "runtime_snapshot",
                snapshot: nextDispatchSnapshotForPersist,
              }),
            });
            setWorkflowTaskEventsByTaskId((prev) => ({
              ...prev,
              [task.id]: [...(prev[task.id] ?? []), nextDispatchRuntimeEvent],
            }));
          } catch (nextDispatchPersistError) {
            console.error("Failed to persist next workflow runtime dispatch snapshot:", nextDispatchPersistError);
          }
        }

        if (effectiveDispatch && !effectiveCompleted) {
          await dispatchTeamStepToEmployeeSession({
            task: updatedTaskAfterDecision ?? task,
            dispatch: {
              employeeId: effectiveDispatch.employeeId,
              employeeName: effectiveDispatch.employeeName,
              nodeType: effectiveDispatch.nodeType,
              input: effectiveDispatch.input,
            },
            previousNodeLabel: currentNode.data.label,
            decision,
            attachExecutorToSnapshotId: nextDispatchSnapshotForPersist?.id,
          });
        } else if (effectiveCompleted) {
          try {
            logWorkflowTrace("team.complete.auto", {
              taskId: task.id,
              workflowId: task.workflowId,
            });
            const taskAfterStep = updatedTaskAfterDecision ?? task;
            if (taskAfterStep.status === "completed") {
              const [events, pendingEmployees] = await Promise.all([
                listTaskEvents(taskAfterStep.id),
                listTaskPendingEmployees(taskAfterStep.id),
              ]);
              setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [taskAfterStep.id]: events }));
              setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [taskAfterStep.id]: pendingEmployees }));
            } else {
              const endedTask = await endWorkflowTask({
                taskId: task.id,
                reason: "到达结束节点自动完成",
              });
              setWorkflowTasks((prev) => prev.map((item) => (item.id === endedTask.id ? endedTask : item)));
              const [events, pendingEmployees] = await Promise.all([
                listTaskEvents(endedTask.id),
                listTaskPendingEmployees(endedTask.id),
              ]);
              setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [endedTask.id]: events }));
              setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [endedTask.id]: pendingEmployees }));
            }
          } catch (endError) {
            console.error("Team workflow auto end task failed:", endError);
          }
        }
        await refreshEmployeeData();
      } catch (e) {
        console.error("Team workflow auto advance failed:", e);
      }
    },
    [
      dispatchTeamStepToEmployeeSession,
      flushDingTalkAutomationReplyForTurn,
      refreshEmployeeData,
      setTaskPendingEmployeesByTaskId,
      setWorkflowRuntimeSnapshotsByTaskId,
      setWorkflowRuntimeStateByTaskId,
      setWorkflowTaskEventsByTaskId,
      setWorkflowTasks,
      workflowVerdictMode,
    ],
  );

  const handleDecideWorkflowTask = useCallback(
    async (input: Parameters<typeof decideWorkflowTaskStage>[0]) => {
      const updatedTask = await decideWorkflowTaskStage(input);
      setWorkflowTasks((prev) => prev.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
      const events = await listTaskEvents(updatedTask.id);
      const pendingEmployees = await listTaskPendingEmployees(updatedTask.id);
      setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
      setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
      const runtimeState = workflowRuntimeStateByTaskIdRef.current[updatedTask.id];
      if (runtimeState) {
        try {
          const graphItem = await getWorkflowGraph({ workflowId: updatedTask.workflowId });
          if (graphItem?.graph?.nodes?.length) {
            const currentNode = graphItem.graph.nodes.find((n) => n.id === runtimeState.currentNodeId);
            const manualAcceptanceEnabled =
              currentNode?.type === "approval" && currentNode.data.conditionElsePrompt?.trim() === "acceptance_enabled";
            if (input.decision === "rejected" && manualAcceptanceEnabled && updatedTask.status === "in_progress") {
              const rollbackNode =
                resolveGraphRollbackNode(graphItem.graph, runtimeState, currentNode.id) ??
                orderedExecutableNodes(graphItem.graph)[updatedTask.currentStageIndex];
              const rollbackEmployeeId = pendingEmployees[0]?.employeeId ?? rollbackNode?.data.employeeId;
              const rollbackEmployeeName = pendingEmployees[0]?.name ?? rollbackNode?.data.label ?? "回退阶段执行";
              if (rollbackEmployeeId) {
                setWorkflowRuntimeStateByTaskId((prev) => ({
                  ...prev,
                  [updatedTask.id]: {
                    ...runtimeState,
                    currentNodeId: rollbackNode?.id ?? runtimeState.currentNodeId,
                    trace: rollbackNode ? [...runtimeState.trace, rollbackNode.id] : runtimeState.trace,
                  },
                }));
                await dispatchTeamStepToEmployeeSession({
                  task: updatedTask,
                  dispatch: {
                    employeeId: rollbackEmployeeId,
                    employeeName: rollbackEmployeeName,
                    nodeType: rollbackNode ? resolveWorkflowDispatchNodeType(rollbackNode) : ("task" as WorkflowGraphNodeType),
                    input: rollbackNode ? composeDispatchInput(rollbackNode, updatedTask.content, graphItem.graph) : updatedTask.content.trim(),
                  },
                  previousNodeLabel: "人工验收节点",
                  decision: "reject",
                });
                await refreshEmployeeData();
                return;
              }
            }
            const taskSession = sessionsRef.current.find((item) => item.id === updatedTask.creator);
            const latestAssistantOutput = extractLatestAssistantPlainText(taskSession);
            const decision = input.decision === "approved" ? "pass" : "reject";
            const nextStep = advanceWorkflowGraph({
              graph: graphItem.graph,
              state: runtimeState,
              startContent: updatedTask.content,
              lastOutput: latestAssistantOutput,
              acceptanceDecision: decision,
            });
            const effectiveDispatch = nextStep.dispatch;
            const effectiveState = nextStep.state;
            const effectiveCompleted = nextStep.completed;
            logWorkflowTrace("team.advance.manual_decision", {
              taskId: updatedTask.id,
              decision,
              nextNodeId: effectiveState.currentNodeId,
              completed: effectiveCompleted,
            });
            const decisionSnapshot: WorkflowRuntimeStepSnapshot = {
              id: `${updatedTask.id}-decision-${Date.now()}`,
              taskId: updatedTask.id,
              phase: "decision",
              fromNodeId: runtimeState.currentNodeId,
              toNodeId: effectiveDispatch?.nodeId ?? effectiveState.currentNodeId,
              toNodeName: effectiveDispatch?.employeeName,
              toNodeType: effectiveDispatch?.nodeType,
              decision,
              executorSessionId: taskSession?.id,
              inputPreview: effectiveDispatch ? snapshotWorkflowDispatchInput(effectiveDispatch.input) : "(流程已结束)",
              outputPreview: snapshotWorkflowAssistantOutput(latestAssistantOutput),
              createdAt: Date.now(),
            };
            setWorkflowRuntimeStateByTaskId((prev) => ({ ...prev, [updatedTask.id]: effectiveState }));
            let filledDispatchSnapshotIdManual: string | undefined;
            let nextDispatchSnapshotManual: WorkflowRuntimeStepSnapshot | undefined;
            setWorkflowRuntimeSnapshotsByTaskId((prev) => {
              const updated = updateSnapshotOutput([...(prev[updatedTask.id] ?? [])], latestAssistantOutput);
              filledDispatchSnapshotIdManual = updated.filledDispatchSnapshotId;
              const nextSnapshots = updated.snapshots;
              nextSnapshots.push(decisionSnapshot);
              if (effectiveDispatch && !effectiveCompleted) {
                const nextDispatchSnapshot: WorkflowRuntimeStepSnapshot = {
                  id: `${updatedTask.id}-dispatch-${Date.now()}`,
                  taskId: updatedTask.id,
                  phase: "dispatch",
                  fromNodeId: effectiveState.lastNodeId,
                  toNodeId: effectiveDispatch.nodeId,
                  toNodeName: effectiveDispatch.employeeName,
                  toNodeType: effectiveDispatch.nodeType,
                  inputPreview: snapshotTeamWorkerExecuteInput(effectiveDispatch, employeesRef.current, pendingEmployees),
                  outputPreview: "(待执行)",
                  createdAt: Date.now(),
                };
                nextDispatchSnapshotManual = nextDispatchSnapshot;
                nextSnapshots.push(nextDispatchSnapshot);
              }
              return {
                ...prev,
                [updatedTask.id]: nextSnapshots,
              };
            });
            if (latestAssistantOutput.trim() && filledDispatchSnapshotIdManual) {
              try {
                const updateEvent = await appendTaskEvent({
                  taskId: updatedTask.id,
                  eventType: "workflow_runtime_snapshot_update",
                  payloadJson: JSON.stringify({
                    action: "runtime_snapshot_output_update",
                    snapshotId: filledDispatchSnapshotIdManual,
                    outputPreview: snapshotWorkflowAssistantOutput(latestAssistantOutput),
                    createdAt: Date.now(),
                  }),
                });
                setWorkflowTaskEventsByTaskId((prev) => ({
                  ...prev,
                  [updatedTask.id]: [...(prev[updatedTask.id] ?? []), updateEvent],
                }));
              } catch (runtimeUpdateEventError) {
                console.error("Failed to persist workflow runtime snapshot update:", runtimeUpdateEventError);
              }
            }
            try {
              const runtimeEvent = await appendTaskEvent({
                taskId: updatedTask.id,
                eventType: "workflow_runtime_snapshot",
                payloadJson: JSON.stringify({
                  action: "runtime_snapshot",
                  snapshot: decisionSnapshot,
                }),
              });
              setWorkflowTaskEventsByTaskId((prev) => ({
                ...prev,
                [updatedTask.id]: [...(prev[updatedTask.id] ?? []), runtimeEvent],
              }));
            } catch (runtimeEventError) {
              console.error("Failed to persist workflow runtime decision snapshot:", runtimeEventError);
            }
            if (nextDispatchSnapshotManual) {
              try {
                const nextDispatchRuntimeEvent = await appendTaskEvent({
                  taskId: updatedTask.id,
                  eventType: "workflow_runtime_snapshot",
                  payloadJson: JSON.stringify({
                    action: "runtime_snapshot",
                    snapshot: nextDispatchSnapshotManual,
                  }),
                });
                setWorkflowTaskEventsByTaskId((prev) => ({
                  ...prev,
                  [updatedTask.id]: [...(prev[updatedTask.id] ?? []), nextDispatchRuntimeEvent],
                }));
              } catch (nextDispatchPersistError) {
                console.error("Failed to persist next workflow runtime dispatch snapshot:", nextDispatchPersistError);
              }
            }
            if (effectiveDispatch && !effectiveCompleted) {
              await dispatchTeamStepToEmployeeSession({
                task: updatedTask,
                dispatch: {
                  employeeId: effectiveDispatch.employeeId,
                  employeeName: effectiveDispatch.employeeName,
                  nodeType: effectiveDispatch.nodeType,
                  input: effectiveDispatch.input,
                },
                previousNodeLabel: "人工验收节点",
                decision,
                attachExecutorToSnapshotId: nextDispatchSnapshotManual?.id,
              });
            } else if (effectiveCompleted) {
              try {
                logWorkflowTrace("team.complete.manual_decision", {
                  taskId: updatedTask.id,
                  workflowId: updatedTask.workflowId,
                });
                if (updatedTask.status === "completed") {
                  const [endedEvents, endedPendingEmployees] = await Promise.all([
                    listTaskEvents(updatedTask.id),
                    listTaskPendingEmployees(updatedTask.id),
                  ]);
                  setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: endedEvents }));
                  setTaskPendingEmployeesByTaskId((prev) => ({
                    ...prev,
                    [updatedTask.id]: endedPendingEmployees,
                  }));
                } else {
                  const endedTask = await endWorkflowTask({
                    taskId: updatedTask.id,
                    reason: "到达结束节点自动完成",
                  });
                  setWorkflowTasks((prev) => prev.map((item) => (item.id === endedTask.id ? endedTask : item)));
                  const [endedEvents, endedPendingEmployees] = await Promise.all([
                    listTaskEvents(endedTask.id),
                    listTaskPendingEmployees(endedTask.id),
                  ]);
                  setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [endedTask.id]: endedEvents }));
                  setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [endedTask.id]: endedPendingEmployees }));
                }
              } catch (endError) {
                console.error("Failed to auto complete workflow task at end node:", endError);
              }
            }
          }
        } catch (runtimeError) {
          console.error("Failed to advance workflow graph runtime:", runtimeError);
        }
      }
      await refreshEmployeeData();
    },
    [
      dispatchTeamStepToEmployeeSession,
      refreshEmployeeData,
      setTaskPendingEmployeesByTaskId,
      setWorkflowRuntimeSnapshotsByTaskId,
      setWorkflowRuntimeStateByTaskId,
      setWorkflowTaskEventsByTaskId,
      setWorkflowTasks,
    ],
  );

  return {
    handleClaudeTurnComplete,
    handleComposerExecute,
    handleDecideWorkflowTask,
    handleSendMessageWithTask,
    moveWorkflowAutomationSessionId,
    notifyOmcEmployeeDirectBatchTaskDone,
    prepareFreshOmcEmployeeWorkerForDirectBatch,
    refreshEmployeeData,
  };
}
