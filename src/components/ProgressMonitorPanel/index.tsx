import { SendOutlined } from "@ant-design/icons";
import { Collapse, Descriptions, Drawer, Empty, InputNumber, Popover, Select, Tag, Tooltip, Typography } from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  ClaudeMessage,
  ClaudeSession,
  EmployeeMonitorItem,
  MonitorDrawerTarget,
  Repository,
  RepositoryMemberMonitorItem,
  RepositoryMemberMonitorSubagentItem,
  SessionConversationTaskItem,
  TeamMonitorItem,
} from "../../types";
import { isSessionBoundAsRepositoryMain } from "../../utils/repositoryMainSessionBinding";
import type { WorkflowInvocationStreamDetail } from "../../constants/workflowUiEvents";
import {
  formatOmcDirectBatchInvocationErrorPreviewLineForList,
  formatOmcDirectBatchInvocationListTitle,
  isOmcDirectBatchInvocationRunning,
} from "../../utils/omcDirectBatchInvocationDisplay";
import {
  getOmcDirectBatchInvocationsSnapshot,
  subscribeOmcDirectBatchInvocations,
} from "../../stores/omcDirectBatchInvocationsStore";
import {
  buildMonitorEmployeeHistorySessionsByName,
  monitorEmployeeHistoryStructureFingerprint,
  normalizeMonitorEmployeeName,
  pickLatestMonitorEmployeeHistorySession,
} from "../../utils/omcEmployeeMonitorHistory";
import {
  pickSubagentTranscriptSession,
  useSubagentDiskTranscript,
} from "../../hooks/useSubagentDiskTranscript";
import {
  clampConcurrencyLimit,
  MAX_CLAUDE_CONCURRENCY_LIMIT,
  MIN_CLAUDE_CONCURRENCY_LIMIT,
} from "../../services/claudeConcurrencyLimits";
import { sanitizeOmcDirectBatchPreviewLineForList } from "../../utils/claudeInvocationText";
import { OmcDirectBatchInvocationDetailDrawer } from "./OmcDirectBatchInvocationDetailDrawer";
import { HistorySessionRestoreButton } from "./HistorySessionRestoreButton";
import { buildMonitorSessionListRowModel } from "./monitorSessionDisplay";
import {
  matchSessionByKeyword,
  normalizeSearchKeyword,
  sessionUpdatedAt,
} from "./progressMonitorSearch";
import { ClaudeSessionMessagesColumn } from "../ClaudeSessions/ClaudeSessionMessagesColumn";

import { useAgentAssignments } from "../../hooks/useAgentAssignments";
import { ExpandIcon } from "../LeftSidebar/SidebarIcons";
import { SubagentStatusIndicator } from "./SubagentStatusIndicator";
import {
  EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS,
  type ExecutionEnvironmentDispatchHistoryDays,
} from "../../constants/executionEnvironmentDispatch";
import {
  canStopSessionConversationTask,
  filterExecutionEnvironmentDispatchTaskItems,
  formatExecutionEnvironmentDispatchTaskTime,
} from "../../utils/sessionConversationTasks";
import {
  SessionConversationTaskDetailDrawer,
  type SessionConversationTaskDetailTarget,
} from "./SessionConversationTaskDetailDrawer";
import "./index.css";

export {
  getSessionPreview,
  HistorySessionDrawerTitle,
  historySessionStatusLabel,
  historySessionStatusTagColor,
} from "./historySessionDrawerChrome";

function RepositoryMiniIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M3 4.5h10v7H3z" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5 4.5V3h6v1.5M5.25 7h5.5M5.25 9.5h3.5" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

interface MonitorClaudeConcurrencyProps {
  activeCount: number;
  limit: number;
  onLimitChange: (value: number) => void | Promise<void>;
}

interface Props {
  employeeItems: EmployeeMonitorItem[];
  repositoryMemberItems: RepositoryMemberMonitorItem[];
  teamItems: TeamMonitorItem[];
  /** 当前对话子代理 / 任务（显示在「我的团队」上方） */
  sessionConversationTaskItems?: SessionConversationTaskItem[];
  /** 强制展示「子代理 / 任务」区块：即便列表为空也展示区块头（默认：仅当有数据时展示）。 */
  showSessionConversationTasks?: boolean;
  executionEnvironmentDispatchHistoryDays?: ExecutionEnvironmentDispatchHistoryDays;
  onExecutionEnvironmentDispatchHistoryDaysChange?: (
    days: ExecutionEnvironmentDispatchHistoryDays,
  ) => void | Promise<void>;
  executionEnvironmentDispatchHistoryDaysSaving?: boolean;
  sessions: ClaudeSession[];
  activeTarget?: MonitorDrawerTarget | null;
  onOpenTeamDetail: (workflowId: string) => void;
  onOpenEmployeeConfig?: () => void;
  onOpenWorkflowConfig?: () => void;
  onStopEmployee?: (employeeId: string) => void;
  onStopTeam?: (workflowId: string) => void;
  /** 当 `Project.sddMode === "wise_trellis"` 时由 AppImpl 传入 true，隐藏员工区块；头部仍显示「成员」配置按钮。 */
  hideEmployeeUi?: boolean;
  /** 按当前项目 + 仓库的 Claude Code 并发展示与上限编辑 */
  claudeConcurrency?: MonitorClaudeConcurrencyProps | null;
  /** 历史会话详情抽屉内：停止运行中 / 连接中的 Claude 会话 */
  onCancelSession?: (sessionId: string) => void;
  /** 历史消息内系统卡片「查看任务详情」 */
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenOmcBatchInvocationDetail?: (input: { sessionId: string; repositoryPath: string; invocationKey: string }) => void;
  /** 结束直连批量下单条 Claude Code 子进程 */
  onCancelOmcDirectBatchInvocation?: (invocationKey: string) => void;
  /** 结束当前对话子代理 / 任务（含消息内 tool_use 标记与会话取消） */
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  /** 非活动标签正文已丢弃时，从历史抽屉按需从磁盘拉回完整 jsonl */
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  /** 历史会话抽屉内手动执行 Claude Code `/compact`。 */
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  /**
   * 历史会话消息抽屉用：解析 `messages` 与触发磁盘补全时应读「实时」会话列表。
   * 若仅传节流后的 `sessions`，会出现抽屉先显示旧快照里的正文、下一帧同步到已回收内存后的空数组，表现为消息突然消失。
   */
  transcriptSourceSessions?: ClaudeSession[];
  projectId?: string | null;
  /** 受控：右侧历史会话消息抽屉当前会话 id */
  historyDrawerSessionId?: string | null;
  onHistoryDrawerSessionIdChange?: (sessionId: string | null) => void;
  /** 将历史会话恢复为当前仓库主会话 */
  onRestoreHistorySessionAsMain?: (sessionId: string) => void | Promise<void>;
  /** 历史 / 派发抽屉底部：resume 继续当前会话 */
  onResumeSession?: (sessionId: string, prompt: string) => boolean | void;
  repositoryMainBindings?: Record<string, string>;
  repositories?: Repository[];
  sectionCollapsed?: boolean;
  onSectionCollapsedChange?: (collapsed: boolean) => void;
}

interface TeamHistorySessionRow {
  session: ClaudeSession;
  employeeName: string;
}

interface HistorySessionRow {
  session: ClaudeSession;
  employeeName?: string;
}

interface RepositorySubagentDetailTarget {
  repository: RepositoryMemberMonitorItem;
  subagent: RepositoryMemberMonitorSubagentItem;
}

