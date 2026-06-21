import {
  CodeOutlined,
  DeploymentUnitOutlined,
  HistoryOutlined,
  LoadingOutlined,
  PlusCircleOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Button, Collapse, Descriptions, Drawer, Empty, Popover, Tag, Typography } from "antd";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
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
import { isSessionBoundAsRepositoryMain, repositoryPathsMatch } from "../../utils/repositoryMainSessionBinding";
import type { WorkflowInvocationStreamDetail } from "../../constants/workflowUiEvents";
import {
  formatOmcDirectBatchInvocationErrorPreviewLineForList,
  formatOmcDirectBatchInvocationListTitle,
  isOmcDirectBatchInvocationRunning,
} from "../../utils/omcDirectBatchInvocationDisplay";
import {
  getOmcDirectBatchInvocationsDigest,
  getOmcDirectBatchInvocationsSnapshot,
  subscribeOmcDirectBatchInvocations,
} from "../../stores/omcDirectBatchInvocationsStore";
import {
  buildMonitorEmployeeHistorySessionsByName,
  monitorEmployeeHistoryStructureFingerprint,
  normalizeMonitorEmployeeName,
  pickMonitorTerminalDrawerSession,
} from "../../utils/omcEmployeeMonitorHistory";
import {
  pickSubagentTranscriptSession,
  useSubagentDiskTranscript,
} from "../../hooks/useSubagentDiskTranscript";
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
import { ExpandIcon } from "../LeftSidebar/SidebarIcons";
import { SubagentStatusIndicator, type SubagentStatusVisual } from "./SubagentStatusIndicator";
import {
  historyDaysToSinceMs,
  type ExecutionEnvironmentDispatchHistoryDays,
} from "../../constants/executionEnvironmentDispatch";
import { ExecutionEnvironmentDispatchHistoryDaysDropdown } from "./ExecutionEnvironmentDispatchHistoryDaysDropdown";
import { MonitorLazyClickPopover } from "./MonitorLazyClickPopover";
import { resolveMonitorRepositoryPath } from "../../utils/executionEnvironmentDispatchAnchor";
import { canStopSessionConversationTask, filterSessionDispatchTaskItems } from "../../utils/sessionConversationTasks";
import { SessionConversationDispatchTaskRow } from "./SessionConversationDispatchTaskRow";
import {
  buildEmployeeTerminalConversationStatusById,
  buildEmployeeTerminalLastMessagePreviewById,
  type EmployeeTerminalConversationStatus,
} from "../../utils/employeeTerminalDispatchStatus";
import {
  monitorSessionsOverviewFingerprint,
  monitorSessionsTerminalStatusFingerprint,
} from "../../hooks/useMonitorSessionsForOverview";
import { useClaudeSessionsLiveSnapshot } from "../../stores/claudeSessionsLiveStore";
import {
  MONITOR_VIRTUALIZE_MIN_ROWS,
  MonitorPanelVirtualRows,
} from "./MonitorPanelVirtualRows";
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

function MonitorItemTypeTag({ label }: { label: string }) {
  return <span className="app-monitor-panel__item-type-tag">{label}</span>;
}

