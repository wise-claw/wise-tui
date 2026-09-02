import { CloseOutlined } from "@ant-design/icons";
import { Spin } from "antd";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActiveRepositoryFilesPanel } from "../LeftSidebar/ActiveRepositoryFilesPanel";
import { LeftSidebarBottomTabPanes } from "../LeftSidebar/LeftSidebarBottomTabPanes";
import { LeftSidebarBottomTabSwitcher } from "../LeftSidebar/LeftSidebarBottomTabSwitcher";
import type { LeftBottomTab } from "../LeftSidebar/sidebarStorage";
import { HoverHint } from "../shared/HoverHint";
import type { WorkspaceFileTreeRailContext } from "./types";
import "./index.css";

const GitPanelLazy = lazy(() => import("../GitPanel").then((module) => ({ default: module.GitPanel })));

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
  repositoryEntries = [],
  onOpenFile,
  onClose,
}: WorkspaceFileTreeRailProps) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<LeftBottomTab>("files");
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

  const headerPrefix = useMemo((): ReactNode => {
    return (
      <div className="app-workspace-file-tree-rail__prefix">
        <LeftSidebarBottomTabSwitcher
          activeTab={activeTab}
          onChange={setActiveTab}
          repositoryPath={trimmedRepositoryPath}
        />
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
      </div>
    );
  }, [activeTab, onClose, trimmedRepositoryPath]);

  const gitPane = useMemo(
    () => (
      <Suspense
        fallback={
          <div className="app-file-editor-loading">
            <Spin size="small" />
          </div>
        }
      >
        <GitPanelLazy
          headerPrefix={headerPrefix}
          repositoryPath={trimmedRepositoryPath}
          repositoryName={repositoryName}
          repositoryEntries={repositoryEntries}
          onOpenFile={handleOpenFile}
          lazyMount
        />
      </Suspense>
    ),
    [handleOpenFile, headerPrefix, repositoryEntries, repositoryName, trimmedRepositoryPath],
  );

  const filesPane = useMemo(
    () => (
      <ActiveRepositoryFilesPanel
        headerPrefix={headerPrefix}
        activeRepositoryPath={trimmedRepositoryPath}
        activeRepositoryName={repositoryName}
        search={search}
        onSearchChange={setSearch}
        onOpenFile={handleOpenFile}
        variant="workspace-rail"
      />
    ),
    [handleOpenFile, headerPrefix, repositoryName, search, trimmedRepositoryPath],
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
      {trimmedRepositoryPath ? (
        <div className="app-workspace-file-tree-rail__tabs">
          <LeftSidebarBottomTabPanes
            showGit={activeTab === "git"}
            showFiles={activeTab === "files"}
            panelsReady
            gitPane={gitPane}
            filesPane={filesPane}
          />
        </div>
      ) : (
        <div className="app-workspace-file-tree-rail-empty">请先选择仓库以浏览文件</div>
      )}
    </aside>
  );
});
