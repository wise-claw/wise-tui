import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { App as AntdApp } from "antd";
import type { AddRepositoryOptions, ProjectItem, Repository, RepositoryAssociatePreset } from "../../types";
import type { RepositoryAcquireMode, RepositoryAcquireParams } from "../../utils/repositoryAcquire";
import { DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION } from "../../constants/workspaceBootstrapAddons";
import {
  REPOSITORY_ASSOCIATE_PRESETS_MAX,
  REPOSITORY_ASSOCIATE_PRESETS_STORAGE_KEY,
} from "../../constants/repositoryAssociatePresets";
import {
  customPresetOptionValue,
  formatRepositoryAssociatePresetLabel,
  isCustomPresetSelectValue,
  newRepositoryAssociatePresetId,
  normalizeRepositoryAssociatePresets,
  presetFingerprint,
} from "../../utils/repositoryAssociatePresets";
import { getAppSettingJson, setAppSettingJson } from "../../services/appSettingsStore";
import {
  repositoryTypeSolidBadgeColor,
  resolveRepositoryIconColor,
} from "../../utils/repositoryType";
import { pickFolder, resolveRepositoryAcquirePath } from "../../services/repository";
import {
  deriveFolderNameFromGitUrl,
  validateRepositoryAcquireParams,
} from "../../utils/repositoryAcquire";
import { buildAddRepositoryOptions } from "./RepositoryAssociateModal";

interface UseRepositoryAssociateModalControllerInput {
  projects?: ProjectItem[];
  onAddRepositoryToProject?: (
    projectId: string,
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
    acquire?: RepositoryAcquireParams,
    explicitFolderPath?: string,
  ) => void;
  onAddFloatingRepository?: (
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
    acquire?: RepositoryAcquireParams,
    explicitFolderPath?: string,
  ) => void;
}

interface SelectOptionGroup {
  label: string;
  options: { value: string; title?: string; label: ReactNode }[];
}

