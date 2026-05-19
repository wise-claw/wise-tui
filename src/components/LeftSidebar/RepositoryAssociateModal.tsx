import { Button, Divider, Input, Modal, Select, Space, Tooltip } from "antd";
import type { AddRepositoryOptions, Repository, RepositoryAssociatePreset, SddMode } from "../../types";
import { REPOSITORY_ICON_COLOR_PRESETS } from "../../utils/repositoryType";
import { SddModeSwitch } from "../SddModeSwitch";

interface RepositoryAssociateModalProps {
  open: boolean;
  floatingMode: boolean;
  associateSelectValue: string;
  onAssociateSelectValueChange: (value: string) => void;
  onRepositoryTypeChange: (value: Repository["repositoryType"]) => void;
  sddMode: SddMode;
  onSddModeChange: (value: SddMode) => void;
  iconDisplayName: string;
  onIconDisplayNameChange: (value: string) => void;
  iconColor: string | null;
  onIconColorChange: (value: string | null) => void;
  presets: RepositoryAssociatePreset[];
  selectOptions: Array<{
    label: string;
    options: { value: string; title?: string; label: React.ReactNode }[];
  }>;
  resolvePresetSelectValue: (value: string) => RepositoryAssociatePreset | null;
  onAddPreset: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function RepositoryAssociateModal({
  open,
  floatingMode,
  associateSelectValue,
  onAssociateSelectValueChange,
  onRepositoryTypeChange,
  sddMode,
  onSddModeChange,
  iconDisplayName,
  onIconDisplayNameChange,
  iconColor,
  onIconColorChange,
  selectOptions,
  resolvePresetSelectValue,
  onAddPreset,
  onCancel,
  onSubmit,
}: RepositoryAssociateModalProps) {
  return (
    <Modal
      title={floatingMode ? "添加单仓" : "关联仓库"}
      open={open}
      onCancel={onCancel}
      onOk={onSubmit}
      okText="继续选择仓库目录"
      cancelText="取消"
      width={400}
    >
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
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
                onAssociateSelectValueChange(nextValue);
                onRepositoryTypeChange(nextValue);
                onIconDisplayNameChange("");
                onIconColorChange(null);
                return;
              }
              const preset = resolvePresetSelectValue(nextValue);
              if (!preset) return;
              onAssociateSelectValueChange(nextValue);
              onRepositoryTypeChange(preset.repositoryType);
              onIconDisplayNameChange(preset.iconDisplayName);
              onIconColorChange(preset.iconColor ?? null);
            }}
            options={selectOptions}
            popupRender={(menu) => (
              <div className="app-add-repo-select-popup">
                {menu}
                <div className="app-add-repo-select-popup-extra" onMouseDown={(event) => event.preventDefault()}>
                  <Divider className="app-add-repo-select-popup-divider" />
                  <div className="app-add-repo-field-label">角标颜色</div>
                  <div className="app-add-repo-icon-swatches">
                    <Tooltip title="与该角色标签的默认角标色一致" mouseEnterDelay={0.25}>
                      <button
                        type="button"
                        className={`app-add-repo-icon-swatch app-add-repo-icon-swatch--follow${iconColor === null ? " app-add-repo-icon-swatch--selected" : ""}`}
                        aria-label="角标颜色与角色标签默认色一致"
                        onClick={() => onIconColorChange(null)}
                      />
                    </Tooltip>
                    {REPOSITORY_ICON_COLOR_PRESETS.map((hex) => (
                      <Tooltip key={hex} title={hex} mouseEnterDelay={0.2}>
                        <button
                          type="button"
                          className={`app-add-repo-icon-swatch${iconColor === hex ? " app-add-repo-icon-swatch--selected" : ""}`}
                          aria-label={`角标颜色 ${hex}`}
                          style={{ backgroundColor: hex }}
                          onClick={() => onIconColorChange(hex)}
                        />
                      </Tooltip>
                    ))}
                  </div>
                  <div className="app-add-repo-field-label app-add-repo-field-label--spaced">角标标题</div>
                  <Input
                    size="small"
                    value={iconDisplayName}
                    onChange={(event) => onIconDisplayNameChange(event.target.value)}
                    placeholder="留空则角标内仅显示角色默认文案（前/后/文）"
                    allowClear
                  />
                  <Button
                    type="default"
                    size="small"
                    block
                    className="app-add-repo-preset-add-btn"
                    onClick={onAddPreset}
                  >
                    将当前配置加入常用选项
                  </Button>
                </div>
              </div>
            )}
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <div className="app-add-repo-field-label">SDD 模式</div>
          <SddModeSwitch
            value={sddMode}
            autoResolved="wise_trellis"
            onChange={onSddModeChange}
            size="small"
          />
        </div>
      </Space>
    </Modal>
  );
}

export function buildAddRepositoryOptions({
  iconDisplayName,
  iconColor,
  sddMode,
}: {
  iconDisplayName: string;
  iconColor: string | null;
  sddMode: SddMode;
}): AddRepositoryOptions {
  const iconText = iconDisplayName.trim();
  return {
    iconDisplayName: iconText.length > 0 ? iconText : undefined,
    iconColor,
    sddMode,
  };
}
