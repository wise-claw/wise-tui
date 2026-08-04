import { FolderOpenOutlined } from "@ant-design/icons";
import { Button, Input, Modal, Space, Typography } from "antd";
import type { AddRepositoryOptions } from "../../types";
import type { WorkspaceBootstrapSelection } from "../../constants/workspaceBootstrapAddons";
import type { RepositoryAcquireMode } from "../../utils/repositoryAcquire";
import { deriveFolderNameFromGitUrl } from "../../utils/repositoryAcquire";
import { WorkspaceBootstrapPicker } from "../WorkspaceBootstrapPicker";
import "./RepositoryAssociateModal.css";

interface RepositoryAssociateModalProps {
  open: boolean;
  floatingMode: boolean;
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
  workspaceBootstrapSelection: WorkspaceBootstrapSelection;
  onWorkspaceBootstrapSelectionChange: (value: WorkspaceBootstrapSelection) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

const ACQUIRE_MODE_OPTIONS: { value: RepositoryAcquireMode; label: string }[] = [
  { value: "pick_existing", label: "已有目录" },
  { value: "create_empty", label: "新建空仓库" },
  { value: "git_clone", label: "从 Git 克隆" },
];

function RepositoryAcquireModePicker({
  value,
  onChange,
}: {
  value: RepositoryAcquireMode;
  onChange: (mode: RepositoryAcquireMode) => void;
}) {
  return (
    <div className="app-add-repo-acquire-mode" role="tablist" aria-label="获取方式">
      {ACQUIRE_MODE_OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`app-add-repo-acquire-mode__item${active ? " is-active" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function RepositoryAssociateModal({
  open,
  floatingMode,
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
  workspaceBootstrapSelection,
  onWorkspaceBootstrapSelectionChange,
  onCancel,
  onSubmit,
}: RepositoryAssociateModalProps) {
  const parentPathLabel = parentPath.trim() || "未选择";
  const gitFolderPlaceholder = deriveFolderNameFromGitUrl(gitUrl);
  const compact = floatingMode;

  return (
    <Modal
      title={floatingMode ? "添加单仓" : "关联仓库"}
      open={open}
      onCancel={onCancel}
      onOk={() => {
        onSubmit();
      }}
      okText={submitOkText}
      cancelText="取消"
      width={440}
      classNames={{
        body: compact ? "app-add-repo-modal-body app-add-repo-modal-body--compact" : "app-add-repo-modal-body",
      }}
    >
      <Space
        orientation="vertical"
        size={compact ? 6 : 8}
        className={compact ? "app-add-repo-form app-add-repo-form--compact" : "app-add-repo-form"}
        style={{ width: "100%" }}
      >
        <div>
          <div className="app-add-repo-field-label">获取方式</div>
          <RepositoryAcquireModePicker value={acquireMode} onChange={onAcquireModeChange} />
        </div>

        <div className="app-add-repo-acquire-panel">
          <div className="app-add-repo-field-label">
            {acquireMode === "pick_existing" ? "仓库目录" : "父目录"}
          </div>
          <div className="app-add-repo-parent-path">
            <Button
              type="default"
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => void onPickParentPath()}
            >
              选择
            </Button>
            <Input
              size="small"
              value={parentPath}
              placeholder={
                acquireMode === "pick_existing"
                  ? compact
                    ? "/Users/you/projects/my-app"
                    : "例如 /Users/you/projects/my-app"
                  : compact
                    ? "工作区根目录或父路径"
                    : "工作区根目录或任意父路径"
              }
              onChange={(event) => onParentPathChange(event.target.value)}
            />
          </div>
          {!compact || !parentPath.trim() ? (
            <Typography.Text type="secondary" className="app-add-repo-acquire-hint">
              {acquireMode === "pick_existing"
                ? parentPath.trim()
                  ? parentPathLabel
                  : compact
                    ? "可填写或选择已有目录；留空则在确定后弹出选择器"
                    : "可填写或选择已有仓库目录（支持 - 等特殊字符）；留空则在确定后弹出选择器"
                : parentPath.trim()
                  ? parentPathLabel
                  : compact
                    ? "请选择或填写父目录"
                    : "请选择或填写父目录，仓库将创建在其下"}
            </Typography.Text>
          ) : null}

          {acquireMode === "git_clone" ? (
            <div className={compact ? "app-add-repo-acquire-grid" : undefined}>
              <div>
                <div className="app-add-repo-field-label app-add-repo-field-label--spaced">Git 仓库地址</div>
                <Input
                  size="small"
                  value={gitUrl}
                  placeholder={
                    compact
                      ? "https://github.com/org/repo.git"
                      : "https://github.com/org/repo.git 或 git@host:org/repo.git"
                  }
                  onChange={(event) => onGitUrlChange(event.target.value)}
                  allowClear
                />
              </div>
              <div>
                <div className="app-add-repo-field-label app-add-repo-field-label--spaced">目标文件夹名</div>
                <Input
                  size="small"
                  value={folderName}
                  placeholder={gitFolderPlaceholder}
                  onChange={(event) => onFolderNameChange(event.target.value)}
                  allowClear
                />
              </div>
            </div>
          ) : acquireMode === "create_empty" ? (
            <>
              <div className="app-add-repo-field-label app-add-repo-field-label--spaced">仓库文件夹名</div>
              <Input
                size="small"
                value={folderName}
                placeholder="例如 frontend-api"
                onChange={(event) => onFolderNameChange(event.target.value)}
                allowClear
              />
              {!compact ? (
                <Typography.Text type="secondary" className="app-add-repo-acquire-hint">
                  将在父目录下创建文件夹并执行 git init
                </Typography.Text>
              ) : null}
            </>
          ) : null}
        </div>

        <div>
          {!floatingMode ? (
            <div className="app-add-repo-field-label">SDD 与内置能力</div>
          ) : null}
          <WorkspaceBootstrapPicker
            selection={workspaceBootstrapSelection}
            onChange={onWorkspaceBootstrapSelectionChange}
          />
        </div>
      </Space>
    </Modal>
  );
}

export function buildAddRepositoryOptions({
  bootstrap,
}: {
  bootstrap?: WorkspaceBootstrapSelection;
}): AddRepositoryOptions {
  return { bootstrap };
}
