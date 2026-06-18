import {
  CheckCircleOutlined,
  CommentOutlined,
  DeleteOutlined,
  EditOutlined,
  FieldTimeOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import {
  Button,
  Popover,
  Empty,
  Modal,
  Table,
  Input,
  Select,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { HoverHint } from "../shared/HoverHint";
import { CopyFeedbackIcon } from "../shared/CopyFeedbackIcon";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { memo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { ClaudeSession } from "../../types";
import { HistorySessionRestoreButton } from "../ProgressMonitorPanel/HistorySessionRestoreButton";
import {
  formatShortQuestionTime,
  getSessionPreview,
} from "./claudeChatHelpers";
import { buildClaudeSessionHoverTitle } from "../../utils/claudeSessionIdTooltip";
import type { SessionGroup } from "./sessionGrouping";
import { applyStarterPromptToComposer } from "../../constants/workflowUiEvents";
import { buildComposerInsertFromPlainText } from "../../services/claudeComposerPrompt";
import {
  FEATURE_SESSION_LIST_PAGE_SIZE,
  SHOW_SESSION_TASK_COMPLETION_FEATURE,
  type RefreshHistorySessionsScope,
  type RepositorySessionExecutionRow,
  type TaskCompletionOwnerFilter,
  type TaskCompletionStatusFilter,
  type SessionUserQuestionRow,
} from "./ClaudeChatSessionFeatureShared";

const TASK_COMPLETION_MODAL_HINT =
  "以下为当前仓库内各标签会话（主会话、员工独立会话、团队流程会话）的 Claude Code 运行状态与上下文概况，便于核对是否均已执行完毕。各标签上的发送节点明细请在对应标签打开「会话跟踪」查看。";

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5V12L15.5 13.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SessionUserQuestionCopyButton({ text }: { text: string }) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <HoverHint title={copied ? "已复制" : "复制"}>
      <Button
        type="text"
        size="small"
        className="app-claude-message-action app-claude-session-user-questions-popover__item-action"
        icon={<CopyFeedbackIcon copied={copied} />}
        aria-label="复制消息内容"
        onClick={(event) => {
          event.stopPropagation();
          void copy(text);
        }}
      />
    </HoverHint>
  );
}

function insertSessionUserQuestionIntoComposer(sessionId: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const { composerMain, attachmentPaths } = buildComposerInsertFromPlainText(trimmed);
  applyStarterPromptToComposer({
    sessionId,
    prompt: trimmed,
    composerMain,
    attachmentPaths,
  });
}

export interface ClaudeChatSessionFeatureToolbarProps {
  sessionId: string;
  sessionUserQuestions: SessionUserQuestionRow[];
  historyPopoverOpen: boolean;
  setHistoryPopoverOpen: (open: boolean) => void;
  historyPopoverCloseGuardRef: RefObject<boolean>;
  setHistoryVisibleCount: Dispatch<SetStateAction<number>>;
  handleHistorySessionsRefresh: () => void;
  historySearchText: string;
  setHistorySearchText: (text: string) => void;
  onRefreshHistorySessions?: (scope: RefreshHistorySessionsScope) => void | Promise<void>;
  historySessionsRefreshing: boolean;
  groupedHistorySessions: SessionGroup[];
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onRestoreHistorySessionAsMain?: (sessionId: string) => void | Promise<void>;
  canRestoreHistorySession: (targetSession: ClaudeSession) => boolean;
  onDeleteHistorySession?: (sessionId: string) => void | Promise<void>;
  handleDeleteHistorySession: (sessionId: string, previewText: string) => void;
  historyPopoverScrollRef: RefObject<HTMLDivElement | null>;
  userQuestionsPopoverOpen: boolean;
  setUserQuestionsPopoverOpen: (open: boolean) => void;
  scrollToSessionMessageId: (messageId: number) => void;
  onOpenRepositoryScheduledTasks?: () => void;
  taskDrawerCount: number;
  setTaskListDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setTaskCompletionModalOpen: Dispatch<SetStateAction<boolean>>;
  taskCompletionModalOpen: boolean;
  completionOwnerFilter: TaskCompletionOwnerFilter;
  setCompletionOwnerFilter: Dispatch<SetStateAction<TaskCompletionOwnerFilter>>;
  completionStatusFilter: TaskCompletionStatusFilter;
  setCompletionStatusFilter: Dispatch<SetStateAction<TaskCompletionStatusFilter>>;
  completionSearchText: string;
  setCompletionSearchText: (text: string) => void;
  completionDisplayedRows: RepositorySessionExecutionRow[];
  completionFilteredRows: RepositorySessionExecutionRow[];
  completionHasMore: boolean;
  completionTableWrapRef: RefObject<HTMLDivElement | null>;
  repositorySessionExecutionRows: RepositorySessionExecutionRow[];
  taskCompletionTableColumns: ColumnsType<RepositorySessionExecutionRow>;
}

export const ClaudeChatSessionFeatureToolbar = memo(function ClaudeChatSessionFeatureToolbar(
  props: ClaudeChatSessionFeatureToolbarProps,
) {
  const {
    sessionId,
    sessionUserQuestions,
    historyPopoverOpen,
    setHistoryPopoverOpen,
    historyPopoverCloseGuardRef,
    setHistoryVisibleCount,
    handleHistorySessionsRefresh,
    historySearchText,
    setHistorySearchText,
    onRefreshHistorySessions,
    historySessionsRefreshing,
    groupedHistorySessions,
    onOpenHistorySessionInInspector,
    onRestoreHistorySessionAsMain,
    canRestoreHistorySession,
    onDeleteHistorySession,
    handleDeleteHistorySession,
    historyPopoverScrollRef,
    userQuestionsPopoverOpen,
    setUserQuestionsPopoverOpen,
    scrollToSessionMessageId,
    onOpenRepositoryScheduledTasks,
    taskDrawerCount,
    setTaskListDrawerOpen,
    setTaskCompletionModalOpen,
    taskCompletionModalOpen,
    completionOwnerFilter,
    setCompletionOwnerFilter,
    completionStatusFilter,
    setCompletionStatusFilter,
    completionSearchText,
    setCompletionSearchText,
    completionDisplayedRows,
    completionFilteredRows,
    completionHasMore,
    completionTableWrapRef,
    repositorySessionExecutionRows,
    taskCompletionTableColumns,
  } = props;

  return (
    <>
      <div className="app-claude-session-feature-panel" role="toolbar" aria-label="会话功能面板">
        <div className="app-claude-session-feature-panel__left">
          <div className="app-claude-session-history-tools" role="toolbar" aria-label="历史会话与历史消息">
            <div className="app-claude-session-tool-group app-claude-session-tool-group--compact">
              <Popover
                trigger="click"
                placement="bottomLeft"
                open={historyPopoverOpen}
                onOpenChange={(nextOpen) => {
                  if (!nextOpen && historyPopoverCloseGuardRef.current) {
                    return;
                  }
                  setHistoryPopoverOpen(nextOpen);
                  if (nextOpen) {
                    setUserQuestionsPopoverOpen(false);
                    setHistoryVisibleCount(FEATURE_SESSION_LIST_PAGE_SIZE);
                    handleHistorySessionsRefresh();
                  } else {
                    setHistorySearchText("");
                  }
                }}
                classNames={{ root: "app-claude-session-history-popover" }}
                content={
                  <div ref={historyPopoverScrollRef} className="app-claude-session-history-popover__content">
                    <div className="app-claude-session-history-popover__search-wrap">
                      <div className="app-claude-session-history-popover__search-row">
                        <input
                          value={historySearchText}
                          onChange={(event) => setHistorySearchText(event.target.value)}
                          className="app-claude-session-history-popover__search-input"
                          placeholder="搜索会话..."
                        />
                        {onRefreshHistorySessions ? (
                          <HoverHint title="从磁盘重新扫描会话">
                            <Button
                              type="text"
                              size="small"
                              className="app-claude-session-history-popover__refresh"
                              icon={<ReloadOutlined />}
                              loading={historySessionsRefreshing}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleHistorySessionsRefresh();
                              }}
                              aria-label="刷新历史会话"
                            />
                          </HoverHint>
                        ) : null}
                      </div>
                    </div>
                    {groupedHistorySessions.length === 0 ? (
                      <div className="app-claude-session-history-popover__empty">
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={historySearchText.trim() ? "未找到匹配会话" : "暂无历史会话"}
                        />
                      </div>
                    ) : (
                      groupedHistorySessions.map((group) => (
                        <div key={group.key} className="app-claude-session-history-popover__group">
                          <div className="app-claude-session-history-popover__group-title">{group.label}</div>
                          <div className="app-claude-session-history-popover__group-list">
                            {group.items.map((item) => {
                              const active = item.id === sessionId;
                              const preview = getSessionPreview(item);
                              const sessionHoverTitle = buildClaudeSessionHoverTitle(item);
                              return (
                                <div key={item.id} className="app-claude-session-history-popover__item-row">
                                  <button
                                    type="button"
                                    className={`app-claude-session-history-popover__item ${active ? "app-claude-session-history-popover__item--active" : ""}`}
                                    title={sessionHoverTitle}
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                    }}
                                    onClick={() => {
                                      onOpenHistorySessionInInspector?.(item.id);
                                      setHistoryPopoverOpen(false);
                                      setHistorySearchText("");
                                    }}
                                  >
                                    <span className="app-claude-session-history-popover__item-dot" />
                                    <span className="app-claude-session-history-popover__item-title">{preview}</span>
                                  </button>
                                  {onRestoreHistorySessionAsMain ? (
                                    <HistorySessionRestoreButton
                                      className="app-claude-session-history-popover__item-restore"
                                      disabled={!canRestoreHistorySession(item)}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void Promise.resolve(onRestoreHistorySessionAsMain(item.id));
                                      }}
                                    />
                                  ) : null}
                                  {onDeleteHistorySession ? (
                                    <HoverHint title="删除该历史会话">
                                      <Button
                                        type="text"
                                        size="small"
                                        className="app-claude-session-history-popover__item-delete"
                                        icon={<DeleteOutlined />}
                                        aria-label="删除该历史会话"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleDeleteHistorySession(item.id, preview);
                                        }}
                                      />
                                    </HoverHint>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                }
              >
                <HoverHint title="历史会话" open={historyPopoverOpen ? false : undefined}>
                  <button
                    type="button"
                    className="app-claude-session-tool-btn app-claude-session-tool-btn--history"
                    onClick={() => {
                      if (historyPopoverOpen) {
                        setHistorySearchText("");
                      }
                    }}
                  >
                    <ClockIcon />
                    <span className="app-claude-session-tool-btn__text">历史会话</span>
                  </button>
                </HoverHint>
              </Popover>

              <Popover
                trigger="click"
                placement="bottomLeft"
                open={userQuestionsPopoverOpen}
                onOpenChange={(nextOpen) => {
                  setUserQuestionsPopoverOpen(nextOpen);
                  if (nextOpen) {
                    setHistoryPopoverOpen(false);
                    setHistorySearchText("");
                  }
                }}
                classNames={{ root: "app-claude-session-user-questions-popover" }}
                content={
                  <div className="app-claude-session-user-questions-popover__content">
                    {sessionUserQuestions.length === 0 ? (
                      <div className="app-claude-session-user-questions-popover__empty">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无我的提问" />
                      </div>
                    ) : (
                      sessionUserQuestions.map((row) => (
                        <div key={row.id} className="app-claude-session-user-questions-popover__item-row">
                          <button
                            type="button"
                            className="app-claude-session-user-questions-popover__item"
                            title={row.text}
                            onClick={() => {
                              scrollToSessionMessageId(row.id);
                              setUserQuestionsPopoverOpen(false);
                            }}
                          >
                            <span className="app-claude-session-user-questions-popover__item-text">
                              {row.text}
                            </span>
                            <span className="app-claude-session-user-questions-popover__item-time">
                              {formatShortQuestionTime(row.timestamp)}
                            </span>
                          </button>
                          <span className="app-claude-session-user-questions-popover__item-actions">
                            <HoverHint title="填入输入框">
                              <Button
                                type="text"
                                size="small"
                                className="app-claude-message-action app-claude-message-action--insert app-claude-session-user-questions-popover__item-action"
                                icon={<EditOutlined />}
                                aria-label="填入会话输入框"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  insertSessionUserQuestionIntoComposer(sessionId, row.text);
                                  setUserQuestionsPopoverOpen(false);
                                }}
                              />
                            </HoverHint>
                            <SessionUserQuestionCopyButton text={row.text} />
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                }
              >
                <HoverHint title="历史消息" open={userQuestionsPopoverOpen ? false : undefined}>
                  <button type="button" className="app-claude-session-tool-btn app-claude-session-tool-btn--user-questions">
                    <CommentOutlined />
                    <span className="app-claude-session-tool-btn__text">历史消息</span>
                  </button>
                </HoverHint>
              </Popover>
            </div>
          </div>
        </div>

        <div className="app-claude-session-feature-panel__right">
          <div
            className="app-claude-session-tools app-claude-session-tool-group app-claude-session-tool-group--compact"
            role="toolbar"
            aria-label={SHOW_SESSION_TASK_COMPLETION_FEATURE ? "可执行任务与完成情况" : "可执行任务与定时任务"}
          >
            <HoverHint title="定时任务：Cron 触发 Claude Code">
              <button
                type="button"
                className="app-claude-session-tool-btn"
                data-ui-anchor="session-scheduled-tasks-btn"
                onClick={() => onOpenRepositoryScheduledTasks?.()}
                disabled={!onOpenRepositoryScheduledTasks}
              >
                <FieldTimeOutlined />
                <span className="app-claude-session-tool-btn__text">定时任务</span>
              </button>
            </HoverHint>
            <HoverHint title="可执行任务">
              <button
                type="button"
                className={[
                  "app-claude-session-tool-btn app-claude-session-tool-btn--task-list",
                  taskDrawerCount > 0 ? "app-claude-session-tool-btn--task-list--badged" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-ui-anchor="session-task-list-btn"
                onClick={() => {
                  setTaskListDrawerOpen(true);
                }}
              >
                <UnorderedListOutlined />
                <span className="app-claude-session-tool-btn__text">任务</span>
                {taskDrawerCount > 0 ? (
                  <span className="app-claude-session-tool-btn__badge" aria-label={`可执行任务数量 ${taskDrawerCount}`}>
                    {taskDrawerCount}
                  </span>
                ) : null}
              </button>
            </HoverHint>
            {SHOW_SESSION_TASK_COMPLETION_FEATURE ? (
              <HoverHint title="查看本仓库各标签会话的 Claude Code 执行情况">
                <button
                  type="button"
                  className="app-claude-session-tool-btn"
                  onClick={() => setTaskCompletionModalOpen(true)}
                >
                  <CheckCircleOutlined />
                  <span className="app-claude-session-tool-btn__text">完成任务</span>
                </button>
              </HoverHint>
            ) : null}
          </div>
        </div>
      </div>

      {SHOW_SESSION_TASK_COMPLETION_FEATURE ? (
        <Modal
          title={(
            <span className="app-task-completion-modal__title-wrap">
              <span className="app-task-completion-modal__title-text">完成任务</span>
              <HoverHint
                title={TASK_COMPLETION_MODAL_HINT}
                placement="bottomLeft"
               
                styles={{ container: { maxWidth: 420 } }}
              >
                <button type="button" className="app-task-completion-modal__title-help" aria-label="说明">
                  <QuestionCircleOutlined />
                </button>
              </HoverHint>
            </span>
          )}
          open={taskCompletionModalOpen}
          onCancel={() => setTaskCompletionModalOpen(false)}
          footer={
            <Button type="primary" onClick={() => setTaskCompletionModalOpen(false)}>
              关闭
            </Button>
          }
          width={Math.min(960, typeof window !== "undefined" ? window.innerWidth - 48 : 960)}
          destroyOnHidden
          className="app-task-completion-modal"
        >
          <div className="app-task-completion-modal__toolbar">
            <div className="app-task-completion-modal__filters" aria-label="筛选">
              <span className="app-task-completion-modal__filter-label">筛选</span>
              <Select<TaskCompletionOwnerFilter>
                size="small"
                value={completionOwnerFilter}
                onChange={setCompletionOwnerFilter}
                className="app-task-completion-modal__select app-task-completion-modal__select--type"
                popupMatchSelectWidth={false}
                options={[
                  { value: "all", label: "全部类型" },
                  { value: "main", label: "主会话" },
                  { value: "employee", label: "员工" },
                  { value: "team", label: "团队" },
                ]}
              />
              <Select<TaskCompletionStatusFilter>
                size="small"
                value={completionStatusFilter}
                onChange={setCompletionStatusFilter}
                className="app-task-completion-modal__select app-task-completion-modal__select--status"
                popupMatchSelectWidth={false}
                options={[
                  { value: "all", label: "全部状态" },
                  { value: "idle", label: "空闲" },
                  { value: "connecting", label: "连接中" },
                  { value: "running", label: "运行中" },
                  { value: "completed", label: "已完成" },
                  { value: "cancelled", label: "已取消" },
                  { value: "error", label: "异常" },
                ]}
              />
            </div>
            <div className="app-task-completion-modal__search-row">
              <Input.Search
                allowClear
                size="small"
                placeholder="搜索摘要、范围、ID…"
                value={completionSearchText}
                onChange={(e) => setCompletionSearchText(e.target.value)}
                className="app-task-completion-modal__search"
              />
              {onRefreshHistorySessions ? (
                <HoverHint title="从磁盘重新扫描会话并刷新列表">
                  <Button
                    type="default"
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={historySessionsRefreshing}
                    onClick={() => {
                      handleHistorySessionsRefresh();
                    }}
                    aria-label="刷新会话列表"
                  >
                    刷新
                  </Button>
                </HoverHint>
              ) : null}
            </div>
          </div>
          <div className="app-task-completion-modal__count">
            已显示 {completionDisplayedRows.length} / {completionFilteredRows.length} 条
            {completionHasMore ? "，表格内向下滚动加载更多" : completionFilteredRows.length > 0 ? "（已全部加载）" : null}
          </div>
          <div ref={completionTableWrapRef} className="app-task-completion-modal__table-wrap">
            <Table<RepositorySessionExecutionRow>
              className="app-task-completion-modal__table"
              tableLayout="fixed"
              size="small"
              pagination={false}
              rowKey="key"
              columns={taskCompletionTableColumns}
              dataSource={completionDisplayedRows}
              locale={{
                emptyText:
                  repositorySessionExecutionRows.length === 0
                    ? "当前仓库暂无会话标签"
                    : "没有符合筛选/搜索条件的会话",
              }}
              scroll={{ y: 340 }}
            />
          </div>
        </Modal>
      ) : null}
    </>
  );
});