export function useRepositoryAssociateModalController({
  projects = [],
  onAddRepositoryToProject,
  onAddFloatingRepository,
}: UseRepositoryAssociateModalControllerInput) {
  const { message } = AntdApp.useApp();
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [floatingMode, setFloatingMode] = useState(false);
  const [repositoryType, setRepositoryType] = useState<Repository["repositoryType"]>("frontend");
  const [workspaceBootstrapSelection, setWorkspaceBootstrapSelection] = useState(
    () => ({ ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION }),
  );
  const [iconDisplayName, setIconDisplayName] = useState("");
  const [iconColor, setIconColor] = useState<string | null>(null);
  const [presets, setPresets] = useState<RepositoryAssociatePreset[]>([]);
  const [associateSelectValue, setAssociateSelectValue] = useState<string>("frontend");
  const [acquireMode, setAcquireMode] = useState<RepositoryAcquireMode>("pick_existing");
  const [parentPath, setParentPath] = useState("");
  const [folderName, setFolderName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const pendingProject = useMemo(
    () => (pendingProjectId ? projects.find((p) => p.id === pendingProjectId) ?? null : null),
    [pendingProjectId, projects],
  );

  const defaultParentPath = pendingProject?.rootPath?.trim() ?? "";

  const resetDraft = useCallback(() => {
    setAssociateSelectValue("frontend");
    setRepositoryType("frontend");
    setWorkspaceBootstrapSelection({ ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION });
    setIconDisplayName("");
    setIconColor(null);
    setAcquireMode("pick_existing");
    setParentPath("");
    setFolderName("");
    setGitUrl("");
  }, []);

  const refreshPresets = useCallback(async () => {
    const raw = await getAppSettingJson<unknown>(REPOSITORY_ASSOCIATE_PRESETS_STORAGE_KEY);
    setPresets(normalizeRepositoryAssociatePresets(raw));
  }, []);

  useEffect(() => {
    void refreshPresets();
  }, [refreshPresets]);

  const selectOptions = useMemo<SelectOptionGroup[]>(() => {
    const builtinOptions = (["frontend", "backend", "document"] as const).map((type) => {
      const title = type === "frontend" ? "前端" : type === "backend" ? "后端" : "文档（PRD…）";
      return {
        value: type,
        title,
        label: (
          <span className="app-add-repo-option-row">
            <span
              className="app-add-repo-option-swatch"
              style={{ background: repositoryTypeSolidBadgeColor(type) }}
              aria-hidden
            />
            <span>{title}</span>
          </span>
        ),
      };
    });
    const groups: SelectOptionGroup[] = [{ label: "预设角色", options: builtinOptions }];
    if (presets.length > 0) {
      groups.push({
        label: "常用配置",
        options: presets.map((preset) => {
          const title = formatRepositoryAssociatePresetLabel(preset);
          return {
            value: customPresetOptionValue(preset.id),
            title,
            label: (
              <span className="app-add-repo-option-row">
                <span
                  className="app-add-repo-option-swatch"
                  style={{ background: resolveRepositoryIconColor(preset.repositoryType, preset.iconColor) }}
                  aria-hidden
                />
                <span>{title}</span>
              </span>
            ),
          };
        }),
      });
    }
    return groups;
  }, [presets]);

  const resolvePresetSelectValue = useCallback(
    (value: string) => {
      if (!isCustomPresetSelectValue(value)) return null;
      const id = value.slice("custom:".length);
      return presets.find((preset) => preset.id === id) ?? null;
    },
    [presets],
  );

  const openAddRepositoryModal = useCallback(
    (projectId: string) => {
      setPendingProjectId(projectId);
      setFloatingMode(false);
      resetDraft();
      const project = projects.find((p) => p.id === projectId);
      if (project?.rootPath?.trim()) {
        setParentPath(project.rootPath.trim());
      }
      void refreshPresets();
    },
    [projects, refreshPresets, resetDraft],
  );

  const openAddFloatingRepositoryModal = useCallback(() => {
    setPendingProjectId(null);
    setFloatingMode(true);
    resetDraft();
    void refreshPresets();
  }, [refreshPresets, resetDraft]);

  const close = useCallback(() => {
    setPendingProjectId(null);
    setFloatingMode(false);
    setSubmitting(false);
  }, []);

  const pickParentPath = useCallback(async () => {
    const picked = await pickFolder();
    if (picked) setParentPath(picked);
  }, []);

  const addPreset = useCallback(async () => {
    const name = iconDisplayName.trim();
    if (!name && iconColor === null) {
      message.warning("请先填写角标文案或选择角标颜色");
      return;
    }
    const candidate: RepositoryAssociatePreset = {
      id: newRepositoryAssociatePresetId(),
      repositoryType,
      iconDisplayName: name,
      iconColor,
      createdAt: Date.now(),
    };
    const fingerprint = presetFingerprint(candidate);
    if (presets.some((preset) => presetFingerprint(preset) === fingerprint)) {
      message.warning("已有相同的常用配置");
      return;
    }
    let next = [...presets, candidate].sort((a, b) => b.createdAt - a.createdAt);
    if (next.length > REPOSITORY_ASSOCIATE_PRESETS_MAX) {
      next = next.slice(0, REPOSITORY_ASSOCIATE_PRESETS_MAX);
    }
    try {
      await setAppSettingJson(REPOSITORY_ASSOCIATE_PRESETS_STORAGE_KEY, next);
      setPresets(next);
      setAssociateSelectValue(customPresetOptionValue(candidate.id));
      message.success("已加入常用选项");
    } catch (err) {
      console.error(err);
      message.error("保存常用配置失败");
    }
  }, [iconColor, iconDisplayName, message, presets, repositoryType]);

  const buildAcquireParams = useCallback((): RepositoryAcquireParams => {
    if (acquireMode === "pick_existing") {
      return { mode: "pick_existing" };
    }
    if (acquireMode === "create_empty") {
      return {
        mode: "create_empty",
        parentPath: parentPath.trim(),
        folderName: folderName.trim(),
      };
    }
    return {
      mode: "git_clone",
      parentPath: parentPath.trim(),
      gitUrl: gitUrl.trim(),
      folderName: folderName.trim() || deriveFolderNameFromGitUrl(gitUrl),
    };
  }, [acquireMode, folderName, gitUrl, parentPath]);

  const submit = useCallback(async () => {
    if (!pendingProjectId && !floatingMode) return;
    if (isCustomPresetSelectValue(associateSelectValue)) {
      const presetId = associateSelectValue.slice("custom:".length);
      if (!presets.some((preset) => preset.id === presetId)) {
        message.warning("所选常用配置已不存在，请重新选择");
        return;
      }
    }
    const options = buildAddRepositoryOptions({
      iconDisplayName,
      iconColor,
      bootstrap: workspaceBootstrapSelection,
    });
    const acquire = buildAcquireParams();
    const validationError = validateRepositoryAcquireParams(acquire);
    if (validationError) {
      message.warning(validationError);
      return;
    }

    const dispatch = (explicitFolderPath?: string) => {
      if (floatingMode) {
        if (!onAddFloatingRepository) {
          message.warning("当前环境未启用「添加单仓」入口");
          return;
        }
        void onAddFloatingRepository(repositoryType, options, acquire, explicitFolderPath);
        return;
      }
      if (!pendingProjectId) return;
      if (!onAddRepositoryToProject) {
        message.warning("当前环境未启用「加入工作区」");
        close();
        return;
      }
      void onAddRepositoryToProject(
        pendingProjectId,
        repositoryType,
        options,
        acquire,
        explicitFolderPath,
      );
    };

    if (acquire.mode === "pick_existing") {
      setPendingProjectId(null);
      setFloatingMode(false);
      dispatch();
      return;
    }

    setSubmitting(true);
    try {
      const resolved = await resolveRepositoryAcquirePath(acquire, {
        defaultParentPath: defaultParentPath || undefined,
      });
      if (!resolved.ok) {
        if (resolved.error) message.error(resolved.error);
        return;
      }
      setPendingProjectId(null);
      setFloatingMode(false);
      dispatch(resolved.path);
    } finally {
      setSubmitting(false);
    }
  }, [
    associateSelectValue,
    buildAcquireParams,
    close,
    defaultParentPath,
    floatingMode,
    iconColor,
    iconDisplayName,
    message,
    onAddFloatingRepository,
    onAddRepositoryToProject,
    pendingProjectId,
    presets,
    repositoryType,
    workspaceBootstrapSelection,
  ]);

  const open = Boolean(pendingProjectId) || floatingMode;

  const submitOkText =
    acquireMode === "pick_existing"
      ? "继续选择仓库目录"
      : acquireMode === "create_empty"
        ? "创建并关联"
        : "克隆并关联";

  return {
    open,
    floatingMode,
    submitting,
    acquireMode,
    setAcquireMode,
    parentPath,
    setParentPath,
    folderName,
    setFolderName,
    gitUrl,
    setGitUrl,
    defaultParentPath,
    pickParentPath,
    submitOkText,
    associateSelectValue,
    setAssociateSelectValue,
    repositoryType,
    setRepositoryType,
    workspaceBootstrapSelection,
    setWorkspaceBootstrapSelection,
    iconDisplayName,
    setIconDisplayName,
    iconColor,
    setIconColor,
    presets,
    selectOptions,
    resolvePresetSelectValue,
    openAddRepositoryModal,
    openAddFloatingRepositoryModal,
    close,
    addPreset,
    submit,
  };
}
