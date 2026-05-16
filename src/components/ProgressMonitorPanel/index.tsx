import { Empty, InputNumber, Popover, Tag, Tooltip, Typography } from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  ClaudeSession,
  EmployeeMonitorItem,
  MonitorDrawerTarget,
  RepositoryMemberMonitorItem,
  TeamMonitorItem,
} from "../../types";
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
} from "../../utils/omcEmployeeMonitorHistory";
import {
  clampConcurrencyLimit,
  MAX_CLAUDE_CONCURRENCY_LIMIT,
  MIN_CLAUDE_CONCURRENCY_LIMIT,
} from "../../services/claudeConcurrencyLimits";
import { sanitizeOmcDirectBatchPreviewLineForList } from "../../utils/claudeInvocationText";
import { OmcDirectBatchInvocationDetailDrawer } from "./OmcDirectBatchInvocationDetailDrawer";
import { MonitorHistorySessionTranscriptDrawer } from "./MonitorHistorySessionTranscriptDrawer";
import { getSessionPreview } from "./historySessionDrawerChrome";

import { useAgentAssignments } from "../../hooks/useAgentAssignments";
import "./index.css";

export {
  getSessionPreview,
  HistorySessionDrawerTitle,
  historySessionStatusLabel,
  historySessionStatusTagColor,
} from "./historySessionDrawerChrome";

function EmployeeMiniIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-4 5.5c0-2.2 1.8-4 4-4s4 1.8 4 4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function TeamMiniIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M3 3h4v4H3zM9 9h4v4H9zM9 3h4v4H9zM3 9h4v4H3z" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M7 5h2M5 7v2M11 7v2M7 11h2" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

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
  sessions: ClaudeSession[];
  activeTarget?: MonitorDrawerTarget | null;
  onOpenTeamDetail: (workflowId: string) => void;
  onOpenEmployeeConfig?: () => void;
  onOpenWorkflowConfig?: () => void;
  onStopEmployee?: (employeeId: string) => void;
  onStopTeam?: (workflowId: string) => void;
  /** 当 `Project.sddMode === "wise_trellis"` 时由 AppImpl 传入 true，隐藏 EmployeeItem 入口与 section。 */
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
  /** 非活动标签正文已丢弃时，从历史抽屉按需从磁盘拉回完整 jsonl */
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  /**
   * 历史会话消息抽屉用：解析 `messages` 与触发磁盘补全时应读「实时」会话列表。
   * 若仅传节流后的 `sessions`，会出现抽屉先显示旧快照里的正文、下一帧同步到已回收内存后的空数组，表现为消息突然消失。
   */
  transcriptSourceSessions?: ClaudeSession[];
  projectId?: string | null;
}

interface TeamHistorySessionRow {
  session: ClaudeSession;
  employeeName: string;
}

