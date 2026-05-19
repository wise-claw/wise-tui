import { Button, Input, Modal, Space, Switch, Typography } from "antd";
import type { StandaloneRepo, Workspace } from "../../types";
import { repositoryFolderBasename } from "../../utils/repositoryType";

interface ProjectNameModalsProps {
  createOpen: boolean;
  createProjectRootPath: string;
  /** 新建 Workspace：创建流程进行中（含 Trellis / reconcile 等），用于确定按钮 loading */
  createSubmitLoading?: boolean;
  onPickCreateProjectRoot: () => void | Promise<void>;
  embedTrellisForNewProject: boolean;
  onEmbedTrellisForNewProjectChange: (value: boolean) => void;
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

export function ProjectNameModals({
  createOpen,
  createProjectRootPath,
  createSubmitLoading = false,
  onPickCreateProjectRoot,
  embedTrellisForNewProject,
  onEmbedTrellisForNewProjectChange,
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
  return (
    <>
      <Modal
        title="新建工作区"
        open={createOpen}
        onCancel={onCancelCreate}
        onOk={onSubmitCreate}
        okText="创建"
        confirmLoading={createSubmitLoading}
        closable={!createSubmitLoading}
        mask={{ closable: !createSubmitLoading }}
        keyboard={!createSubmitLoading}
        footer={(_, { OkBtn }) => <OkBtn />}
      >
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Typography.Text type="secondary">工作区名称</Typography.Text>
            <Input
              value={projectNameInput}
              onChange={(event) => onProjectNameInputChange(event.target.value)}
              placeholder="请输入工作区名称"
              onPressEnter={() => {
                if (!createSubmitLoading) void onSubmitCreate();
              }}
              disabled={createSubmitLoading}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Typography.Text type="secondary">工作区根目录</Typography.Text>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Button
                type="default"
                disabled={createSubmitLoading}
                onClick={() => void onPickCreateProjectRoot()}
              >
                选择文件夹…
              </Button>
              <Typography.Text
                ellipsis={{ tooltip: createProjectRootPath }}
                style={{ flex: 1, minWidth: 120 }}
                type={createProjectRootPath ? undefined : "secondary"}
              >
                {createProjectRootPath || "未选择"}
              </Typography.Text>
            </div>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              工作区根目录只承载 Trellis；代码仓库通过「关联仓库」添加。
            </Typography.Paragraph>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <Typography.Text>内置 Trellis</Typography.Text>
            <Switch
              checked={embedTrellisForNewProject}
              disabled={createSubmitLoading}
              onChange={onEmbedTrellisForNewProjectChange}
            />
          </div>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            开启后，将在<strong>所选工作区根目录</strong>下检测并执行 <Typography.Text code>trellis init -y</Typography.Text>
            （已存在 <Typography.Text code>.trellis/scripts/task.py</Typography.Text> 时自动跳过）。
          </Typography.Paragraph>
        </Space>
      </Modal>

      <Modal
        title="重命名工作区"
        open={Boolean(editProject)}
        onCancel={onCancelEdit}
        onOk={onSubmitEdit}
        okText="保存"
        cancelText="取消"
      >
        <Input
          value={projectNameInput}
          onChange={(event) => onProjectNameInputChange(event.target.value)}
          placeholder="请输入新的工作区名称"
          onPressEnter={onSubmitEdit}
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