function extractTrailingNumber(value: string | undefined): number | null {
  const m = value?.match(/(\d+)\s*$/);
  if (!m) return null;
  const n = Number.parseInt(m[1] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

function findSubagentSession(
  sessions: readonly ClaudeSession[],
  subagent: RepositoryMemberMonitorSubagentItem,
): ClaudeSession | null {
  const sessionId = subagent.sessionId?.trim();
  if (!sessionId) return null;
  return sessions.find((session) => session.id === sessionId || session.claudeSessionId === sessionId) ?? null;
}

function subagentSessionStatus(status: RepositoryMemberMonitorSubagentItem["status"]): ClaudeSession["status"] {
  if (status === "running" || status === "stale") return "running";
  if (status === "failed") return "error";
  if (status === "cancelled") return "cancelled";
  return "completed";
}

function textMessage(
  id: number,
  role: ClaudeMessage["role"],
  content: string,
  timestamp: number,
): ClaudeMessage {
  return {
    id,
    role,
    content,
    parts: [{ type: "text", text: content }],
    timestamp,
  };
}

function buildSyntheticSubagentSession(
  repository: RepositoryMemberMonitorItem,
  subagent: RepositoryMemberMonitorSubagentItem,
): ClaudeSession {
  const now = Date.now();
  const startedAt = subagent.startedAt ?? Math.max(0, subagent.updatedAt - 1000);
  const prompt = subagent.promptExcerpt?.trim()
    || subagent.taskTitle?.trim()
    || subagent.previewText.trim()
    || `${subagent.subagentType} ${subagent.stage ?? ""}`.trim();
  const output = subagent.outputExcerpt?.trim()
    || (subagent.previewText.trim() && subagent.previewText.trim() !== prompt ? subagent.previewText.trim() : "")
    || (subagent.status === "running" || subagent.status === "stale" ? "等待子代理输出..." : "未记录输出正文");
  const statusLine = [
    subagentStatusLabel(subagent.status),
    subagent.stage ? `stage: ${subagent.stage}` : "",
    subagent.taskId ? `task: ${subagent.taskId}` : "",
  ].filter(Boolean).join(" · ");

  return {
    id: `repository-subagent-${subagent.invocationKey}`,
    claudeSessionId: subagent.sessionId?.trim() || null,
    repositoryPath: subagent.repositoryPath ?? repository.repositoryPath,
    repositoryName: repository.repositoryName,
    model: subagent.model ?? "",
    status: subagentSessionStatus(subagent.status),
    createdAt: startedAt || now,
    pendingPrompt: "",
    messages: [
      textMessage(1, "system", `${subagent.subagentType} · ${statusLine}`, startedAt || now - 1000),
      textMessage(2, "user", prompt || "子代理执行记录", startedAt || now - 500),
      textMessage(3, "assistant", output, subagent.completedAt ?? subagent.updatedAt ?? now),
    ],
  };
}

interface HistorySessionPopoverContentProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  employeeFilterValue?: string;
  onEmployeeFilterChange?: (value: string) => void;
  employeeOptions?: string[];
  rows: HistorySessionRow[];
  emptyDescription: string;
  onSelectSession?: (sessionId: string) => void;
  /** 恢复为主会话（替换当前仓库主会话绑定） */
  onRestoreSession?: (sessionId: string) => void;
  canRestoreSession?: (sessionId: string) => boolean;
  /** 列表行右侧「结束」；由调用方按 Wise 标签 / 注册表 / PID 分发终止逻辑 */
  onEndSession?: (sessionId: string) => void;
  searchPlaceholder?: string;
  listTitle?: string;
  memberFilterAllLabel?: string;
}

function HistorySessionPopoverListRow({
  row,
  showTerminalLabel,
}: {
  row: HistorySessionRow;
  showTerminalLabel: boolean;
}) {
  const model = buildMonitorSessionListRowModel(row.session, { employeeName: row.employeeName });
  return (
    <>
      <div className="app-monitor-panel__history-popover-item-head">
        <Tag bordered={false} color={model.statusColor} className="app-monitor-panel__history-popover-status-tag">
          {model.statusLabel}
        </Tag>
        {showTerminalLabel && model.terminalLabel ? (
          <span className="app-monitor-panel__history-popover-item-terminal" title={model.terminalLabel}>
            {model.terminalLabel}
          </span>
        ) : null}
        <span className="app-monitor-panel__history-popover-item-time" title={model.updatedAtText}>
          {model.relativeUpdatedAtText}
        </span>
      </div>
      <span className="app-monitor-panel__history-popover-item-title" title={model.preview}>
        {model.preview}
      </span>
      <span className="app-monitor-panel__history-popover-item-sub" title={model.repoShort}>
        {model.repoShort}
      </span>
    </>
  );
}

function ConcurrencyControl({ activeCount, limit, onLimitChange }: MonitorClaudeConcurrencyProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(limit);

  useEffect(() => {
    if (!editing) {
      setDraft(limit);
    }
  }, [limit, editing]);

  async function commit() {
    const next = clampConcurrencyLimit(typeof draft === "number" ? draft : limit);
    setEditing(false);
    if (next !== limit) {
      await onLimitChange(next);
    }
  }

  return (
    <Tooltip title="当前运行数 / 上限；双击修改上限（绑定当前项目与仓库）">
      <div
        className="app-monitor-panel__concurrency"
        role="group"
        aria-label="Claude Code 并发控制"
        onDoubleClick={() => {
          if (!editing) {
            setEditing(true);
          }
        }}
      >
        <span className="app-monitor-panel__concurrency-label">并发</span>
        {editing ? (
          <InputNumber
            size="small"
            min={MIN_CLAUDE_CONCURRENCY_LIMIT}
            max={MAX_CLAUDE_CONCURRENCY_LIMIT}
            controls={false}
            value={draft}
            onChange={(v) => setDraft(typeof v === "number" ? v : limit)}
            autoFocus
            className="app-monitor-panel__concurrency-input"
            onBlur={() => void commit()}
            onPressEnter={() => void commit()}
          />
        ) : (
          <span className="app-monitor-panel__concurrency-value">{activeCount}/{limit}</span>
        )}
      </div>
    </Tooltip>
  );
}

interface OmcDirectBatchPopoverContentProps {
  invocations: WorkflowInvocationStreamDetail[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onRowActivate: (inv: WorkflowInvocationStreamDetail) => void;
  onCancelInvocation?: (invocationKey: string) => void;
}

const OmcDirectBatchPopoverContent = memo(function OmcDirectBatchPopoverContentInner({
  invocations,
  searchValue,
  onSearchChange,
  onRowActivate,
  onCancelInvocation,
}: OmcDirectBatchPopoverContentProps) {
  const keyword = normalizeSearchKeyword(searchValue);
  const filtered = invocations.filter((inv) => {
    if (!keyword) return true;
    const listPreview = sanitizeOmcDirectBatchPreviewLineForList(inv.previewLine);
    const hay = [inv.taskTitle, inv.taskId, inv.templateId, listPreview, inv.invocationKey]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join(" ")
      .toLocaleLowerCase("zh-CN");
    return hay.includes(keyword);
  });
  const hasRows = filtered.length > 0;
  return (
    <div className="app-monitor-panel__history-popover-content">
      <div className="app-monitor-panel__history-popover-search-wrap">
        <input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          className="app-monitor-panel__history-popover-search-input"
          placeholder="搜索标题、任务 id、模板…"
          onClick={(event) => event.stopPropagation()}
        />
      </div>
      {hasRows ? (
        <div className="app-monitor-panel__history-popover-list">
          {filtered.map((inv) => {
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
            const errorPreview = formatOmcDirectBatchInvocationErrorPreviewLineForList(inv);
            return (
              <div key={inv.invocationKey} className="app-monitor-panel__history-popover-omc-row">
                <button
                  type="button"
                  className="app-monitor-panel__history-popover-item app-monitor-panel__history-popover-item--grow"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRowActivate(inv);
                  }}
                >
                  <span className="app-monitor-panel__history-popover-item-title">{formatOmcDirectBatchInvocationListTitle(inv)}</span>
                  <span className="app-monitor-panel__history-popover-item-time">
                    <Tag color={phaseTagColor}>{phaseLabel}</Tag>
                    {errorPreview ? ` · ${errorPreview}` : ""}
                  </span>
                </button>
                {onCancelInvocation && isOmcDirectBatchInvocationRunning(inv) ? (
                  <span className="app-monitor-panel__history-popover-omc-stop-wrap">
                    <button
                      type="button"
                      className="app-monitor-panel__history-popover-omc-stop"
                      title="结束该子进程"
                      onPointerDown={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelInvocation(inv.invocationKey);
                      }}
                    >
                      结束
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="app-monitor-panel__history-popover-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={searchValue.trim() ? "未匹配到子进程" : "暂无直连批量执行记录"}
          />
        </div>
      )}
    </div>
  );
});

/** OMC 员工「执行记录」：直连批量 invocation 列表，仅在此订阅 store，避免整块 `ProgressMonitorPanel` 重渲。 */
const OmcDirectBatchInProgressPopover = memo(function OmcDirectBatchInProgressPopoverInner({
  open,
  onOpenChange,
  searchValue,
  onSearchChange,
  onRowActivate,
  onCancelInvocation,
}: {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onRowActivate: (inv: WorkflowInvocationStreamDetail) => void;
  onCancelInvocation?: (invocationKey: string) => void;
}) {
  const invocations = useSyncExternalStore(
    subscribeOmcDirectBatchInvocations,
    getOmcDirectBatchInvocationsSnapshot,
    getOmcDirectBatchInvocationsSnapshot,
  );
  const runningCount = invocations.filter(isOmcDirectBatchInvocationRunning).length;
  const totalCount = invocations.length;
  const linkLabel = "执行记录";
  const tooltipTitle =
    runningCount > 0
      ? `当前 ${runningCount} 路运行中（共 ${totalCount} 路；与「可执行任务」勾选条数不是同一概念）`
      : totalCount > 0
        ? `共 ${totalCount} 路子进程记录；新发起直连批量 OMC 时会清空并重建列表`
        : "查看直连批量 OMC 子进程列表（非 Wise 会话标签列表）";
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={onOpenChange}
      overlayClassName="app-monitor-panel__history-popover"
      content={
        <OmcDirectBatchPopoverContent
          invocations={invocations}
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          onRowActivate={onRowActivate}
          onCancelInvocation={onCancelInvocation}
        />
      }
    >
      <Tooltip title={tooltipTitle} mouseEnterDelay={0.35}>
        <button
          type="button"
          className="app-monitor-panel__item-history-link"
          onClick={(event) => event.stopPropagation()}
        >
          {linkLabel}
        </button>
      </Tooltip>
    </Popover>
  );
});

function statusText(status: "in_progress" | "idle") {
  if (status === "in_progress") {
    return (
      <Tooltip title="进行中">
        <span className="app-monitor-panel__status-spinner" role="status" aria-label="进行中">
          <svg className="app-monitor-panel__status-spinner-svg" viewBox="0 0 16 16" aria-hidden>
            <circle className="app-monitor-panel__status-spinner-track" cx="8" cy="8" r="6.25" fill="none" />
            <circle className="app-monitor-panel__status-spinner-arc" cx="8" cy="8" r="6.25" fill="none" />
          </svg>
        </span>
      </Tooltip>
    );
  }
  return (
    <span className={`app-monitor-panel__status-text app-monitor-panel__status-text--${status}`}>
      空闲
    </span>
  );
}

function taskResultTag(status?: EmployeeMonitorItem["latestTaskStatus"]) {
  if (!status || status === "in_progress") return null;
  const label = status === "completed" ? "最近: 已完成" : status === "rejected" ? "最近: 已拒绝" : "最近: 已归档";
  return (
    <span className={`app-monitor-panel__result-pill app-monitor-panel__result-pill--${status}`}>
      {label}
    </span>
  );
}

function subagentStatusLabel(status: RepositoryMemberMonitorSubagentItem["status"]): string {
  if (status === "running") return "运行中";
  if (status === "stale") return "疑似断连";
  if (status === "reclaimed") return "已回收";
  if (status === "cancelled") return "已中断";
  if (status === "failed") return "失败";
  return "完成";
}

function subagentStatusTagColor(status: RepositoryMemberMonitorSubagentItem["status"]): string {
  if (status === "running") return "processing";
  if (status === "stale") return "warning";
  if (status === "reclaimed") return "default";
  if (status === "cancelled") return "default";
  if (status === "failed") return "error";
  return "success";
}

function formatMonitorTimestamp(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function compactId(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) return "—";
  if (normalized.length <= 18) return normalized;
  return `${normalized.slice(0, 8)}…${normalized.slice(-6)}`;
}

function RepositorySubagentDetailDrawer({
  target,
  sessions,
  onReloadFullDiskTranscript,
  onClose,
}: {
  target: RepositorySubagentDetailTarget | null;
  sessions: readonly ClaudeSession[];
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const width = Math.min(760, typeof window !== "undefined" ? window.innerWidth - 40 : 760);
  const subagent = target?.subagent ?? null;
  const repository = target?.repository ?? null;
  const matchedSession = subagent ? findSubagentSession(sessions, subagent) : null;
  const repositoryPath =
    subagent?.repositoryPath?.trim() || repository?.repositoryPath?.trim() || "";
  const claudeSessionId =
    matchedSession?.claudeSessionId?.trim() || subagent?.sessionId?.trim() || "";
  const syntheticSession =
    repository && subagent ? buildSyntheticSubagentSession(repository, subagent) : null;
  const diskTranscriptStatus = matchedSession?.status ?? subagentSessionStatus(subagent?.status ?? "completed");

  const { session: diskTranscriptSession } = useSubagentDiskTranscript({
    enabled: target !== null && Boolean(repositoryPath && claudeSessionId),
    repositoryPath,
    repositoryName: repository?.repositoryName ?? subagent?.repositoryPath ?? "",
    claudeSessionId,
    model: subagent?.model ?? matchedSession?.model,
    status: diskTranscriptStatus,
    createdAt: subagent?.startedAt ?? matchedSession?.createdAt,
  });

  const transcriptSession = pickSubagentTranscriptSession(
    diskTranscriptSession,
    matchedSession,
    syntheticSession,
  );

  const matchedSessionId = matchedSession?.id ?? null;
  useEffect(() => {
    if (!target || !onReloadFullDiskTranscript || !matchedSessionId || !claudeSessionId) return;
    if ((matchedSession?.messages.length ?? 0) > 0) return;
    if ((diskTranscriptSession?.messages.length ?? 0) > 0) return;
    void onReloadFullDiskTranscript(matchedSessionId);
  }, [
    target,
    onReloadFullDiskTranscript,
    matchedSessionId,
    claudeSessionId,
    matchedSession?.messages.length,
    diskTranscriptSession?.messages.length,
  ]);

  return (
    <Drawer
      title={subagent ? `${subagent.subagentType} · 子进程记录` : "子进程记录"}
      placement="right"
      size={width}
      open={target !== null}
      onClose={onClose}
      destroyOnHidden
      classNames={{ body: "app-monitor-panel__subagent-detail-drawer-body" }}
      extra={subagent ? <Tag color={subagentStatusTagColor(subagent.status)}>{subagentStatusLabel(subagent.status)}</Tag> : null}
    >
      {!subagent || !repository ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无子进程记录" />
      ) : (
        <div className="app-monitor-panel__subagent-detail">
          {subagent.status === "reclaimed" ? (
            <Typography.Text type="secondary" className="app-monitor-panel__subagent-detail-hint">
              该记录已从宿主进程表回收，不再计入运行中；下方保留最近一次 transcript 或回收摘要用于复盘。
            </Typography.Text>
          ) : null}
          <div className="app-monitor-panel__subagent-detail-session">
            {transcriptSession ? (
              <ClaudeSessionMessagesColumn session={transcriptSession} showAllMessages />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到可展示的执行记录" />
            )}
          </div>

          <Collapse
            size="small"
            ghost
            items={[
              {
                key: "metadata",
                label: "元数据",
                children: (
                  <>
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label="仓库">{repository.repositoryName}</Descriptions.Item>
                      <Descriptions.Item label="仓库路径">
                        <Typography.Text code copyable>
                          {subagent.repositoryPath ?? repository.repositoryPath}
                        </Typography.Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="rootPath">
                        <Typography.Text code copyable>
                          {subagent.rootPath ?? "—"}
                        </Typography.Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="子进程 id">
                        <Typography.Text code copyable={{ text: subagent.invocationKey }}>
                          {compactId(subagent.invocationKey)}
                        </Typography.Text>
                      </Descriptions.Item>
                      {subagent.sessionId ? (
                        <Descriptions.Item label="会话 id">
                          <Typography.Text code copyable={{ text: subagent.sessionId }}>
                            {compactId(subagent.sessionId)}
                          </Typography.Text>
                        </Descriptions.Item>
                      ) : null}
                      {subagent.toolUseId ? (
                        <Descriptions.Item label="tool_use id">
                          <Typography.Text code copyable={{ text: subagent.toolUseId }}>
                            {compactId(subagent.toolUseId)}
                          </Typography.Text>
                        </Descriptions.Item>
                      ) : null}
                      {subagent.toolName ? <Descriptions.Item label="工具">{subagent.toolName}</Descriptions.Item> : null}
                      {subagent.model ? <Descriptions.Item label="模型">{subagent.model}</Descriptions.Item> : null}
                      {subagent.stage ? <Descriptions.Item label="阶段">{subagent.stage}</Descriptions.Item> : null}
                      {subagent.taskId ? (
                        <Descriptions.Item label="任务 id">
                          <Typography.Text code>{subagent.taskId}</Typography.Text>
                        </Descriptions.Item>
                      ) : null}
                      {subagent.taskTitle ? <Descriptions.Item label="任务标题">{subagent.taskTitle}</Descriptions.Item> : null}
                      {subagent.currentFile ? (
                        <Descriptions.Item label="当前文件">
                          <Typography.Text code copyable>
                            {subagent.currentFile}
                          </Typography.Text>
                        </Descriptions.Item>
                      ) : null}
                      <Descriptions.Item label="来源">{subagent.source ?? "—"}</Descriptions.Item>
                      <Descriptions.Item label="开始时间">{formatMonitorTimestamp(subagent.startedAt)}</Descriptions.Item>
                      <Descriptions.Item label="更新时间">{formatMonitorTimestamp(subagent.updatedAt)}</Descriptions.Item>
                      <Descriptions.Item label="心跳时间">{formatMonitorTimestamp(subagent.lastHeartbeatAt)}</Descriptions.Item>
                      <Descriptions.Item label="结束时间">{formatMonitorTimestamp(subagent.completedAt)}</Descriptions.Item>
                      {typeof subagent.lineCount === "number" ? <Descriptions.Item label="stdout 行数">{subagent.lineCount}</Descriptions.Item> : null}
                      {typeof subagent.errCount === "number" ? <Descriptions.Item label="stderr 行数">{subagent.errCount}</Descriptions.Item> : null}
                      {typeof subagent.success === "boolean" ? (
                        <Descriptions.Item label="退出结果">{subagent.success ? "成功" : "失败"}</Descriptions.Item>
                      ) : null}
                    </Descriptions>

                    <div className="app-monitor-panel__subagent-detail-section">
                      <Typography.Text strong className="app-monitor-panel__subagent-detail-section-title">
                        记录摘要
                      </Typography.Text>
                      <pre className="app-monitor-panel__subagent-detail-pre">{subagent.previewText || "—"}</pre>
                    </div>
                  </>
                ),
              },
            ]}
          />
        </div>
      )}
    </Drawer>
  );
}

function memberTooltipContent(memberNames?: string[]) {
  if (!memberNames || memberNames.length === 0) {
    return "暂无团队成员";
  }
  return (
    <div className="app-monitor-panel__member-tooltip">
      {memberNames.map((name) => (
        <div key={name} className="app-monitor-panel__member-tooltip-line">{name}</div>
      ))}
    </div>
  );
}

export function HistorySessionPopoverContent({
  searchValue,
  onSearchChange,
  employeeFilterValue,
  onEmployeeFilterChange,
  employeeOptions,
  rows,
  emptyDescription,
  onSelectSession,
  onRestoreSession,
  canRestoreSession,
  onEndSession,
  searchPlaceholder = "搜索会话摘要或仓库名…",
  listTitle = "历史会话",
  memberFilterAllLabel = "全部成员",
}: HistorySessionPopoverContentProps) {
  const showEmployeeFilter = Boolean(onEmployeeFilterChange);
  const hasRows = rows.length > 0;
  const showTerminalLabelInRows = showEmployeeFilter;
  return (
    <div className="app-monitor-panel__history-popover-content">
      <div className="app-monitor-panel__history-popover-search-wrap">
        {showEmployeeFilter ? (
          <select
            value={employeeFilterValue ?? "all"}
            onChange={(event) => onEmployeeFilterChange?.(event.target.value)}
            className="app-monitor-panel__history-popover-member-select"
            onClick={(event) => event.stopPropagation()}
          >
            <option value="all">{memberFilterAllLabel}</option>
            {(employeeOptions ?? []).map((name) => {
              const value = name.trim();
              if (!value) return null;
              return (
                <option key={value} value={value}>
                  {value}
                </option>
              );
            })}
          </select>
        ) : null}
        <input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          className="app-monitor-panel__history-popover-search-input"
          placeholder={searchPlaceholder}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
      <div className="app-monitor-panel__history-popover-list-head">
        <span className="app-monitor-panel__history-popover-list-title">{listTitle}</span>
        <span className="app-monitor-panel__history-popover-list-count">{hasRows ? `${rows.length} 条` : "无记录"}</span>
      </div>
      {hasRows ? (
        <div className="app-monitor-panel__history-popover-list">
          {rows.map((row) => (
            <div key={row.session.id} className="app-monitor-panel__history-popover-omc-row">
              <button
                type="button"
                className="app-monitor-panel__history-popover-item app-monitor-panel__history-popover-item--grow"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectSession?.(row.session.id);
                }}
              >
                <HistorySessionPopoverListRow row={row} showTerminalLabel={showTerminalLabelInRows} />
              </button>
              {onRestoreSession ? (
                <HistorySessionRestoreButton
                  className="app-monitor-panel__history-popover-restore"
                  disabled={canRestoreSession ? !canRestoreSession(row.session.id) : false}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRestoreSession(row.session.id);
                  }}
                />
              ) : null}
              {onEndSession ? (
                <span className="app-monitor-panel__history-popover-omc-stop-wrap">
                  <button
                    type="button"
                    className="app-monitor-panel__history-popover-omc-stop"
                    title="结束该 Claude 进程"
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEndSession(row.session.id);
                    }}
                  >
                    结束
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="app-monitor-panel__history-popover-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={emptyDescription}
          />
        </div>
      )}
    </div>
  );
}

export function ProgressMonitorPanel({
  employeeItems,
  repositoryMemberItems: _repositoryMemberItems,
  teamItems,
  sessionConversationTaskItems = [],
  showSessionConversationTasks = false,
  executionEnvironmentDispatchHistoryDays,
  onExecutionEnvironmentDispatchHistoryDaysChange,
  executionEnvironmentDispatchHistoryDaysSaving = false,
  sessions,
  activeTarget,
  onOpenTeamDetail,
  onOpenEmployeeConfig,
  onOpenWorkflowConfig,
  onStopEmployee,
  onStopTeam,
  hideEmployeeUi: _hideEmployeeUi = false,
  claudeConcurrency = null,
  onCancelSession,
  onOpenTaskDetail: _onOpenTaskDetail,
  onOpenOmcBatchInvocationDetail,
  onCancelOmcDirectBatchInvocation,
  onStopSessionConversationTask,
  onReloadFullDiskTranscript,
  onCompactSessionHistory: _onCompactSessionHistory,
  transcriptSourceSessions,
  projectId,
  historyDrawerSessionId: _historyDrawerSessionIdProp,
  onHistoryDrawerSessionIdChange,
  onRestoreHistorySessionAsMain,
  onResumeSession,
  repositoryMainBindings = {},
  repositories = [],
  sectionCollapsed = false,
  onSectionCollapsedChange,
}: Props) {
  const { running: agentAssignments } = useAgentAssignments({ projectId, enabled: Boolean(projectId) });
  const setSectionCollapsed = onSectionCollapsedChange;

  const [employeeHistoryPopoverId, setEmployeeHistoryPopoverId] = useState<string | null>(null);
  const [teamHistoryPopoverId, setTeamHistoryPopoverId] = useState<string | null>(null);
  const [employeeHistorySearch, setEmployeeHistorySearch] = useState("");
  const [teamHistorySearch, setTeamHistorySearch] = useState("");
  const [teamHistoryEmployeeFilter, setTeamHistoryEmployeeFilter] = useState<string>("all");
  const [, setInternalHistoryMessagesSessionId] = useState<string | null>(null);
  const setHistoryMessagesSessionId = onHistoryDrawerSessionIdChange ?? setInternalHistoryMessagesSessionId;

  const canRestoreHistorySession = useCallback(
    (sessionId: string) => {
      if (!onRestoreHistorySessionAsMain) return false;
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) return false;
      return !isSessionBoundAsRepositoryMain(session, repositoryMainBindings, sessions, repositories);
    },
    [onRestoreHistorySessionAsMain, repositoryMainBindings, repositories, sessions],
  );
  const [omcDirectBatchDetailSnapshot, setOmcDirectBatchDetailSnapshot] = useState<WorkflowInvocationStreamDetail | null>(null);
  const [repositorySubagentDetailTarget, setRepositorySubagentDetailTarget] = useState<RepositorySubagentDetailTarget | null>(null);
  const [sessionConversationTaskDetailTarget, setSessionConversationTaskDetailTarget] =
    useState<SessionConversationTaskDetailTarget | null>(null);

  const omcDirectBatchInvocationsLive = useSyncExternalStore(
    subscribeOmcDirectBatchInvocations,
    getOmcDirectBatchInvocationsSnapshot,
    getOmcDirectBatchInvocationsSnapshot,
  );
  useEffect(() => {
    setOmcDirectBatchDetailSnapshot((prev) => {
      if (!prev) return prev;
      const fresh = omcDirectBatchInvocationsLive.find((i) => i.invocationKey === prev.invocationKey);
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
  }, [omcDirectBatchInvocationsLive]);

  const employeeHistoryByNameCacheRef = useRef<{ fp: string; map: Map<string, ClaudeSession[]> } | null>(null);
  const employeeHistorySessionsByName = useMemo(() => {
    const fp = monitorEmployeeHistoryStructureFingerprint(sessions);
    const hit = employeeHistoryByNameCacheRef.current;
    if (hit && hit.fp === fp) {
      return hit.map;
    }
    const map = buildMonitorEmployeeHistorySessionsByName(sessions);
    employeeHistoryByNameCacheRef.current = { fp, map };
    return map;
  }, [sessions]);

  const sortedEmployeeItems = useMemo(() => {
    return [...employeeItems].sort((a, b) => {
      const aNum = extractTrailingNumber(a.name) ?? extractTrailingNumber(a.employeeId);
      const bNum = extractTrailingNumber(b.name) ?? extractTrailingNumber(b.employeeId);
      if (aNum !== null && bNum !== null && aNum !== bNum) {
        return aNum - bNum;
      }
      if (aNum !== null && bNum === null) return -1;
      if (aNum === null && bNum !== null) return 1;
      return a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" });
    });
  }, [employeeItems]);
  const teamHistorySessionsByWorkflowId = useMemo(() => {
    const map = new Map<string, TeamHistorySessionRow[]>();
    for (const teamItem of teamItems) {
      const normalizedMemberNames = (teamItem.memberNames ?? [])
        .map((name) => normalizeMonitorEmployeeName(name))
        .filter((name) => name.length > 0);
      const rows: TeamHistorySessionRow[] = [];
      const visitedSessionIds = new Set<string>();
      for (const memberName of normalizedMemberNames) {
        const sessionsOfMember = employeeHistorySessionsByName.get(memberName) ?? [];
        for (const session of sessionsOfMember) {
          if (visitedSessionIds.has(session.id)) {
            continue;
          }
          visitedSessionIds.add(session.id);
          rows.push({ session, employeeName: memberName });
        }
      }
      rows.sort((a, b) => sessionUpdatedAt(b.session) - sessionUpdatedAt(a.session));
      map.set(teamItem.workflowId, rows);
    }
    return map;
  }, [employeeHistorySessionsByName, teamItems]);

  const sessionsForHistoryTranscript = transcriptSourceSessions ?? sessions;

  function openHistoryMessagesDrawer(sessionId: string) {
    setEmployeeHistoryPopoverId(null);
    setTeamHistoryPopoverId(null);
    setHistoryMessagesSessionId(sessionId);
  }

  const handleOmcBatchInvocationSelect = useCallback(
    (input: { sessionId: string; repositoryPath: string; invocationKey: string }) => {
      setEmployeeHistoryPopoverId(null);
      setEmployeeHistorySearch("");
      setOmcDirectBatchDetailSnapshot(null);
      onOpenOmcBatchInvocationDetail?.(input);
    },
    [onOpenOmcBatchInvocationDetail],
  );

  const handleOmcDirectBatchRowActivate = useCallback((inv: WorkflowInvocationStreamDetail) => {
    setEmployeeHistoryPopoverId(null);
    setEmployeeHistorySearch("");
    setSessionConversationTaskDetailTarget(null);
    setOmcDirectBatchDetailSnapshot(inv);
  }, []);

  const activateEmployeeTerminalRow = useCallback(
    (item: EmployeeMonitorItem) => {
      if (item.employeeId === "omc-worker") {
        const latestInvocation =
          omcDirectBatchInvocationsLive.length > 0
            ? omcDirectBatchInvocationsLive[omcDirectBatchInvocationsLive.length - 1]
            : undefined;
        if (latestInvocation) {
          const subprocessSid = latestInvocation.subprocessSessionId?.trim();
          if (subprocessSid) {
            openHistoryMessagesDrawer(subprocessSid);
            return;
          }
          handleOmcDirectBatchRowActivate(latestInvocation);
          return;
        }
        const boundSid = item.sessionId?.trim();
        if (boundSid) {
          openHistoryMessagesDrawer(boundSid);
          return;
        }
        setEmployeeHistoryPopoverId(item.employeeId);
        setEmployeeHistorySearch("");
        return;
      }

      const latestSession = pickLatestMonitorEmployeeHistorySession(employeeHistorySessionsByName, item.name);
      if (latestSession) {
        openHistoryMessagesDrawer(latestSession.id);
        return;
      }
      const activeSid = item.sessionId?.trim();
      if (activeSid && sessions.some((session) => session.id === activeSid)) {
        openHistoryMessagesDrawer(activeSid);
        return;
      }
      setEmployeeHistoryPopoverId(item.employeeId);
      setEmployeeHistorySearch("");
    },
    [employeeHistorySessionsByName, handleOmcDirectBatchRowActivate, omcDirectBatchInvocationsLive, sessions],
  );

  const stopSessionConversationTask = useCallback(
    (item: SessionConversationTaskItem) => {
      if (
        !canStopSessionConversationTask(item, {
          onCancelSession,
          onCancelOmcDirectBatchInvocation,
          onStopSessionConversationTask,
        })
      ) {
        return;
      }
      if (onStopSessionConversationTask) {
        onStopSessionConversationTask(item);
        return;
      }
      if (item.cancelMode === "invocation") {
        const key = item.invocationKey?.trim();
        if (key && onCancelOmcDirectBatchInvocation) {
          onCancelOmcDirectBatchInvocation(key);
        }
        return;
      }
      const sid = item.sessionId?.trim();
      if (sid && onCancelSession) {
        onCancelSession(sid);
      }
    },
    [onCancelOmcDirectBatchInvocation, onCancelSession, onStopSessionConversationTask],
  );

  const openSessionConversationTaskDetail = useCallback(
    (item: SessionConversationTaskItem) => {
      if (item.invocationKey && item.sessionId && item.repositoryPath) {
        const inv = omcDirectBatchInvocationsLive.find((row) => row.invocationKey === item.invocationKey);
        setSessionConversationTaskDetailTarget(null);
        if (inv) {
          setOmcDirectBatchDetailSnapshot(inv);
          return;
        }
        onOpenOmcBatchInvocationDetail?.({
          sessionId: item.sessionId,
          repositoryPath: item.repositoryPath,
          invocationKey: item.invocationKey,
        });
        return;
      }

      if (item.source === "execution_environment") {
        setOmcDirectBatchDetailSnapshot(null);
        setSessionConversationTaskDetailTarget({ task: item });
        return;
      }

      const sid = item.sessionId?.trim();
      if (!sid) return;
      const sessionHit =
        sessionsForHistoryTranscript.find((row) => row.id === sid || row.claudeSessionId?.trim() === sid) ??
        sessions.find((row) => row.id === sid || row.claudeSessionId?.trim() === sid);
      if (!sessionHit) return;
      setOmcDirectBatchDetailSnapshot(null);
      setSessionConversationTaskDetailTarget({ task: item });
    },
    [omcDirectBatchInvocationsLive, onOpenOmcBatchInvocationDetail, sessions, sessionsForHistoryTranscript],
  );

  const executionEnvironmentDispatchTaskItems = useMemo(
    () => filterExecutionEnvironmentDispatchTaskItems(sessionConversationTaskItems),
    [sessionConversationTaskItems],
  );

  const runningSessionConversationTasks = useMemo(
    () => executionEnvironmentDispatchTaskItems.filter((item) => item.status === "running"),
    [executionEnvironmentDispatchTaskItems],
  );

  const shouldShowSessionConversationTasks = showSessionConversationTasks;

  const panelHasListContent =
    shouldShowSessionConversationTasks ||
    employeeItems.length > 0 ||
    agentAssignments.length > 0 ||
    teamItems.length > 0;

  const collapsedSummaryMeta = useMemo(() => {
    if (claudeConcurrency) {
      return `${claudeConcurrency.activeCount}/${claudeConcurrency.limit}`;
    }
    const runningTerminals = employeeItems.filter((item) => item.status === "in_progress").length;
    const runningTeams = teamItems.filter((item) => item.status === "in_progress").length;
    const activeCount = runningTerminals + runningTeams + agentAssignments.length;
    return activeCount > 0 ? `${activeCount} 活跃` : null;
  }, [agentAssignments.length, claudeConcurrency, employeeItems, teamItems]);

  const monitorDrawers = (
    <>
      <OmcDirectBatchInvocationDetailDrawer
        open={omcDirectBatchDetailSnapshot !== null}
        snapshot={omcDirectBatchDetailSnapshot}
        sessions={sessions}
        onClose={() => setOmcDirectBatchDetailSnapshot(null)}
        onOpenInMainSessionBackground={onOpenOmcBatchInvocationDetail ? handleOmcBatchInvocationSelect : undefined}
      />

      <SessionConversationTaskDetailDrawer
        target={sessionConversationTaskDetailTarget}
        sessions={sessionsForHistoryTranscript}
        sessionConversationTaskItems={sessionConversationTaskItems ?? []}
        onClose={() => setSessionConversationTaskDetailTarget(null)}
        onStopTask={stopSessionConversationTask}
        onCancelSession={onCancelSession}
        onCancelOmcDirectBatchInvocation={onCancelOmcDirectBatchInvocation}
        onStopSessionConversationTask={onStopSessionConversationTask}
        onResumeSession={onResumeSession}
      />

      <RepositorySubagentDetailDrawer
        target={repositorySubagentDetailTarget}
        sessions={sessionsForHistoryTranscript}
        onReloadFullDiskTranscript={onReloadFullDiskTranscript}
        onClose={() => setRepositorySubagentDetailTarget(null)}
      />
    </>
  );

  if (sectionCollapsed && setSectionCollapsed) {
    return (
      <div className="app-monitor-panel app-monitor-panel--section-collapsed">
        <div className="app-repository-row app-left-sidebar-monitor-panel-collapsed-row">
          <div className="app-repository-item app-repository-item--project app-repository-item--monitor-panel-collapsed">
            <span
              className="app-repository-expand"
              role="button"
              tabIndex={0}
              aria-expanded={false}
              aria-label="展开运行面板"
              onClick={(event) => {
                event.stopPropagation();
                setSectionCollapsed(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  setSectionCollapsed(false);
                }
              }}
            >
              <ExpandIcon expanded={false} />
            </span>
            <span
              className="app-repository-name-block app-left-sidebar-monitor-panel-collapsed-hit"
              role="button"
              tabIndex={0}
              aria-label="展开运行面板"
              onClick={() => setSectionCollapsed(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSectionCollapsed(false);
                }
              }}
            >
              <span className="app-repository-name">运行面板</span>
              {collapsedSummaryMeta ? (
                <span className="app-repository-meta" aria-label={collapsedSummaryMeta}>
                  {collapsedSummaryMeta}
                </span>
              ) : null}
            </span>
          </div>
        </div>
        {monitorDrawers}
      </div>
    );
  }

  return (
    <div className="app-monitor-panel">
      <div className="app-monitor-panel__head">
        <div className="app-monitor-panel__head-start">
          <div className="app-monitor-panel__title">运行面板</div>
          <div className="app-monitor-panel__config-btns">
            {onOpenEmployeeConfig ? (
              <button
                type="button"
                className="app-monitor-panel__config-btn"
                onClick={() => onOpenEmployeeConfig()}
              >
                终端
              </button>
            ) : null}
            <button
              type="button"
              className="app-monitor-panel__config-btn"
              onClick={() => onOpenWorkflowConfig?.()}
            >
              工作流
            </button>
          </div>
        </div>
        <div className="app-monitor-panel__head-concurrency">
          {claudeConcurrency ? (
            <ConcurrencyControl
              activeCount={claudeConcurrency.activeCount}
              limit={claudeConcurrency.limit}
              onLimitChange={claudeConcurrency.onLimitChange}
            />
          ) : (
            <span className="app-monitor-panel__concurrency app-monitor-panel__concurrency--muted" aria-hidden>
              <span className="app-monitor-panel__concurrency-label">并发</span>
              <span className="app-monitor-panel__concurrency-placeholder">—</span>
            </span>
          )}
          {setSectionCollapsed ? (
            <Tooltip title="收起运行面板" mouseEnterDelay={0.35}>
              <button
                type="button"
                className="app-monitor-panel__section-collapse-btn"
                aria-label="收起运行面板"
                onClick={() => setSectionCollapsed(true)}
              >
                <ExpandIcon expanded />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {!panelHasListContent ? (
        <div className="app-monitor-panel__empty app-monitor-panel__empty--with-action">
          <span>暂无终端</span>
          {onOpenEmployeeConfig ? (
            <button
              type="button"
              className="app-monitor-panel__empty-add-btn"
              onClick={() => onOpenEmployeeConfig()}
            >
              配置终端
            </button>
          ) : null}
        </div>
      ) : null}

      {employeeItems.length > 0 ? (
      <div className="app-monitor-panel__section">
          {sortedEmployeeItems.map((item) => {
            const isOmcWorker = item.employeeId === "omc-worker";
            const employeePopoverOpen = employeeHistoryPopoverId === item.employeeId;
            const keyword =
              employeePopoverOpen && !isOmcWorker ? normalizeSearchKeyword(employeeHistorySearch) : "";
            const historySessions =
              employeePopoverOpen && !isOmcWorker
                ? (employeeHistorySessionsByName.get(normalizeMonitorEmployeeName(item.name)) ?? [])
                : [];
            const matchedEmployeeSessions =
              employeePopoverOpen && !isOmcWorker
                ? historySessions.filter((session) => matchSessionByKeyword(session, keyword)).slice(0, 30)
                : [];
            return (
              <div key={item.employeeId} className="app-monitor-panel__item app-monitor-panel__item--terminal-row">
              <div className="app-monitor-panel__item-row app-monitor-panel__item-row--terminal">
                <button
                  type="button"
                  className="app-monitor-panel__item-row-main app-monitor-panel__subagent-row--clickable"
                  title={`打开 ${item.name} 最新会话记录`}
                  onClick={() => activateEmployeeTerminalRow(item)}
                >
                  <span className="app-monitor-panel__item-name-wrap">
                    <span className="app-monitor-panel__item-name">{item.name}</span>
                    {statusText(item.status)}
                  </span>
                </button>
                <span className="app-monitor-panel__item-actions">
                  {item.status === "in_progress" ? (
                    <button
                      type="button"
                      className="app-monitor-panel__item-action-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStopEmployee?.(item.employeeId);
                      }}
                    >
                      结束
                    </button>
                  ) : null}
                  {isOmcWorker ? (
                    <OmcDirectBatchInProgressPopover
                      open={employeeHistoryPopoverId === item.employeeId}
                      onOpenChange={(nextOpen) => {
                        if (nextOpen) {
                          setEmployeeHistoryPopoverId(item.employeeId);
                          setEmployeeHistorySearch("");
                          return;
                        }
                        setEmployeeHistoryPopoverId((prev) => (prev === item.employeeId ? null : prev));
                        setEmployeeHistorySearch("");
                      }}
                      searchValue={employeeHistorySearch}
                      onSearchChange={setEmployeeHistorySearch}
                      onRowActivate={handleOmcDirectBatchRowActivate}
                      onCancelInvocation={onCancelOmcDirectBatchInvocation}
                    />
                  ) : (
                    <Popover
                      trigger="click"
                      placement="bottomRight"
                      open={employeeHistoryPopoverId === item.employeeId}
                      onOpenChange={(nextOpen) => {
                        if (nextOpen) {
                          setEmployeeHistoryPopoverId(item.employeeId);
                          setEmployeeHistorySearch("");
                          return;
                        }
                        setEmployeeHistoryPopoverId((prev) => (prev === item.employeeId ? null : prev));
                        setEmployeeHistorySearch("");
                      }}
                      overlayClassName="app-monitor-panel__history-popover"
                      content={
                        <HistorySessionPopoverContent
                          searchValue={employeeHistorySearch}
                          onSearchChange={setEmployeeHistorySearch}
                          rows={matchedEmployeeSessions.map((session) => ({
                            session,
                            employeeName: item.name,
                          }))}
                          listTitle={`${item.name} · 历史会话`}
                          emptyDescription={employeeHistorySearch.trim() ? "未找到匹配会话" : "该终端暂无历史会话"}
                          onSelectSession={(sessionId) => openHistoryMessagesDrawer(sessionId)}
                          onRestoreSession={
                            onRestoreHistorySessionAsMain
                              ? (sessionId) => {
                                  void Promise.resolve(onRestoreHistorySessionAsMain(sessionId));
                                }
                              : undefined
                          }
                          canRestoreSession={canRestoreHistorySession}
                        />
                      }
                    >
                      <button
                        type="button"
                        className="app-monitor-panel__item-history-link"
                        onClick={(event) => event.stopPropagation()}
                      >
                        历史会话
                      </button>
                    </Popover>
                  )}
                  {taskResultTag(item.latestTaskStatus)}
                </span>
              </div>
              </div>
            );
          })}
      </div>
      ) : null}

      {shouldShowSessionConversationTasks ? (
        <div
          className={`app-monitor-panel__section app-monitor-panel__section--session-tasks${
            executionEnvironmentDispatchTaskItems.length === 0
              ? " app-monitor-panel__section--session-tasks-empty"
              : ""
          }`}
        >
          <div className="app-monitor-panel__session-tasks-toolbar">
            <div className="app-monitor-panel__session-tasks-toolbar-start">
              <Typography.Text className="app-monitor-panel__session-tasks-title">
                <SendOutlined className="app-monitor-panel__session-tasks-title-icon" aria-hidden />
                任务派发
              </Typography.Text>
              <span className="app-monitor-panel__session-tasks-count">
                {runningSessionConversationTasks.length > 0
                  ? `进行中 ${runningSessionConversationTasks.length}`
                  : `共 ${executionEnvironmentDispatchTaskItems.length} 项`}
              </span>
            </div>
            {executionEnvironmentDispatchHistoryDays != null &&
            onExecutionEnvironmentDispatchHistoryDaysChange ? (
              <Select
                size="small"
                className="app-monitor-panel__session-tasks-days"
                classNames={{ popup: { root: "app-monitor-panel__session-tasks-days-dropdown" } }}
                aria-label="任务派发历史天数"
                disabled={executionEnvironmentDispatchHistoryDaysSaving}
                value={executionEnvironmentDispatchHistoryDays}
                options={EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS.map((day) => ({
                  value: day,
                  label: `近 ${day} 天`,
                }))}
                onChange={(value) => {
                  void onExecutionEnvironmentDispatchHistoryDaysChange(
                    value as ExecutionEnvironmentDispatchHistoryDays,
                  );
                }}
              />
            ) : null}
          </div>
          {executionEnvironmentDispatchTaskItems.length > 0 ? (
            <div className="app-monitor-panel__session-tasks-list" aria-label="当前会话派发任务">
              {executionEnvironmentDispatchTaskItems.map((item) => {
                const showStop = canStopSessionConversationTask(item, {
                  onCancelSession,
                  onCancelOmcDirectBatchInvocation,
                  onStopSessionConversationTask,
                });
                return (
                  <div className="app-monitor-panel__session-task-row" key={item.key}>
                    <button
                      type="button"
                      className="app-monitor-panel__session-task-row-main"
                      title={item.subtitle ? `${item.label} · ${item.subtitle}` : item.label}
                      onClick={() => openSessionConversationTaskDetail(item)}
                    >
                      <span className="app-monitor-panel__session-task-name" title={item.label}>
                        {item.label}
                      </span>
                      {item.subtitle ? (
                        <span className="app-monitor-panel__session-task-meta">{item.subtitle}</span>
                      ) : null}
                      <span className="app-monitor-panel__session-task-time">
                        {formatExecutionEnvironmentDispatchTaskTime(item.updatedAt)}
                      </span>
                    </button>
                    <span className="app-monitor-panel__session-task-actions">
                      {showStop ? (
                        <Tooltip title="结束执行">
                          <button
                            type="button"
                            className="app-monitor-panel__session-task-stop"
                            aria-label="结束执行"
                            onClick={(event) => {
                              event.stopPropagation();
                              stopSessionConversationTask(item);
                            }}
                          >
                            ■
                          </button>
                        </Tooltip>
                      ) : null}
                      <SubagentStatusIndicator status={item.status} />
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="app-monitor-panel__session-tasks-empty-hint">近 {executionEnvironmentDispatchHistoryDays ?? 1} 天暂无派发记录</div>
          )}
        </div>
      ) : null}

      {agentAssignments.length > 0 ? (
        <div className="app-monitor-panel__section">
          <div className="app-monitor-panel__section-head">
            <div className="app-monitor-panel__section-title-wrap">
              <Typography.Text className="app-monitor-panel__section-title">
                <span className="app-monitor-panel__section-icon"><RepositoryMiniIcon /></span>
                Mission Agent
              </Typography.Text>
              <Typography.Text className="app-monitor-panel__meta">
                {agentAssignments.length} 活跃
              </Typography.Text>
            </div>
          </div>
          {agentAssignments.map((a) => (
            <div key={a.assignmentId} className="app-monitor-panel__item app-monitor-panel__item--readonly">
              <div className="app-monitor-panel__item-row">
                <span className="app-monitor-panel__item-name-wrap">
                  <span className="app-monitor-panel__item-name">{a.agentType}</span>
                  <span className="app-monitor-panel__repo-type">{a.stage}</span>
                  <span className="app-monitor-panel__status app-monitor-panel__status--in_progress">
                    {a.status === "stale" ? "疑似断连" : "运行中"}
                  </span>
                </span>
                <span className="app-monitor-panel__item-actions">
                  {a.clusterId ? (
                    <span className="app-monitor-panel__result-pill">{a.clusterId}</span>
                  ) : null}
                  {a.currentFile ? (
                    <span className="app-monitor-panel__result-pill" title={a.currentFile}>
                      {a.currentFile.split("/").pop()}
                    </span>
                  ) : null}
                </span>
              </div>
              {a.repositoryPath ? (
                <div className="app-monitor-panel__subagent-tree">
                  <div className="app-monitor-panel__subagent-row">
                    <span className="app-monitor-panel__subagent-branch" aria-hidden />
                    <span className="app-monitor-panel__subagent-main">
                      <span className="app-monitor-panel__subagent-name">
                        {(a.repositoryPath ?? "").split("/").pop()}
                      </span>
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {teamItems.length > 0 ? (
      <div className="app-monitor-panel__section">
          {teamItems.map((item) => {
            const teamPopoverOpen = teamHistoryPopoverId === item.workflowId;
            const keyword = teamPopoverOpen ? normalizeSearchKeyword(teamHistorySearch) : "";
            const matchedTeamSessions = teamPopoverOpen
              ? (teamHistorySessionsByWorkflowId.get(item.workflowId) ?? [])
                  .filter((row) => {
                    if (teamHistoryEmployeeFilter !== "all" && row.employeeName !== teamHistoryEmployeeFilter) {
                      return false;
                    }
                    return matchSessionByKeyword(row.session, keyword, row.employeeName);
                  })
                  .slice(0, 30)
              : [];
            return (
              <div
                key={item.workflowId}
                className={`app-monitor-panel__item ${activeTarget?.type === "team" && activeTarget.workflowId === item.workflowId ? "app-monitor-panel__item--active" : ""}`}
                onClick={() => onOpenTeamDetail(item.workflowId)}
              >
              <div className="app-monitor-panel__item-row">
                <span className="app-monitor-panel__item-name-wrap">
                  <Tooltip title={memberTooltipContent(item.memberNames)}>
                    <span className="app-monitor-panel__item-name">{item.workflowName}</span>
                  </Tooltip>
                  {statusText(item.status)}
                </span>
                <span className="app-monitor-panel__item-actions">
                  {item.status === "in_progress" ? (
                    <button
                      type="button"
                      className="app-monitor-panel__item-action-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStopTeam?.(item.workflowId);
                      }}
                    >
                      结束
                    </button>
                  ) : null}
                  <Popover
                    trigger="click"
                    placement="bottomRight"
                    open={teamHistoryPopoverId === item.workflowId}
                    onOpenChange={(nextOpen) => {
                      if (nextOpen) {
                        setTeamHistoryPopoverId(item.workflowId);
                        setTeamHistorySearch("");
                        setTeamHistoryEmployeeFilter("all");
                        return;
                      }
                      setTeamHistoryPopoverId((prev) => (prev === item.workflowId ? null : prev));
                      setTeamHistorySearch("");
                      setTeamHistoryEmployeeFilter("all");
                    }}
                    overlayClassName="app-monitor-panel__history-popover"
                    content={
                      <HistorySessionPopoverContent
                        searchValue={teamHistorySearch}
                        onSearchChange={setTeamHistorySearch}
                        employeeFilterValue={teamHistoryEmployeeFilter}
                        onEmployeeFilterChange={setTeamHistoryEmployeeFilter}
                        employeeOptions={item.memberNames ?? []}
                        rows={matchedTeamSessions}
                        listTitle={`${item.workflowName} · 历史会话`}
                        memberFilterAllLabel="全部终端"
                        emptyDescription={
                          teamHistorySearch.trim() || teamHistoryEmployeeFilter !== "all"
                            ? "未找到匹配会话"
                            : "该工作流暂无历史会话"
                        }
                        onSelectSession={(sessionId) => openHistoryMessagesDrawer(sessionId)}
                        onRestoreSession={
                          onRestoreHistorySessionAsMain
                            ? (sessionId) => {
                                void Promise.resolve(onRestoreHistorySessionAsMain(sessionId));
                              }
                            : undefined
                        }
                        canRestoreSession={canRestoreHistorySession}
                      />
                    }
                  >
                    <button
                      type="button"
                      className="app-monitor-panel__item-history-link"
                      onClick={(event) => event.stopPropagation()}
                    >
                      历史会话
                    </button>
                  </Popover>
                  {taskResultTag(item.latestTaskStatus)}
                </span>
              </div>
              <div className="app-monitor-panel__item-meta-grid">
                <span className="app-monitor-panel__item-sub">{item.progressText}</span>
                {item.omcProgressText ? (
                  <span className="app-monitor-panel__item-sub">{item.omcProgressText}</span>
                ) : null}
              </div>
              </div>
            );
          })}
      </div>
      ) : null}

      {monitorDrawers}
    </div>
  );
}