interface HistorySessionRow {
  session: ClaudeSession;
  employeeName?: string;
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
  searchPlaceholder?: string;
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

export function normalizeSearchKeyword(input: string): string {
  return input.trim().toLocaleLowerCase("zh-CN");
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

export function matchSessionByKeyword(session: ClaudeSession, keyword: string, employeeName?: string): boolean {
  if (!keyword) return true;
  const preview = getSessionPreview(session).toLocaleLowerCase("zh-CN");
  const repositoryName = (session.repositoryName ?? "").toLocaleLowerCase("zh-CN");
  const normalizedEmployeeName = (employeeName ?? "").toLocaleLowerCase("zh-CN");
  return preview.includes(keyword) || repositoryName.includes(keyword) || normalizedEmployeeName.includes(keyword);
}

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

function repositoryTypeLabel(value: RepositoryMemberMonitorItem["repositoryType"]): string {
  if (value === "frontend") return "前端";
  if (value === "backend") return "后端";
  if (value === "document") return "文档";
  return value;
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

export function sessionUpdatedAt(session: ClaudeSession): number {
  const lastTimestamp = session.messages[session.messages.length - 1]?.timestamp;
  return typeof lastTimestamp === "number" ? lastTimestamp : session.createdAt;
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
  searchPlaceholder = "搜索历史会话...",
}: HistorySessionPopoverContentProps) {
  const showEmployeeFilter = Boolean(onEmployeeFilterChange);
  const hasRows = rows.length > 0;
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
            <option value="all">全部员工</option>
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
      {hasRows ? (
        <div className="app-monitor-panel__history-popover-list">
          {rows.map((row) => (
            <button
              key={row.session.id}
              type="button"
              className="app-monitor-panel__history-popover-item"
              onClick={(event) => {
                event.stopPropagation();
                onSelectSession?.(row.session.id);
              }}
            >
              <span className="app-monitor-panel__history-popover-item-title">
                {getSessionPreview(row.session)}
              </span>
              <span className="app-monitor-panel__history-popover-item-time">
                {row.employeeName
                  ? `${row.employeeName} · ${new Date(sessionUpdatedAt(row.session)).toLocaleString("zh-CN", { hour12: false })}`
                  : new Date(sessionUpdatedAt(row.session)).toLocaleString("zh-CN", { hour12: false })}
              </span>
            </button>
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
  repositoryMemberItems,
  teamItems,
  sessions,
  activeTarget,
  onOpenTeamDetail,
  onOpenEmployeeConfig,
  onOpenWorkflowConfig,
  onStopEmployee,
  onStopTeam,
  hideEmployeeUi = false,
  claudeConcurrency = null,
  onCancelSession,
  onOpenTaskDetail,
  onOpenOmcBatchInvocationDetail,
  onCancelOmcDirectBatchInvocation,
  onReloadFullDiskTranscript,
  transcriptSourceSessions,
  projectId,
}: Props) {
  const { running: agentAssignments } = useAgentAssignments({ projectId, enabled: Boolean(projectId) });

  const [employeeHistoryPopoverId, setEmployeeHistoryPopoverId] = useState<string | null>(null);
  const [teamHistoryPopoverId, setTeamHistoryPopoverId] = useState<string | null>(null);
  const [employeeHistorySearch, setEmployeeHistorySearch] = useState("");
  const [teamHistorySearch, setTeamHistorySearch] = useState("");
  const [teamHistoryEmployeeFilter, setTeamHistoryEmployeeFilter] = useState<string>("all");
  const [historyMessagesSessionId, setHistoryMessagesSessionId] = useState<string | null>(null);
  const [omcDirectBatchDetailSnapshot, setOmcDirectBatchDetailSnapshot] = useState<WorkflowInvocationStreamDetail | null>(null);

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

  const employeeInProgress = useMemo(
    () => employeeItems.filter((item) => item.status === "in_progress").length,
    [employeeItems],
  );
  const teamInProgress = useMemo(
    () => teamItems.filter((item) => item.status === "in_progress").length,
    [teamItems],
  );
  const repositoryMemberInProgress = useMemo(
    () => repositoryMemberItems.filter((item) => item.status === "in_progress").length,
    [repositoryMemberItems],
  );

  const teamHistorySessionsByWorkflowId = useMemo(() => {
    const map = new Map<string, TeamHistorySessionRow[]>();
    for (const teamItem of teamItems) {
      const normalizedMemberNames = (teamItem.memberNames ?? [])
        .map((name) => name.trim())
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

  function closeHistoryMessagesDrawer() {
    setHistoryMessagesSessionId(null);
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
    setOmcDirectBatchDetailSnapshot(inv);
  }, []);

  return (
    <div className="app-monitor-panel">
      <div className="app-monitor-panel__head">
        <div className="app-monitor-panel__head-start">
          <div className="app-monitor-panel__title">我的团队</div>
          <div className="app-monitor-panel__config-btns">
            {hideEmployeeUi ? null : (
              <button
                type="button"
                className="app-monitor-panel__config-btn"
                onClick={() => onOpenEmployeeConfig?.()}
              >
                员工
              </button>
            )}
            <button
              type="button"
              className="app-monitor-panel__config-btn"
              onClick={() => onOpenWorkflowConfig?.()}
            >
              团队
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
        </div>
      </div>

      {hideEmployeeUi ? null : (
      <div className="app-monitor-panel__section">
        <div className="app-monitor-panel__section-head">
          <div className="app-monitor-panel__section-title-wrap">
            <Typography.Text className="app-monitor-panel__section-title">
              <span className="app-monitor-panel__section-icon"><EmployeeMiniIcon /></span>
              员工
            </Typography.Text>
            <Typography.Text className="app-monitor-panel__meta">
              总数 {employeeItems.length} · 进行中 {employeeInProgress} · 空闲 {employeeItems.length - employeeInProgress}
            </Typography.Text>
          </div>
        </div>
        {employeeItems.length === 0 ? (
          <div className="app-monitor-panel__empty app-monitor-panel__empty--with-action">
            <button
              type="button"
              className="app-monitor-panel__empty-add-btn"
              onClick={() => onOpenEmployeeConfig?.()}
            >
              新增员工
            </button>
          </div>
        ) : (
          employeeItems.map((item) => {
            const isOmcWorker = item.employeeId === "omc-worker";
            const employeePopoverOpen = employeeHistoryPopoverId === item.employeeId;
            const keyword =
              employeePopoverOpen && !isOmcWorker ? normalizeSearchKeyword(employeeHistorySearch) : "";
            const historySessions =
              employeePopoverOpen && !isOmcWorker
                ? (employeeHistorySessionsByName.get(item.name.trim()) ?? [])
                : [];
            const matchedEmployeeSessions =
              employeePopoverOpen && !isOmcWorker
                ? historySessions.filter((session) => matchSessionByKeyword(session, keyword)).slice(0, 30)
                : [];
            return (
              <div key={item.employeeId} className="app-monitor-panel__item app-monitor-panel__item--readonly">
              <div className="app-monitor-panel__item-row">
                <span className="app-monitor-panel__item-name-wrap">
                  <span className="app-monitor-panel__item-name">{item.name}</span>
                  {statusText(item.status)}
                </span>
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
                          rows={matchedEmployeeSessions.map((session) => ({ session }))}
                          emptyDescription={employeeHistorySearch.trim() ? "未找到匹配会话" : "暂无历史会话"}
                          onSelectSession={(sessionId) => openHistoryMessagesDrawer(sessionId)}
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
          })
        )}
      </div>
      )}

      {repositoryMemberItems.length > 0 ? (
        <div className="app-monitor-panel__section">
          <div className="app-monitor-panel__section-head">
            <div className="app-monitor-panel__section-title-wrap">
              <Typography.Text className="app-monitor-panel__section-title">
                <span className="app-monitor-panel__section-icon"><RepositoryMiniIcon /></span>
                仓库成员
              </Typography.Text>
              <Typography.Text className="app-monitor-panel__meta">
                总数 {repositoryMemberItems.length} · 进行中 {repositoryMemberInProgress} · 空闲 {repositoryMemberItems.length - repositoryMemberInProgress}
              </Typography.Text>
            </div>
          </div>
          {repositoryMemberItems.map((item) => (
            <div key={item.repositoryId} className="app-monitor-panel__item app-monitor-panel__item--readonly">
              <div className="app-monitor-panel__item-row">
                <span className="app-monitor-panel__item-name-wrap">
                  <Tooltip title={item.repositoryPath}>
                    <span className="app-monitor-panel__item-name">{item.repositoryName}</span>
                  </Tooltip>
                  <span className="app-monitor-panel__repo-type">{repositoryTypeLabel(item.repositoryType)}</span>
                  {statusText(item.status)}
                </span>
                <span className="app-monitor-panel__item-actions">
                  <span className="app-monitor-panel__result-pill">
                    子进程 {item.activeSubagentCount}/{item.subagents.length}
                  </span>
                </span>
              </div>
              <div className="app-monitor-panel__subagent-tree" aria-label={`${item.repositoryName} Trellis 子进程`}>
                {item.subagents.slice(0, 3).map((subagent) => (
                  <div key={subagent.invocationKey} className="app-monitor-panel__subagent-row">
                    <span className="app-monitor-panel__subagent-branch" aria-hidden />
                    <span className="app-monitor-panel__subagent-main">
                      <span className="app-monitor-panel__subagent-name">{subagent.subagentType}</span>
                      {subagent.stage ? <span className="app-monitor-panel__subagent-stage">{subagent.stage}</span> : null}
                    </span>
                    <span className={`app-monitor-panel__subagent-status app-monitor-panel__subagent-status--${subagent.status}`}>
                      {subagent.status === "running" ? "运行中" : subagent.status === "failed" ? "失败" : "完成"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
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
                {agentAssignments.length} 运行中
              </Typography.Text>
            </div>
          </div>
          {agentAssignments.map((a) => (
            <div key={a.assignmentId} className="app-monitor-panel__item app-monitor-panel__item--readonly">
              <div className="app-monitor-panel__item-row">
                <span className="app-monitor-panel__item-name-wrap">
                  <span className="app-monitor-panel__item-name">{a.agentType}</span>
                  <span className="app-monitor-panel__repo-type">{a.stage}</span>
                  <span className="app-monitor-panel__status app-monitor-panel__status--in_progress">运行中</span>
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

      <div className="app-monitor-panel__section">
        <div className="app-monitor-panel__section-head">
          <div className="app-monitor-panel__section-title-wrap">
            <Typography.Text className="app-monitor-panel__section-title">
              <span className="app-monitor-panel__section-icon"><TeamMiniIcon /></span>
              团队
            </Typography.Text>
            <Typography.Text className="app-monitor-panel__meta">
              总数 {teamItems.length} · 进行中 {teamInProgress} · 空闲 {teamItems.length - teamInProgress}
            </Typography.Text>
          </div>
        </div>
        {teamItems.length === 0 ? (
          <div className="app-monitor-panel__empty app-monitor-panel__empty--with-action">
            <button
              type="button"
              className="app-monitor-panel__empty-add-btn"
              onClick={() => onOpenWorkflowConfig?.()}
            >
              新增团队
            </button>
          </div>
        ) : (
          teamItems.map((item) => {
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
                        emptyDescription={
                          teamHistorySearch.trim() || teamHistoryEmployeeFilter !== "all" ? "未找到匹配会话" : "暂无历史会话"
                        }
                        onSelectSession={(sessionId) => openHistoryMessagesDrawer(sessionId)}
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
          })
        )}
      </div>

      <MonitorHistorySessionTranscriptDrawer
        open={historyMessagesSessionId !== null}
        sessionId={historyMessagesSessionId}
        onClose={closeHistoryMessagesDrawer}
        transcriptSourceSessions={sessionsForHistoryTranscript}
        onReloadFullDiskTranscript={onReloadFullDiskTranscript}
        onCancelSession={onCancelSession}
        onOpenTaskDetail={onOpenTaskDetail}
      />

      <OmcDirectBatchInvocationDetailDrawer
        open={omcDirectBatchDetailSnapshot !== null}
        snapshot={omcDirectBatchDetailSnapshot}
        sessions={sessions}
        onClose={() => setOmcDirectBatchDetailSnapshot(null)}
        onOpenInMainSessionBackground={onOpenOmcBatchInvocationDetail ? handleOmcBatchInvocationSelect : undefined}
      />
    </div>
  );
}
