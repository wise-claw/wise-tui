import { Button, Drawer, Empty, Space, Tag, Typography, message } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { List } from "../ui/AppList";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useClaudeSessionsLiveSnapshot } from "../../stores/claudeSessionsLiveStore";
import type {
  ClaudeSession,
  EmployeeItem,
  EmployeeMonitorItem,
  MonitorDrawerTarget,
  TeamMonitorItem,
  WorkflowGraph,
  WorkflowRuntimeStepSnapshot,
  WorkflowTaskEventItem,
  WorkflowTaskItem,
  WorkflowTemplateItem,
} from "../../types";
import {
  getOmcDirectBatchInvocationsSnapshot,
  subscribeOmcDirectBatchInvocations,
} from "../../stores/omcDirectBatchInvocationsStore";
import { sortWorkflowRuntimeSnapshotsChronological } from "../../utils/sortWorkflowRuntimeSnapshots";
import { resolveWorkflowProgressGraphHighlight } from "../../utils/resolveWorkflowProgressGraphHighlight";
import { describeNextExecutorAfterDispatch } from "../../utils/workflowTeamNextExecutor";
import { findLatestRuntimeSnapshotForGraphNode } from "../../utils/findLatestRuntimeSnapshotForGraphNode";
import {
  WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_SUBMITTED,
  WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_UNRESOLVED,
} from "../../constants/workflowEvents";
import {
  buildMonitorEmployeeHistorySessionsByName,
  monitorEmployeeHistoryStructureFingerprint,
} from "../../utils/omcEmployeeMonitorHistory";
import {
  formatOmcDirectBatchInvocationErrorPreviewLineForList,
  formatOmcDirectBatchInvocationListTitle,
  isOmcDirectBatchInvocationRunning,
} from "../../utils/omcDirectBatchInvocationDisplay";
import type { WorkflowInvocationStreamDetail } from "../../constants/workflowUiEvents";
import { OmcDirectBatchInvocationDetailDrawer } from "../ProgressMonitorPanel/OmcDirectBatchInvocationDetailDrawer";
import { MonitorHistorySessionTranscriptDrawer } from "../ProgressMonitorPanel/MonitorHistorySessionTranscriptDrawer";
import { WorkflowProgressGraphCanvas } from "../WorkflowProgressGraphCanvas";
import "./index.css";

/** OMC 员工直连批量：与列表同源订阅，用于状态标签上路数 */
function OmcWorkerDirectBatchStatusTag({ inProgress }: { inProgress: boolean }) {
  const invocations = useSyncExternalStore(
    subscribeOmcDirectBatchInvocations,
    getOmcDirectBatchInvocationsSnapshot,
    getOmcDirectBatchInvocationsSnapshot,
  );
  const nRun = invocations.filter(isOmcDirectBatchInvocationRunning).length;
  const nTotal = invocations.length;
  if (!inProgress) {
    if (nTotal > 0) {
      return <Tag color="default">{nRun > 0 ? `执行中 · ${nRun} 路` : `历史 · ${nTotal} 路`}</Tag>;
    }
    return <Tag color="default">空闲</Tag>;
  }
  return <Tag color="success">{nRun > 0 ? `执行中 · ${nRun} 路` : nTotal > 0 ? `历史 · ${nTotal} 路` : "执行中"}</Tag>;
}

const OmcWorkerDrawerInvocationList = memo(function OmcWorkerDrawerInvocationListInner({
  onRowActivate,
  onCancelInvocation,
}: {
  onRowActivate: (inv: WorkflowInvocationStreamDetail) => void;
  onCancelInvocation?: (invocationKey: string) => void;
}) {
  const omcDirectBatchInvocations = useSyncExternalStore(
    subscribeOmcDirectBatchInvocations,
    getOmcDirectBatchInvocationsSnapshot,
    getOmcDirectBatchInvocationsSnapshot,
  );
  if (omcDirectBatchInvocations.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无历史会话。每路结束后会将截断 stdout/stderr 与派发正文写入发起批量的 Repo 执行会话「后台执行详情」，请打开该执行会话回溯。"
      />
    );
  }
  return (
    <List
      size="small"
      dataSource={omcDirectBatchInvocations}
      renderItem={(inv) => {
        const phaseLabel =
          inv.phase === "progress"
            ? "输出中"
            : inv.phase === "started"
              ? "已启动"
              : inv.phase === "complete"
                ? inv.success === false
                  ? "失败"
                  : "已完成"
                : "—";
        const phaseTagColor =
          inv.phase === "progress" ? "processing" : inv.phase === "complete" ? (inv.success === false ? "error" : "success") : "default";
        const errorPreview = formatOmcDirectBatchInvocationErrorPreviewLineForList(inv, 240);
        return (
          <List.Item
            className="app-monitor-drawer__omc-inv-item"
            actions={
              onCancelInvocation && isOmcDirectBatchInvocationRunning(inv)
                ? [
                    <HoverHint title="结束该 Claude Code 子进程" key="stop">
                      <Button
                        type="link"
                        size="small"
                        danger
                        onClick={(event) => {
                          event.stopPropagation();
                          onCancelInvocation(inv.invocationKey);
                        }}
                      >
                        结束
                      </Button>
                    </HoverHint>,
                  ]
                : []
            }
          >
            <button
              type="button"
              className="app-monitor-drawer__message app-monitor-drawer__message--button"
              onClick={() => onRowActivate(inv)}
            >
              <div className="app-monitor-drawer__message-head">
                <span>{formatOmcDirectBatchInvocationListTitle(inv)}</span>
                <Tag color={phaseTagColor}>{phaseLabel}</Tag>
              </div>
              {errorPreview ? <div className="app-monitor-drawer__message-body">{errorPreview}</div> : null}
            </button>
          </List.Item>
        );
      }}
    />
  );
});

