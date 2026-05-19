import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { App as AntdApp } from "antd";
import type { AddRepositoryOptions, Repository, RepositoryAssociatePreset, SddMode } from "../../types";
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
import { buildAddRepositoryOptions } from "./RepositoryAssociateModal";

interface UseRepositoryAssociateModalControllerInput {
  onAddRepositoryToProject?: (
    projectId: string,
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
  ) => void;
  onAddFloatingRepository?: (
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
  ) => void;
}

interface SelectOptionGroup {
  label: string;
  options: { value: string; title?: string; label: ReactNode }[];
}

export function useRepositoryAssociateModalController({
  onAddRepositoryToProject,
  onAddFloatingRepository,
}: UseRepositoryAssociateModalControllerInput) {
  const { message } = AntdApp.useApp();
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [floatingMode, setFloatingMode] = useState(false);
  const [repositoryType, setRepositoryType] = useState<Repository["repositoryType"]>("frontend");
  const [sddMode, setSddMode] = useState<SddMode>("auto");
  const [iconDisplayName, setIconDisplayName] = useState("");
  const [iconColor, setIconColor] = useState<string | null>(null);
  const [presets, setPresets] = useState<RepositoryAssociatePreset[]>([]);
  const [associateSelectValue, setAssociateSelectValue] = useState<string>("frontend");

  const resetDraft = useCallback(() => {
    setAssociateSelectValue("frontend");
    setRepositoryType("frontend");
    setSddMode("auto");
    setIconDisplayName("");
    setIconColor(null);
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
      void refreshPresets();
    },
    [refreshPresets, resetDraft],
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

  const submit = useCallback(() => {
    if (!pendingProjectId && !floatingMode) return;
    if (isCustomPresetSelectValue(associateSelectValue)) {
      const presetId = associateSelectValue.slice("custom:".length);
      if (!presets.some((preset) => preset.id === presetId)) {
        message.warning("所选常用配置已不存在，请重新选择");
        return;
      }
    }
    const options = buildAddRepositoryOptions({ iconDisplayName, iconColor, sddMode });
    if (floatingMode) {
      if (!onAddFloatingRepository) {
        message.warning("当前环境未启用「添加单仓」入口");
        return;
      }
      setFloatingMode(false);
      void onAddFloatingRepository(repositoryType, options);
      return;
    }
    if (!pendingProjectId) return;
    if (!onAddRepositoryToProject) {
      message.warning("当前环境未启用「加入工作区」");
      close();
      return;
    }
    setPendingProjectId(null);
    void onAddRepositoryToProject(pendingProjectId, repositoryType, options);
  }, [
    associateSelectValue,
    floatingMode,
    iconColor,
    iconDisplayName,
    message,
    onAddFloatingRepository,
    onAddRepositoryToProject,
    pendingProjectId,
    presets,
    repositoryType,
    sddMode,
  ]);

  return {
    open: Boolean(pendingProjectId) || floatingMode,
    floatingMode,
    associateSelectValue,
    setAssociateSelectValue,
    repositoryType,
    setRepositoryType,
    sddMode,
    setSddMode,
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
