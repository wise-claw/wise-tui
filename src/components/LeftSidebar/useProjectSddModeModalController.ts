import { App as AntdApp } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { ProjectItem, ProjectSddMode, Repository } from "../../types";
import {
  resolveProjectSddModeForStack,
  sddStackModeFromProjectSddMode,
  sddStackModeToBootstrap,
  type SddStackMode,
} from "../../constants/sddStackMode";
import { dispatchTrellisBootstrapComplete } from "../../constants/trellisUiEvents";
import { workspaceBootstrapNeedsTrellisInit } from "../../constants/workspaceBootstrapAddons";
import { detectSddSignals, type SddSignals } from "../../services/trellis/sddModeDetector";
import { runWorkspaceBootstrap } from "../../services/workspaceBootstrap";
import { resolveTrellisBootstrapPath } from "../../utils/trellisBootstrapPath";

interface UseProjectSddModeModalControllerInput {
  projects: ProjectItem[];
  repositories: Repository[];
  onUpdateProjectSddMode?: (projectId: string, sddMode: ProjectSddMode) => void | Promise<void>;
}

const EMPTY_SDD_SIGNALS: SddSignals = {
  hasTrellisTasks: false,
  hasTrellisSpec: false,
  hasOpenSpec: false,
  hasGenericSpec: false,
};

export function useProjectSddModeModalController({
  projects,
  repositories,
  onUpdateProjectSddMode,
}: UseProjectSddModeModalControllerInput) {
  const { message } = AntdApp.useApp();
  const [project, setProject] = useState<ProjectItem | null>(null);
  const [bootstrapPath, setBootstrapPath] = useState<string | null>(null);
  const [value, setValue] = useState<SddStackMode>("wise_trellis");
  const [saving, setSaving] = useState(false);
  const [signals, setSignals] = useState<SddSignals | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!bootstrapPath) {
      setSignals(null);
      return;
    }
    setSignals(null);
    void detectSddSignals(bootstrapPath).then(
      (nextSignals) => {
        if (!cancelled) setSignals(nextSignals);
      },
      () => {
        if (!cancelled) setSignals(EMPTY_SDD_SIGNALS);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bootstrapPath]);

  const open = useCallback(
    (nextProject: ProjectItem) => {
      const path = resolveTrellisBootstrapPath({
        scope: "project",
        project: nextProject,
        repositories,
        projects,
      });
      if (!path) {
        message.warning("无法解析工作区目录，请先配置工作区根目录或关联仓库");
        return;
      }
      setProject(nextProject);
      setBootstrapPath(path);
      setValue(sddStackModeFromProjectSddMode(nextProject.sddMode));
    },
    [message, projects, repositories],
  );

  const cancel = useCallback(() => {
    setProject(null);
    setBootstrapPath(null);
  }, []);

  const submit = useCallback(async () => {
    if (!project || !bootstrapPath || !onUpdateProjectSddMode) {
      setProject(null);
      setBootstrapPath(null);
      return;
    }
    setSaving(true);
    try {
      const bootstrap = sddStackModeToBootstrap(value);
      const projectSddMode = resolveProjectSddModeForStack(value, signals ?? EMPTY_SDD_SIGNALS);
      if (bootstrap.trellis || bootstrap.trellisInit || bootstrap.omc) {
        await runWorkspaceBootstrap(bootstrapPath, bootstrap);
      }
      await onUpdateProjectSddMode(project.id, projectSddMode);
      if (workspaceBootstrapNeedsTrellisInit(bootstrap)) {
        dispatchTrellisBootstrapComplete({ projectId: project.id });
      }
      message.success("工作区 SDD 模式已保存");
      setProject(null);
      setBootstrapPath(null);
    } catch (err) {
      console.error(err);
      message.error(err instanceof Error ? err.message : "保存工作区 SDD 模式失败");
    } finally {
      setSaving(false);
    }
  }, [bootstrapPath, message, onUpdateProjectSddMode, project, signals, value]);

  return {
    project,
    value,
    signals,
    saving,
    canSave: Boolean(onUpdateProjectSddMode && bootstrapPath),
    open,
    setValue,
    cancel,
    submit,
  };
}
