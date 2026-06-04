import type { ReactNode } from "react";
import { WorkspaceMemosPanel } from "./WorkspaceMemosPanel";
import { WorkspaceQuickActionsPanel } from "./WorkspaceQuickActionsPanel";
import { WorkspaceTodosPanel } from "./WorkspaceTodosPanel";
import { useWorkspaceInspectorPanelsDefault } from "../../hooks/useWorkspaceInspectorPanelsDefault";

export interface WorkspaceInspectorPanelsSectionProps {
  projectId: string | null;
  repositoryId: number | null;
  /** Cockpit 右栏在 Mission 卡片之上渲染三块工作区卡片。 */
  children?: ReactNode;
}

export function WorkspaceInspectorPanelsSection({
  projectId,
  repositoryId,
  children,
}: WorkspaceInspectorPanelsSectionProps) {
  const panels = useWorkspaceInspectorPanelsDefault();

  return (
    <>
      {panels.showWorkspaceQuickActionsPanel ? (
        <WorkspaceQuickActionsPanel projectId={projectId} repositoryId={repositoryId} />
      ) : null}
      {panels.showWorkspaceMemosPanel ? (
        <WorkspaceMemosPanel projectId={projectId} repositoryId={repositoryId} />
      ) : null}
      {panels.showWorkspaceTodosPanel ? (
        <WorkspaceTodosPanel projectId={projectId} repositoryId={repositoryId} />
      ) : null}
      {children}
    </>
  );
}
