import { CloseOutlined, HistoryOutlined } from "@ant-design/icons";
import { Button, Card, Space, Spin, Typography } from "antd";
import type { MenuProps } from "antd";
import type { ReactNode, RefObject } from "react";
import type { SplitResult, TaskApiSpec, TaskExecutionStatus, TaskItem } from "../../types";
import { TaskAiPopoverContent } from "./TaskAiPopoverContent";
import { TaskAnchorPopoverBody } from "./TaskAnchorPopoverBody";
import { TaskBoardHeader } from "./TaskBoardHeader";
import { TaskCard } from "./TaskCard";
import { SplitQualityStrip } from "./SplitQualityStrip";
import { SplitRuntimeMessages } from "./SplitRuntimeMessages";
import type {
  SplitQualitySummary,
  SplitRetryPhase,
  SplitRuntimeLogItem,
  TaskRoleFilter,
} from "./types";
import type { TaskAiMode, TaskConfirmFilter } from "./helpers";
import { taskToMarkdown } from "./helpers";

interface TaskConfirmCounts {
  confirmedCount: number;
  unconfirmedCount: number;
}

interface SplitQualityStats extends SplitQualitySummary {
  mappingRate: number;
  traceRate: number;
}

interface MappingFallbackStats {
  total: number;
  fallbackCount: number;
  hasFallback: boolean;
  allFallback: boolean;
}

interface Props {
  splitError: string | null;
  mappingFallbackStats: MappingFallbackStats | null;
  splitQualityStats: SplitQualityStats | null;
  taskHostRef: RefObject<HTMLDivElement | null>;
  filteredTasks: TaskItem[];
  runtimeVisible: boolean;
  runtimeLogs: SplitRuntimeLogItem[];
  runtimeListRef: RefObject<HTMLDivElement | null>;
  retryingPhase: SplitRetryPhase | null;
  parsing: boolean;
  unmetTaskIds: string[];
  unmetMenuItems: MenuProps["items"];
  confirmSavingTaskId: string | null;
  activeResult: SplitResult | null;
  taskConfirmFilter: TaskConfirmFilter;
  taskConfirmCounts: TaskConfirmCounts;
  taskRoleFilter: TaskRoleFilter;
  taskRoleFilterOptions: { label: string; value: TaskRoleFilter }[];
  showRoleFilterTabs: boolean;
  canGenerateExecutableTasks: boolean;
  hasConfirmedTasks: boolean;
  hasUnconfirmedTasks: boolean;
  closingMotionActive: boolean;
  selectedTaskId: string | null;
  resolvedTaskAnchorIds: string[];
  pendingTaskContentById: Record<string, string>;
  pendingTaskApiSpecById: Record<string, TaskApiSpec>;
  taskExecutableCheckResultById: Record<string, string>;
  taskUnmetCollapsedById: Record<string, boolean>;
  taskCheckCollapsedById: Record<string, boolean>;
  taskAiOptimizedContentById: Record<string, string>;
  taskAiOptimizedReadyById: Record<string, boolean>;
  taskAiActionLoadingById: Record<string, TaskAiMode | null>;
  taskAiSavingTaskId: string | null;
  taskAiPopoverTaskId: string | null;
  taskAiPopoverMode: TaskAiMode | null;
  taskAnchorPopoverTaskId: string | null;
  generatingExecutableTaskId: string | null;
  savingTaskId: string | null;
  onConfirmAll: () => void;
  onAddTask: () => void;
  onClearAllTasks: () => void;
  onTaskConfirmFilterChange: (value: TaskConfirmFilter) => void;
  onTaskRoleFilterChange: (value: TaskRoleFilter) => void;
  getTaskAiMode: (task: TaskItem) => TaskAiMode;
  getTaskAiInput: (task: TaskItem, mode: TaskAiMode) => string;
  getDraftedTask: (task: TaskItem) => TaskItem;
  displayExecutionStatus: (task: TaskItem) => TaskExecutionStatus;
  cardUnmetPointsForTask: (task: TaskItem) => string[];
  onTaskAiInputChange: (taskId: string, mode: TaskAiMode, markdown: string) => void;
  onTaskAiOptimizedTextChange: (taskId: string, markdown: string) => void;
  onTaskAiClose: () => void;
  onTaskAiSubmit: (task: TaskItem, mode: TaskAiMode) => void;
  onSaveOptimizedTask: (task: TaskItem) => void;
  onSelectTask: (task: TaskItem) => void;
  onLocateAnchor: (task: TaskItem) => void;
  onDeleteTask: (taskId: string) => void;
  onPendingContentChange: (taskId: string, markdown: string) => void;
  onPendingApiSpecChange: (taskId: string, spec: TaskApiSpec) => void;
  onAnchorPopoverChange: (task: TaskItem, open: boolean) => void;
  onAiPopoverChange: (task: TaskItem, mode: TaskAiMode, open: boolean) => void;
  onGenerateExecutableForTask: (taskId: string) => void;
  onSaveTaskDraft: (taskId: string) => void;
  onConfirmTaskAdjustment: (taskId: string) => void;
  onToggleUnmet: (taskId: string, collapsed: boolean) => void;
  onToggleCheck: (taskId: string, collapsed: boolean) => void;
  onGenerateExecutableTasks: () => void;
  onCloseRuntime: () => void;
  onRetryStage: (phase: SplitRetryPhase) => void;
  onShowRuntime: () => void;
}

