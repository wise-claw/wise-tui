import type { WorkflowConfigModalProps } from "./types";
import { WorkflowConfigEditorPanel } from "./WorkflowConfigEditorPanel";
import { WorkflowConfigTeamSidebar } from "./WorkflowConfigTeamSidebar";
import type { WorkflowConfigModalController } from "./useWorkflowConfigModal";

type Props = Pick<
  WorkflowConfigModalProps,
  "loading" | "employees" | "templates" | "projects" | "repositoryPath" | "selectableEmployeeIds"
> & {
  controller: WorkflowConfigModalController;
};

export function WorkflowConfigModalContent({
  loading,
  employees,
  templates,
  projects,
  repositoryPath,
  selectableEmployeeIds = [],
  controller,
}: Props) {
  return (
    <div className="app-workflow-config-layout">
      <WorkflowConfigTeamSidebar templates={templates} {...controller} />
      <WorkflowConfigEditorPanel
        loading={loading}
        employees={employees}
        projects={projects}
        repositoryPath={repositoryPath}
        selectableEmployeeIds={selectableEmployeeIds}
        {...controller}
      />
    </div>
  );
}
