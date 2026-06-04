import type { ReactNode } from "react";
import {
  RepositoryFilesExplorer,
  type GitPanelOpenFileOptions,
} from "../GitPanel";
import type { GitPanelWorkspaceSelectorProps } from "../GitPanel/GitPanelWorkspaceSelector";

interface ActiveRepositoryFilesPanelProps {
  activeRepositoryPath: string;
  activeRepositoryName?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  sectionCollapsed: boolean;
  onSectionCollapsedChange: (collapsed: boolean) => void;
  headerPrefix?: ReactNode;
  workspaceSelector: Omit<GitPanelWorkspaceSelectorProps, "activeRepositoryPath">;
}

export function ActiveRepositoryFilesPanel({
  activeRepositoryPath,
  activeRepositoryName,
  search,
  onSearchChange,
  onOpenFile,
  sectionCollapsed,
  onSectionCollapsedChange,
  headerPrefix,
  workspaceSelector,
}: ActiveRepositoryFilesPanelProps) {
  return (
    <div
      className={
        "app-left-sidebar-files-explorer" +
        (sectionCollapsed ? " app-left-sidebar-files-explorer--section-collapsed" : "")
      }
    >
      <div className="app-left-sidebar-files-explorer-body">
        <RepositoryFilesExplorer
          headerPrefix={headerPrefix}
          repositoryPath={activeRepositoryPath}
          repositoryLabel={
            activeRepositoryName?.trim() ||
            activeRepositoryPath.split(/[/\\]/).filter(Boolean).pop() ||
            "资源管理器"
          }
          search={search}
          showSearchField={!sectionCollapsed}
          onSearchChange={onSearchChange}
          onOpenFile={onOpenFile}
          onClearExplorerSearch={() => onSearchChange("")}
          sectionCollapsed={sectionCollapsed}
          onSectionCollapsedChange={onSectionCollapsedChange}
          workspaceSelector={workspaceSelector}
        />
      </div>
    </div>
  );
}
