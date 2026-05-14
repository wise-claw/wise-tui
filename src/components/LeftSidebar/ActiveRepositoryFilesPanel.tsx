import { Input } from "antd";
import { RepositoryFilesExplorer, type GitPanelOpenFileOptions } from "../GitPanel";

interface ActiveRepositoryFilesPanelProps {
  activeRepositoryPath: string;
  activeRepositoryName?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  sectionCollapsed: boolean;
  onSectionCollapsedChange: (collapsed: boolean) => void;
}

export function ActiveRepositoryFilesPanel({
  activeRepositoryPath,
  activeRepositoryName,
  search,
  onSearchChange,
  onOpenFile,
  sectionCollapsed,
  onSectionCollapsedChange,
}: ActiveRepositoryFilesPanelProps) {
  return (
    <div
      className={
        "app-left-sidebar-files-explorer" +
        (sectionCollapsed ? " app-left-sidebar-files-explorer--section-collapsed" : "")
      }
    >
      {!sectionCollapsed ? (
        <div className="app-left-sidebar-files-explorer-search">
          <Input
            size="small"
            allowClear
            placeholder="搜索文件..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      ) : null}
      <div className="app-left-sidebar-files-explorer-body">
        <RepositoryFilesExplorer
          repositoryPath={activeRepositoryPath}
          repositoryLabel={
            activeRepositoryName?.trim() ||
            activeRepositoryPath.split(/[/\\]/).filter(Boolean).pop() ||
            "资源管理器"
          }
          search={search}
          onOpenFile={onOpenFile}
          onClearExplorerSearch={() => onSearchChange("")}
          sectionCollapsed={sectionCollapsed}
          onSectionCollapsedChange={onSectionCollapsedChange}
        />
      </div>
    </div>
  );
}