function MonitorPanelCompactScrollBody({
  enabled,
  scrollRef,
  children,
}: {
  enabled: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  if (enabled && scrollRef) {
    return (
      <div ref={scrollRef} className="app-monitor-panel__compact-sidebar-body">
        {children}
      </div>
    );
  }
  return <>{children}</>;
}

function MonitorPanelHeadConfigActions({
  onOpenEmployeeConfig,
  onOpenWorkflowConfig,
}: {
  onOpenEmployeeConfig?: () => void;
  onOpenWorkflowConfig?: () => void;
}) {
  if (!onOpenEmployeeConfig && !onOpenWorkflowConfig) {
    return null;
  }
  return (
    <div className="app-monitor-panel__head-actions">
      {onOpenEmployeeConfig ? (
        <button
          type="button"
          className="app-monitor-panel__head-config-btn"
          title="配置终端"
          aria-label="配置终端"
          onClick={() => onOpenEmployeeConfig()}
        >
          <CodeOutlined aria-hidden />
          <span className="app-monitor-panel__head-config-label">终端</span>
        </button>
      ) : null}
      {onOpenWorkflowConfig ? (
        <button
          type="button"
          className="app-monitor-panel__head-config-btn"
          title="配置工作流"
          aria-label="配置工作流"
          onClick={() => onOpenWorkflowConfig()}
        >
          <DeploymentUnitOutlined aria-hidden />
          <span className="app-monitor-panel__head-config-label">工作流</span>
        </button>
      ) : null}
    </div>
  );
}

interface Props {
  employeeItems: EmployeeMonitorItem[];
  repositoryMemberItems: RepositoryMemberMonitorItem[];
  teamItems: TeamMonitorItem[];
  /** 当前对话子代理 / 任务（显示在「我的团队」上方） */
  sessionConversationTaskItems?: readonly SessionConversationTaskItem[];
  /** 强制展示「子代理 / 任务」区块：即便列表为空也展示区块头（默认：仅当有数据时展示）。 */
  showSessionConversationTasks?: boolean;
  executionEnvironmentDispatchHistoryDays?: ExecutionEnvironmentDispatchHistoryDays;
  onExecutionEnvironmentDispatchHistoryDaysChange?: (
    days: ExecutionEnvironmentDispatchHistoryDays,
  ) => void | Promise<void>;
  executionEnvironmentDispatchHistoryDaysSaving?: boolean;
  sessions: ClaudeSession[];
  /** 当前主会话 id，用于解析同仓库下的终端 worker 与派发任务归属 */
  activeSessionId?: string | null;
  activeTarget?: MonitorDrawerTarget | null;
  onOpenTeamDetail?: (workflowId: string) => void;
  onOpenEmployeeConfig?: () => void;
  onOpenWorkflowConfig?: () => void;
  onStopEmployee?: (employeeId: string) => void;
  onStopTeam?: (workflowId: string) => void;
  /** 当 `Project.sddMode === "wise_trellis"` 时由 AppImpl 传入 true，隐藏员工区块；头部仍显示「成员」配置按钮。 */
  hideEmployeeUi?: boolean;
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
  /** 运行面板终端历史弹层：为该终端新建 worker 会话 */
  onCreateTerminalEmployeeSession?: (employeeId: string) => string | null | Promise<string | null>;
  /** 打开终端历史列表前刷新仓库磁盘会话索引 */
  onRefreshHistorySessions?: (scope: {
    repositoryPath: string;
    repositoryName: string;
  }) => void | Promise<void>;
  /** 历史 / 派发抽屉底部：resume 继续当前会话 */
  onResumeSession?: import("./MonitorDrawerSessionComposer").MonitorDrawerResumeSessionFn;
  /** 派发 / 执行会话抽屉打开前：从 tabs / 磁盘回退解析 worker */
  onPrepareSessionForMonitorDrawer?: import("./MonitorDrawerSessionComposer").MonitorDrawerPrepareSessionFn;
  repositoryMainBindings?: Record<string, string>;
  repositories?: Repository[];
  sectionCollapsed?: boolean;
  onSectionCollapsedChange?: (collapsed: boolean) => void;
  /** 左栏运行面板内容区滚动容器；终端 + 派发 + 工作流合并列表，超出配置行数后整体滚动。 */
  compactSidebarScrollRootRef?: RefObject<HTMLDivElement | null>;
  /** 左栏内容区可见行数（由默认配置注入，高度由外层 CSS 变量控制）。 */
  monitorPanelVisibleRows?: number;
}

type MonitorCompactFlatRow =
  | { kind: "terminal"; item: EmployeeMonitorItem }
  | { kind: "dispatch"; item: SessionConversationTaskItem }
  | { kind: "workflow"; item: TeamMonitorItem };

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
  /** 终端历史弹层：搜索框右侧「新建会话」 */
  onCreateSession?: () => void;
  createSessionLoading?: boolean;
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
      <div className="app-monitor-panel__history-popover-scroll">
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
  const tooltipTitle =
    runningCount > 0
      ? `当前 ${runningCount} 路运行中（共 ${totalCount} 路；与「可执行任务」勾选条数不是同一概念）`
      : totalCount > 0
        ? `共 ${totalCount} 路子进程记录；新发起直连批量 OMC 时会清空并重建列表`
        : "查看直连批量 OMC 子进程列表（非 Wise 会话标签列表）";

  const triggerButton = (
    requestOpen: () => void,
  ) => (
    <button
      type="button"
      className="app-monitor-panel__item-action-icon-btn"
      title={tooltipTitle}
      aria-label="直连批量 OMC 子进程列表"
      onClick={(event) => {
        event.stopPropagation();
        requestOpen();
      }}
    >
      <HistoryOutlined />
    </button>
  );

  if (!open) {
    return triggerButton(() => onOpenChange(true));
  }

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open
      destroyOnHidden
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
      {triggerButton(() => {})}
    </Popover>
  );
});

