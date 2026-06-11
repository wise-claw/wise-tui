import { memo, type ReactNode } from "react";
import { RepositoryFilesExplorer } from "../GitPanel/RepositoryFilesExplorer";
import type { GitPanelOpenFileOptions } from "../GitPanel/types";
import type { GitPanelWorkspaceSelectorProps } from "../GitPanel/GitPanelWorkspaceSelector";

interface ActiveRepositoryFilesPanelProps {
  activeRepositoryPath: string;
  activeRepositoryName?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  sectionCollapsed: boolean;
  onSectionCollapsedChange?: (collapsed: boolean) => void;
  headerPrefix?: ReactNode;
  workspaceSelector?: Omit<GitPanelWorkspaceSelectorProps, "activeRepositoryPath">;
  /** 右栏 Inspector 内嵌时使用独立布局 class。 */
  variant?: "left-sidebar" | "right-rail" | "workspace-rail";
}

export const ActiveRepositoryFilesPanel = memo(function ActiveRepositoryFilesPanel({
  activeRepositoryPath,
  activeRepositoryName,
  search,
  onSearchChange,
  onOpenFile,
  sectionCollapsed,
  onSectionCollapsedChange,
  headerPrefix,
  workspaceSelector,
  variant = "left-sidebar",
}: ActiveRepositoryFilesPanelProps) {
  const rootClassName =
    variant === "workspace-rail"
      ? "app-workspace-file-tree-rail-panel"
      : variant === "right-rail"
        ? "app-right-panel-files-explorer" +
          (sectionCollapsed ? " app-right-panel-files-explorer--section-collapsed" : "")
        : "app-left-sidebar-files-explorer" +
          (sectionCollapsed ? " app-left-sidebar-files-explorer--section-collapsed" : "");

  return (
    <div className={rootClassName}>
      <div
        className={
          variant === "workspace-rail"
            ? "app-workspace-file-tree-rail-panel-body"
            : variant === "right-rail"
              ? "app-right-panel-files-explorer-body"
              : "app-left-sidebar-files-explorer-body"
        }
      >
        <RepositoryFilesExplorer
          headerPrefix={headerPrefix}
          repositoryPath={activeRepositoryPath}
          repositoryLabel={
            activeRepositoryName?.trim() ||
            activeRepositoryPath.split(/[/\\]/).filter(Boolean).pop() ||
            "资源管理器"
          }
          search={search}
          showSearchField={variant === "workspace-rail" ? true : !sectionCollapsed}
          onSearchChange={onSearchChange}
          onOpenFile={onOpenFile}
          onClearExplorerSearch={() => onSearchChange("")}
          sectionCollapsed={sectionCollapsed}
          onSectionCollapsedChange={
            variant === "workspace-rail" ? undefined : onSectionCollapsedChange
          }
          hideContextHeader={variant === "workspace-rail"}
          workspaceSelector={workspaceSelector}
        />
      </div>
    </div>
  );
});