interface Props {
  open: boolean;
  target: MonitorDrawerTarget | null;
  onClose: () => void;
  employeeItems: EmployeeMonitorItem[];
  teamItems: TeamMonitorItem[];
  workflowTasks: WorkflowTaskItem[];
  workflowTaskEventsByTaskId: Record<string, WorkflowTaskEventItem[]>;
  workflowRuntimeSnapshotsByTaskId: Record<string, WorkflowRuntimeStepSnapshot[]>;
  taskPendingEmployeesByTaskId: Record<string, Array<{ employeeId: string; name: string }>>;
  sessions: ClaudeSession[];
  employees: EmployeeItem[];
  workflowTemplates: WorkflowTemplateItem[];
  /** 与监控台同源的工作流图，用于团队/任务详情中的只读进度画布 */
  workflowGraphsByWorkflowId?: Record<string, WorkflowGraph>;
  onJumpToSession?: (sessionId: string) => void;
  onOpenOmcBatchInvocationDetail?: (input: { sessionId: string; repositoryPath: string; invocationKey: string }) => void;
  onCancelOmcDirectBatchInvocation?: (invocationKey: string) => void;
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  onLoadMoreTranscriptFromDisk?: (sessionId: string) => void | Promise<void>;
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  /** 历史执行会话消息抽屉：应用实时会话列表解析正文，避免与节流 `sessions` 不同步导致消息闪没 */
  transcriptSourceSessions?: ClaudeSession[];
  /** 与监控台一致：抽屉内停止运行中会话 */
  onCancelSession?: (sessionId: string) => void;
  /** 历史消息内「查看任务详情」 */
  onOpenTaskDetail?: (taskId: string) => void;
  /** 历史会话抽屉底部：resume 继续执行 */
  onResumeSession?: import("../ProgressMonitorPanel/MonitorDrawerSessionComposer").MonitorDrawerResumeSessionFn;
}

interface SessionMessageRow {
  sessionId: string;
  sessionTitle: string;
  role: string;
  content: string;
  timestamp: number;
}

interface OmcRunProgressRow {
  timestamp: number;
  stage: string;
  message: string;
  level: "info" | "warning" | "error";
}

interface OmcExecutionRun {
  taskRunId: string;
  taskId: string;
  templateId?: string;
  attempt?: number;
  subagentType?: string;
  ownerKind?: "repository";
  ownerRepositoryId?: number;
  ownerRepositoryName?: string;
  ownerRepositoryPath?: string;
  repositoryType?: "frontend" | "backend" | "document";
  trellisStage?: string;
  omcCommand?: string;
  startedAt?: number;
  endedAt?: number;
  status: "running" | "succeeded" | "failed" | "aborted";
  summary?: string;
  error?: string;
  progress: OmcRunProgressRow[];
}

function formatWorkflowNodeTypeLabel(nodeType?: string): string {
  if (!nodeType) return "未知";
  if (nodeType === "start") return "开始节点";
  if (nodeType === "end") return "结束节点";
  if (nodeType === "task") return "执行节点";
  if (nodeType === "approval") return "审批节点";
  return nodeType;
}

function formatRepositoryTypeLabel(value?: string): string | null {
  if (!value) return null;
  if (value === "frontend") return "前端";
  if (value === "backend") return "后端";
  if (value === "document") return "文档";
  return value;
}

interface AcceptanceVerdictEventPayload {
  workflowAcceptanceVerdict?: "approve" | "reject";
  acceptanceGate?: "schema" | "inferred";
  verdictSource?: string;
  verdictMode?: string;
  reason?: string;
  graphNodeId?: string;
  rationale?: string;
  validatedVerdictPayload?: {
    rationale?: string;
  };
}

function formatAcceptanceGateLabel(value?: string): string | null {
  if (!value) return null;
  if (value === "schema") return "Schema 门闸";
  if (value === "inferred") return "文本推断";
  return value;
}

function formatVerdictSourceLabel(value?: string): string | null {
  if (!value) return null;
  if (value === "complete_payload") return "结构化载荷";
  if (value === "output_fallback") return "输出兜底";
  if (value === "structured_only") return "仅结构化模式";
  if (value === "unknown") return "未知来源";
  return value;
}

function formatVerdictModeLabel(value?: string): string | null {
  if (!value) return null;
  if (value === "structured_plus_extractor") return "Structured+Fallback";
  if (value === "structured_only") return "StructuredOnly";
  if (value === "heuristic") return "Heuristic";
  return value;
}

function formatAcceptanceReasonLabel(value?: string): string | null {
  if (!value) return null;
  if (value === "parse_failed") return "解析失败";
  if (value === "structured_missing") return "缺少结构化判定";
  if (value === "structured_invalid") return "结构化判定无效";
  if (value === "approval_node_employee_missing") return "审批节点缺少执行员工";
  return value;
}

function formatTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(timestamp);
  }
}

async function copyText(text: string): Promise<void> {
  if (!text) return;
  await navigator.clipboard.writeText(text);
}

const RUNTIME_GRAPH_HOVER_PREVIEW_MAX = 1200;

