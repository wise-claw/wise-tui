import { Col, Layout, Row, Space, Spin } from "antd";
import { Suspense } from "react";
import type {
  EmployeeItem,
  ProjectItem,
  Repository,
  WorkflowTemplateItem,
} from "../../types";
import { savePrdTaskSplitResult } from "../../services/prdTaskSplitStore";
import { sameStringArray } from "../../utils/anchorStability";
import { RequirementNameModal } from "./RequirementNameModal";
import { RuntimePromptEditModal } from "./RuntimePromptEditModal";
import { SplitPromptWizardModal } from "./SplitPromptWizardModal";
import { ProjectScopeHeader } from "./ProjectScopeHeader";
import { RequirementInputCard } from "./RequirementInputCard";
import { TaskResultPanel } from "./TaskResultPanel";
import { reconcileResolvedAnchorRanges } from "./anchorReconcile";
import {
  TASK_SPLIT_CLOSE_ANIMATION_MS,
  usePrdTaskSplitPanelController,
} from "./usePrdTaskSplitPanelController";

export interface PrdTaskSplitPanelProps {
  onClose: () => void;
  projects: ProjectItem[];
  repositories: Repository[];
  activeProjectId: string | null;
  activeRepositoryId: number | null;
  employees: EmployeeItem[];
  workflowTemplates: WorkflowTemplateItem[];
  /** 与侧栏仓库一致：打开全局「员工」配置（新建后自动关联当前项目）。 */
  onOpenEmployeeConfigForProject?: () => void;
  /** 与侧栏仓库一致：打开全局「团队」配置（保存模板后自动关联当前项目）。 */
  onOpenWorkflowConfigForProject?: () => void;
}

