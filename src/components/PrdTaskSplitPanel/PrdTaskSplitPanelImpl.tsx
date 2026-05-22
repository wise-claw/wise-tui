import { Col, Layout, Row, Space, Spin } from "antd";
import { Suspense, useState } from "react";
import type { ProjectItem, Repository } from "../../types";
import { savePrdTaskSplitResult } from "../../services/prdTaskSplitStore";
import { sameStringArray } from "../../utils/anchorStability";
import { RequirementNameModal } from "./RequirementNameModal";
import { RuntimePromptEditModal } from "./RuntimePromptEditModal";
import { RequirementInputCard } from "./RequirementInputCard";
import { TaskResultPanel } from "./TaskResultPanel";
import { TrellisMissionStrip } from "./TrellisMissionStrip";
import { reconcileResolvedAnchorRanges } from "./anchorReconcile";
import { usePrdTaskSplitPanelController } from "./usePrdTaskSplitPanelController";

type SplitWorkspaceLayout = "review" | "focused";

export interface PrdTaskSplitPanelProps {
  onClose: () => void;
  projects: ProjectItem[];
  repositories: Repository[];
  activeProjectId: string | null;
  activeRepositoryId: number | null;
}

export function PrdTaskSplitPanel({
  onClose,
  projects,
  repositories,
  activeProjectId,
  activeRepositoryId,
}: PrdTaskSplitPanelProps) {
  const [workspaceLayout, setWorkspaceLayout] = useState<SplitWorkspaceLayout>("review");
  const {
    activeRequirement,
    activeRequirementId,
    activeResult,
    assistantHistoryLoading,
    assistantHistoryOptions,
    assistantMcpOptions,
    assistantRuntimeLoading,
    assistantWorkflowOptions,
    assistantSelectedMcpIds,
    anchorRangePersistTimerRef,
    canGenerateExecutableTasks,
    cardUnmetPointsForTask,
    confirmSavingTaskId,
    displayExecutionStatus,
    executionFanoutSnapshot,
    filteredTasks,
    focusTaskWithFilterSync,
    generatingExecutableTaskId,
    getDraftedTask,
    getTaskAiInput,
    getTaskAiMode,
    handleAddTask,
    handleAssistantMcpsChange,
    handleCheckTaskExecutable,
    handleClearAllTasks,
    handleConfirmAllTasks,
    handleConfirmRequirementNameModal,
    handleConfirmTaskAdjustment,
    handleDeleteActiveRequirement,
    handleDeleteTask,
    handleGenerateExecutableForSplitTask,
    handleGenerateExecutableTasks,
    handleDispatchPlannedClusters,
    handleImportLegacyPrd,
    handleImportPrdFile,
    handleMoveTaskInExecutionPlan,
    handleMoveTaskToExecutionWave,
    handleParse,
    handleOptimizeRuntimePromptDraft,
    handleOptimizeTaskContent,
    handlePasteImage,
    handlePinActiveRequirement,
    handleResetRuntimePromptToDefault,
    handleRetrySplitStage,
    handleSaveOptimizedTaskContent,
    handleSaveRuntimePromptDraft,
    handleSaveTaskDraft,
    handleSplitSelection,
    handleUserPersistPrdDraft,
    hasInput,
    inputError,
    inputValue,
    latestAnchorRangePersistResultRef,
    linkedRepositoryId,
    mappingFallbackStats,
    materializedExecutionResult,
    message,
    milkdownEditorRef,
    milkdownTaskAnchors,
    plannedMissionSummary,
    parsing,
    pendingTaskApiSpecById,
    pendingTaskContentById,
    pickRequirementIdForTask,
    promptActionItems,
    requirementHistoryById,
    requirementEditorShellRef,
    requirementNameInput,
    requirementNameModalMode,
    requirementNameModalOpen,
    requirementNameSaving,
    resolvedTaskAnchorIds,
    retryingPhase,
    runtimePromptDraftBySlot,
    runtimePromptLoading,
    runtimePromptModalOpen,
    runtimePromptOptimizingSlot,
    runtimePromptSaving,
    runtimePromptSlot,
    savingTaskId,
    scrollToRequirementInPrd,
    scrollToTaskAnchorInPrd,
    selectedAnchorTaskId,
    selectedTaskId,
    setActiveResult,
    setAnchorResolveReported,
    setInputValue,
    setPendingTaskApiSpecById,
    setPendingTaskContentById,
    setRequirementNameInput,
    setRequirementNameModalMode,
    setRequirementNameModalOpen,
    setResolvedTaskAnchorIds,
    setRuntimePromptModalOpen,
    setRuntimePromptSaving,
    setRuntimePromptSlot,
    setSelectedAnchorTaskId,
    setSelectedTaskId,
    setSplitRuntimeVisible,
    setTaskAiInputById,
    setTaskAiOptimizedContentById,
    setTaskAiPopoverMode,
    setTaskAiPopoverTaskId,
    setTaskAnchorPopoverTaskId,
    setTaskCheckCollapsedById,
    setTaskConfirmFilter,
    setTaskUnmetCollapsedById,
    showUrlAnchorHint,
    sortedRequirementHistory,
    splitError,
    splitPromptAdjustStarting,
    splitQualityStats,
    splitRuntimeListRef,
    splitRuntimeLogs,
    splitRuntimeVisible,
    requirementMission,
    trellisStageItems,
    trellisTargetSummary,
    openTaskAiPopover,
    taskAiActionLoadingById,
    taskAiOptimizedContentById,
    taskAiOptimizedReadyById,
    taskAiPopoverMode,
    taskAiPopoverTaskId,
    taskAiSavingTaskId,
    taskAnchorPopoverTaskId,
    taskCheckCollapsedById,
    taskConfirmCounts,
    taskConfirmFilter,
    taskExecutableCheckResultById,
    taskSplitHostRef,
    taskUnmetCollapsedById,
    switchToRequirement,
    unmetPreconditionsMenuItems,
    unmetTaskIds,
    updateRuntimePromptDraft,
  } = usePrdTaskSplitPanelController({
    onClose,
    projects,
    repositories,
    activeProjectId,
    activeRepositoryId,
  });
  const workspaceStageClass = filteredTasks.length > 0 || plannedMissionSummary || splitRuntimeVisible
    ? "app-prd-task-panel__columns--has-task-flow"
    : "app-prd-task-panel__columns--writing";

  return (
    <Suspense
      fallback={
        <div className="app-file-editor-loading">
          <Spin size="small" />
        </div>
      }
    >
      <Layout.Content
        className="app-prd-task-panel"
      >
      <RuntimePromptEditModal
        open={runtimePromptModalOpen}
        linkedRepositoryId={linkedRepositoryId}
        loading={runtimePromptLoading}
        saving={runtimePromptSaving}
        optimizingSlot={runtimePromptOptimizingSlot}
        slot={runtimePromptSlot}
        draftBySlot={runtimePromptDraftBySlot}
        onSlotChange={setRuntimePromptSlot}
        onDraftChange={updateRuntimePromptDraft}
        onResetToDefault={() => void handleResetRuntimePromptToDefault()}
        onCancel={() => {
          setRuntimePromptModalOpen(false);
          setRuntimePromptSaving(false);
        }}
        onSave={() => void handleSaveRuntimePromptDraft()}
        onOptimize={(slot) => void handleOptimizeRuntimePromptDraft(slot)}
      />
      <RequirementNameModal
        open={requirementNameModalOpen}
        mode={requirementNameModalMode}
        saving={requirementNameSaving}
        value={requirementNameInput}
        onChange={setRequirementNameInput}
        onCancel={() => setRequirementNameModalOpen(false)}
        onConfirm={() => void handleConfirmRequirementNameModal()}
      />
      <Space orientation="vertical" size={4} className="app-prd-task-panel__stack">
        <TrellisMissionStrip target={trellisTargetSummary} stages={trellisStageItems} />
        <Row
          gutter={12}
          className={[
            "app-prd-task-panel__columns",
            workspaceStageClass,
            workspaceLayout === "focused" ? "app-prd-task-panel__columns--task-focus" : "",
          ].filter(Boolean).join(" ")}
        >
          <Col span={12} className="app-prd-task-panel__col app-prd-task-panel__col--requirements">
            <RequirementInputCard
              activeRequirementId={activeRequirementId}
              activeRequirement={activeRequirement ?? null}
              options={sortedRequirementHistory}
              inputValue={inputValue}
              inputError={inputError}
              showUrlAnchorHint={showUrlAnchorHint}
              hasInput={hasInput}
              parsing={parsing}
              splitStarting={splitPromptAdjustStarting}
              promptActionItems={promptActionItems}
              assistantRuntimeLoading={assistantRuntimeLoading}
              assistantWorkflowOptions={assistantWorkflowOptions}
              assistantMcpOptions={assistantMcpOptions}
              assistantSelectedMcpIds={assistantSelectedMcpIds}
              assistantHistoryOptions={assistantHistoryOptions}
              assistantHistoryLoading={assistantHistoryLoading}
              editorRef={milkdownEditorRef}
              editorShellRef={requirementEditorShellRef}
              taskAnchors={milkdownTaskAnchors}
              selectedAnchorTaskId={selectedAnchorTaskId}
              filteredTaskCount={filteredTasks.length}
              onInputChange={setInputValue}
              onPickRequirement={(value) => {
                const picked = requirementHistoryById.get(value);
                if (!picked) return;
                switchToRequirement(picked);
              }}
              onPinRequirement={() => handlePinActiveRequirement()}
              onCreateRequirement={() => {
                setRequirementNameModalMode("create");
                setRequirementNameInput("");
                setRequirementNameModalOpen(true);
              }}
              onDeleteRequirement={() => handleDeleteActiveRequirement()}
              onPasteImage={(e) => void handlePasteImage(e)}
              onSplitSelection={() => void handleSplitSelection()}
              onResolvedTaskAnchorIdsChange={(taskIds) => {
                const normalizedTaskIds = Array.from(
                  new Set(
                    taskIds
                      .map((id) => id.trim())
                      .filter((id) => id.length > 0),
                  ),
                ).sort((a, b) => a.localeCompare(b));
                setResolvedTaskAnchorIds((prev) => (
                  sameStringArray(prev, normalizedTaskIds) ? prev : normalizedTaskIds
                ));
                setAnchorResolveReported((prev) => (prev ? prev : true));
              }}
              onTaskAnchorRangesChange={(ranges) => {
                setActiveResult((prev) => {
                  if (!prev) return prev;
                  const merged = reconcileResolvedAnchorRanges(prev, ranges);
                  if (!merged) return prev;
                  latestAnchorRangePersistResultRef.current = merged;
                  if (anchorRangePersistTimerRef.current != null) {
                    window.clearTimeout(anchorRangePersistTimerRef.current);
                  }
                  anchorRangePersistTimerRef.current = window.setTimeout(() => {
                    const payload = latestAnchorRangePersistResultRef.current;
                    if (!payload) return;
                    void savePrdTaskSplitResult(payload).catch((err) => {
                      const msg = err instanceof Error ? err.message : String(err);
                      message.warning(`任务锚点位置持久化失败：${msg}`);
                    });
                  }, 300);
                  return merged;
                });
              }}
              onTaskAnchorMarkerClick={(taskId) => {
                focusTaskWithFilterSync(taskId);
              }}
              onSaveDraft={() => void handleUserPersistPrdDraft()}
              onStartSplit={() => void handleParse()}
              onImportPrdFile={() => void handleImportPrdFile()}
              onImportLegacyPrd={(summary) => void handleImportLegacyPrd(summary)}
              onAssistantMcpsChange={handleAssistantMcpsChange}
            />
          </Col>
          <Col span={12} className="app-prd-task-panel__col app-prd-task-panel__col--tasks">
            <TaskResultPanel
              splitError={splitError}
              mappingFallbackStats={mappingFallbackStats}
              splitQualityStats={splitQualityStats}
              taskHostRef={taskSplitHostRef}
              filteredTasks={filteredTasks}
              runtimeVisible={splitRuntimeVisible}
              runtimeLogs={splitRuntimeLogs}
              clusterRuns={Object.values(requirementMission.state.clusterRuns)}
              runtimeListRef={splitRuntimeListRef}
              retryingPhase={retryingPhase}
              parsing={parsing}
              unmetTaskIds={unmetTaskIds}
              unmetMenuItems={unmetPreconditionsMenuItems}
              confirmSavingTaskId={confirmSavingTaskId}
              executionFanoutSnapshot={executionFanoutSnapshot}
              materializedExecutionResult={materializedExecutionResult}
              activeResult={activeResult}
              plannedMissionSummary={plannedMissionSummary}
              taskConfirmFilter={taskConfirmFilter}
              taskConfirmCounts={taskConfirmCounts}
              canGenerateExecutableTasks={canGenerateExecutableTasks}
              closingMotionActive={false}
              selectedTaskId={selectedTaskId}
              resolvedTaskAnchorIds={resolvedTaskAnchorIds}
              pendingTaskContentById={pendingTaskContentById}
              pendingTaskApiSpecById={pendingTaskApiSpecById}
              taskExecutableCheckResultById={taskExecutableCheckResultById}
              taskUnmetCollapsedById={taskUnmetCollapsedById}
              taskCheckCollapsedById={taskCheckCollapsedById}
              taskAiOptimizedContentById={taskAiOptimizedContentById}
              taskAiOptimizedReadyById={taskAiOptimizedReadyById}
              taskAiActionLoadingById={taskAiActionLoadingById}
              taskAiSavingTaskId={taskAiSavingTaskId}
              taskAiPopoverTaskId={taskAiPopoverTaskId}
              taskAiPopoverMode={taskAiPopoverMode}
              taskAnchorPopoverTaskId={taskAnchorPopoverTaskId}
              generatingExecutableTaskId={generatingExecutableTaskId}
              savingTaskId={savingTaskId}
              onConfirmAll={handleConfirmAllTasks}
              onAddTask={() => void handleAddTask()}
              onClearAllTasks={() => handleClearAllTasks()}
              onTaskConfirmFilterChange={setTaskConfirmFilter}
              getTaskAiMode={getTaskAiMode}
              getTaskAiInput={getTaskAiInput}
              getDraftedTask={getDraftedTask}
              displayExecutionStatus={displayExecutionStatus}
              cardUnmetPointsForTask={cardUnmetPointsForTask}
              onTaskAiInputChange={(taskId, mode, markdown) => {
                setTaskAiInputById((prev) => ({
                  ...prev,
                  [taskId]: {
                    ...(prev[taskId] ?? {}),
                    [mode]: markdown,
                  },
                }));
              }}
              onTaskAiOptimizedTextChange={(taskId, markdown) => {
                setTaskAiOptimizedContentById((prev) => ({
                  ...prev,
                  [taskId]: markdown,
                }));
              }}
              onTaskAiClose={() => {
                setTaskAiPopoverTaskId(null);
                setTaskAiPopoverMode(null);
              }}
              onTaskAiSubmit={(task, mode) => {
                const prompt = getTaskAiInput(task, mode).trim();
                if (!prompt) {
                  message.warning("请输入提示词后再执行。");
                  return;
                }
                if (mode === "optimize") {
                  void handleOptimizeTaskContent(task, prompt);
                  return;
                }
                void handleCheckTaskExecutable(task, prompt);
              }}
              onSaveOptimizedTask={(task) => void handleSaveOptimizedTaskContent(task)}
              onSelectTask={(task) => {
                if (selectedTaskId !== null && selectedTaskId !== task.id) {
                  milkdownEditorRef.current?.clearRequirementFocusHighlight();
                }
                setSelectedTaskId(task.id);
                setSelectedAnchorTaskId(task.id);
              }}
              onLocateAnchor={(task) => {
                if (selectedTaskId !== task.id) {
                  milkdownEditorRef.current?.clearRequirementFocusHighlight();
                }
                setSelectedTaskId(task.id);
                setSelectedAnchorTaskId(task.id);
                const locatedByAnchor = scrollToTaskAnchorInPrd(task);
                if (locatedByAnchor) return;
                const requirementId = pickRequirementIdForTask(task);
                if (requirementId) {
                  const locatedByRequirement = scrollToRequirementInPrd(requirementId);
                  if (locatedByRequirement) return;
                }
                message.warning("没有相应的锚点。");
              }}
              onDeleteTask={handleDeleteTask}
              onPendingContentChange={(taskId, markdown) => {
                setPendingTaskContentById((prev) => {
                  if (prev[taskId] === markdown) return prev;
                  return { ...prev, [taskId]: markdown };
                });
              }}
              onPendingApiSpecChange={(taskId, spec) => {
                setPendingTaskApiSpecById((prev) => ({ ...prev, [taskId]: spec }));
              }}
              onAnchorPopoverChange={(task, open) => {
                if (open) {
                  setTaskAiPopoverTaskId(null);
                  setTaskAiPopoverMode(null);
                  setTaskAnchorPopoverTaskId(task.id);
                  return;
                }
                setTaskAnchorPopoverTaskId((prev) => (prev === task.id ? null : prev));
              }}
              onAiPopoverChange={(task, mode, open) => {
                if (open) {
                  setTaskAnchorPopoverTaskId(null);
                  openTaskAiPopover(task, mode);
                  return;
                }
                if (taskAiPopoverTaskId === task.id && taskAiPopoverMode === mode) {
                  setTaskAiPopoverTaskId(null);
                  setTaskAiPopoverMode(null);
                }
              }}
              onGenerateExecutableForTask={(taskId) => void handleGenerateExecutableForSplitTask(taskId)}
              onSaveTaskDraft={(taskId) => void handleSaveTaskDraft(taskId)}
              onConfirmTaskAdjustment={(taskId) => void handleConfirmTaskAdjustment(taskId)}
              onToggleUnmet={(taskId, collapsed) => {
                setTaskUnmetCollapsedById((prev) => ({
                  ...prev,
                  [taskId]: !collapsed,
                }));
              }}
              onToggleCheck={(taskId, collapsed) => {
                setTaskCheckCollapsedById((prev) => ({
                  ...prev,
                  [taskId]: !collapsed,
                }));
              }}
              onGenerateExecutableTasks={handleGenerateExecutableTasks}
              onDispatchPlannedClusters={() => void handleDispatchPlannedClusters()}
              onMoveTaskInExecutionPlan={(taskId, direction) => void handleMoveTaskInExecutionPlan(taskId, direction)}
              onMoveTaskToExecutionWave={(taskId, waveIndex) => void handleMoveTaskToExecutionWave(taskId, waveIndex)}
              onWorkspaceLayoutChange={setWorkspaceLayout}
              onCloseRuntime={() => setSplitRuntimeVisible(false)}
              onRetryStage={(phase) => { void handleRetrySplitStage(phase); }}
              onRetryCluster={(clusterId) => { void requirementMission.retryCluster(clusterId); }}
              onCancelCluster={(clusterId) => { void requirementMission.cancelCluster(clusterId); }}
              onShowRuntime={() => setSplitRuntimeVisible(true)}
            />
          </Col>
        </Row>
      </Space>
      </Layout.Content>
    </Suspense>
  );
}