function buildRuntimeGraphHoverNodeContent(input: {
  nodeId: string;
  snapshotsSorted: WorkflowRuntimeStepSnapshot[];
  taskPending: Array<{ employeeId: string; name: string }>;
  taskStatus: WorkflowTaskItem["status"];
  employees: EmployeeItem[];
}): ReactNode | null {
  const { nodeId, snapshotsSorted, taskPending, taskStatus, employees } = input;
  const nid = nodeId.trim();
  let bestIdx = -1;
  let best: WorkflowRuntimeStepSnapshot | undefined;
  for (let i = snapshotsSorted.length - 1; i >= 0; i -= 1) {
    const s = snapshotsSorted[i];
    if (!s || s.toNodeId?.trim() !== nid) continue;
    best = s;
    bestIdx = i;
    break;
  }
  if (!best || bestIdx < 0) return null;
  const nextExecutor = describeNextExecutorAfterDispatch(snapshotsSorted, bestIdx, taskPending, taskStatus);
  const name = best.toNodeName?.trim();
  const emp = name ? employees.find((e) => e.name.trim() === name) : undefined;
  const agent = emp?.agentType?.trim();
  const inputText = best.inputPreview?.trim() || "(无)";
  const outputText = best.outputPreview?.trim() || "(无)";
  const clamp = (t: string) => (t.length > RUNTIME_GRAPH_HOVER_PREVIEW_MAX ? `${t.slice(0, RUNTIME_GRAPH_HOVER_PREVIEW_MAX)}…` : t);
  const awaiting = outputText === "(待执行)";
  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <Typography.Text strong style={{ fontSize: 12 }}>
          {best.phase === "dispatch" ? "派发" : "决策"} · {best.toNodeName?.trim() || best.toNodeId || "—"}
        </Typography.Text>
        {awaiting ? (
          <Tag color="processing" style={{ marginLeft: 8 }}>
            待返回
          </Tag>
        ) : null}
        <span className="app-monitor-drawer__muted" style={{ marginLeft: 8, fontSize: 11 }}>
          {formatTime(best.createdAt)}
        </span>
      </div>
      {best.executorSessionId?.trim() ? (
        <div className="app-monitor-drawer__muted" style={{ fontSize: 11, marginBottom: 4 }}>
          已绑定 Wise 会话：可点击节点打开消息抽屉
        </div>
      ) : (
        <div className="app-monitor-drawer__muted" style={{ fontSize: 11, marginBottom: 4 }}>
          该步骤未记录执行会话，无法从节点直达消息抽屉
        </div>
      )}
      {best.toNodeType ? (
        <div className="app-monitor-drawer__muted" style={{ fontSize: 11 }}>
          节点类型：{formatWorkflowNodeTypeLabel(best.toNodeType)}
          {agent ? ` · 执行前缀：/${agent}` : ""}
        </div>
      ) : null}
      <div style={{ marginTop: 8 }}>
        <Space size={6} align="center" style={{ marginBottom: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            输入（派发拼接）
          </Typography.Text>
          <Button type="link" size="small" style={{ padding: 0, height: "auto", fontSize: 11 }} onClick={() => void copyText(inputText)}>
            复制
          </Button>
        </Space>
        <pre className="app-monitor-drawer__team-step-pre" style={{ maxHeight: 180, overflow: "auto" }}>
          {clamp(inputText)}
        </pre>
      </div>
      <div style={{ marginTop: 8 }}>
        <Space size={6} align="center" style={{ marginBottom: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            会话返回
          </Typography.Text>
          <Button type="link" size="small" style={{ padding: 0, height: "auto", fontSize: 11 }} onClick={() => void copyText(outputText)}>
            复制
          </Button>
        </Space>
        <pre className="app-monitor-drawer__team-step-pre" style={{ maxHeight: 180, overflow: "auto" }}>
          {clamp(outputText)}
        </pre>
      </div>
      <div className="app-monitor-drawer__muted" style={{ marginTop: 6, fontSize: 11 }}>
        下一阶段执行方：<strong>{nextExecutor}</strong>
      </div>
    </div>
  );
}

function extractBoundEmployeeName(repositoryName: string): string | null {
  const marker = "员工:";
  const idx = repositoryName.lastIndexOf(marker);
  if (idx < 0) return null;
  const value = repositoryName.slice(idx + marker.length).trim();
  return value || null;
}

function sessionUpdatedAt(session: ClaudeSession): number {
  const lastTimestamp = session.messages[session.messages.length - 1]?.timestamp;
  return typeof lastTimestamp === "number" ? lastTimestamp : session.createdAt;
}

function extractSessionPreview(session: ClaudeSession | undefined): string {
  if (!session) return "暂无会话";
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role === "user" || msg.role === "assistant") {
      const text = msg.content.trim();
      if (text) return text.length > 90 ? `${text.slice(0, 90)}...` : text;
    }
  }
  const fallback = session.diskPreview?.trim() || "暂无会话";
  return fallback.length > 90 ? `${fallback.slice(0, 90)}...` : fallback;
}

function flattenSessionMessages(sessions: ClaudeSession[]): SessionMessageRow[] {
  return sessions
    .flatMap((session) =>
      session.messages.map((msg) => ({
        sessionId: session.id,
        sessionTitle: session.repositoryName || session.id,
        role: msg.role,
        content: msg.content || "(空消息)",
        timestamp: msg.timestamp,
      })),
    )
    .sort((a, b) => b.timestamp - a.timestamp);
}

function resolveTeamDrawerTask(teamItem: TeamMonitorItem | undefined, tasks: WorkflowTaskItem[]): WorkflowTaskItem | undefined {
  if (!teamItem) return undefined;
  const list = tasks.filter((t) => t.workflowId === teamItem.workflowId);
  if (list.length === 0) return undefined;
  const active = list.find((t) => t.status === "in_progress");
  if (active) return active;
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

function extractEventEmployeeIds(events: WorkflowTaskEventItem[]): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    if (!event.payloadJson) continue;
    try {
      const payload = JSON.parse(event.payloadJson) as { employeeId?: string };
      const employeeId = payload.employeeId?.trim();
      if (employeeId) ids.add(employeeId);
    } catch {
      // ignore malformed payload
    }
  }
  return Array.from(ids);
}

function parseAcceptanceVerdictEventPayload(event: WorkflowTaskEventItem): AcceptanceVerdictEventPayload | null {
  if (
    event.eventType !== WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_SUBMITTED &&
    event.eventType !== WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_UNRESOLVED
  ) {
    return null;
  }
  if (!event.payloadJson) return null;
  try {
    return JSON.parse(event.payloadJson) as AcceptanceVerdictEventPayload;
  } catch {
    return null;
  }
}

