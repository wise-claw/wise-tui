import { Alert, App as AntdApp, Button, Modal } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClaudeSession, ProjectItem, Repository } from "../../types";
import {
  WORKFLOW_UI_EVENT_OPEN_WORKFLOW_CONFIG,
} from "../../constants/workflowUiEvents";
import { projectToPrdSplitTarget, repositoryToPrdSplitTarget } from "../PrdSplitWizard/targetModel";
import { useSplitWizardState } from "../PrdSplitWizard/useSplitWizardState";
import { MissionHeader } from "./header/MissionHeader";
import { MissionCanvas } from "./canvas/MissionCanvas";
import { TaskDetailDrawer } from "./details/TaskDetailDrawer";
import { EngineeringDrawer } from "./engineering/EngineeringDrawer";
import { PrdAnchorDrawer } from "./details/PrdAnchorDrawer";
import { LegacyRunsModal } from "./setup/LegacyRunsModal";
import { useMissionPresenter } from "./useMissionPresenter";
import { runMissionClusters, writeMissionToTrellis } from "./actions/runMissionActions";
import { useSplitterStream } from "./actions/splitterStreamListener";
import type { MissionPrimaryCta } from "./presenter/types";
import "./index.css";

export interface MissionControlInitialTarget {
  projectId?: string | null;
  repositoryId?: number | null;
}

export interface MissionControlProps {
  projects: ProjectItem[];
  repositories: Repository[];
  sessions?: ClaudeSession[];
  initialTarget?: MissionControlInitialTarget | null;
  onClose: () => void;
}