function statusText(status: "in_progress" | "idle") {
  if (status === "in_progress") {
    return (
      <span
        className="app-monitor-panel__status-spinner"
        role="status"
        aria-label="进行中"
        title="进行中"
      >
          <svg className="app-monitor-panel__status-spinner-svg" viewBox="0 0 16 16" aria-hidden>
            <circle className="app-monitor-panel__status-spinner-track" cx="8" cy="8" r="6.25" fill="none" />
            <circle className="app-monitor-panel__status-spinner-arc" cx="8" cy="8" r="6.25" fill="none" />
          </svg>
        </span>
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

function memberTooltipTitle(memberNames?: string[]): string {
  if (!memberNames?.length) return "暂无团队成员";
  return memberNames.join("、");
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
  onCreateSession,
  createSessionLoading = false,
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
        {onCreateSession ? (
            <Button
              type="text"
              size="small"
              className="app-monitor-panel__history-popover-new-session"
              icon={<PlusCircleOutlined />}
              loading={createSessionLoading}
              aria-label="新建会话"
              title="新建会话"
              onClick={(event) => {
                event.stopPropagation();
                onCreateSession();
              }}
            />
        ) : null}
      </div>
      <div className="app-monitor-panel__history-popover-list-head">
        <span className="app-monitor-panel__history-popover-list-title">{listTitle}</span>
        <span className="app-monitor-panel__history-popover-list-count">{hasRows ? `${rows.length} 条` : "无记录"}</span>
      </div>
      <div className="app-monitor-panel__history-popover-scroll">
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
    </div>
  );
}

const TerminalEmployeeMonitorRow = memo(function TerminalEmployeeMonitorRow({
  item,
  conversationStatus,
  lastMessagePreview,
  historyPopoverOpen,
  historySearch,
  matchedHistorySessions,
  onActivateRow,
  onStopEmployee,
  onHistoryPopoverOpenChange,
  onHistorySearchChange,
  onSelectHistorySession,
  onRestoreHistorySession,
  canRestoreHistorySession,
  onCreateTerminalSession,
  createTerminalSessionLoading,
  onOmcRowActivate,
  onCancelOmcInvocation,
  statusVisual,
}: {
  item: EmployeeMonitorItem;
  conversationStatus: EmployeeTerminalConversationStatus;
  lastMessagePreview: string;
  statusVisual: SubagentStatusVisual;
  historyPopoverOpen: boolean;
  historySearch: string;
  matchedHistorySessions: readonly ClaudeSession[];
  onActivateRow: (item: EmployeeMonitorItem) => void;
  onStopEmployee?: (employeeId: string) => void;
  onHistoryPopoverOpenChange: (employeeId: string, nextOpen: boolean) => void;
  onHistorySearchChange: (value: string) => void;
  onSelectHistorySession: (sessionId: string) => void;
  onRestoreHistorySession?: (sessionId: string) => void;
  canRestoreHistorySession: (sessionId: string) => boolean;
  onCreateTerminalSession?: () => void;
  createTerminalSessionLoading?: boolean;
  onOmcRowActivate: (inv: WorkflowInvocationStreamDetail) => void;
  onCancelOmcInvocation?: (invocationKey: string) => void;
}) {
  const terminalInProgress =
    item.status === "in_progress" || conversationStatus === "running";
  const isOmcWorker = item.employeeId === "omc-worker";

  return (
    <div className="app-monitor-panel__item app-monitor-panel__item--terminal-row">
      <div className="app-monitor-panel__item-row app-monitor-panel__item-row--terminal">
        <button
          type="button"
          className="app-monitor-panel__item-row-hit app-monitor-panel__item-row-hit--terminal"
          title={`打开 ${item.name} 最新会话记录`}
          onClick={() => onActivateRow(item)}
        >
          <span className="app-monitor-panel__item-name-wrap">
            <MonitorItemTypeTag label={isOmcWorker ? "OMC" : "终端"} />
            <span className="app-monitor-panel__item-name">{item.name}</span>
          </span>
          {lastMessagePreview ? (
            <span className="app-monitor-panel__session-task-preview" title={lastMessagePreview}>
              {lastMessagePreview}
            </span>
          ) : null}
        </button>
        <span className="app-monitor-panel__item-actions">
          <SubagentStatusIndicator status={conversationStatus} visual={statusVisual} />
          {terminalInProgress ? (
            <button
              type="button"
              className="app-monitor-panel__item-action-icon-btn app-monitor-panel__item-action-icon-btn--stop"
              title="结束终端"
              aria-label="结束终端"
              onClick={(event) => {
                event.stopPropagation();
                onStopEmployee?.(item.employeeId);
              }}
            >
              <StopOutlined />
            </button>
          ) : null}
          {!isOmcWorker && onCreateTerminalSession ? (
            <button
              type="button"
              className={`app-monitor-panel__item-action-icon-btn app-monitor-panel__item-action-icon-btn--new-session${createTerminalSessionLoading ? " app-monitor-panel__item-action-icon-btn--loading" : ""}`}
              title={createTerminalSessionLoading ? "创建中..." : "新增会话"}
              aria-label="新增会话"
              aria-busy={createTerminalSessionLoading}
              disabled={createTerminalSessionLoading}
              onClick={(event) => {
                event.stopPropagation();
                if (createTerminalSessionLoading) return;
                onCreateTerminalSession();
              }}
            >
              {createTerminalSessionLoading ? <LoadingOutlined /> : <PlusCircleOutlined />}
            </button>
          ) : null}
          {isOmcWorker ? (
            <OmcDirectBatchInProgressPopover
              open={historyPopoverOpen}
              onOpenChange={(nextOpen) => onHistoryPopoverOpenChange(item.employeeId, nextOpen)}
              searchValue={historySearch}
              onSearchChange={onHistorySearchChange}
              onRowActivate={onOmcRowActivate}
              onCancelInvocation={onCancelOmcInvocation}
            />
          ) : (
            <MonitorLazyClickPopover
              open={historyPopoverOpen}
              placement="bottomRight"
              overlayClassName="app-monitor-panel__history-popover"
              onOpenChange={(nextOpen) => onHistoryPopoverOpenChange(item.employeeId, nextOpen)}
              content={
                <HistorySessionPopoverContent
                  searchValue={historySearch}
                  onSearchChange={onHistorySearchChange}
                  rows={matchedHistorySessions.map((session) => ({
                    session,
                    employeeName: item.name,
                  }))}
                  listTitle={`${item.name} · 历史会话`}
                  emptyDescription={historySearch.trim() ? "未找到匹配会话" : "该终端暂无历史会话"}
                  onSelectSession={onSelectHistorySession}
                  onRestoreSession={
                    onRestoreHistorySession
                      ? (sessionId) => {
                          void Promise.resolve(onRestoreHistorySession(sessionId));
                        }
                      : undefined
                  }
                  canRestoreSession={canRestoreHistorySession}
                  onCreateSession={onCreateTerminalSession}
                  createSessionLoading={createTerminalSessionLoading}
                />
              }
              renderTrigger={({ requestOpen }) => (
                <button
                  type="button"
                  className="app-monitor-panel__item-action-icon-btn"
                  title="历史会话"
                  aria-label="历史会话"
                  onClick={(event) => {
                    event.stopPropagation();
                    requestOpen();
                  }}
                >
                  <HistoryOutlined />
                </button>
              )}
            />
          )}
          {conversationStatus === "idle" ? taskResultTag(item.latestTaskStatus) : null}
        </span>
      </div>
    </div>
  );
});

export const ProgressMonitorPanel = memo(function ProgressMonitorPanel({
  employeeItems,
  repositoryMemberItems: _repositoryMemberItems,
  teamItems,
  sessionConversationTaskItems = [],
  showSessionConversationTasks = false,
  executionEnvironmentDispatchHistoryDays,
  onExecutionEnvironmentDispatchHistoryDaysChange,
  executionEnvironmentDispatchHistoryDaysSaving = false,
  sessions,
  activeSessionId = null,
  activeTarget,
  onOpenTeamDetail,
  onOpenEmployeeConfig,
  onOpenWorkflowConfig,
  onStopEmployee,
  onStopTeam,
  hideEmployeeUi: _hideEmployeeUi = false,
  onCancelSession,
  onOpenTaskDetail: _onOpenTaskDetail,
  onOpenOmcBatchInvocationDetail,
  onCancelOmcDirectBatchInvocation,
  onStopSessionConversationTask,
  onReloadFullDiskTranscript,
  onCompactSessionHistory: _onCompactSessionHistory,
  transcriptSourceSessions,
  projectId: _projectId,
  historyDrawerSessionId: _historyDrawerSessionIdProp,
  onHistoryDrawerSessionIdChange,
  onRestoreHistorySessionAsMain,
  onCreateTerminalEmployeeSession,
  onRefreshHistorySessions,
  onResumeSession,
  onPrepareSessionForMonitorDrawer,
  repositoryMainBindings = {},
  repositories = [],
  sectionCollapsed = false,
  onSectionCollapsedChange,
  compactSidebarScrollRootRef,
  monitorPanelVisibleRows: _monitorPanelVisibleRows,
}: Props) {
  const isCompactSidebarPanel = compactSidebarScrollRootRef != null;
  const setSectionCollapsed = onSectionCollapsedChange;

  const [employeeHistoryPopoverId, setEmployeeHistoryPopoverId] = useState<string | null>(null);
  const [teamHistoryPopoverId, setTeamHistoryPopoverId] = useState<string | null>(null);
  const [employeeHistorySearch, setEmployeeHistorySearch] = useState("");
  const [creatingTerminalSessionEmployeeId, setCreatingTerminalSessionEmployeeId] = useState<string | null>(
    null,
  );
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
  const omcDirectBatchInvocationsDigest = useSyncExternalStore(
    subscribeOmcDirectBatchInvocations,
    getOmcDirectBatchInvocationsDigest,
    getOmcDirectBatchInvocationsDigest,
  );
  const omcDirectBatchDetailInvocationKey = omcDirectBatchDetailSnapshot?.invocationKey ?? null;
  useEffect(() => {
    if (!omcDirectBatchDetailInvocationKey) return;
    setOmcDirectBatchDetailSnapshot((prev) => {
      if (!prev) return prev;
      const fresh = getOmcDirectBatchInvocationsSnapshot().find(
        (i) => i.invocationKey === prev.invocationKey,
      );
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
  }, [omcDirectBatchInvocationsDigest, omcDirectBatchDetailInvocationKey]);

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

  const needsLiveTranscriptSessions =
    _historyDrawerSessionIdProp != null ||
    sessionConversationTaskDetailTarget != null ||
    repositorySubagentDetailTarget != null ||
    omcDirectBatchDetailSnapshot != null;
  const liveTranscriptSessions = useClaudeSessionsLiveSnapshot(needsLiveTranscriptSessions);
  const nextTranscriptFingerprint = needsLiveTranscriptSessions
    ? monitorSessionsOverviewFingerprint(liveTranscriptSessions)
    : "frozen";
  const [transcriptSessionsFingerprint, setTranscriptSessionsFingerprint] = useState(
    nextTranscriptFingerprint,
  );
  if (nextTranscriptFingerprint !== transcriptSessionsFingerprint) {
    setTranscriptSessionsFingerprint(nextTranscriptFingerprint);
  }
  const sessionsForHistoryTranscript = useMemo(
    () => (needsLiveTranscriptSessions ? liveTranscriptSessions : (transcriptSourceSessions ?? sessions)),
    [needsLiveTranscriptSessions, transcriptSessionsFingerprint, sessions, transcriptSourceSessions, liveTranscriptSessions],
  );

  const openHistoryMessagesDrawer = useCallback(
    (sessionId: string) => {
      setEmployeeHistoryPopoverId(null);
      setTeamHistoryPopoverId(null);
      setHistoryMessagesSessionId(sessionId);
    },
    [setHistoryMessagesSessionId],
  );

  const handleCreateTerminalEmployeeSession = useCallback(
    (employeeId: string) => {
      if (!onCreateTerminalEmployeeSession || creatingTerminalSessionEmployeeId) return;
      setCreatingTerminalSessionEmployeeId(employeeId);
      void Promise.resolve(onCreateTerminalEmployeeSession(employeeId))
        .finally(() => {
          setCreatingTerminalSessionEmployeeId(null);
        });
    },
    [creatingTerminalSessionEmployeeId, onCreateTerminalEmployeeSession],
  );

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

  const executionEnvironmentDispatchSinceMs = useMemo(
    () =>
      executionEnvironmentDispatchHistoryDays != null
        ? historyDaysToSinceMs(executionEnvironmentDispatchHistoryDays)
        : undefined,
    [executionEnvironmentDispatchHistoryDays],
  );

  const executionEnvironmentDispatchTaskItems = useMemo(
    () =>
      filterSessionDispatchTaskItems(
        sessionConversationTaskItems,
        executionEnvironmentDispatchSinceMs,
      ),
    [sessionConversationTaskItems, executionEnvironmentDispatchSinceMs],
  );

  const monitorRepositoryPath = useMemo(
    () =>
      resolveMonitorRepositoryPath({
        activeSessionId,
        sessions,
        repositoryMainSessionBindings: repositoryMainBindings,
        repositories,
        employeeItems,
        dispatchTasks: executionEnvironmentDispatchTaskItems,
      }),
    [
      activeSessionId,
      employeeItems,
      executionEnvironmentDispatchTaskItems,
      repositories,
      repositoryMainBindings,
      sessions,
    ],
  );

  const activateEmployeeTerminalRow = useCallback(
    (item: EmployeeMonitorItem) => {
      const openDrawer = (sessionId: string) => {
        openHistoryMessagesDrawer(sessionId);
      };
      if (item.employeeId === "omc-worker") {
        const latestInvocation =
          omcDirectBatchInvocationsLive.length > 0
            ? omcDirectBatchInvocationsLive[omcDirectBatchInvocationsLive.length - 1]
            : undefined;
        if (latestInvocation) {
          const subprocessSid = latestInvocation.subprocessSessionId?.trim();
          if (subprocessSid) {
            openDrawer(subprocessSid);
            return;
          }
          handleOmcDirectBatchRowActivate(latestInvocation);
          return;
        }
        const boundSid = item.sessionId?.trim();
        if (boundSid) {
          openDrawer(boundSid);
          return;
        }
        setEmployeeHistoryPopoverId(item.employeeId);
        setEmployeeHistorySearch("");
        return;
      }

      const repoPath =
        item.repositoryPath?.trim() ||
        monitorRepositoryPath ||
        "";
      const drawerSession = pickMonitorTerminalDrawerSession(
        sessions,
        repoPath,
        item.name,
        employeeHistorySessionsByName,
      );
      if (drawerSession) {
        openDrawer(drawerSession.id);
        return;
      }
      const activeSid = item.sessionId?.trim();
      if (activeSid && sessions.some((session) => session.id === activeSid)) {
        openDrawer(activeSid);
        return;
      }
      setEmployeeHistoryPopoverId(item.employeeId);
      setEmployeeHistorySearch("");
    },
    [
      employeeHistorySessionsByName,
      handleOmcDirectBatchRowActivate,
      monitorRepositoryPath,
      omcDirectBatchInvocationsLive,
      openHistoryMessagesDrawer,
      sessions,
    ],
  );

  const sessionsForTerminalStatusRef = useRef(sessions);
  sessionsForTerminalStatusRef.current = sessions;
  const nextTerminalStatusFingerprint = monitorSessionsTerminalStatusFingerprint(sessions);
  const [sessionsTerminalStatusFingerprint, setSessionsTerminalStatusFingerprint] = useState(
    nextTerminalStatusFingerprint,
  );
  if (nextTerminalStatusFingerprint !== sessionsTerminalStatusFingerprint) {
    setSessionsTerminalStatusFingerprint(nextTerminalStatusFingerprint);
  }
  const employeeTerminalConversationStatusById = useMemo(
    () =>
      buildEmployeeTerminalConversationStatusById({
        employeeItems,
        repositoryPath: monitorRepositoryPath,
        sessions: sessionsForTerminalStatusRef.current,
        dispatchTasks: executionEnvironmentDispatchTaskItems,
      }),
    [
      employeeItems,
      executionEnvironmentDispatchTaskItems,
      monitorRepositoryPath,
      sessionsTerminalStatusFingerprint,
    ],
  );

  const employeeTerminalLastMessagePreviewById = useMemo(
    () =>
      buildEmployeeTerminalLastMessagePreviewById({
        employeeItems,
        repositoryPath: monitorRepositoryPath,
        sessions: sessionsForTerminalStatusRef.current,
        dispatchTasks: executionEnvironmentDispatchTaskItems,
        conversationStatusById: employeeTerminalConversationStatusById,
      }),
    [
      employeeItems,
      employeeTerminalConversationStatusById,
      executionEnvironmentDispatchTaskItems,
      monitorRepositoryPath,
      sessionsTerminalStatusFingerprint,
    ],
  );

  const compactListsAnchorRef = useRef<HTMLDivElement>(null);
  const compactFlatRows = useMemo((): MonitorCompactFlatRow[] => {
    if (!isCompactSidebarPanel) return [];
    const rows: MonitorCompactFlatRow[] = [];
    for (const item of sortedEmployeeItems) {
      rows.push({ kind: "terminal", item });
    }
    for (const item of executionEnvironmentDispatchTaskItems) {
      rows.push({ kind: "dispatch", item });
    }
    for (const item of teamItems) {
      rows.push({ kind: "workflow", item });
    }
    return rows;
  }, [executionEnvironmentDispatchTaskItems, isCompactSidebarPanel, sortedEmployeeItems, teamItems]);
  const useCompactVirtual =
    isCompactSidebarPanel && compactFlatRows.length >= MONITOR_VIRTUALIZE_MIN_ROWS;
  const useCompactUnifiedList =
    isCompactSidebarPanel && compactFlatRows.length > 0 && !useCompactVirtual;

  const renderDispatchTaskRow = useCallback(
    (item: SessionConversationTaskItem) => (
      <SessionConversationDispatchTaskRow
        key={item.key}
        item={item}
        statusVisual={isCompactSidebarPanel ? "lite" : "full"}
        showStop={canStopSessionConversationTask(item, {
          onCancelSession,
          onCancelOmcDirectBatchInvocation,
          onStopSessionConversationTask,
        })}
        onOpenDetail={openSessionConversationTaskDetail}
        onStop={stopSessionConversationTask}
      />
    ),
    [
      onCancelOmcDirectBatchInvocation,
      onCancelSession,
      onStopSessionConversationTask,
      openSessionConversationTaskDetail,
      stopSessionConversationTask,
      isCompactSidebarPanel,
    ],
  );

  const handleEmployeeHistoryPopoverOpenChange = useCallback(
    (employeeId: string, nextOpen: boolean) => {
      if (nextOpen) {
        setEmployeeHistoryPopoverId(employeeId);
        setEmployeeHistorySearch("");
        const employeeItem = employeeItems.find((item) => item.employeeId === employeeId);
        const repoPath =
          employeeItem?.repositoryPath?.trim() ||
          monitorRepositoryPath ||
          "";
        if (repoPath && onRefreshHistorySessions) {
          const repoName =
            employeeItem?.repositoryName?.trim() ||
            repositories.find((repo) => repositoryPathsMatch(repo.path, repoPath))?.name ||
            sessions
              .find((session) => repositoryPathsMatch(session.repositoryPath, repoPath))
              ?.repositoryName?.trim() ||
            repoPath;
          void onRefreshHistorySessions({
            repositoryPath: repoPath,
            repositoryName: repoName,
          });
        }
        return;
      }
      setEmployeeHistoryPopoverId((prev) => (prev === employeeId ? null : prev));
      setEmployeeHistorySearch("");
    },
    [employeeItems, monitorRepositoryPath, onRefreshHistorySessions, repositories, sessions],
  );

  const renderEmployeeTerminalListItem = useCallback(
    (item: EmployeeMonitorItem) => {
      const historyPopoverOpen = employeeHistoryPopoverId === item.employeeId;
      const isOmcWorker = item.employeeId === "omc-worker";
      const keyword =
        historyPopoverOpen && !isOmcWorker ? normalizeSearchKeyword(employeeHistorySearch) : "";
      const historySessions =
        historyPopoverOpen && !isOmcWorker
          ? (employeeHistorySessionsByName.get(normalizeMonitorEmployeeName(item.name)) ?? [])
          : [];
      const matchedHistorySessions =
        historyPopoverOpen && !isOmcWorker
          ? historySessions.filter((session) => matchSessionByKeyword(session, keyword)).slice(0, 30)
          : [];
      return (
        <TerminalEmployeeMonitorRow
          key={item.employeeId}
          item={item}
          conversationStatus={
            employeeTerminalConversationStatusById.get(item.employeeId) ?? "idle"
          }
          lastMessagePreview={employeeTerminalLastMessagePreviewById.get(item.employeeId) ?? ""}
          statusVisual={isCompactSidebarPanel ? "lite" : "full"}
          historyPopoverOpen={historyPopoverOpen}
          historySearch={historyPopoverOpen ? employeeHistorySearch : ""}
          matchedHistorySessions={matchedHistorySessions}
          onActivateRow={activateEmployeeTerminalRow}
          onStopEmployee={onStopEmployee}
          onHistoryPopoverOpenChange={handleEmployeeHistoryPopoverOpenChange}
          onHistorySearchChange={setEmployeeHistorySearch}
          onSelectHistorySession={openHistoryMessagesDrawer}
          onRestoreHistorySession={onRestoreHistorySessionAsMain}
          canRestoreHistorySession={canRestoreHistorySession}
          onCreateTerminalSession={
            onCreateTerminalEmployeeSession && !isOmcWorker
              ? () => handleCreateTerminalEmployeeSession(item.employeeId)
              : undefined
          }
          createTerminalSessionLoading={creatingTerminalSessionEmployeeId === item.employeeId}
          onOmcRowActivate={handleOmcDirectBatchRowActivate}
          onCancelOmcInvocation={onCancelOmcDirectBatchInvocation}
        />
      );
    },
    [
      activateEmployeeTerminalRow,
      canRestoreHistorySession,
      creatingTerminalSessionEmployeeId,
      employeeHistoryPopoverId,
      employeeHistorySearch,
      employeeHistorySessionsByName,
      employeeTerminalConversationStatusById,
      employeeTerminalLastMessagePreviewById,
      handleCreateTerminalEmployeeSession,
      handleEmployeeHistoryPopoverOpenChange,
      handleOmcDirectBatchRowActivate,
      onCancelOmcDirectBatchInvocation,
      onCreateTerminalEmployeeSession,
      onRestoreHistorySessionAsMain,
      onStopEmployee,
      isCompactSidebarPanel,
    ],
  );

  const renderWorkflowListItem = useCallback(
    (item: TeamMonitorItem) => {
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
          onClick={() => onOpenTeamDetail?.(item.workflowId)}
        >
          <div className="app-monitor-panel__item-row">
            <span className="app-monitor-panel__item-name-wrap">
              <MonitorItemTypeTag label="工作流" />
              <span
                className="app-monitor-panel__item-name"
                title={memberTooltipTitle(item.memberNames) || item.workflowName}
              >
                {item.workflowName}
              </span>
              {statusText(item.status)}
            </span>
            <span className="app-monitor-panel__item-actions">
              {item.status === "in_progress" ? (
                <button
                  type="button"
                  className="app-monitor-panel__item-action-icon-btn app-monitor-panel__item-action-icon-btn--stop"
                  title="结束工作流"
                  aria-label="结束工作流"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStopTeam?.(item.workflowId);
                  }}
                >
                  <StopOutlined />
                </button>
              ) : null}
              <MonitorLazyClickPopover
                open={teamPopoverOpen}
                placement="bottomRight"
                overlayClassName="app-monitor-panel__history-popover"
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
                renderTrigger={({ requestOpen }) => (
                  <button
                    type="button"
                    className="app-monitor-panel__item-action-icon-btn"
                    title="历史会话"
                    aria-label="历史会话"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestOpen();
                    }}
                  >
                    <HistoryOutlined />
                  </button>
                )}
              />
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
    },
    [
      activeTarget,
      canRestoreHistorySession,
      onOpenTeamDetail,
      onRestoreHistorySessionAsMain,
      onStopTeam,
      openHistoryMessagesDrawer,
      teamHistoryEmployeeFilter,
      teamHistoryPopoverId,
      teamHistorySearch,
      teamHistorySessionsByWorkflowId,
    ],
  );

  const compactVirtualRenderRef = useRef({
    renderTerminal: renderEmployeeTerminalListItem,
    renderDispatch: renderDispatchTaskRow,
    renderWorkflow: renderWorkflowListItem,
  });
  compactVirtualRenderRef.current = {
    renderTerminal: renderEmployeeTerminalListItem,
    renderDispatch: renderDispatchTaskRow,
    renderWorkflow: renderWorkflowListItem,
  };
  const renderCompactVirtualRow = useCallback((row: MonitorCompactFlatRow) => {
    const { renderTerminal, renderDispatch, renderWorkflow } = compactVirtualRenderRef.current;
    if (row.kind === "terminal") return renderTerminal(row.item);
    if (row.kind === "dispatch") return renderDispatch(row.item);
    return renderWorkflow(row.item);
  }, []);

  const shouldShowSessionConversationTasks = showSessionConversationTasks;

  const panelHasListContent =
    shouldShowSessionConversationTasks ||
    employeeItems.length > 0 ||
    teamItems.length > 0;

  const monitorDrawers = (
    <>
      <OmcDirectBatchInvocationDetailDrawer
        open={omcDirectBatchDetailSnapshot !== null}
        snapshot={omcDirectBatchDetailSnapshot}
        sessions={sessions}
        onClose={() => setOmcDirectBatchDetailSnapshot(null)}
        onOpenInMainSessionBackground={onOpenOmcBatchInvocationDetail ? handleOmcBatchInvocationSelect : undefined}
      />

      {sessionConversationTaskDetailTarget ? (
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
          onReloadFullDiskTranscript={onReloadFullDiskTranscript}
          onPrepareSessionForMonitorDrawer={onPrepareSessionForMonitorDrawer}
        />
      ) : null}

      <RepositorySubagentDetailDrawer
        target={repositorySubagentDetailTarget}
        sessions={sessionsForHistoryTranscript}
        onReloadFullDiskTranscript={onReloadFullDiskTranscript}
        onClose={() => setRepositorySubagentDetailTarget(null)}
      />
    </>
  );

  return (
    <div
      className={
        "app-monitor-panel" +
        (sectionCollapsed ? " app-monitor-panel--section-collapsed" : "") +
        (isCompactSidebarPanel ? " app-monitor-panel--compact-sidebar" : "")
      }
    >
      <div className="app-monitor-panel__head">
        <div className="app-monitor-panel__head-start">
          <div className="app-monitor-panel__title">运行面板</div>
          {!sectionCollapsed ? (
            <MonitorPanelHeadConfigActions
              onOpenEmployeeConfig={onOpenEmployeeConfig}
              onOpenWorkflowConfig={onOpenWorkflowConfig}
            />
          ) : null}
        </div>
        <div className="app-monitor-panel__head-end">
          {shouldShowSessionConversationTasks &&
          executionEnvironmentDispatchHistoryDays != null &&
          onExecutionEnvironmentDispatchHistoryDaysChange ? (
            <ExecutionEnvironmentDispatchHistoryDaysDropdown
              disabled={executionEnvironmentDispatchHistoryDaysSaving}
              value={executionEnvironmentDispatchHistoryDays}
              onChange={onExecutionEnvironmentDispatchHistoryDaysChange}
              compact={isCompactSidebarPanel}
            />
          ) : null}
          {setSectionCollapsed ? (
            <button
              type="button"
              className="app-monitor-panel__section-collapse-btn"
              title={sectionCollapsed ? "展开运行面板" : "收起运行面板"}
              aria-expanded={!sectionCollapsed}
              aria-label={sectionCollapsed ? "展开运行面板" : "收起运行面板"}
              onClick={() => setSectionCollapsed(!sectionCollapsed)}
            >
              <ExpandIcon expanded={!sectionCollapsed} />
            </button>
          ) : null}
        </div>
      </div>

      {!sectionCollapsed ? (
      <MonitorPanelCompactScrollBody
        enabled={isCompactSidebarPanel}
        scrollRef={compactSidebarScrollRootRef}
      >
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

      {useCompactVirtual ? (
        <div
          ref={compactListsAnchorRef}
          className="app-monitor-panel__section app-monitor-panel__section--unified app-monitor-panel__section--compact-virtual"
        >
          <MonitorPanelVirtualRows
            scrollRootRef={compactSidebarScrollRootRef!}
            anchorRef={compactListsAnchorRef}
            rows={compactFlatRows}
            getRowKey={(row) => {
              if (row.kind === "terminal") return `t:${row.item.employeeId}`;
              if (row.kind === "dispatch") return `d:${row.item.key}`;
              return `w:${row.item.workflowId}`;
            }}
            renderRow={renderCompactVirtualRow}
          />
          {shouldShowSessionConversationTasks && executionEnvironmentDispatchTaskItems.length === 0 ? (
            <div className="app-monitor-panel__session-tasks-empty-hint">
              近 {executionEnvironmentDispatchHistoryDays ?? 1} 天暂无执行环境派发记录
            </div>
          ) : null}
        </div>
      ) : null}

      {useCompactUnifiedList ? (
        <div className="app-monitor-panel__section app-monitor-panel__section--unified">
          <div className="app-monitor-panel__unified-list" aria-label="运行面板列表">
            {sortedEmployeeItems.map((item) => renderEmployeeTerminalListItem(item))}
            {executionEnvironmentDispatchTaskItems.map((item) => renderDispatchTaskRow(item))}
            {teamItems.map((item) => renderWorkflowListItem(item))}
          </div>
          {shouldShowSessionConversationTasks && executionEnvironmentDispatchTaskItems.length === 0 ? (
            <div className="app-monitor-panel__session-tasks-empty-hint">
              近 {executionEnvironmentDispatchHistoryDays ?? 1} 天暂无执行环境派发记录
            </div>
          ) : null}
        </div>
      ) : null}

      {!isCompactSidebarPanel && employeeItems.length > 0 ? (
        <div className="app-monitor-panel__section app-monitor-panel__section--terminals">
          <div className="app-monitor-panel__terminals-list">
            {sortedEmployeeItems.map((item) => renderEmployeeTerminalListItem(item))}
          </div>
        </div>
      ) : null}

      {!isCompactSidebarPanel && shouldShowSessionConversationTasks ? (
        <div
          className={`app-monitor-panel__section app-monitor-panel__section--session-tasks${
            executionEnvironmentDispatchTaskItems.length === 0
              ? " app-monitor-panel__section--session-tasks-empty"
              : ""
          }`}
        >
          {executionEnvironmentDispatchTaskItems.length > 0 ? (
            <div className="app-monitor-panel__session-tasks-list" aria-label="当前会话派发任务">
              {executionEnvironmentDispatchTaskItems.map((item) => renderDispatchTaskRow(item))}
            </div>
          ) : (
            <div className="app-monitor-panel__session-tasks-empty-hint">近 {executionEnvironmentDispatchHistoryDays ?? 1} 天暂无执行环境派发记录</div>
          )}
        </div>
      ) : null}

      {!isCompactSidebarPanel && teamItems.length > 0 ? (
        <div className="app-monitor-panel__section app-monitor-panel__section--workflows">
          <div className="app-monitor-panel__workflows-list">
            {teamItems.map((item) => renderWorkflowListItem(item))}
          </div>
        </div>
      ) : null}
      </MonitorPanelCompactScrollBody>
      ) : null}

      {monitorDrawers}
    </div>
  );
});
