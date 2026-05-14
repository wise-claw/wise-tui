import { Input, Modal, Space, Switch, Typography } from "antd";
import type { ProjectItem, Repository } from "../../types";
import { repositoryFolderBasename } from "../../utils/repositoryType";

interface ProjectNameModalsProps {
  createOpen: boolean;
  embedTrellisForNewProject: boolean;
  onEmbedTrellisForNewProjectChange: (value: boolean) => void;
  editProject: ProjectItem | null;
  projectNameInput: string;
  onProjectNameInputChange: (value: string) => void;
  onCancelCreate: () => void;
  onCancelEdit: () => void;
  onSubmitCreate: () => void | Promise<void>;
  onSubmitEdit: () => void;
  promotingRepository: Repository | null;
  promotingRepositoryName: string;
  onPromotingRepositoryNameChange: (value: string) => void;
  onCancelPromote: () => void;
  onSubmitPromote: () => void;
}

export function ProjectNameModals({
  createOpen,
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
        title="新建项目"
        open={createOpen}
        onCancel={onCancelCreate}
        onOk={onSubmitCreate}
        okText="创建"
        cancelText="取消"
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Input
            value={projectNameInput}
            onChange={(event) => onProjectNameInputChange(event.target.value)}
            placeholder="请输入项目名称"
            onPressEnter={onSubmitCreate}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <Typography.Text>内置 Trellis</Typography.Text>
            <Switch checked={embedTrellisForNewProject} onChange={onEmbedTrellisForNewProjectChange} />
          </div>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            开启后，若当前侧栏选中的仓库可作为「种子目录」，将在该仓库根目录执行 <Typography.Text code>trellis init -y</Typography.Text>
            （已存在祖先项目中的 <Typography.Text code>.trellis/scripts/task.py</Typography.Text> 时自动跳过）。无种子仓库时不会执行初始化。
          </Typography.Paragraph>
        </Space>
      </Modal>

      <Modal
        title="重命名项目"
        open={Boolean(editProject)}
        onCancel={onCancelEdit}
        onOk={onSubmitEdit}
        okText="保存"
        cancelText="取消"
      >
        <Input
          value={projectNameInput}
          onChange={(event) => onProjectNameInputChange(event.target.value)}
          placeholder="请输入新的项目名称"
          onPressEnter={onSubmitEdit}
        />
      </Modal>

      <Modal
        title={
          promotingRepository
            ? `升格仓库「${repositoryFolderBasename(promotingRepository)}」为新项目`
            : "升格为新项目"
        }
        open={Boolean(promotingRepository)}
        onCancel={onCancelPromote}
        onOk={onSubmitPromote}
        okText="创建项目并加入"
        cancelText="取消"
      >
        <Input
          value={promotingRepositoryName}
          onChange={(event) => onPromotingRepositoryNameChange(event.target.value)}
          placeholder="请输入新项目名称"
          onPressEnter={onSubmitPromote}
          autoFocus
        />
      </Modal>
    </>
  );
}
