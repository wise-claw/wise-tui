import { CloseOutlined, HistoryOutlined, CheckCircleOutlined, LoadingOutlined } from "@ant-design/icons";
import { Button, Card, Space, Spin, Typography } from "antd";
import type { MenuProps } from "antd";
import { useEffect, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { SplitResult, TaskApiSpec, TaskExecutionStatus, TaskItem } from "../../types";
import { ExecutionOrchestrationPanel } from "./ExecutionOrchestrationPanel";
import { ExecutionRuntimeQueue } from "./ExecutionRuntimeQueue";
import { TaskAiPopoverContent } from "./TaskAiPopoverContent";
import { TaskAnchorPopoverBody } from "./TaskAnchorPopoverBody";
import { TaskBoardHeader } from "./TaskBoardHeader";
import { TaskCard } from "./TaskCard";
import { SplitQualityStrip } from "./SplitQualityStrip";
import { SplitRuntimeMessages } from "./SplitRuntimeMessages";
import type { ExecutionFanoutSnapshot } from "../../services/prdSplit/executionFanout";
import type { GenerateExecutableTasksResult } from "./usePrdTaskSplitPanelController";
import type {
  RequirementMissionMaterializeResult,
  RequirementMissionPlanSummary,
} from "./useRequirementMissionController";
import type { ClusterRunState } from "../PrdSplitWizard/types";
import type {
  SplitQualitySummary,
  SplitRetryPhase,
  SplitRuntimeLogItem,
} from "./types";
import type { TaskAiMode, TaskConfirmFilter } from "./helpers";
import { taskToMarkdown } from "./helpers";

type ResultViewMode = "review" | "orchestration";
type WorkspaceLayoutMode = "review" | "focused";

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
  clusterRuns: ClusterRunState[];
  runtimeListRef: RefObject<HTMLDivElement | null>;
  retryingPhase: SplitRetryPhase | null;
  parsing: boolean;
  unmetTaskIds: string[];
  unmetMenuItems: MenuProps["items"];
  confirmSavingTaskId: string | null;
  executionFanoutSnapshot: ExecutionFanoutSnapshot | null;
  materializedExecutionResult: RequirementMissionMaterializeResult | null;
  activeResult: SplitResult | null;
  plannedMissionSummary: RequirementMissionPlanSummary | null;
  taskConfirmFilter: TaskConfirmFilter;
  taskConfirmCounts: TaskConfirmCounts;
  canGenerateExecutableTasks: boolean;
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
  onConfirmAll: () => boolean | void | Promise<boolean | void>;
  onAddTask: () => void;
  onClearAllTasks: () => void;
  onTaskConfirmFilterChange: (value: TaskConfirmFilter) => void;
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
  onGenerateExecutableTasks: () => Promise<GenerateExecutableTasksResult | false>;
  onDispatchPlannedClusters: () => void;
  onMoveTaskInExecutionPlan: (taskId: string, direction: "earlier" | "later") => void;
  onMoveTaskToExecutionWave: (taskId: string, waveIndex: number) => void;
  onWorkspaceLayoutChange: (mode: WorkspaceLayoutMode) => void;
  onCloseRuntime: () => void;
  onRetryStage: (phase: SplitRetryPhase) => void;
  onRetryCluster: (clusterId: string) => void;
  onCancelCluster: (clusterId: string) => void;
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
  clusterRuns,
  runtimeListRef,
  retryingPhase,
  parsing,
  unmetTaskIds,
  unmetMenuItems,
  confirmSavingTaskId,
  executionFanoutSnapshot,
  materializedExecutionResult,
  activeResult,
  plannedMissionSummary,
  taskConfirmFilter,
  taskConfirmCounts,
  canGenerateExecutableTasks,
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
  onDispatchPlannedClusters,
  onMoveTaskInExecutionPlan,
  onMoveTaskToExecutionWave,
  onWorkspaceLayoutChange,
  onCloseRuntime,
  onRetryStage,
  onRetryCluster,
  onCancelCluster,
  onShowRuntime,
}: Props) {
  const showRuntimePanel = runtimeVisible && (parsing || runtimeLogs.length > 0);
  const [resultViewMode, setResultViewMode] = useState<ResultViewMode>("review");
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(() => new Set());
  const [runtimeQueueHidden, setRuntimeQueueHidden] = useState(false);
  const materializedResult = materializedExecutionResult;
  const showExecutionRuntime = materializedResult !== null && activeResult && !runtimeQueueHidden;
  const showOrchestration = resultViewMode === "orchestration" && activeResult && filteredTasks.length > 0 && !showExecutionRuntime;
  const showPlanPreview = !activeResult && plannedMissionSummary !== null;
  const showTaskList = resultViewMode === "review" && !showPlanPreview && !showExecutionRuntime;
  useEffect(() => {
    setRuntimeQueueHidden(false);
  }, [materializedExecutionResult]);
  useEffect(() => {
    setExpandedTaskIds((prev) => {
      const visibleIds = new Set(filteredTasks.map((task) => task.id));
      const next = new Set([...prev].filter((taskId) => visibleIds.has(taskId)));
      if (selectedTaskId && visibleIds.has(selectedTaskId)) next.add(selectedTaskId);
      if (next.size === 0 && filteredTasks[0]) next.add(filteredTasks[0].id);
      return next;
    });
  }, [filteredTasks, selectedTaskId]);
  useEffect(() => {
    const shouldFocus =
      resultViewMode === "orchestration" ||
      showExecutionRuntime ||
      (resultViewMode === "review" && showRuntimePanel);

    onWorkspaceLayoutChange(shouldFocus ? "focused" : "review");
  }, [onWorkspaceLayoutChange, resultViewMode, showExecutionRuntime, showRuntimePanel]);

  async function handleConfirmAllAndEnterOrchestration() {
    const confirmed = await onConfirmAll();
    if (confirmed === false) return;
    setResultViewMode("orchestration");
  }

  // Dynamic header rendering
  let cardTitle: ReactNode = null;
  let cardExtra: ReactNode = null;

  if (showExecutionRuntime) {
    const overallStatus = executionFanoutSnapshot?.status ?? "running";
    const getExecutionRuntimeTitle = (status: string | undefined) => {
      if (status === "failed") return "执行 fan-out 有失败";
      if (status === "succeeded") return "执行 fan-out 已完成";
      return "正在自动派发执行";
    };
    cardTitle = (
      <Space orientation="vertical" size={2} style={{ display: 'flex', width: '100%' }}>
        <Space size={8} align="center">
          <Typography.Text strong style={{ fontSize: 13 }}>
            ⚙️ Workspace Trellis · {getExecutionRuntimeTitle(overallStatus)}
          </Typography.Text>
          {overallStatus === "running" ? <Spin size="small" /> : null}
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', fontWeight: 'normal', whiteSpace: 'normal', wordBreak: 'break-all' }}>
          {executionFanoutSnapshot?.message ?? "任务目录已写入 Workspace Trellis，正在按编排波次自动派发实现子代理。"}
        </Typography.Text>
      </Space>
    );
    cardExtra = (
      <Space size={8}>
        <Button
          size="small"
          onClick={() => {
            setRuntimeQueueHidden(true);
            setResultViewMode("orchestration");
          }}
        >
          返回编排
        </Button>
        <Button
          size="small"
          icon={overallStatus === "running" ? <LoadingOutlined /> : <CheckCircleOutlined />}
          disabled
        >
          {overallStatus === "running" ? "执行中" : overallStatus === "failed" ? "有失败" : "已完成"}
        </Button>
      </Space>
    );
  } else if (showOrchestration) {
    cardTitle = (
      <Space size={8} align="center">
        <Typography.Text strong style={{ fontSize: 13 }}>🗺️ 并行波次编排 (Execution wave lanes DAG)</Typography.Text>
      </Space>
    );
    cardExtra = (
      <Button
        size="small"
        onClick={() => setResultViewMode("review")}
      >
        返回列表复核
      </Button>
    );
  } else if (showPlanPreview) {
    cardTitle = (
      <Space orientation="vertical" size={2} style={{ display: 'flex', width: '100%' }}>
        <Typography.Text strong style={{ fontSize: 13 }}>Cluster 规划</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', fontWeight: 'normal' }}>
          {plannedMissionSummary?.requirementCount} 条需求 · {plannedMissionSummary?.clusters.length} 个分组
        </Typography.Text>
      </Space>
    );
    cardExtra = (
      <Button
        type="primary"
        size="small"
        loading={parsing}
        disabled={parsing || plannedMissionSummary?.clusters.length === 0}
        onClick={onDispatchPlannedClusters}
      >
        派发 splitter
      </Button>
    );
  } else {
    // Normal Stage 1 Review mode
    cardTitle = (
      <TaskBoardHeader
        filteredTasksCount={filteredTasks.length}
        unmetTaskIds={unmetTaskIds}
        unmetMenuItems={unmetMenuItems}
        confirmSavingTaskId={confirmSavingTaskId}
        activeResult={activeResult}
        taskConfirmFilter={taskConfirmFilter}
        taskConfirmCounts={taskConfirmCounts}
        onConfirmAll={handleConfirmAllAndEnterOrchestration}
        onAddTask={onAddTask}
        onClearAllTasks={onClearAllTasks}
        onTaskConfirmFilterChange={onTaskConfirmFilterChange}
      />
    );
    cardExtra = (
      <Space size={8}>
        {(runtimeLogs.length > 0 || parsing) ? (
          runtimeVisible ? (
            <Button
              size="small"
              type="text"
              icon={<CloseOutlined />}
              onClick={onCloseRuntime}
            >
              收起过程
            </Button>
          ) : (
            <Button
              size="small"
              type="text"
              icon={<HistoryOutlined />}
              onClick={onShowRuntime}
            >
              重看过程
            </Button>
          )
        ) : null}
      </Space>
    );
  }

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
          title={cardTitle}
          extra={cardExtra}
          className="app-prd-task-panel__result-card app-prd-task-panel__task-card"
          bodyStyle={{ padding: 0 }}
        >
          <div className="app-prd-task-panel__task-split-layout">
            {!showPlanPreview && filteredTasks.length > 0 ? (
              <SplitResultStageRail
                mode={resultViewMode}
                canEnterOrchestration={Boolean(activeResult)}
                canGenerateExecutableTasks={canGenerateExecutableTasks}
                confirmedCount={taskConfirmCounts.confirmedCount}
                totalCount={filteredTasks.length}
                waveCount={activeResult?.parallelGroups.length ?? 0}
                onModeChange={setResultViewMode}
                materialized={materializedResult !== null}
                onMaterialize={async () => {
                  void onGenerateExecutableTasks();
                }}
              />
            ) : null}
            <div className="app-prd-task-panel__task-upper">
              {showPlanPreview ? (
                <PlannedClusterPreview
                  summary={plannedMissionSummary}
                />
              ) : null}

              {showOrchestration ? (
                <ExecutionOrchestrationPanel
                  result={activeResult}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={(taskId) => {
                    const task = activeResult.splitTasks.find((item) => item.id === taskId);
                    if (task) onSelectTask(task);
                  }}
                  onMoveTask={onMoveTaskInExecutionPlan}
                  onMoveTaskToWave={onMoveTaskToExecutionWave}
                />
              ) : null}

              {showExecutionRuntime ? (
                <ExecutionRuntimeQueue
                  result={activeResult}
                  materializedResult={materializedResult}
                  fanoutSnapshot={executionFanoutSnapshot}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={(taskId) => {
                    const task = activeResult.splitTasks.find((item) => item.id === taskId);
                    if (task) onSelectTask(task);
                  }}
                />
              ) : null}

              {showTaskList ? (
                showRuntimePanel ? (
                  <div className="app-prd-task-panel__stage-review-split">
                    <div className="app-prd-task-panel__stage-review-runtime app-prd-task-panel__result-runtime">
                      <SplitRuntimeMessages
                        logs={runtimeLogs}
                        clusterRuns={clusterRuns}
                        listRef={runtimeListRef}
                        retryingPhase={retryingPhase}
                        onRetryStage={onRetryStage}
                        onRetryCluster={onRetryCluster}
                        onCancelCluster={onCancelCluster}
                      />
                    </div>
                    <div className="app-prd-task-panel__stage-review-tasks">
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
                              expanded={expandedTaskIds.has(task.id)}
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
                              onToggleExpanded={(taskId) => {
                                setExpandedTaskIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(taskId)) {
                                    next.delete(taskId);
                                  } else {
                                    next.add(taskId);
                                  }
                                  return next;
                                });
                              }}
                              onToggleUnmet={onToggleUnmet}
                              onToggleCheck={onToggleCheck}
                            />
                          ))
                        )}
                      </div>
                    </div>
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
                          expanded={expandedTaskIds.has(task.id)}
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
                          onToggleExpanded={(taskId) => {
                            setExpandedTaskIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(taskId)) {
                                next.delete(taskId);
                              } else {
                                next.add(taskId);
                              }
                              return next;
                            });
                          }}
                          onToggleUnmet={onToggleUnmet}
                          onToggleCheck={onToggleCheck}
                        />
                      ))
                    )}
                  </div>
                )
              ) : null}
            </div>
          </div>
        </Card>
      </div>
    </Space>
  );
}