export function MissionControl({
  projects,
  repositories,
  sessions = [],
  initialTarget,
  onClose,
}: MissionControlProps) {
  const api = useSplitWizardState();
  const { message } = AntdApp.useApp();
  const { viewModel, setSelection } = useMissionPresenter({ api, projects, repositories });
  const { stdout } = useSplitterStream();
  const [engineeringOpen, setEngineeringOpen] = useState(false);
  const [prdAnchorOpen, setPrdAnchorOpen] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [legacyImportOpen, setLegacyImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const appliedInitialKeyRef = useRef<string | null>(null);

  const initialKey = useMemo(
    () => `${initialTarget?.projectId ?? ""}:${initialTarget?.repositoryId ?? ""}`,
    [initialTarget?.projectId, initialTarget?.repositoryId],
  );

  // Auto-initialize wizard state from initialTarget — no setup drawer needed.
  useEffect(() => {
    const projectId = initialTarget?.projectId ?? null;
    const repositoryId = initialTarget?.repositoryId ?? null;
    if (!projectId && repositoryId == null) {
      appliedInitialKeyRef.current = initialKey;
      return;
    }
    if (appliedInitialKeyRef.current === initialKey) return;
    if (projectId) {
      const project = projects.find((item) => item.id === projectId);
      if (project) {
        const target = projectToPrdSplitTarget(project, repositories);
        api.reset(target.project, target.repositories, target.context);
        appliedInitialKeyRef.current = initialKey;
        return;
      }
    }
    if (repositoryId != null) {
      const repository = repositories.find((item) => item.id === repositoryId);
      if (repository) {
        const target = repositoryToPrdSplitTarget(repository);
        api.reset(target.project, target.repositories, target.context);
        appliedInitialKeyRef.current = initialKey;
      }
    }
  }, [api, initialKey, initialTarget?.projectId, initialTarget?.repositoryId, projects, repositories]);

  useEffect(() => {
    if (api.state.stage === "plan" && api.state.existingParents === null) {
      void api.refreshExistingParents();
    }
  }, [api, api.state.existingParents, api.state.stage]);

  const handlePrimaryCta = useCallback(
    async (cta: MissionPrimaryCta) => {
      if (cta.kind === "open-setup" || cta.kind === "parse-prd") {
        // Inline editor handles PRD submission — CTA button hidden in drafting phase.
        const result = api.parseAndPlan();
        if (!result.ok) {
          api.setGlobalError(result.reason);
        }
        return;
      }
      if (cta.kind === "generate-tasks") {
        api.goToDispatch();
        setBusy(true);
        try {
          await runMissionClusters(api);
        } finally {
          setBusy(false);
        }
        return;
      }
      if (cta.kind === "write-trellis") {
        setBusy(true);
        try {
          await writeMissionToTrellis(api);
        } finally {
          setBusy(false);
        }
        return;
      }
      if (cta.kind === "open-workflow") {
        if (!cta.workflowId) {
          message.warning("尚未生成执行编排");
          return;
        }
        window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_OPEN_WORKFLOW_CONFIG, {
          detail: {
            workflowId: cta.workflowId,
            projectId: api.state.context?.mode === "project" ? api.state.project?.id : undefined,
          },
        }));
      }
    },
    [api, message],
  );

  const handleSelectTask = useCallback((taskId: string) => {
    const task = viewModel.taskSwimlane
      .flatMap((lane) => lane.tasks)
      .find((candidate) => candidate.id === taskId);
    setSelection((current) => ({
      taskId,
      requirementId:
        current.requirementId && task?.sourceRequirementIds.includes(current.requirementId)
          ? current.requirementId
          : task?.sourceRequirementIds[0] ?? null,
    }));
    setDetailDrawerOpen(true);
  }, [setSelection, viewModel.taskSwimlane]);

  const handleCloseTaskDetail = useCallback(() => {
    setDetailDrawerOpen(false);
    setSelection((current) => current.taskId ? { ...current, taskId: null } : current);
  }, [setSelection]);

  const handleRestart = useCallback(() => {
    if (api.state.stage === "input") return;
    Modal.confirm({
      title: "重新编辑 PRD？",
      content: "当前已生成的任务分组和编辑内容将被清除，PRD 原文会保留。",
      okText: "确定",
      cancelText: "取消",
      onOk: () => {
        api.backToInput();
        setSelection({ requirementId: null, taskId: null });
      },
    });
  }, [api]);

  return (
    <div className="mission-control">
      <MissionHeader
        viewModel={viewModel}
        busy={busy}
        onPrimaryCta={handlePrimaryCta}
        onRestart={handleRestart}
        onOpenEngineering={() => setEngineeringOpen(true)}
      />
      <Button
        className="mission-close-btn"
        type="text"
        icon={<CloseOutlined />}
        onClick={onClose}
      />
      {api.state.globalError ? (
        <Alert className="mission-global-error" type="error" showIcon message={api.state.globalError} />
      ) : null}
      <MissionCanvas
        viewModel={viewModel}
        api={api}
        projects={projects}
        repositories={repositories}
        onSelectRequirement={(requirementId) => {
          const firstTask = viewModel.taskSwimlane
            .flatMap((lane) => lane.tasks)
            .find((task) => task.sourceRequirementIds.includes(requirementId));
          setSelection({ requirementId, taskId: firstTask?.id ?? null });
        }}
        onSelectTask={handleSelectTask}
        onOpenLegacyImport={() => setLegacyImportOpen(true)}
      />
      <EngineeringDrawer
        open={engineeringOpen}
        details={viewModel.engineering}
        projectId={api.state.context?.mode === "project" ? api.state.project?.id ?? null : null}
        reuseExistingParents={api.state.reuseExistingParents}
        dispatchOnlyDirty={api.state.dispatchOnlyDirty}
        onReuseExistingParentsChange={api.setReuseExistingParents}
        onDispatchOnlyDirtyChange={api.setDispatchOnlyDirty}
        onRenameTaskGroup={api.renameCluster}
        onClose={() => setEngineeringOpen(false)}
      />
      <PrdAnchorDrawer
        open={prdAnchorOpen}
        evidence={viewModel.selectedTaskEvidence}
        prd={api.state.prd}
        requirementsIndex={api.state.requirementsIndex}
        taskGroups={viewModel.engineering.clusters}
        onClose={() => setPrdAnchorOpen(false)}
        onPatchAnchor={(clusterId, taskId, taskAnchors, isManual) => {
          if (isManual) api.patchManualTask(clusterId, taskId, { taskAnchors });
          else api.patchTaskEdit(clusterId, taskId, { taskAnchors });
        }}
        onClearAnchor={(clusterId, taskId, isManual) => {
          if (isManual) api.patchManualTask(clusterId, taskId, { taskAnchors: undefined });
          else api.clearTaskAnchorEdit(clusterId, taskId);
        }}
      />
      <TaskDetailDrawer
        open={detailDrawerOpen}
        detail={viewModel.selectedTaskDetail}
        sessions={sessions}
        stdoutLines={stdout[viewModel.selectedTaskDetail?.clusterId ?? ""] ?? []}
        repoPath={viewModel.project.rootPath || undefined}
        repoName={viewModel.project.name || undefined}
        onClose={handleCloseTaskDetail}
        onPatchTitle={(clusterId, taskId, title, isManual) => {
          if (isManual) api.patchManualTask(clusterId, taskId, { title });
          else api.patchTaskEdit(clusterId, taskId, { title });
        }}
        onPatchDescription={(clusterId, taskId, description, isManual) => {
          if (isManual) api.patchManualTask(clusterId, taskId, { description });
          else api.patchTaskEdit(clusterId, taskId, { description });
        }}
        onPatchRole={(clusterId, taskId, role, isManual) => {
          if (!role) return;
          if (isManual) api.patchManualTask(clusterId, taskId, { role });
          else api.patchTaskEdit(clusterId, taskId, { role });
        }}
        onPatchTaskList={(clusterId, taskId, field, items, isManual) => {
          if (isManual) api.patchManualTask(clusterId, taskId, { [field]: items });
          else api.patchTaskEdit(clusterId, taskId, { [field]: items });
        }}
        onDeleteTask={(clusterId, taskId) => api.deleteTask(clusterId, taskId)}
        onRestoreTask={(clusterId, taskId) => api.restoreTask(clusterId, taskId)}
        onAddTask={(clusterId, sourceRequirementIds) => {
          const id = `manual-${clusterId}-${Date.now()}`;
          api.addManualTask(clusterId, {
            id,
            title: "新任务",
            description: "请补充任务说明",
            role: "frontend",
            size: "M",
            estimateDays: 2,
            dependencies: [],
            sourceRefs: [],
            sourceRequirementIds,
            subtasks: [],
            dod: [],
            executionStatus: "executable",
            executionStatusManual: true,
            flowStatus: "todo",
          });
          setSelection((current) => ({
            requirementId: sourceRequirementIds[0] ?? current.requirementId,
            taskId: id,
          }));
          return id;
        }}
        onOpenPrdAnchor={() => setPrdAnchorOpen(true)}
      />
      <LegacyRunsModal
        open={legacyImportOpen}
        onClose={() => setLegacyImportOpen(false)}
        onPick={(markdown) => {
          api.setPrdMarkdown(markdown);
          setLegacyImportOpen(false);
          message.success("已导入历史 PRD");
        }}
      />
    </div>
  );
}
