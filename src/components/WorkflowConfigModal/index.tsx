import { Modal } from "antd";
import { WorkflowConfigModalContent } from "./WorkflowConfigModalContent";
import { useWorkflowConfigModal } from "./useWorkflowConfigModal";
import type { WorkflowConfigModalProps } from "./types";
import "./index.css";

export type { WorkflowConfigModalProps } from "./types";

export function WorkflowConfigModal({
  open,
  inline = false,
  loading,
  employees,
  templates,
  projects,
  workflowProjectIds,
  onClose,
  onSaveTemplate,
  onLoadGraphItem,
  onSaveGraph,
  onValidateGraph,
  onDeleteTemplate,
  repositoryPath,
  selectableEmployeeIds = [],
  initialWorkflowId = null,
}: WorkflowConfigModalProps) {
  const controller = useWorkflowConfigModal({
    open,
    loading,
    employees,
    templates,
    projects,
    workflowProjectIds,
    onClose,
    onSaveTemplate,
    onLoadGraphItem,
    onSaveGraph,
    onValidateGraph,
    onDeleteTemplate,
    repositoryPath,
    selectableEmployeeIds,
    initialWorkflowId,
  });

  const content = (
    <WorkflowConfigModalContent
      loading={loading}
      employees={employees}
      templates={templates}
      projects={projects}
      repositoryPath={repositoryPath}
      selectableEmployeeIds={selectableEmployeeIds}
      controller={controller}
    />
  );

  if (inline) {
    if (!open) return null;
    return <div className="app-workflow-config-inline-root">{content}</div>;
  }

  return (
    <Modal
      title="团队配置"
      open={open}
      onCancel={onClose}
      footer={null}
      centered={false}
      width="100%"
      rootClassName="app-workflow-config-modal-root"
      className="app-workflow-config-modal"
      destroyOnHidden
      styles={{
        body: {
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {content}
    </Modal>
  );
}