export function PrdTaskSplitPanel({
  onClose,
  projects,
  repositories,
  activeProjectId,
  activeRepositoryId,
  employees,
  workflowTemplates,
  onOpenEmployeeConfigForProject,
  onOpenWorkflowConfigForProject,
}: PrdTaskSplitPanelProps) {
  const {
    activeRequirement,
    activeRequirementId,
    activeResult,
    anchorRangePersistTimerRef,
    canGenerateExecutableTasks,
    cardUnmetPointsForTask,
    closingToTaskListMotion,
    confirmSavingTaskId,
    displayExecutionStatus,
    filteredTasks,
    focusTaskWithFilterSync,
    generatingExecutableTaskId,
    getDraftedTask,
    getTaskAiInput,
    getTaskAiMode,
    handleAddTask,
    handleCheckTaskExecutable,
    handleClearAllTasks,
    handleConfirmAllTasks,
    handleConfirmRequirementNameModal,
    handleConfirmTaskAdjustment,
    handleDeleteActiveRequirement,
    handleDeleteTask,
    handleGenerateExecutableForSplitTask,
    handleGenerateExecutableTasks,
    handleOpenSplitPromptAdjustModal,
    handleOptimizeRuntimePromptDraft,
    handleOptimizeSplitPromptDraft,
    handleOptimizeTaskContent,
    handlePasteImage,
    handlePinActiveRequirement,
    handleResetRuntimePromptToDefault,
    handleRetrySplitStage,
    handleSaveOptimizedTaskContent,
    handleSaveRuntimePromptDraft,
    handleSaveSplitPromptAdjustDrafts,
    handleSaveTaskDraft,
    handleSplitSelection,
    handleStartSplitFromAdjustModal,
    handleUserPersistPrdDraft,
    hasConfirmedTasks,
    hasInput,
    hasUnconfirmedTasks,
    inputError,
    inputValue,
    latestAnchorRangePersistResultRef,
    linkedProject,
    linkedRepository,
    linkedRepositoryId,
    mappingFallbackStats,
    message,
    milkdownEditorRef,
    milkdownTaskAnchors,
    parsing,
    pendingTaskApiSpecById,
    pendingTaskContentById,
    pickRequirementIdForTask,
    promptActionItems,
    requirementEditorShellRef,
    requirementHistoryById,
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
    setSplitPromptAdjustDraftBySlot,
    setSplitPromptAdjustModalOpen,
    setSplitRuntimeVisible,
    setSplitWizardStep,
    setTaskAiInputById,
    setTaskAiOptimizedContentById,
    setTaskAiPopoverMode,
    setTaskAiPopoverTaskId,
    setTaskAnchorPopoverTaskId,
    setTaskCheckCollapsedById,
    setTaskConfirmFilter,
    setTaskRoleFilter,
    setTaskUnmetCollapsedById,
    showRoleFilterTabs,
    showUrlAnchorHint,
    sortedRequirementHistory,
    splitError,
    splitPromptAdjustDraftBySlot,
    splitPromptAdjustLoading,
    splitPromptAdjustModalOpen,
    splitPromptAdjustSaving,
    splitPromptAdjustStarting,
    splitPromptOptimizingSlot,
    splitQualityStats,
    splitRuntimeListRef,
    splitRuntimeLogs,
    splitRuntimeRef,
    splitRuntimeVisible,
    splitWizardStep,
    switchToRequirement,
    panelRootRef,
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
    taskRoleFilter,
    taskRoleFilterOptions,
    taskSplitHostRef,
    taskUnmetCollapsedById,
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

  return (
    <Suspense
      fallback={
        <div className="app-file-editor-loading">
          <Spin size="small" />
        </div>
      }
    >
      <Layout.Content
        ref={(node) => {
          panelRootRef.current = node;
        }}
        className={[
          "app-prd-task-panel",
          closingToTaskListMotion?.active ? "app-prd-task-panel--closing-to-task-list" : "",
        ].join(" ").trim()}
        style={closingToTaskListMotion
          ? {
            transform: closingToTaskListMotion.active
              ? `translate3d(${closingToTaskListMotion.dx}px, ${closingToTaskListMotion.dy}px, 0) scale(${closingToTaskListMotion.scale})`
              : "translate3d(0, 0, 0) scale(1)",
            opacity: closingToTaskListMotion.active ? 0.14 : 1,
            transition: `transform ${TASK_SPLIT_CLOSE_ANIMATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${TASK_SPLIT_CLOSE_ANIMATION_MS}ms ease`,
            transformOrigin: "center center",
            pointerEvents: "none",
            willChange: "transform, opacity",
          }
          : undefined}
      >
      <SplitPromptWizardModal
        open={splitPromptAdjustModalOpen}
        step={splitWizardStep}
        parsing={parsing}
        starting={splitPromptAdjustStarting}
        saving={splitPromptAdjustSaving}
        optimizingSlot={splitPromptOptimizingSlot}
        loading={splitPromptAdjustLoading}
        draftBySlot={splitPromptAdjustDraftBySlot}
        runtimeLogs={splitRuntimeLogs}
        runtimeListRef={splitRuntimeListRef}
        retryingPhase={retryingPhase}
        onStepChange={setSplitWizardStep}
        onClose={() => {
          setSplitPromptAdjustModalOpen(false);
          setSplitWizardStep("prompts");
          setSplitRuntimeVisible(false);
        }}
        onDraftChange={(slot, markdown) => {
          setSplitPromptAdjustDraftBySlot((prev) => ({ ...prev, [slot]: markdown }));
        }}
        onSavePrompts={() => void handleSaveSplitPromptAdjustDrafts()}
        onStartSplit={() => void handleStartSplitFromAdjustModal()}
        onOptimize={(slot) => void handleOptimizeSplitPromptDraft(slot)}
        onRetryStage={(phase) => { void handleRetrySplitStage(phase); }}
      />
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
      <Space direction="vertical" size={4} className="app-prd-task-panel__stack">
        <ProjectScopeHeader
          projects={projects}
          repositories={repositories}
          employees={employees}
          workflowTemplates={workflowTemplates}
          activeProjectId={activeProjectId}
          linkedProject={linkedProject}
          linkedRepositoryId={linkedRepositoryId}
          linkedRepository={linkedRepository}
          closingActive={Boolean(closingToTaskListMotion?.active)}
          onClose={onClose}
          onOpenEmployeeConfigForProject={onOpenEmployeeConfigForProject}
          onOpenWorkflowConfigForProject={onOpenWorkflowConfigForProject}
        />

        <Row gutter={12} className="app-prd-task-panel__columns">
          <Col span={12} className="app-prd-task-panel__col">
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
              editorRef={milkdownEditorRef}
              editorShellRef={requirementEditorShellRef}
              taskAnchors={milkdownTaskAnchors}
              selectedAnchorTaskId={selectedAnchorTaskId}
              filteredTaskCount={filteredTasks.length}
              splitRuntimeVisible={splitRuntimeVisible}
              splitRuntimeRef={splitRuntimeRef}
              splitRuntimeListRef={splitRuntimeListRef}
              splitRuntimeLogs={splitRuntimeLogs}
              retryingPhase={retryingPhase}
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
              onCloseRuntimePanel={() => setSplitRuntimeVisible(false)}
              onRetryStage={(phase) => { void handleRetrySplitStage(phase); }}
              onSaveDraft={() => void handleUserPersistPrdDraft()}
              onStartSplit={() => void handleOpenSplitPromptAdjustModal()}
            />
          </Col>
          <Col span={12} className="app-prd-task-panel__col">
            <TaskResultPanel
              splitError={splitError}
              mappingFallbackStats={mappingFallbackStats}
              splitQualityStats={splitQualityStats}
              taskHostRef={taskSplitHostRef}
              filteredTasks={filteredTasks}
              unmetTaskIds={unmetTaskIds}
              unmetMenuItems={unmetPreconditionsMenuItems}
              confirmSavingTaskId={confirmSavingTaskId}
              activeResult={activeResult}
              taskConfirmFilter={taskConfirmFilter}
              taskConfirmCounts={taskConfirmCounts}
              taskRoleFilter={taskRoleFilter}
              taskRoleFilterOptions={taskRoleFilterOptions}
              showRoleFilterTabs={showRoleFilterTabs}
              canGenerateExecutableTasks={canGenerateExecutableTasks}
              hasConfirmedTasks={hasConfirmedTasks}
              hasUnconfirmedTasks={hasUnconfirmedTasks}
              closingMotionActive={Boolean(closingToTaskListMotion)}
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
              onConfirmAll={() => void handleConfirmAllTasks()}
              onAddTask={() => void handleAddTask()}
              onClearAllTasks={() => handleClearAllTasks()}
              onTaskConfirmFilterChange={setTaskConfirmFilter}
              onTaskRoleFilterChange={setTaskRoleFilter}
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
              onGenerateExecutableTasks={() => void handleGenerateExecutableTasks()}
            />
          </Col>
        </Row>
      </Space>
      </Layout.Content>
    </Suspense>
  );
}