function readTaskRunPayload(event: WorkflowTaskEventItem): Record<string, unknown> | null {
  if (!event.payloadJson) return null;
  try {
    return JSON.parse(event.payloadJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectOmcRuns(events: WorkflowTaskEventItem[], taskId: string): OmcExecutionRun[] {
  const runsById = new Map<string, OmcExecutionRun>();
  const runOrder: string[] = [];
  const ensureRun = (taskRunId: string): OmcExecutionRun => {
    const existing = runsById.get(taskRunId);
    if (existing) return existing;
    const next: OmcExecutionRun = {
      taskRunId,
      taskId,
      status: "running",
      progress: [],
    };
    runsById.set(taskRunId, next);
    runOrder.push(taskRunId);
    return next;
  };

  for (const event of events) {
    if (
      event.eventType !== "task.run.started" &&
      event.eventType !== "task.run.progressed" &&
      event.eventType !== "task.run.succeeded" &&
      event.eventType !== "task.run.failed" &&
      event.eventType !== "task.run.aborted"
    ) {
      continue;
    }
    const payload = readTaskRunPayload(event);
    if (!payload) continue;
    const payloadTaskId = typeof payload.taskId === "string" ? payload.taskId : "";
    if (payloadTaskId !== taskId) continue;
    const taskRunIdRaw = typeof payload.taskRunId === "string" ? payload.taskRunId.trim() : "";
    const taskRunId = taskRunIdRaw || `unknown-${event.id}`;
    const run = ensureRun(taskRunId);

    const templateId = typeof payload.templateId === "string" ? payload.templateId.trim() : "";
    if (templateId) run.templateId = templateId;
    if (typeof payload.attempt === "number") run.attempt = payload.attempt;
    const payloadCommand = typeof payload.omcCommand === "string" ? payload.omcCommand.trim() : "";
    if (payloadCommand) run.omcCommand = payloadCommand;
    const metadata =
      payload.metadata && typeof payload.metadata === "object"
        ? (payload.metadata as Record<string, unknown>)
        : undefined;
    const metadataCommand = typeof metadata?.omcCommand === "string" ? metadata.omcCommand.trim() : "";
    if (metadataCommand) run.omcCommand = metadataCommand;
    const subagentType = typeof payload.subagentType === "string" ? payload.subagentType.trim() : "";
    if (subagentType) run.subagentType = subagentType;
    const metadataSubagent = typeof metadata?.subagentType === "string" ? metadata.subagentType.trim() : "";
    if (metadataSubagent) run.subagentType = metadataSubagent;
    const ownerKind = typeof metadata?.ownerKind === "string" ? metadata.ownerKind.trim() : "";
    if (ownerKind === "repository") run.ownerKind = "repository";
    const ownerRepositoryId = typeof metadata?.ownerRepositoryId === "number" ? metadata.ownerRepositoryId : undefined;
    if (typeof ownerRepositoryId === "number" && Number.isFinite(ownerRepositoryId)) {
      run.ownerRepositoryId = ownerRepositoryId;
    }
    const ownerRepositoryName =
      typeof metadata?.ownerRepositoryName === "string" ? metadata.ownerRepositoryName.trim() : "";
    if (ownerRepositoryName) run.ownerRepositoryName = ownerRepositoryName;
    const ownerRepositoryPath =
      typeof metadata?.ownerRepositoryPath === "string" ? metadata.ownerRepositoryPath.trim() : "";
    if (ownerRepositoryPath) run.ownerRepositoryPath = ownerRepositoryPath;
    const repositoryType = typeof metadata?.repositoryType === "string" ? metadata.repositoryType.trim() : "";
    if (repositoryType === "frontend" || repositoryType === "backend" || repositoryType === "document") {
      run.repositoryType = repositoryType;
    }
    const trellisStage = typeof metadata?.stage === "string" ? metadata.stage.trim() : "";
    if (trellisStage) run.trellisStage = trellisStage;

    if (event.eventType === "task.run.started") {
      run.startedAt = event.createdAt;
      run.status = "running";
      continue;
    }

    if (event.eventType === "task.run.progressed") {
      const stage = typeof payload.stage === "string" && payload.stage.trim() ? payload.stage.trim() : "adapter.progress";
      const message = typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : "执行中";
      const levelRaw = typeof payload.level === "string" ? payload.level : "info";
      const level: OmcRunProgressRow["level"] = levelRaw === "error" ? "error" : levelRaw === "warning" ? "warning" : "info";
      run.progress.push({
        timestamp: event.createdAt,
        stage,
        message,
        level,
      });
      continue;
    }

    run.endedAt = event.createdAt;
    if (event.eventType === "task.run.succeeded") {
      run.status = "succeeded";
    } else if (event.eventType === "task.run.aborted") {
      run.status = "aborted";
    } else {
      run.status = "failed";
    }
    const summary = typeof payload.summary === "string" ? payload.summary.trim() : "";
    if (summary) run.summary = summary;
    const error = typeof payload.error === "string" ? payload.error.trim() : "";
    if (error) run.error = error;
  }

  return runOrder
    .map((id) => runsById.get(id))
    .filter((item): item is OmcExecutionRun => Boolean(item))
    .sort((a, b) => (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0));
}

export function ProgressMonitorDrawer({
  open,
  target,
  onClose,
  employeeItems,
  teamItems,
  workflowTasks,
  workflowTaskEventsByTaskId,
  workflowRuntimeSnapshotsByTaskId,
  taskPendingEmployeesByTaskId,
  sessions,
  employees,
  workflowTemplates,
  workflowGraphsByWorkflowId = {},
  onJumpToSession,
  onOpenOmcBatchInvocationDetail,
  onCancelOmcDirectBatchInvocation,
  onReloadFullDiskTranscript,
  onCompactSessionHistory,
  transcriptSourceSessions: _transcriptSourceSessions,
  onCancelSession,
  onOpenTaskDetail,
  onResumeSession,
}: Props) {
  const liveTranscriptSessions = useClaudeSessionsLiveSnapshot(open);
  const [employeeMessageLimit, setEmployeeMessageLimit] = useState(20);
  const [omcDirectBatchDetailSnapshot, setOmcDirectBatchDetailSnapshot] = useState<WorkflowInvocationStreamDetail | null>(null);
  /** 员工「历史执行会话消息」：仅预览，不替换中栏主会话。 */
  const [historyPeekSessionId, setHistoryPeekSessionId] = useState<string | null>(null);

  const omcDirectBatchInvocationsLiveDrawer = useSyncExternalStore(
    subscribeOmcDirectBatchInvocations,
    getOmcDirectBatchInvocationsSnapshot,
    getOmcDirectBatchInvocationsSnapshot,
  );
  useEffect(() => {
    setOmcDirectBatchDetailSnapshot((prev) => {
      if (!prev) return prev;
      const fresh = omcDirectBatchInvocationsLiveDrawer.find((i) => i.invocationKey === prev.invocationKey);
      if (!fresh) return prev;
      const sid = fresh.subprocessSessionId?.trim() || prev.subprocessSessionId?.trim();
      const merged: WorkflowInvocationStreamDetail = {
        ...prev,
        ...fresh,
        ...(sid ? { subprocessSessionId: sid } : {}),
      };
      if (
        merged.phase === prev.phase &&
        merged.lineCount === prev.lineCount &&
        merged.errCount === prev.errCount &&
        merged.previewLine === prev.previewLine &&
        merged.subprocessSessionId === prev.subprocessSessionId &&
        merged.success === prev.success
      ) {
        return prev;
      }
      return merged;
    });
  }, [omcDirectBatchInvocationsLiveDrawer]);

  useEffect(() => {
    if (target?.type === "employee") {
      setEmployeeMessageLimit(20);
    }
  }, [target]);

  useEffect(() => {
    if (!open) {
      setOmcDirectBatchDetailSnapshot(null);
      setHistoryPeekSessionId(null);
    }
  }, [open]);

  useEffect(() => {
    setHistoryPeekSessionId(null);
  }, [target]);

  const handleOpenOmcBatchFromDetailDrawer = useCallback(
    (input: { sessionId: string; repositoryPath: string; invocationKey: string }) => {
      setOmcDirectBatchDetailSnapshot(null);
      onOpenOmcBatchInvocationDetail?.(input);
      onClose();
    },
    [onClose, onOpenOmcBatchInvocationDetail],
  );

  const sessionById = useMemo(() => {
    const m = new Map<string, ClaudeSession>();
    for (const s of sessions) {
      m.set(s.id, s);
      const cid = s.claudeSessionId?.trim();
      if (cid) m.set(cid, s);
    }
    return m;
  }, [sessions]);
  const employeeById = useMemo(() => new Map(employees.map((item) => [item.id, item] as const)), [employees]);
  const workflowById = useMemo(() => new Map(workflowTemplates.map((item) => [item.id, item] as const)), [workflowTemplates]);

  const employeeItem = target?.type === "employee" ? employeeItems.find((item) => item.employeeId === target.employeeId) : undefined;
  const teamItem = target?.type === "team" ? teamItems.find((item) => item.workflowId === target.workflowId) : undefined;

  const employeeTask = employeeItem?.activeTaskId ? workflowTasks.find((item) => item.id === employeeItem.activeTaskId) : undefined;
  const employeeSession = employeeItem?.sessionId ? sessionById.get(employeeItem.sessionId) : undefined;
  const drawerEmployeeHistCacheRef = useRef<{ fp: string; list: ClaudeSession[] } | null>(null);
  const employeeHistorySessions = useMemo(() => {
    if (!employeeItem) return [];
    if (employeeItem.employeeId === "omc-worker") return [];
    const name = employeeItem.name.trim();
    const fp = `${monitorEmployeeHistoryStructureFingerprint(sessions)}\x1e${name}`;
    const hit = drawerEmployeeHistCacheRef.current;
    if (hit && hit.fp === fp) {
      return hit.list;
    }
    const byName = buildMonitorEmployeeHistorySessionsByName(sessions);
    const list = byName.get(name) ?? [];
    drawerEmployeeHistCacheRef.current = { fp, list };
    return list;
  }, [employeeItem, sessions]);
  const employeeMessageRows = useMemo(() => flattenSessionMessages(employeeHistorySessions), [employeeHistorySessions]);

  const teamTask = useMemo(() => resolveTeamDrawerTask(teamItem, workflowTasks), [teamItem, workflowTasks]);
  const teamSnapshotsSorted = useMemo(() => {
    if (!teamTask) return [];
    return sortWorkflowRuntimeSnapshotsChronological(workflowRuntimeSnapshotsByTaskId[teamTask.id] ?? []);
  }, [teamTask, workflowRuntimeSnapshotsByTaskId]);
  const teamLatestAcceptanceEvent = useMemo(() => {
    if (!teamTask) return null;
    const events = workflowTaskEventsByTaskId[teamTask.id] ?? [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (
        event.eventType === WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_SUBMITTED ||
        event.eventType === WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_UNRESOLVED
      ) {
        return event;
      }
    }
    return null;
  }, [teamTask, workflowTaskEventsByTaskId]);
  const teamLatestAcceptancePayload = useMemo(() => {
    if (!teamLatestAcceptanceEvent) return null;
    return parseAcceptanceVerdictEventPayload(teamLatestAcceptanceEvent);
  }, [teamLatestAcceptanceEvent]);
  const teamLatestDecisionOutputPreview = useMemo(() => {
    for (let i = teamSnapshotsSorted.length - 1; i >= 0; i -= 1) {
      const item = teamSnapshotsSorted[i];
      if (item.phase !== "decision") continue;
      const output = item.outputPreview?.trim();
      if (!output || output === "(空)") continue;
      return output;
    }
    return null;
  }, [teamSnapshotsSorted]);
  const latestAcceptanceGateLabel = formatAcceptanceGateLabel(teamLatestAcceptancePayload?.acceptanceGate);
  const latestVerdictSourceLabel = formatVerdictSourceLabel(teamLatestAcceptancePayload?.verdictSource);
  const latestVerdictModeLabel = formatVerdictModeLabel(teamLatestAcceptancePayload?.verdictMode);
  const latestAcceptanceReasonLabel = formatAcceptanceReasonLabel(teamLatestAcceptancePayload?.reason);
  const latestAcceptanceEvidence = useMemo(() => {
    const fromValidatedPayload = teamLatestAcceptancePayload?.validatedVerdictPayload?.rationale?.trim();
    if (fromValidatedPayload) return fromValidatedPayload;
    const fromPayload = teamLatestAcceptancePayload?.rationale?.trim();
    if (fromPayload) return fromPayload;
    if (teamLatestDecisionOutputPreview) return teamLatestDecisionOutputPreview;
    return null;
  }, [teamLatestAcceptancePayload, teamLatestDecisionOutputPreview]);
  const teamOmcRuns = useMemo(() => {
    if (!teamTask) return [];
    const events = workflowTaskEventsByTaskId[teamTask.id] ?? [];
    return collectOmcRuns(events, teamTask.id);
  }, [teamTask, workflowTaskEventsByTaskId]);

  const teamWorkflowGraph = useMemo(() => {
    if (!teamItem) return null;
    return workflowGraphsByWorkflowId[teamItem.workflowId] ?? null;
  }, [teamItem, workflowGraphsByWorkflowId]);

  const teamProgressHighlight = useMemo(() => {
    if (!teamTask) {
      return { activeNodeId: null as string | null, flowSourceId: null as string | null, flowTargetId: null as string | null };
    }
    return resolveWorkflowProgressGraphHighlight({
      graph: teamWorkflowGraph,
      snapshotsSorted: teamSnapshotsSorted,
      taskStatus: teamTask.status,
    });
  }, [teamTask, teamWorkflowGraph, teamSnapshotsSorted]);

  const selectedTask = target?.type === "task" ? workflowTasks.find((item) => item.id === target.taskId) : undefined;
  const selectedTaskEvents = selectedTask ? (workflowTaskEventsByTaskId[selectedTask.id] ?? []) : [];
  const selectedTaskSnapshots = selectedTask ? (workflowRuntimeSnapshotsByTaskId[selectedTask.id] ?? []) : [];
  const selectedTaskSnapshotsSorted = useMemo(
    () => (selectedTask ? sortWorkflowRuntimeSnapshotsChronological(selectedTaskSnapshots) : []),
    [selectedTask, selectedTaskSnapshots],
  );
  const selectedTaskWorkflowGraph = useMemo(() => {
    if (!selectedTask) return null;
    return workflowGraphsByWorkflowId[selectedTask.workflowId] ?? null;
  }, [selectedTask, workflowGraphsByWorkflowId]);
  const selectedTaskProgressHighlight = useMemo(() => {
    if (!selectedTask) {
      return { activeNodeId: null as string | null, flowSourceId: null as string | null, flowTargetId: null as string | null };
    }
    return resolveWorkflowProgressGraphHighlight({
      graph: selectedTaskWorkflowGraph,
      snapshotsSorted: selectedTaskSnapshotsSorted,
      taskStatus: selectedTask.status,
    });
  }, [selectedTask, selectedTaskWorkflowGraph, selectedTaskSnapshotsSorted]);
  const teamTaskPending = teamTask ? taskPendingEmployeesByTaskId[teamTask.id] ?? [] : [];
  const selectedTaskPending = selectedTask ? taskPendingEmployeesByTaskId[selectedTask.id] ?? [] : [];

  const renderTeamGraphHover = useCallback(
    (nodeId: string) =>
      teamTask
        ? buildRuntimeGraphHoverNodeContent({
            nodeId,
            snapshotsSorted: teamSnapshotsSorted,
            taskPending: teamTaskPending,
            taskStatus: teamTask.status,
            employees,
          })
        : null,
    [employees, teamSnapshotsSorted, teamTask, teamTaskPending],
  );

  const onTeamGraphNodeClick = useCallback(
    (nodeId: string) => {
      if (!teamTask) return;
      const hit = findLatestRuntimeSnapshotForGraphNode(teamSnapshotsSorted, nodeId);
      if (!hit?.executorSessionId?.trim()) {
        message.warning("该节点暂无已记录的执行会话，无法打开消息抽屉");
        return;
      }
      setHistoryPeekSessionId(hit.executorSessionId.trim());
    },
    [teamSnapshotsSorted, teamTask],
  );

  const renderTaskGraphHover = useCallback(
    (nodeId: string) =>
      selectedTask
        ? buildRuntimeGraphHoverNodeContent({
            nodeId,
            snapshotsSorted: selectedTaskSnapshotsSorted,
            taskPending: selectedTaskPending,
            taskStatus: selectedTask.status,
            employees,
          })
        : null,
    [employees, selectedTask, selectedTaskPending, selectedTaskSnapshotsSorted],
  );

  const onTaskGraphNodeClick = useCallback(
    (nodeId: string) => {
      if (!selectedTask) return;
      const hit = findLatestRuntimeSnapshotForGraphNode(selectedTaskSnapshotsSorted, nodeId);
      if (!hit?.executorSessionId?.trim()) {
        message.warning("该节点暂无已记录的执行会话，无法打开消息抽屉");
        return;
      }
      setHistoryPeekSessionId(hit.executorSessionId.trim());
    },
    [selectedTask, selectedTaskSnapshotsSorted],
  );

  const selectedTaskSessionIds = useMemo(() => {
    if (!selectedTask) return [];
    const related = new Map<string, ClaudeSession>();
    const creatorSession =
      sessions.find((item) => item.id === selectedTask.creator) ||
      sessions.find((item) => item.claudeSessionId === selectedTask.creator);
    if (creatorSession) {
      related.set(creatorSession.id, creatorSession);
    }
    const eventEmployeeIds = new Set(extractEventEmployeeIds(selectedTaskEvents));
    const eventEmployeeNames = new Set(
      Array.from(eventEmployeeIds)
        .map((employeeId) => employeeById.get(employeeId)?.name?.trim())
        .filter((name): name is string => Boolean(name)),
    );
    for (const session of sessions) {
      const boundEmployeeName = extractBoundEmployeeName(session.repositoryName);
      if (boundEmployeeName && eventEmployeeNames.has(boundEmployeeName)) {
        related.set(session.id, session);
      }
    }
    return Array.from(related.values()).sort((a, b) => sessionUpdatedAt(b) - sessionUpdatedAt(a));
  }, [employeeById, selectedTask, selectedTaskEvents, sessions]);

  const sessionsForHistoryTranscript = liveTranscriptSessions;

  const title =
    target?.type === "employee"
      ? `员工详情 · ${employeeItem?.name ?? ""}`
      : target?.type === "team"
        ? `团队详情 · ${teamItem?.workflowName ?? ""}`
        : `任务详情 · ${selectedTask?.title ?? ""}`;

  return (
    <>
    <Drawer title={title} open={open} onClose={onClose} size={480} destroyOnHidden>
      {target?.type === "employee" && employeeItem ? (
        <div className="app-monitor-drawer">
          <div className="app-monitor-drawer__section">
            <Typography.Text strong>{employeeItem.name}</Typography.Text>
            <div className="app-monitor-drawer__meta">
              {employeeItem.employeeId === "omc-worker" ? (
                <OmcWorkerDirectBatchStatusTag inProgress={employeeItem.status === "in_progress"} />
              ) : (
                <Tag color={employeeItem.status === "in_progress" ? "success" : "default"}>
                  {employeeItem.status === "in_progress" ? "进行中" : "空闲"}
                </Tag>
              )}
              {employeeItem.executionSource === "employee_session" ? (
                <Tag color="processing" className="app-monitor-drawer__source-tag">
                  独立会话执行
                </Tag>
              ) : null}
              {employeeItem.executionSource === "workflow" ? (
                <Tag color="purple" className="app-monitor-drawer__source-tag">
                  工作流执行
                </Tag>
              ) : null}
              <span>{employeeById.get(employeeItem.employeeId)?.agentType ?? "未知类型"}</span>
              <span>更新时间：{formatTime(employeeItem.updatedAt)}</span>
            </div>
          </div>

          <div className="app-monitor-drawer__section">
            <Typography.Text type="secondary">当前任务</Typography.Text>
            {employeeTask ? (
              <div className="app-monitor-drawer__card">
                <div>{employeeTask.title}</div>
                <div className="app-monitor-drawer__muted">阶段：{employeeTask.currentStageIndex + 1}</div>
                <div className="app-monitor-drawer__muted app-monitor-drawer__path-row">
                  仓库：{employeeItem.repositoryName ?? employeeSession?.repositoryName ?? "未知"} ({employeeItem.repositoryPath ?? employeeSession?.repositoryPath ?? "未绑定"})
                  {employeeItem.repositoryPath ?? employeeSession?.repositoryPath ? (
                    <button
                      type="button"
                      className="app-monitor-drawer__copy-btn"
                      onClick={() => {
                        void copyText(employeeItem.repositoryPath ?? employeeSession?.repositoryPath ?? "");
                      }}
                    >
                      复制
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />
            )}
          </div>

          <div className="app-monitor-drawer__section">
            {employeeItem.employeeId === "omc-worker" ? (
              <>
                <Typography.Text type="secondary">直连批量执行记录</Typography.Text>
                <OmcWorkerDrawerInvocationList
                  onRowActivate={(inv) => setOmcDirectBatchDetailSnapshot(inv)}
                  onCancelInvocation={onCancelOmcDirectBatchInvocation}
                />
              </>
            ) : (
              <>
                <Typography.Text type="secondary">历史执行会话消息</Typography.Text>
                {employeeMessageRows.length > 0 ? (
                  <>
                    <List
                      size="small"
                      dataSource={employeeMessageRows.slice(0, employeeMessageLimit)}
                      renderItem={(msg) => (
                        <List.Item>
                          <button
                            type="button"
                            className="app-monitor-drawer__message app-monitor-drawer__message--button"
                            onClick={() => setHistoryPeekSessionId(msg.sessionId)}
                          >
                            <div className="app-monitor-drawer__message-head">
                              <span>{msg.sessionTitle}</span>
                              <span>{msg.role}</span>
                              <span>{formatTime(msg.timestamp)}</span>
                            </div>
                            <div className="app-monitor-drawer__message-body">{msg.content || "(空消息)"}</div>
                          </button>
                        </List.Item>
                      )}
                    />
                    {employeeMessageRows.length > employeeMessageLimit ? (
                      <Button size="small" className="app-monitor-drawer__more-btn" onClick={() => setEmployeeMessageLimit((prev) => prev + 20)}>
                        加载更多消息
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话消息" />
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      {target?.type === "team" && teamItem ? (
        <div className="app-monitor-drawer app-monitor-drawer--team">
          <div className="app-monitor-drawer__section">
            <Typography.Text strong>{teamItem.workflowName}</Typography.Text>
            <div className="app-monitor-drawer__meta">
              <Tag color={teamItem.status === "in_progress" ? "success" : "default"}>
                {teamItem.status === "in_progress" ? "进行中" : "空闲"}
              </Tag>
              <span>{teamItem.progressText}</span>
            </div>
            {teamTask && teamItem.stageCount ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                当前任务所处模板阶段：第 {teamTask.currentStageIndex + 1} / {teamItem.stageCount} 阶段
              </Typography.Text>
            ) : teamTask ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                当前任务所处阶段：第 {teamTask.currentStageIndex + 1} 阶段
              </Typography.Text>
            ) : null}
            {teamTask ? (
              <Button size="small" className="app-monitor-drawer__jump-btn" onClick={() => onJumpToSession?.(teamTask.creator)}>
                跳转到团队会话
              </Button>
            ) : null}
          </div>

          {teamWorkflowGraph && teamWorkflowGraph.nodes.length > 0 ? (
            <div className="app-monitor-drawer__section app-monitor-drawer__section--workflow-graph">
              <Typography.Text type="secondary">流程进度</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 11 }}>
                与工作流画布一致：橙色描边为当前节点，流动线段表示最近一次派发沿有向边推进。悬停任务类节点可查看派发/返回摘要；已绑定 Wise 会话时可点击查看消息抽屉。
              </Typography.Paragraph>
              <WorkflowProgressGraphCanvas
                workflowGraph={teamWorkflowGraph}
                employees={employees}
                activeNodeId={teamProgressHighlight.activeNodeId}
                flowSourceId={teamProgressHighlight.flowSourceId}
                flowTargetId={teamProgressHighlight.flowTargetId}
                height={240}
                renderNodeHoverContent={renderTeamGraphHover}
                onNodeClick={onTeamGraphNodeClick}
              />
            </div>
          ) : null}

          <div className="app-monitor-drawer__section app-monitor-drawer__section--acceptance-fixed">
            <Typography.Text type="secondary">验收判定记录</Typography.Text>
            {teamTask && teamLatestAcceptanceEvent ? (
              <div className="app-monitor-drawer__card app-monitor-drawer__acceptance-card">
                <Space size={6} wrap>
                  <Tag color="blue">
                    {teamLatestAcceptanceEvent.eventType === WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_SUBMITTED ? "自动判定" : "待人工"}
                  </Tag>
                  {teamLatestAcceptancePayload?.workflowAcceptanceVerdict === "approve" ? <Tag color="success">通过</Tag> : null}
                  {teamLatestAcceptancePayload?.workflowAcceptanceVerdict === "reject" ? <Tag color="error">驳回</Tag> : null}
                  {latestAcceptanceGateLabel ? <Tag>门闸：{latestAcceptanceGateLabel}</Tag> : null}
                  {latestVerdictSourceLabel ? <Tag>来源：{latestVerdictSourceLabel}</Tag> : null}
                  {latestVerdictModeLabel ? <Tag>模式：{latestVerdictModeLabel}</Tag> : null}
                </Space>
                <div className="app-monitor-drawer__muted" style={{ marginTop: 6 }}>
                  节点：{teamLatestAcceptancePayload?.graphNodeId?.trim() || "未知"} · 时间：{formatTime(teamLatestAcceptanceEvent.createdAt)}
                </div>
                {latestAcceptanceReasonLabel ? (
                  <div className="app-monitor-drawer__muted" style={{ marginTop: 4 }}>
                    原因：{latestAcceptanceReasonLabel}
                  </div>
                ) : null}
                {latestAcceptanceEvidence ? (
                  <>
                    <div className="app-monitor-drawer__muted" style={{ marginTop: 6 }}>
                      判定依据：
                    </div>
                    <pre className="app-monitor-drawer__team-step-pre" style={{ marginTop: 4 }}>
                      {latestAcceptanceEvidence}
                    </pre>
                  </>
                ) : null}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无验收判定事件" />
            )}
          </div>
          <div className="app-monitor-drawer__section">
            <Typography.Text type="secondary">OMC 执行记录</Typography.Text>
            {teamTask && teamOmcRuns.length > 0 ? (
              <List
                size="small"
                dataSource={teamOmcRuns.slice(0, 8)}
                renderItem={(run) => (
                  <List.Item>
                    <div className="app-monitor-drawer__event">
                      <Space size={6} wrap style={{ marginBottom: 4 }}>
                        <Tag color="blue">{run.templateId ?? "unknown-template"}</Tag>
                        <Tag color={run.status === "succeeded" ? "success" : run.status === "running" ? "processing" : run.status === "aborted" ? "default" : "error"}>
                          {run.status === "succeeded"
                            ? "成功"
                            : run.status === "running"
                              ? "执行中"
                              : run.status === "aborted"
                                ? "已中止"
                                : "失败"}
                        </Tag>
                        {run.attempt ? <Tag>attempt {run.attempt}</Tag> : null}
                        {run.omcCommand ? <Tag>{run.omcCommand}</Tag> : null}
                        {run.ownerKind === "repository" ? (
                          <Tag color="geekblue">仓库成员: {run.ownerRepositoryName || run.ownerRepositoryPath || run.ownerRepositoryId}</Tag>
                        ) : null}
                        {run.repositoryType ? <Tag>{formatRepositoryTypeLabel(run.repositoryType)}</Tag> : null}
                        {run.trellisStage ? <Tag>阶段: {run.trellisStage}</Tag> : null}
                        {run.subagentType ? <Tag>子代理: {run.subagentType}</Tag> : null}
                      </Space>
                      <div className="app-monitor-drawer__muted">
                        启动：{run.startedAt ? formatTime(run.startedAt) : "未知"} · 结束：{run.endedAt ? formatTime(run.endedAt) : "进行中"}
                      </div>
                      {run.summary ? (
                        <div className="app-monitor-drawer__muted" style={{ marginTop: 4 }}>
                          摘要：{run.summary}
                        </div>
                      ) : null}
                      {run.error ? (
                        <div className="app-monitor-drawer__muted" style={{ marginTop: 4, color: "var(--ant-color-error)" }}>
                          错误：{run.error}
                        </div>
                      ) : null}
                      {run.progress.length > 0 ? (
                        <div className="app-monitor-drawer__muted" style={{ marginTop: 6 }}>
                          {(run.progress.slice(-4) ?? []).map((item) => (
                            <div key={`${run.taskRunId}-${item.timestamp}-${item.stage}`}>
                              [{item.level}] {item.stage} · {item.message}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </List.Item>
                )}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 OMC 执行记录" />
            )}
          </div>
        </div>
      ) : null}

      {target?.type === "task" && selectedTask ? (
        <div className="app-monitor-drawer">
          <div className="app-monitor-drawer__section">
            <Typography.Text strong>{selectedTask.title}</Typography.Text>
            <div className="app-monitor-drawer__meta">
              <Tag color="success">已完成</Tag>
              <span>完成时间：{formatTime(selectedTask.updatedAt)}</span>
              <span>工作流：{workflowById.get(selectedTask.workflowId)?.name ?? selectedTask.workflowId}</span>
            </div>
            <div className="app-monitor-drawer__card">{selectedTask.content || "(空任务描述)"}</div>
          </div>

          {selectedTaskWorkflowGraph && selectedTaskWorkflowGraph.nodes.length > 0 ? (
            <div className="app-monitor-drawer__section app-monitor-drawer__section--workflow-graph">
              <Typography.Text type="secondary">流程进度</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 11 }}>
                与工作流画布一致：橙色描边为当前节点，流动线段表示最近一次派发沿有向边推进。悬停任务类节点可查看派发/返回摘要；已绑定 Wise 会话时可点击查看消息抽屉。
              </Typography.Paragraph>
              <WorkflowProgressGraphCanvas
                workflowGraph={selectedTaskWorkflowGraph}
                employees={employees}
                activeNodeId={selectedTaskProgressHighlight.activeNodeId}
                flowSourceId={selectedTaskProgressHighlight.flowSourceId}
                flowTargetId={selectedTaskProgressHighlight.flowTargetId}
                height={220}
                renderNodeHoverContent={renderTaskGraphHover}
                onNodeClick={onTaskGraphNodeClick}
              />
            </div>
          ) : null}

          <div className="app-monitor-drawer__section">
            <Typography.Text type="secondary">会话信息列表</Typography.Text>
            {selectedTaskSessionIds.length > 0 ? (
              <List
                size="small"
                dataSource={selectedTaskSessionIds}
                renderItem={(session) => (
                  <List.Item>
                    <button
                      type="button"
                      className="app-monitor-drawer__message app-monitor-drawer__message--button"
                      onClick={() => onJumpToSession?.(session.id)}
                    >
                      <div className="app-monitor-drawer__message-head">
                        <span>{session.repositoryName}</span>
                        <span>{session.status}</span>
                        <span>{formatTime(sessionUpdatedAt(session))}</span>
                      </div>
                      <div className="app-monitor-drawer__message-body">
                        {extractSessionPreview(session)}
                      </div>
                    </button>
                  </List.Item>
                )}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联会话信息" />
            )}
          </div>

          <div className="app-monitor-drawer__section">
            <Typography.Text type="secondary">关键执行记录</Typography.Text>
            {selectedTaskSnapshots.length > 0 ? (
              <List
                size="small"
                dataSource={selectedTaskSnapshots.slice(-10).reverse()}
                renderItem={(item) => (
                  <List.Item>
                    <div className="app-monitor-drawer__event">
                      <div>{item.phase === "dispatch" ? "派发" : "决策"} · {formatTime(item.createdAt)}</div>
                      <div className="app-monitor-drawer__muted">{item.outputPreview || item.inputPreview || "(空)"}</div>
                    </div>
                  </List.Item>
                )}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无执行记录" />
            )}
          </div>
        </div>
      ) : null}
    </Drawer>
    <OmcDirectBatchInvocationDetailDrawer
      open={omcDirectBatchDetailSnapshot !== null}
      snapshot={omcDirectBatchDetailSnapshot}
      sessions={sessions}
      onClose={() => setOmcDirectBatchDetailSnapshot(null)}
      onOpenInMainSessionBackground={onOpenOmcBatchInvocationDetail ? handleOpenOmcBatchFromDetailDrawer : undefined}
    />
    <MonitorHistorySessionTranscriptDrawer
      open={historyPeekSessionId !== null}
      sessionId={historyPeekSessionId}
      onClose={() => setHistoryPeekSessionId(null)}
      transcriptSourceSessions={sessionsForHistoryTranscript}
      onReloadFullDiskTranscript={onReloadFullDiskTranscript}
      onCompactSessionHistory={onCompactSessionHistory}
      onCancelSession={onCancelSession}
      onOpenTaskDetail={onOpenTaskDetail}
      onOpenHistorySessionInInspector={(sessionId) => {
        const sid = sessionId.trim();
        if (sid) setHistoryPeekSessionId(sid);
      }}
      onResumeSession={onResumeSession}
    />
    </>
  );
}
