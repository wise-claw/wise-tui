import { memo } from "react";
import { useWorkspaceInspectorPanelsDefault } from "../../hooks/useWorkspaceInspectorPanelsDefault";
import { WorkspaceQuickActionsPanel } from "./WorkspaceQuickActionsPanel";
import { WorkspaceTodosPanel } from "./WorkspaceTodosPanel";

export interface WorkspaceInspectorWorkspaceCardsProps {
  projectId: string | null;
  repositoryId: number | null;
}

function workspaceCardsPropsEqual(
  prev: WorkspaceInspectorWorkspaceCardsProps,
  next: WorkspaceInspectorWorkspaceCardsProps,
): boolean {
  return prev.projectId === next.projectId && prev.repositoryId === next.repositoryId;
}

/** 快捷操作 / 待办：与 monitor sessions 流式更新隔离，避免右栏卡片无谓 reconcile。 */
export const WorkspaceInspectorWorkspaceCards = memo(function WorkspaceInspectorWorkspaceCards({
  projectId,
  repositoryId,
}: WorkspaceInspectorWorkspaceCardsProps) {
  const panels = useWorkspaceInspectorPanelsDefault();

  return (
    <>
      {panels.showWorkspaceQuickActionsPanel ? (
        <WorkspaceQuickActionsPanel projectId={projectId} repositoryId={repositoryId} />
      ) : null}
      {panels.showWorkspaceTodosPanel ? (
        <WorkspaceTodosPanel projectId={projectId} repositoryId={repositoryId} />
      ) : null}
    </>
  );
}, workspaceCardsPropsEqual);
