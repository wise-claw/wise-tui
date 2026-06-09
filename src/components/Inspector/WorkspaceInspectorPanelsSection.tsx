import type { ReactNode } from "react";
import { WorkspaceInspectorWorkspaceCards } from "./WorkspaceInspectorWorkspaceCards";

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
  return (
    <>
      <WorkspaceInspectorWorkspaceCards projectId={projectId} repositoryId={repositoryId} />
      {children}
    </>
  );
}