function SplitResultStageRail({
  mode,
  canEnterOrchestration,
  canGenerateExecutableTasks,
  confirmedCount,
  totalCount,
  waveCount,
  materialized,
  onModeChange,
  onMaterialize,
}: {
  mode: ResultViewMode;
  canEnterOrchestration: boolean;
  canGenerateExecutableTasks: boolean;
  confirmedCount: number;
  totalCount: number;
  waveCount: number;
  materialized: boolean;
  onModeChange: (mode: ResultViewMode) => void;
  onMaterialize: () => void;
}) {
  return (
    <div className="app-prd-task-panel__result-stage-rail" aria-label="需求拆分结果流程">
      <button
        type="button"
        className={[
          "app-prd-task-panel__result-stage",
          mode === "review" ? "is-active" : "",
        ].filter(Boolean).join(" ")}
        onClick={() => onModeChange("review")}
      >
        <span>1</span>
        <strong>候选任务复核</strong>
        <small>{confirmedCount}/{totalCount} 已确认</small>
      </button>
      <button
        type="button"
        className={[
          "app-prd-task-panel__result-stage",
          mode === "orchestration" ? "is-active" : "",
        ].filter(Boolean).join(" ")}
        disabled={!canEnterOrchestration}
        onClick={() => onModeChange("orchestration")}
      >
        <span>2</span>
        <strong>编排确认</strong>
        <small>{waveCount > 0 ? `${waveCount} 个执行波次` : "生成 DAG"}</small>
      </button>
      <button
        type="button"
        className="app-prd-task-panel__result-stage app-prd-task-panel__result-stage--execute"
        disabled={!canGenerateExecutableTasks || materialized}
        onClick={onMaterialize}
      >
        <span>3</span>
        <strong>落盘执行</strong>
        <small>{materialized ? "执行已启动" : canGenerateExecutableTasks ? "写入并派发" : "等待确认"}</small>
      </button>
    </div>
  );
}

function PlannedClusterPreview({
  summary,
}: {
  summary: RequirementMissionPlanSummary;
}) {
  return (
    <div className="app-prd-task-panel__planned-clusters">
      <div className="app-prd-task-panel__planned-cluster-list">
        {summary.clusters.map((cluster, index) => (
          <div key={cluster.id} className="app-prd-task-panel__planned-cluster-row">
            <span>C{index + 1}</span>
            <div>
              <strong>{cluster.title}</strong>
              <small>
                {cluster.id} · requirements: {cluster.requirementIds.join(", ") || "none"}
              </small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface TaskResultCardProps {
  task: TaskItem;
  activeResult: SplitResult | null;
  selected: boolean;
  expanded: boolean;
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
  onToggleExpanded: (taskId: string) => void;
  onToggleUnmet: (taskId: string, collapsed: boolean) => void;
  onToggleCheck: (taskId: string, collapsed: boolean) => void;
}

function TaskResultCard({
  task,
  activeResult,
  selected,
  expanded,
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
  onToggleExpanded,
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
      expanded={expanded}
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
      onToggleExpanded={() => onToggleExpanded(task.id)}
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
