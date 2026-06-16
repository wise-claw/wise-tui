import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Divider, Input, Modal, Select, Space, Typography } from "antd";
import { HoverHint } from "../shared/HoverHint";
import type { Repository, RepositoryAssociatePreset } from "../../types";
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
import type { RepositoryIconBadgePatch } from "../../services/repository";
import { repositoryFolderBasename, REPOSITORY_ICON_COLOR_PRESETS, repositoryTypeSolidBadgeColor, resolveRepositoryIconColor } from "../../utils/repositoryType";

interface RepositoryIconBadgeModalProps {
  repository: Repository | null;
  saving: boolean;
  canSave: boolean;
  onCancel: () => void;
  onSubmit: (patch: RepositoryIconBadgePatch) => void;
}

interface SelectOptionGroup {
  label: string;
  options: { value: string; title?: string; label: ReactNode }[];
}

export function RepositoryIconBadgeModal({
  repository,
  saving,
  canSave,
  onCancel,
  onSubmit,
}: RepositoryIconBadgeModalProps) {
  const [repositoryType, setRepositoryType] = useState<Repository["repositoryType"]>("frontend");
  const [associateSelectValue, setAssociateSelectValue] = useState<string>("frontend");
  const [iconDisplayName, setIconDisplayName] = useState("");
  const [iconColor, setIconColor] = useState<string | null>(null);
  const [presets, setPresets] = useState<RepositoryAssociatePreset[]>([]);

  useEffect(() => {
    if (!repository) return;
    setRepositoryType(repository.repositoryType);
    setAssociateSelectValue(repository.repositoryType);
    setIconDisplayName(repository.iconDisplayName?.trim() ?? "");
    setIconColor(repository.iconColor ?? null);
    void getAppSettingJson<unknown>(REPOSITORY_ASSOCIATE_PRESETS_STORAGE_KEY).then((raw) => {
      setPresets(normalizeRepositoryAssociatePresets(raw));
    });
  }, [repository]);

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

  const addPreset = useCallback(async () => {
    const name = iconDisplayName.trim();
    if (!name && iconColor === null) return;
    const candidate: RepositoryAssociatePreset = {
      id: newRepositoryAssociatePresetId(),
      repositoryType,
      iconDisplayName: name,
      iconColor,
      createdAt: Date.now(),
    };
    const fingerprint = presetFingerprint(candidate);
    if (presets.some((preset) => presetFingerprint(preset) === fingerprint)) return;
    let next = [...presets, candidate].sort((a, b) => b.createdAt - a.createdAt);
    if (next.length > REPOSITORY_ASSOCIATE_PRESETS_MAX) {
      next = next.slice(0, REPOSITORY_ASSOCIATE_PRESETS_MAX);
    }
    await setAppSettingJson(REPOSITORY_ASSOCIATE_PRESETS_STORAGE_KEY, next);
    setPresets(next);
    setAssociateSelectValue(customPresetOptionValue(candidate.id));
  }, [iconColor, iconDisplayName, presets, repositoryType]);

  const handleSubmit = () => {
    if (!repository) return;
    const iconText = iconDisplayName.trim();
    onSubmit({
      repositoryType,
      iconDisplayName: iconText.length > 0 ? iconText : null,
      iconColor,
    });
  };

  return (
    <Modal
      title="配置角标"
      open={Boolean(repository)}
      onCancel={onCancel}
      onOk={handleSubmit}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: !canSave }}
      width={440}
      destroyOnHidden
    >
      {repository ? (
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            仓库：{repositoryFolderBasename(repository)}
          </Typography.Text>
          <div>
            <div className="app-add-repo-field-label">角标与自定义角色标签</div>
            <Select
              className="app-add-repository-badge-select"
              size="small"
              classNames={{ popup: { root: "app-add-repo-select-dropdown" } }}
              popupMatchSelectWidth
              optionLabelProp="title"
              value={associateSelectValue}
              onChange={(value) => {
                const nextValue = String(value);
                if (nextValue === "frontend" || nextValue === "backend" || nextValue === "document") {
                  setAssociateSelectValue(nextValue);
                  setRepositoryType(nextValue);
                  setIconDisplayName("");
                  setIconColor(null);
                  return;
                }
                const preset = resolvePresetSelectValue(nextValue);
                if (!preset) return;
                setAssociateSelectValue(nextValue);
                setRepositoryType(preset.repositoryType);
                setIconDisplayName(preset.iconDisplayName);
                setIconColor(preset.iconColor ?? null);
              }}
              options={selectOptions}
              popupRender={(menu) => (
                <div className="app-add-repo-select-popup">
                  {menu}
                  <div className="app-add-repo-select-popup-extra" onMouseDown={(event) => event.preventDefault()}>
                    <Divider className="app-add-repo-select-popup-divider" />
                    <div className="app-add-repo-field-label">角标颜色</div>
                    <div className="app-add-repo-icon-swatches">
                      <HoverHint title="与该角色标签的默认角标色一致">
                        <button
                          type="button"
                          className={`app-add-repo-icon-swatch app-add-repo-icon-swatch--follow${iconColor === null ? " app-add-repo-icon-swatch--selected" : ""}`}
                          aria-label="角标颜色与角色标签默认色一致"
                          onClick={() => setIconColor(null)}
                        />
                      </HoverHint>
                      {REPOSITORY_ICON_COLOR_PRESETS.map((hex) => (
                        <HoverHint key={hex} title={hex}>
                          <button
                            type="button"
                            className={`app-add-repo-icon-swatch${iconColor === hex ? " app-add-repo-icon-swatch--selected" : ""}`}
                            aria-label={`角标颜色 ${hex}`}
                            style={{ backgroundColor: hex }}
                            onClick={() => setIconColor(hex)}
                          />
                        </HoverHint>
                      ))}
                    </div>
                    <div className="app-add-repo-field-label app-add-repo-field-label--spaced">角标标题</div>
                    <Input
                      size="small"
                      value={iconDisplayName}
                      onChange={(event) => setIconDisplayName(event.target.value)}
                      placeholder="留空则角标内仅显示角色默认文案（前/后/文）"
                      allowClear
                    />
                    <Button
                      type="default"
                      size="small"
                      block
                      className="app-add-repo-preset-add-btn"
                      onClick={() => void addPreset()}
                    >
                      将当前配置加入常用选项
                    </Button>
                  </div>
                </div>
              )}
              style={{ width: "100%" }}
            />
          </div>
        </Space>
      ) : null}
    </Modal>
  );
}
