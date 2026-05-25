import { FolderOpenOutlined } from "@ant-design/icons";
import { Button, Divider, Input, Modal, Segmented, Select, Space, Tooltip, Typography } from "antd";
import type { AddRepositoryOptions, Repository, RepositoryAssociatePreset } from "../../types";
import type { WorkspaceBootstrapSelection } from "../../constants/workspaceBootstrapAddons";
import type { RepositoryAcquireMode } from "../../utils/repositoryAcquire";
import { deriveFolderNameFromGitUrl } from "../../utils/repositoryAcquire";
import { REPOSITORY_ICON_COLOR_PRESETS } from "../../utils/repositoryType";
import { WorkspaceBootstrapPicker } from "../WorkspaceBootstrapPicker";

interface RepositoryAssociateModalProps {
  open: boolean;
  floatingMode: boolean;
  submitting?: boolean;
  acquireMode: RepositoryAcquireMode;
  onAcquireModeChange: (mode: RepositoryAcquireMode) => void;
  parentPath: string;
  onParentPathChange: (value: string) => void;
  onPickParentPath: () => void;
  folderName: string;
  onFolderNameChange: (value: string) => void;
  gitUrl: string;
  onGitUrlChange: (value: string) => void;
  submitOkText: string;
  associateSelectValue: string;
  onAssociateSelectValueChange: (value: string) => void;
  onRepositoryTypeChange: (value: Repository["repositoryType"]) => void;
  workspaceBootstrapSelection: WorkspaceBootstrapSelection;
  onWorkspaceBootstrapSelectionChange: (value: WorkspaceBootstrapSelection) => void;
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

const ACQUIRE_MODE_OPTIONS: { value: RepositoryAcquireMode; label: string }[] = [
  { value: "pick_existing", label: "已有目录" },
  { value: "create_empty", label: "新建空仓库" },
  { value: "git_clone", label: "从 Git 克隆" },
];

export function RepositoryAssociateModal({
  open,
  floatingMode,
  submitting = false,
  acquireMode,
  onAcquireModeChange,
  parentPath,
  onParentPathChange,
  onPickParentPath,
  folderName,
  onFolderNameChange,
  gitUrl,
  onGitUrlChange,
  submitOkText,
  associateSelectValue,
  onAssociateSelectValueChange,
  onRepositoryTypeChange,
  workspaceBootstrapSelection,
  onWorkspaceBootstrapSelectionChange,
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
  const parentPathLabel = parentPath.trim() || "未选择";
  const gitFolderPlaceholder = deriveFolderNameFromGitUrl(gitUrl);

  return (
    <Modal
      title={floatingMode ? "添加单仓" : "关联仓库"}
      open={open}
      onCancel={onCancel}
      onOk={onSubmit}
      okText={submitOkText}
      cancelText="取消"
      confirmLoading={submitting}
      closable={!submitting}
      mask={{ closable: !submitting }}
      keyboard={!submitting}
      width={floatingMode ? 480 : 440}
    >
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <div>
          <div className="app-add-repo-field-label">获取方式</div>
          <Segmented
            block
            size="small"
            value={acquireMode}
            disabled={submitting}
            options={ACQUIRE_MODE_OPTIONS}
            onChange={(value) => onAcquireModeChange(value as RepositoryAcquireMode)}
          />
        </div>

        {acquireMode !== "pick_existing" ? (
          <div className="app-add-repo-acquire-panel">
            <div className="app-add-repo-field-label">父目录</div>
            <div className="app-add-repo-parent-path">
              <Button
                type="default"
                size="small"
                icon={<FolderOpenOutlined />}
                disabled={submitting}
                onClick={() => void onPickParentPath()}
              >
                选择
              </Button>
              <Input
                size="small"
                value={parentPath}
                disabled={submitting}
                placeholder="工作区根目录或任意父路径"
                onChange={(event) => onParentPathChange(event.target.value)}
              />
            </div>
            <Typography.Text type="secondary" className="app-add-repo-acquire-hint">
              {parentPath.trim() ? parentPathLabel : "请选择或填写父目录，仓库将创建在其下"}
            </Typography.Text>

            {acquireMode === "git_clone" ? (
              <>
                <div className="app-add-repo-field-label app-add-repo-field-label--spaced">Git 仓库地址</div>
                <Input
                  size="small"
                  value={gitUrl}
                  disabled={submitting}
                  placeholder="https://github.com/org/repo.git 或 git@host:org/repo.git"
                  onChange={(event) => onGitUrlChange(event.target.value)}
                  allowClear
                />
                <div className="app-add-repo-field-label app-add-repo-field-label--spaced">目标文件夹名</div>
                <Input
                  size="small"
                  value={folderName}
                  disabled={submitting}
                  placeholder={gitFolderPlaceholder}
                  onChange={(event) => onFolderNameChange(event.target.value)}
                  allowClear
                />
              </>
            ) : (
              <>
                <div className="app-add-repo-field-label app-add-repo-field-label--spaced">仓库文件夹名</div>
                <Input
                  size="small"
                  value={folderName}
                  disabled={submitting}
                  placeholder="例如 frontend-api"
                  onChange={(event) => onFolderNameChange(event.target.value)}
                  allowClear
                />
                <Typography.Text type="secondary" className="app-add-repo-acquire-hint">
                  将在父目录下创建文件夹并执行 git init
                </Typography.Text>
              </>
            )}
          </div>
        ) : null}

        <div>
          <div className="app-add-repo-field-label">角标与自定义角色标签</div>
          <Select
            className="app-add-repository-badge-select"
            size="small"
            classNames={{ popup: { root: "app-add-repo-select-dropdown" } }}
            popupMatchSelectWidth
            optionLabelProp="title"
            value={associateSelectValue}
            disabled={submitting}
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
          <div className="app-add-repo-field-label">SDD 与内置能力</div>
          <WorkspaceBootstrapPicker
            selection={workspaceBootstrapSelection}
            onChange={onWorkspaceBootstrapSelectionChange}
            disabled={submitting}
          />
        </div>
      </Space>
    </Modal>
  );
}

export function buildAddRepositoryOptions({
  iconDisplayName,
  iconColor,
  bootstrap,
}: {
  iconDisplayName: string;
  iconColor: string | null;
  bootstrap?: WorkspaceBootstrapSelection;
}): AddRepositoryOptions {
  const iconText = iconDisplayName.trim();
  return {
    iconDisplayName: iconText.length > 0 ? iconText : undefined,
    iconColor,
    bootstrap,
  };
}
