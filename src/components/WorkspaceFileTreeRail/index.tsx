import { CloseOutlined } from "@ant-design/icons";
import { memo, useCallback, useEffect, useState } from "react";
import { GitPanelWorkspaceSelector } from "../GitPanel/GitPanelWorkspaceSelector";
import { ActiveRepositoryFilesPanel } from "../LeftSidebar/ActiveRepositoryFilesPanel";
import { HoverHint } from "../shared/HoverHint";
import type { WorkspaceFileTreeRailContext } from "./types";
import "./index.css";

export interface WorkspaceFileTreeRailProps extends WorkspaceFileTreeRailContext {
  widthPx: number;
  /** 左栏收起时文件树贴窗口左缘，需为 macOS 交通灯预留标题栏内边距。 */
  macTitlebarInset?: boolean;
  onClose: () => void;
}

export const WorkspaceFileTreeRail = memo(function WorkspaceFileTreeRail({
  widthPx,
  macTitlebarInset = false,
  repositoryPath = "",
  repositoryName,
  workspaceSelector,
  onOpenFile,
  onClose,
}: WorkspaceFileTreeRailProps) {
  const [search, setSearch] = useState("");
  const trimmedRepositoryPath = repositoryPath.trim();

  useEffect(() => {
    setSearch("");
  }, [trimmedRepositoryPath]);

  const handleOpenFile = useCallback(
    (path: string, options?: Parameters<typeof onOpenFile>[1]) => {
      onOpenFile(path, { ...options, fromFileTree: true });
    },
    [onOpenFile],
  );

  return (
    <aside
      className={
        "app-workspace-file-tree-rail" +
        (macTitlebarInset ? " app-workspace-file-tree-rail--mac-titlebar-inset" : "")
      }
      style={{ width: widthPx, flexBasis: widthPx, maxWidth: widthPx }}
      aria-label="文件树"
    >
      <header className="app-workspace-file-tree-rail__header">
        <div className="app-workspace-file-tree-rail__selector">
          <GitPanelWorkspaceSelector
            {...workspaceSelector}
            activeRepositoryPath={trimmedRepositoryPath}
          />
        </div>
        <HoverHint title="关闭文件树">
          <button
            type="button"
            className="app-workspace-file-tree-rail__close"
            aria-label="关闭文件树"
            onClick={onClose}
          >
            <CloseOutlined />
          </button>
        </HoverHint>
      </header>
      <div className="app-workspace-file-tree-rail__body">
        {trimmedRepositoryPath ? (
          <ActiveRepositoryFilesPanel
            activeRepositoryPath={trimmedRepositoryPath}
            activeRepositoryName={repositoryName}
            search={search}
            onSearchChange={setSearch}
            onOpenFile={handleOpenFile}
            sectionCollapsed={false}
            variant="workspace-rail"
          />
        ) : (
          <div className="app-workspace-file-tree-rail-empty">请先选择仓库以浏览文件</div>
        )}
      </div>
    </aside>
  );
});