export function TaskResultPanel({
  splitError,
  mappingFallbackStats,
  splitQualityStats,
  taskHostRef,
  filteredTasks,
  runtimeVisible,
  runtimeLogs,
  runtimeListRef,
  retryingPhase,
  parsing,
  unmetTaskIds,
  unmetMenuItems,
  confirmSavingTaskId,
  activeResult,
  taskConfirmFilter,
  taskConfirmCounts,
  taskRoleFilter,
  taskRoleFilterOptions,
  showRoleFilterTabs,
  canGenerateExecutableTasks,
  hasConfirmedTasks,
  hasUnconfirmedTasks,
  closingMotionActive,
  selectedTaskId,
  resolvedTaskAnchorIds,
  pendingTaskContentById,
  pendingTaskApiSpecById,
  taskExecutableCheckResultById,
  taskUnmetCollapsedById,
  taskCheckCollapsedById,
  taskAiOptimizedContentById,
  taskAiOptimizedReadyById,
  taskAiActionLoadingById,
  taskAiSavingTaskId,
  taskAiPopoverTaskId,
  taskAiPopoverMode,
  taskAnchorPopoverTaskId,
  generatingExecutableTaskId,
  savingTaskId,
  onConfirmAll,
  onAddTask,
  onClearAllTasks,
  onTaskConfirmFilterChange,
  onTaskRoleFilterChange,
  getTaskAiMode,
  getTaskAiInput,
  getDraftedTask,
  displayExecutionStatus,
  cardUnmetPointsForTask,
  onTaskAiInputChange,
  onTaskAiOptimizedTextChange,
  onTaskAiClose,
  onTaskAiSubmit,
  onSaveOptimizedTask,
  onSelectTask,
  onLocateAnchor,
  onDeleteTask,
  onPendingContentChange,
  onPendingApiSpecChange,
  onAnchorPopoverChange,
  onAiPopoverChange,
  onGenerateExecutableForTask,
  onSaveTaskDraft,
  onConfirmTaskAdjustment,
  onToggleUnmet,
  onToggleCheck,
  onGenerateExecutableTasks,
  onCloseRuntime,
  onRetryStage,
  onShowRuntime,
}: Props) {
  const showRuntime = runtimeVisible && (parsing || filteredTasks.length === 0 || runtimeLogs.length > 0);
  return (
    <Space orientation="vertical" size={12} className="app-prd-task-panel__full-width app-prd-task-panel__stack">
      {splitError ? <Typography.Text type="danger">{splitError}</Typography.Text> : null}
      {mappingFallbackStats?.hasFallback ? (
        <Typography.Text type={mappingFallbackStats.allFallback ? "warning" : "secondary"}>
          映射提示：当前需求映射 {mappingFallbackStats.fallbackCount}/{mappingFallbackStats.total}
          条由本地自动映射生成（不依赖模型返回 requirement 映射字段）。
        </Typography.Text>
      ) : null}
      <SplitQualityStrip stats={splitQualityStats} />

      <div ref={taskHostRef} className="app-prd-task-panel__task-card-host">
        <Card
          size="small"
          title={(
            <TaskBoardHeader
              filteredTasksCount={filteredTasks.length}
              unmetTaskIds={unmetTaskIds}
              unmetMenuItems={unmetMenuItems}
              confirmSavingTaskId={confirmSavingTaskId}
              activeResult={activeResult}
              taskConfirmFilter={taskConfirmFilter}
              taskConfirmCounts={taskConfirmCounts}
              taskRoleFilter={taskRoleFilter}
              taskRoleFilterOptions={taskRoleFilterOptions}
              showRoleFilterTabs={showRoleFilterTabs}
              onConfirmAll={onConfirmAll}
              onAddTask={onAddTask}
              onClearAllTasks={onClearAllTasks}
              onTaskConfirmFilterChange={onTaskConfirmFilterChange}
              onTaskRoleFilterChange={onTaskRoleFilterChange}
            />
          )}
          extra={runtimeLogs.length > 0 && filteredTasks.length > 0 ? (
            <Button
              size="small"
              type="text"
              icon={<HistoryOutlined />}
              onClick={onShowRuntime}
            >
              重看过程
            </Button>
          ) : null}
          className="app-prd-task-panel__result-card app-prd-task-panel__task-card"
          bodyStyle={{ padding: 0 }}
        >
          <div className="app-prd-task-panel__task-split-layout">
            <div className="app-prd-task-panel__task-upper">
              {showRuntime ? (
                <div className="app-prd-task-panel__result-runtime">
                  <div className="app-prd-task-panel__split-runtime-head">
                    <Space size={8} align="center" className="app-prd-task-panel__split-runtime-head-title">
                      <Typography.Text strong>Claude Code 运行过程</Typography.Text>
                      {parsing ? <Spin size="small" aria-label="拆分进行中" /> : null}
                    </Space>
                    <Button
                      size="small"
                      type="text"
                      icon={<CloseOutlined />}
                      onClick={onCloseRuntime}
                      aria-label="关闭处理信息面板"
                    />
                  </div>
                  <SplitRuntimeMessages
                    logs={runtimeLogs}
                    listRef={runtimeListRef}
                    retryingPhase={retryingPhase}
                    onRetryStage={onRetryStage}
                  />
                </div>
              ) : (
                <div className="app-prd-task-panel__task-list">
                  {filteredTasks.length === 0 ? (
                    <div className="app-prd-task-panel__task-list-empty">
                      <Typography.Text type="secondary">暂未拆分任务</Typography.Text>
                    </div>
                  ) : (
                    filteredTasks.map((task) => (
                      <TaskResultCard
                        key={task.id}
                        task={task}
                        activeResult={activeResult}
                        selected={selectedTaskId === task.id}
                        canDelete={(activeResult?.splitTasks.length ?? 0) > 1}
                        closingMotionActive={closingMotionActive}
                        resolvedTaskAnchorIds={resolvedTaskAnchorIds}
                        pendingContent={pendingTaskContentById[task.id]}
                        pendingApiSpec={pendingTaskApiSpecById[task.id]}
                        taskExecutableCheckResult={taskExecutableCheckResultById[task.id] ?? ""}
                        unmetCollapsed={taskUnmetCollapsedById[task.id] ?? false}
                        checkCollapsed={taskCheckCollapsedById[task.id] ?? false}
                        optimizedText={taskAiOptimizedContentById[task.id] ?? ""}
                        optimizedReady={taskAiOptimizedReadyById[task.id] ?? false}
                        actionLoading={!!taskAiActionLoadingById[task.id]}
                        savingOptimized={taskAiSavingTaskId === task.id}
                        anchorPopoverOpen={taskAnchorPopoverTaskId === task.id}
                        aiPopoverMode={taskAiPopoverTaskId === task.id ? taskAiPopoverMode : null}
                        generatingExecutableTaskId={generatingExecutableTaskId}
                        savingTaskId={savingTaskId}
                        confirmSavingTaskId={confirmSavingTaskId}
                        getTaskAiMode={getTaskAiMode}
                        getTaskAiInput={getTaskAiInput}
                        getDraftedTask={getDraftedTask}
                        displayExecutionStatus={displayExecutionStatus}
                        cardUnmetPointsForTask={cardUnmetPointsForTask}
                        onTaskAiInputChange={onTaskAiInputChange}
                        onTaskAiOptimizedTextChange={onTaskAiOptimizedTextChange}
                        onTaskAiClose={onTaskAiClose}
                        onTaskAiSubmit={onTaskAiSubmit}
                        onSaveOptimizedTask={onSaveOptimizedTask}
                        onSelectTask={onSelectTask}
                        onLocateAnchor={onLocateAnchor}
                        onDeleteTask={onDeleteTask}
                        onPendingContentChange={onPendingContentChange}
                        onPendingApiSpecChange={onPendingApiSpecChange}
                        onAnchorPopoverChange={onAnchorPopoverChange}
                        onAiPopoverChange={onAiPopoverChange}
                        onGenerateExecutableForTask={onGenerateExecutableForTask}
                        onSaveTaskDraft={onSaveTaskDraft}
                        onConfirmTaskAdjustment={onConfirmTaskAdjustment}
                        onToggleUnmet={onToggleUnmet}
                        onToggleCheck={onToggleCheck}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="app-prd-task-panel__task-lower">
              <Button
                type="primary"
                block
                className={[
                  "app-prd-task-panel__task-generate-btn",
                  canGenerateExecutableTasks
                    ? "app-prd-task-panel__task-generate-btn--ready"
                    : "app-prd-task-panel__task-generate-btn--blocked",
                ].join(" ")}
                onClick={onGenerateExecutableTasks}
                disabled={!canGenerateExecutableTasks || closingMotionActive}
              >
                {!hasConfirmedTasks
                  ? "落盘到 Trellis（已确认 0）"
                  : hasUnconfirmedTasks
                    ? `落盘到 Trellis（未确认 ${taskConfirmCounts.unconfirmedCount}）`
                    : "落盘到 Trellis"}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </Space>
  );
}

interface TaskResultCardProps {
  task: TaskItem;
  activeResult: SplitResult | null;
  selected: boolean;
  canDelete: boolean;
  closingMotionActive: boolean;
  resolvedTaskAnchorIds: string[];
  pendingContent: string | undefined;
  pendingApiSpec: TaskApiSpec | undefined;
  taskExecutableCheckResult: string;
  unmetCollapsed: boolean;
  checkCollapsed: boolean;
  optimizedText: string;
  optimizedReady: boolean;
  actionLoading: boolean;
  savingOptimized: boolean;
  anchorPopoverOpen: boolean;
  aiPopoverMode: TaskAiMode | null;
  generatingExecutableTaskId: string | null;
  savingTaskId: string | null;
  confirmSavingTaskId: string | null;
  getTaskAiMode: (task: TaskItem) => TaskAiMode;
  getTaskAiInput: (task: TaskItem, mode: TaskAiMode) => string;
  getDraftedTask: (task: TaskItem) => TaskItem;
  displayExecutionStatus: (task: TaskItem) => TaskExecutionStatus;
  cardUnmetPointsForTask: (task: TaskItem) => string[];
  onTaskAiInputChange: (taskId: string, mode: TaskAiMode, markdown: string) => void;
  onTaskAiOptimizedTextChange: (taskId: string, markdown: string) => void;
  onTaskAiClose: () => void;
  onTaskAiSubmit: (task: TaskItem, mode: TaskAiMode) => void;
  onSaveOptimizedTask: (task: TaskItem) => void;
  onSelectTask: (task: TaskItem) => void;
  onLocateAnchor: (task: TaskItem) => void;
  onDeleteTask: (taskId: string) => void;
  onPendingContentChange: (taskId: string, markdown: string) => void;
  onPendingApiSpecChange: (taskId: string, spec: TaskApiSpec) => void;
  onAnchorPopoverChange: (task: TaskItem, open: boolean) => void;
  onAiPopoverChange: (task: TaskItem, mode: TaskAiMode, open: boolean) => void;
  onGenerateExecutableForTask: (taskId: string) => void;
  onSaveTaskDraft: (taskId: string) => void;
  onConfirmTaskAdjustment: (taskId: string) => void;
  onToggleUnmet: (taskId: string, collapsed: boolean) => void;
  onToggleCheck: (taskId: string, collapsed: boolean) => void;
}

function TaskResultCard({
  task,
  activeResult,
  selected,
  canDelete,
  closingMotionActive,
  resolvedTaskAnchorIds,
  pendingContent,
  pendingApiSpec,
  taskExecutableCheckResult,
  unmetCollapsed,
  checkCollapsed,
  optimizedText,
  optimizedReady,
  actionLoading,
  savingOptimized,
  anchorPopoverOpen,
  aiPopoverMode,
  generatingExecutableTaskId,
  savingTaskId,
  confirmSavingTaskId,
  getTaskAiMode,
  getTaskAiInput,
  getDraftedTask,
  displayExecutionStatus,
  cardUnmetPointsForTask,
  onTaskAiInputChange,
  onTaskAiOptimizedTextChange,
  onTaskAiClose,
  onTaskAiSubmit,
  onSaveOptimizedTask,
  onSelectTask,
  onLocateAnchor,
  onDeleteTask,
  onPendingContentChange,
  onPendingApiSpecChange,
  onAnchorPopoverChange,
  onAiPopoverChange,
  onGenerateExecutableForTask,
  onSaveTaskDraft,
  onConfirmTaskAdjustment,
  onToggleUnmet,
  onToggleCheck,
}: TaskResultCardProps) {
  const taskAiMode = getTaskAiMode(task);
  const draftedTask = getDraftedTask(task);
  const taskAiPopoverContent: ReactNode = (
    <TaskAiPopoverContent
      mode={taskAiMode}
      promptText={getTaskAiInput(task, taskAiMode)}
      optimizedText={optimizedText}
      actionLoading={actionLoading}
      saving={savingOptimized}
      optimizedReady={optimizedReady}
      onPromptChange={(markdown) => onTaskAiInputChange(task.id, taskAiMode, markdown)}
      onOptimizedTextChange={(markdown) => onTaskAiOptimizedTextChange(task.id, markdown)}
      onClose={onTaskAiClose}
      onSubmit={() => onTaskAiSubmit(task, taskAiMode)}
      onSaveOptimized={() => onSaveOptimizedTask(task)}
    />
  );
  const taskAnchorPopoverContent: ReactNode = (
    <TaskAnchorPopoverBody
      task={task}
      activeResult={activeResult}
      anchorResolvedInEditor={resolvedTaskAnchorIds.includes(task.id)}
    />
  );

  return (
    <TaskCard
      task={task}
      draftedTask={draftedTask}
      selected={selected}
      canDelete={canDelete}
      pendingContent={pendingContent}
      draftedTaskMarkdown={taskToMarkdown(draftedTask)}
      pendingApiSpec={pendingApiSpec}
      showApiSpec={Boolean(draftedTask.apiSpec) || task.title.includes("接口协议")}
      executionStatus={displayExecutionStatus(task)}
      generatingTaskId={generatingExecutableTaskId}
      savingTaskId={savingTaskId}
      confirmSavingTaskId={confirmSavingTaskId}
      closingMotionActive={closingMotionActive}
      taskUnmetLines={cardUnmetPointsForTask(task)}
      taskExecutableCheckResult={taskExecutableCheckResult}
      unmetCollapsed={unmetCollapsed}
      checkCollapsed={checkCollapsed}
      anchorPopoverOpen={anchorPopoverOpen}
      aiPopoverMode={aiPopoverMode}
      taskAiPopoverContent={taskAiPopoverContent}
      taskAnchorPopoverContent={taskAnchorPopoverContent}
      onSelect={() => onSelectTask(task)}
      onLocateAnchor={() => onLocateAnchor(task)}
      onDelete={() => onDeleteTask(task.id)}
      onPendingContentChange={(markdown) => onPendingContentChange(task.id, markdown)}
      onPendingApiSpecChange={(spec) => onPendingApiSpecChange(task.id, spec)}
      onAnchorPopoverChange={(open) => onAnchorPopoverChange(task, open)}
      onAiPopoverChange={(mode, open) => onAiPopoverChange(task, mode, open)}
      onGenerateExecutable={() => onGenerateExecutableForTask(task.id)}
      onSaveDraft={() => onSaveTaskDraft(task.id)}
      onConfirmAdjustment={() => onConfirmTaskAdjustment(task.id)}
      onToggleUnmet={() => onToggleUnmet(task.id, unmetCollapsed)}
      onToggleCheck={() => onToggleCheck(task.id, checkCollapsed)}
    />
  );
}
