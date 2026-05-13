import { Input, Modal } from "antd";
import type { ProjectItem, Repository } from "../../types";
import { repositoryFolderBasename } from "../../utils/repositoryType";

interface ProjectNameModalsProps {
  createOpen: boolean;
  editProject: ProjectItem | null;
  projectNameInput: string;
  onProjectNameInputChange: (value: string) => void;
  onCancelCreate: () => void;
  onCancelEdit: () => void;
  onSubmitCreate: () => void;
  onSubmitEdit: () => void;
  promotingRepository: Repository | null;
  promotingRepositoryName: string;
  onPromotingRepositoryNameChange: (value: string) => void;
  onCancelPromote: () => void;
  onSubmitPromote: () => void;
}

export function ProjectNameModals({
  createOpen,
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
        <Input
          value={projectNameInput}
          onChange={(event) => onProjectNameInputChange(event.target.value)}
          placeholder="请输入项目名称"
          onPressEnter={onSubmitCreate}
        />
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
