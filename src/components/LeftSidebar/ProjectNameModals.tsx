import { FolderOpenOutlined } from "@ant-design/icons";
import { Button, Checkbox, Form, Input, Modal, Typography } from "antd";
import type { StandaloneRepo, Workspace } from "../../types";
import {
  WORKSPACE_BOOTSTRAP_PLUGIN_ADDONS,
  type WorkspaceBootstrapSelection,
} from "../../constants/workspaceBootstrapAddons";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import "./ProjectNameModals.css";

interface ProjectNameModalsProps {
  createOpen: boolean;
  createProjectRootPath: string;
  /** 新建 Workspace：创建流程进行中（含 Trellis / reconcile 等），用于确定按钮 loading */
  createSubmitLoading?: boolean;
  onPickCreateProjectRoot: () => void | Promise<void>;
  workspaceBootstrapSelection: WorkspaceBootstrapSelection;
  onWorkspaceBootstrapSelectionChange: (value: WorkspaceBootstrapSelection) => void;
  editProject: Workspace | null;
  projectNameInput: string;
  onProjectNameInputChange: (value: string) => void;
  onCancelCreate: () => void;
  onCancelEdit: () => void;
  onSubmitCreate: () => void | Promise<void>;
  onSubmitEdit: () => void;
  promotingRepository: StandaloneRepo | null;
  promotingRepositoryName: string;
  onPromotingRepositoryNameChange: (value: string) => void;
  onCancelPromote: () => void;
  onSubmitPromote: () => void;
}

function patchBootstrapSelection(
  prev: WorkspaceBootstrapSelection,
  patch: Partial<WorkspaceBootstrapSelection>,
): WorkspaceBootstrapSelection {
  return { ...prev, ...patch };
}

const WORKSPACE_SCAFFOLD_BOOTSTRAP_OPTIONS = [
  {
    id: "trellis" as const,
    label: "Trellis",
    title: "根目录 trellis init -y；已有 .trellis/scripts/task.py 则跳过",
  },
  {
    id: "openspec" as const,
    label: "OpenSpec",
    title: "根目录 openspec init --tools claude；已有 .openspec/ 则跳过",
  },
] as const;

export function ProjectNameModals({
  createOpen,
  createProjectRootPath,
  createSubmitLoading = false,
  onPickCreateProjectRoot,
  workspaceBootstrapSelection,
  onWorkspaceBootstrapSelectionChange,
  editProject,
  projectNameInput,
  onProjectNameInputChange,
  onCancelCreate,
  onCancelEdit,
  onSubmitCreate,
  onSubmitEdit,
  promotingRepository,
  promotingRepositoryName,
  onPromotingRepositoryNameChange,
  onCancelPromote,
  onSubmitPromote,
}: ProjectNameModalsProps) {
  const rootPathLabel = createProjectRootPath.trim() || "未选择";
  const selection = workspaceBootstrapSelection;
  const setSelection = onWorkspaceBootstrapSelectionChange;

  return (
    <>
      <Modal
        title="新建工作区"
        className="app-create-workspace-modal"
        width={440}
        open={createOpen}
        onCancel={onCancelCreate}
        onOk={onSubmitCreate}
        okText="创建"
        cancelText="取消"
        confirmLoading={createSubmitLoading}
        closable={!createSubmitLoading}
        mask={{ closable: !createSubmitLoading }}
        keyboard={!createSubmitLoading}
        destroyOnHidden
      >
        <Form layout="vertical" requiredMark={false} className="app-create-workspace-form">
          <Form.Item label="工作区名称" className="app-create-workspace-form__item">
            <Input
              size="small"
              value={projectNameInput}
              onChange={(event) => onProjectNameInputChange(event.target.value)}
              placeholder="请输入工作区名称"
              autoFocus
              disabled={createSubmitLoading}
              onPressEnter={() => {
                if (!createSubmitLoading) void onSubmitCreate();
              }}
            />
          </Form.Item>

          <div className="app-create-workspace-form__section">
            <Typography.Text className="app-create-workspace-form__section-label">根目录</Typography.Text>
            <div className="app-create-workspace-path">
              <Button
                type="default"
                size="small"
                className="app-create-workspace-path__pick"
                icon={<FolderOpenOutlined />}
                disabled={createSubmitLoading}
                onClick={() => void onPickCreateProjectRoot()}
              >
                选择
              </Button>
              <span
                className={`app-create-workspace-path__value${createProjectRootPath.trim() ? "" : " app-create-workspace-path__value--empty"}`}
                title={createProjectRootPath.trim() ? rootPathLabel : undefined}
              >
                {rootPathLabel}
              </span>
            </div>
            <Typography.Text className="app-create-workspace-form__hint" ellipsis>
              任务编排根目录；代码仓通过「关联仓库」添加。
            </Typography.Text>
          </div>

          <div className="app-create-workspace-bootstrap">
            <Typography.Text strong className="app-create-workspace-bootstrap__title">
              一键内置
            </Typography.Text>
            <div className="app-create-workspace-bootstrap__groups">
              <div className="app-create-workspace-bootstrap__group">
                <span className="app-create-workspace-bootstrap__group-label">根目录</span>
                <div className="app-create-workspace-bootstrap__chips">
                  {WORKSPACE_SCAFFOLD_BOOTSTRAP_OPTIONS.map((option) => (
                    <Checkbox
                      key={option.id}
                      className="app-create-workspace-bootstrap__chip"
                      checked={selection[option.id]}
                      disabled={createSubmitLoading}
                      title={option.title}
                      onChange={(event) =>
                        setSelection(
                          patchBootstrapSelection(selection, { [option.id]: event.target.checked }),
                        )
                      }
                    >
                      {option.label}
                    </Checkbox>
                  ))}
                </div>
              </div>
              <div className="app-create-workspace-bootstrap__group">
                <span className="app-create-workspace-bootstrap__group-label">Claude</span>
                <div className="app-create-workspace-bootstrap__chips">
                  {WORKSPACE_BOOTSTRAP_PLUGIN_ADDONS.map((addon) => (
                    <Checkbox
                      key={addon.id}
                      className="app-create-workspace-bootstrap__chip"
                      checked={selection[addon.id]}
                      disabled={createSubmitLoading}
                      title={addon.label}
                      onChange={(event) =>
                        setSelection(
                          patchBootstrapSelection(selection, { [addon.id]: event.target.checked }),
                        )
                      }
                    >
                      {addon.shortLabel}
                    </Checkbox>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Form>
      </Modal>

      <Modal
        title="重命名工作区"
        open={Boolean(editProject)}
        onCancel={onCancelEdit}
        onOk={onSubmitEdit}
        okText="保存"
        cancelText="取消"
        width={400}
        destroyOnHidden
      >
        <Input
          value={projectNameInput}
          onChange={(event) => onProjectNameInputChange(event.target.value)}
          placeholder="请输入新的工作区名称"
          onPressEnter={onSubmitEdit}
          autoFocus
        />
      </Modal>

      <Modal
        title={
          promotingRepository
            ? `升格单仓「${repositoryFolderBasename(promotingRepository)}」为工作区`
            : "升格为工作区"
        }
        open={Boolean(promotingRepository)}
        onCancel={onCancelPromote}
        onOk={onSubmitPromote}
        okText="创建工作区并加入"
        cancelText="取消"
        width={400}
        destroyOnHidden
      >
        <Input
          value={promotingRepositoryName}
          onChange={(event) => onPromotingRepositoryNameChange(event.target.value)}
          placeholder="请输入新工作区名称"
          onPressEnter={onSubmitPromote}
          autoFocus
        />
      </Modal>
    </>
  );
}
