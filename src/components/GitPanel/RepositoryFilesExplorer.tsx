import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { HoverHint } from "../shared/HoverHint";
import { Button, Empty, Input, Menu, Popconfirm, Spin } from "antd";
import {
  ExclamationCircleOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  MinusSquareOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { ExpandIcon } from "../LeftSidebar/SidebarIcons";
import { GitPanelWorkspaceSelector, type GitPanelWorkspaceSelectorProps } from "./GitPanelWorkspaceSelector";
import { ExplorerInlineCreateRow } from "./ExplorerInlineCreateRow";
import { ExplorerSearchResultList } from "./ExplorerSearchResultList";
import { RepositoryExplorerTreeActionsProvider } from "./RepositoryExplorerTreeActionsContext";
import { RepositoryExplorerGitStatusProvider } from "./RepositoryExplorerGitStatusContext";
import { flattenRepositoryTreeRows, type FlatRepositoryTreeRow } from "./repositoryTreeFlatten";
import { REPOSITORY_TREE_ROW_HEIGHT_PX } from "./repositoryTreeLayout";
import { RepositoryVirtualTreeList } from "./RepositoryVirtualTreeList";
import { MIN_EXPLORER_SEARCH_QUERY_LEN } from "./fileTree";
import type { GitPanelOpenFileOptions } from "./types";
import { useRepositoryFilesExplorer } from "./useRepositoryFilesExplorer";
import { useGitRepositoryExplorerStatus } from "../../hooks/useGitRepositoryExplorerStatus";
import { useRepositoryEditorDirtyPaths } from "../../hooks/useRepositoryEditorDirtyPaths";
import { useRepositoryExplorerPointerHover } from "../../hooks/useRepositoryExplorerPointerHover";
import { useScrollEndClass } from "../../hooks/useScrollEndClass";
import { LEFT_SIDEBAR_SCROLLING_CLASS } from "../../constants/leftSidebarScrollPerformance";
import { formatRepositoryExplorerLoadError } from "../../utils/repositoryPathAccessibility";
import type { ExplorerRevealTarget } from "../../utils/explorerRevealTarget";

type WorkspaceSelectorProps = Omit<GitPanelWorkspaceSelectorProps, "activeRepositoryPath">;

export interface RepositoryFilesExplorerProps {
  repositoryPath: string;
  repositoryLabel: string;
  search: string;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  onClearExplorerSearch?: () => void;
  /** Similar to the right Claude Code section: collapse to a title bar and click the repository name to expand. */
  sectionCollapsed?: boolean;
  onSectionCollapsedChange?: (collapsed: boolean) => void;
  /** 在仓库标题栏与文件树之间显示搜索框（左栏文件 Tab） */
  showSearchField?: boolean;
  onSearchChange?: (value: string) => void;
  /** 左栏整合头部：Tab 切换等，渲染在仓库标题左侧 */
  headerPrefix?: ReactNode;
  /** 与 Git 面板一致的工作区 / 仓库选择器 */
  workspaceSelector?: WorkspaceSelectorProps;
  /** 外层栏已展示仓库切换器时，隐藏文件树内标题栏 */
  hideContextHeader?: boolean;
  /** 多实例文件树并存时，用于搜索/外链打开后只定位到对应实例。 */
  explorerRevealTarget?: ExplorerRevealTarget;
  /**
   * 面板是否可见。隐藏态（keep-alive 的 hidden）时降级：跳过 git status reactive
   * 订阅与 hover，避免多 panel 并存时 N 倍渲染放大。默认 true。
   */
  active?: boolean;
}

export const RepositoryFilesExplorer = memo(function RepositoryFilesExplorer({
  repositoryPath,
  repositoryLabel,
  search,
  onOpenFile,
  onClearExplorerSearch,
  sectionCollapsed = false,
  onSectionCollapsedChange,
  showSearchField = false,
  onSearchChange,
  headerPrefix,
  workspaceSelector,
  hideContextHeader = false,
  explorerRevealTarget,
  active = true,
}: RepositoryFilesExplorerProps) {
  const trimmedRepositoryPath = repositoryPath.trim();
  const explorer = useRepositoryFilesExplorer({
    repositoryPath: trimmedRepositoryPath,
    search,
    onClearExplorerSearch,
    explorerRevealTarget,
  });
  const explorerGitStatus = useGitRepositoryExplorerStatus(trimmedRepositoryPath, active);
  const editorDirtyPaths = useRepositoryEditorDirtyPaths(trimmedRepositoryPath);
  const explorerDecorations = useMemo(
    () => ({
      generation: explorerGitStatus.generation,
      editorDirtyRevision: editorDirtyPaths.generation,
      getFileStatus: explorerGitStatus.getFileStatus,
      getDirStatus: explorerGitStatus.getDirStatus,
      dirHasChanges: (path: string) =>
        explorerGitStatus.dirHasChanges(path) || editorDirtyPaths.dirHasDirty(path),
      isEditorDirty: editorDirtyPaths.isDirty,
    }),
    [editorDirtyPaths, explorerGitStatus],
  );
  const trimmedSearch = search.trim();
  const searchActive = trimmedSearch.length > 0;
  const rootInline = explorer.inlineCreate?.parentDir === "" && !searchActive;
  const treeEmpty =
    !searchActive &&
    !explorer.hasRootLoaded &&
    !explorer.loading &&
    !rootInline;
  const searchListEmpty =
    searchActive &&
    !explorer.explorerSearchTooShort &&
    !explorer.explorerSearchPending &&
    !explorer.loading &&
    !explorer.isRefreshing &&
    explorer.searchResultRows.length === 0;

  const scrollRegionRef = useRef<HTMLDivElement>(null);
  useScrollEndClass(scrollRegionRef, [
    LEFT_SIDEBAR_SCROLLING_CLASS,
    "git-files-explorer-scroll-region--scrolling",
  ], 160, {
    relieveSidePanelPriority: true,
    relieveFileTreePriority: true,
  });
  const flatTreeRows = useMemo(
    () =>
      flattenRepositoryTreeRows({
        nodes: explorer.filteredTree,
        expandedDirs: explorer.expandedDirs,
        loadingDirKeys: explorer.loadingDirKeys,
        inlineCreate: explorer.inlineCreate,
      }),
    [
      explorer.filteredTree,
      explorer.expandedDirs,
      explorer.loadingDirKeys,
      explorer.inlineCreate,
      explorer.childrenMapRevision,
    ],
  );

  const pointerHoverRowsRef = useRef<readonly FlatRepositoryTreeRow[] | null>(flatTreeRows);
  pointerHoverRowsRef.current = flatTreeRows;
  const pointerHoverPath = useRepositoryExplorerPointerHover(
    scrollRegionRef,
    active && !searchActive,
    pointerHoverRowsRef,
  );

  const treeActions = useMemo(
    () => ({
      onToggleDir: explorer.handleToggleDir,
      onSelectNode: explorer.handleSelectNode,
      onOpenFile,
      onInlineValueChange: explorer.handleInlineValueChange,
      onInlineCommit: explorer.handleInlineCommit,
      onInlineCancel: explorer.cancelInlineCreate,
    }),
    [
      explorer.handleToggleDir,
      explorer.handleSelectNode,
      explorer.handleInlineValueChange,
      explorer.handleInlineCommit,
      explorer.cancelInlineCreate,
      onOpenFile,
    ],
  );

  const pathToRowIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < flatTreeRows.length; i++) {
      const row = flatTreeRows[i];
      if (row.kind === "file" || row.kind === "dir") {
        map.set(row.node.path, i);
      }
    }
    return map;
  }, [flatTreeRows]);

  useEffect(() => {
    const selectedPath = explorer.selected?.path?.trim();
    if (!selectedPath || searchActive) {
      return;
    }
    const index = pathToRowIndex.get(selectedPath);
    if (index === undefined) {
      return;
    }
    const el = scrollRegionRef.current;
    if (!el) {
      return;
    }
    const rowTop = index * REPOSITORY_TREE_ROW_HEIGHT_PX;
    const rowBottom = rowTop + REPOSITORY_TREE_ROW_HEIGHT_PX;
    if (rowTop < el.scrollTop) {
      el.scrollTop = rowTop;
    } else if (rowBottom > el.scrollTop + el.clientHeight) {
      // 留出底部 padding，避免定位到的文件紧贴视口底部
      const bottomPadding = Math.min(el.clientHeight * 0.3, 120);
      el.scrollTop = rowBottom - el.clientHeight + bottomPadding;
    }
  }, [explorer.selected?.path, pathToRowIndex, searchActive]);

  if (!trimmedRepositoryPath) {
    return (
      <div className="git-files-mode">
        <Empty description="请选择仓库以浏览文件" style={{ padding: "40px 0" }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }
  const setSectionCollapsed = onSectionCollapsedChange;
  const switchingRepositoryTree = explorer.treeStale && !explorer.hasRootLoaded;

  const treeBody = explorer.loadError ? (
    <Empty
      description={formatRepositoryExplorerLoadError(explorer.loadError, trimmedRepositoryPath)}
      style={{ padding: "24px 0" }}
      image={Empty.PRESENTED_IMAGE_SIMPLE}
    />
  ) : searchActive && trimmedSearch.length < MIN_EXPLORER_SEARCH_QUERY_LEN ? (
    <Empty
      description={`至少输入 ${MIN_EXPLORER_SEARCH_QUERY_LEN} 个字符`}
      style={{ padding: "24px 0" }}
      image={Empty.PRESENTED_IMAGE_SIMPLE}
    />
  ) : searchActive ? (
    searchListEmpty ? (
      <Empty
        description="未找到匹配文件"
        style={{ padding: "24px 0" }}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    ) : (
      <div
        className="repo-search-results-wrap"
        onContextMenu={explorer.handleExplorerContextMenu}
      >
        <ExplorerSearchResultList
          rows={explorer.searchResultRows}
          pending={explorer.explorerSearchPending}
          selectedPath={explorer.selected?.path ?? null}
          onSelect={explorer.handleSelectNode}
          onOpenFile={onOpenFile}
        />
      </div>
    )
  ) : treeEmpty ? (
    <Empty
      description="暂无文件"
      style={{ padding: "24px 0" }}
      image={Empty.PRESENTED_IMAGE_SIMPLE}
    />
  ) : (
    <div
      className="repo-tree-list"
      onContextMenu={explorer.handleExplorerContextMenu}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          explorer.clearSelection();
        }
      }}
    >
      {rootInline && explorer.inlineCreate ? (
        <ExplorerInlineCreateRow
          key={explorer.inlineRowKey}
          depth={0}
          kind={explorer.inlineCreate.type}
          value={explorer.inlineCreate.value}
          onChange={explorer.handleInlineValueChange}
          onCommit={() => void explorer.commitInlineCreate()}
          onCancel={explorer.cancelInlineCreate}
        />
      ) : null}
      <RepositoryExplorerTreeActionsProvider value={treeActions}>
        <RepositoryVirtualTreeList
          scrollRootRef={scrollRegionRef}
          rows={flatTreeRows}
          selectedPath={explorer.selected?.path ?? null}
          hoverPath={pointerHoverPath}
          loadingDirKeys={explorer.loadingDirKeys}
          inlineCreate={explorer.inlineCreate}
          onInlineValueChange={explorer.handleInlineValueChange}
          onInlineCommit={explorer.handleInlineCommit}
          onInlineCancel={explorer.cancelInlineCreate}
          gitStatusRevision={explorerDecorations.generation}
          editorDirtyRevision={explorerDecorations.editorDirtyRevision}
        />
      </RepositoryExplorerTreeActionsProvider>
    </div>
  );

  const toolbarInSearchRow = Boolean(showSearchField && onSearchChange);
  const explorerToolbarActions = (
    <span className="git-files-explorer-actions">
      <HoverHint title="新建文件">
        <Button
          type="text"
          size="small"
          icon={<FileAddOutlined />}
          onClick={explorer.handleToolbarNewFile}
          aria-label="新建文件"
        />
      </HoverHint>
      <HoverHint title="新建文件夹">
        <Button
          type="text"
          size="small"
          icon={<FolderAddOutlined />}
          onClick={explorer.handleToolbarNewFolder}
          aria-label="新建文件夹"
        />
      </HoverHint>
      <HoverHint title="刷新">
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          onClick={explorer.handleRefresh}
          aria-label="刷新"
        />
      </HoverHint>
      <HoverHint title="全部收起">
        <Button
          type="text"
          size="small"
          icon={<MinusSquareOutlined />}
          onClick={explorer.handleCollapseAll}
          aria-label="全部收起"
        />
      </HoverHint>
    </span>
  );

  const sectionCollapseButton =
    setSectionCollapsed != null ? (
      <HoverHint
        title={sectionCollapsed ? "展开文件树" : "收起文件树"}
       
      >
        <button
          type="button"
          className="git-files-explorer-section-collapse"
          aria-expanded={!sectionCollapsed}
          aria-label={sectionCollapsed ? "展开文件树" : "收起文件树"}
          onClick={() => setSectionCollapsed(!sectionCollapsed)}
        >
          <ExpandIcon expanded={!sectionCollapsed} />
        </button>
      </HoverHint>
    ) : null;

  return (
    <RepositoryExplorerGitStatusProvider value={explorerDecorations}>
    <div
      className={
        "git-files-mode" +
        (sectionCollapsed ? " git-files-mode--section-collapsed" : "") +
        (hideContextHeader ? " git-files-mode--context-header-hidden" : "")
      }
    >
      {!hideContextHeader ? (
      <div className="git-files-explorer-bar">
        {headerPrefix ? <div className="git-files-explorer-bar-prefix">{headerPrefix}</div> : null}
        {workspaceSelector ? (
          <div className="git-files-explorer-workspace-selector">
            <GitPanelWorkspaceSelector
              {...workspaceSelector}
              activeRepositoryPath={repositoryPath}
            />
          </div>
        ) : (
          <span className="git-files-explorer-title" title={repositoryPath}>
            <span className="git-files-explorer-title-icon-wrap" aria-hidden>
              <FolderOpenOutlined />
            </span>
            <span className="git-files-explorer-title-text">{repositoryLabel || "资源管理器"}</span>
          </span>
        )}
        {sectionCollapseButton}
        {!sectionCollapsed && !toolbarInSearchRow ? explorerToolbarActions : null}
      </div>
      ) : null}
      {!sectionCollapsed && toolbarInSearchRow ? (
        <div className="git-files-explorer-search">
          <Input
            className="git-files-explorer-search-field"
            size="small"
            allowClear
            placeholder="搜索文件..."
            value={search}
            onChange={(e) => onSearchChange?.(e.target.value)}
          />
          {explorerToolbarActions}
        </div>
      ) : null}
      {!sectionCollapsed ? (
      <div
        ref={scrollRegionRef}
        className={`git-files-explorer-scroll-region${
          explorer.isRefreshing && explorer.filteredTree.length === 0
            ? " git-files-explorer-scroll-region--refreshing"
            : ""
        }`}
      >
        {(explorer.loading || explorer.isRefreshing || switchingRepositoryTree) &&
        explorer.filteredTree.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <Spin size="small" description={switchingRepositoryTree ? "切换文件树中..." : "加载文件中..."} />
          </div>
        ) : (
          <>
            {explorer.treeStale ? (
              <div className="git-files-explorer-stale-hint" aria-live="polite">
                正在加载文件树…
              </div>
            ) : null}
            {searchActive && explorer.explorerSearchTruncated ? (
              <div className="git-files-explorer-stale-hint" aria-live="polite">
                匹配结果过多，仅显示前 500 项，请细化关键词
              </div>
            ) : null}
            {treeBody}
          </>
        )}
      </div>
      ) : null}
      {!sectionCollapsed && explorer.explorerCtx ? (
        <>
          <div
            className="git-files-ctx-backdrop"
            role="presentation"
            aria-hidden
            onMouseDown={() => explorer.setExplorerCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              explorer.setExplorerCtx(null);
            }}
          />
          <Menu
            className="git-files-ctx-menu"
            classNames={{ popup: { root: "git-files-ctx-menu-popup" } }}
            style={{ position: "fixed", left: explorer.explorerCtx.x, top: explorer.explorerCtx.y, zIndex: 1050 }}
            selectable={false}
            items={explorer.explorerContextMenuItems}
          />
        </>
      ) : null}
      {!sectionCollapsed && explorer.deletePop ? (
        <Popconfirm
          open
          title="确认删除"
          description={
            <div className="git-files-delete-pop-desc">
              {explorer.deletePop.isDir ? (
                <p>
                  将<strong>递归删除</strong>该文件夹及其中的全部内容，且<strong>不可恢复</strong>。
                </p>
              ) : (
                <p>
                  将永久删除该文件，且<strong>不可恢复</strong>。
                </p>
              )}
              <p className="git-files-delete-pop-path">
                <code>{explorer.deletePop.path}</code>
              </p>
            </div>
          }
          okText="确认删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          placement="bottomLeft"
          zIndex={1100}
          icon={<ExclamationCircleOutlined className="git-files-delete-pop-icon" aria-hidden />}
          getPopupContainer={() => document.body}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              explorer.setDeletePop(null);
            }
          }}
          onConfirm={async () => {
            const ok = await explorer.performDeletePath(explorer.deletePop!.path);
            if (ok) {
              explorer.setDeletePop(null);
            }
          }}
        >
          <span
            className="git-files-delete-pop-anchor"
            style={{
              position: "fixed",
              left: explorer.deletePop.x,
              top: explorer.deletePop.y,
              width: 1,
              height: 1,
              overflow: "hidden",
              pointerEvents: "none",
            }}
            aria-hidden
          />
        </Popconfirm>
      ) : null}
    </div>
    </RepositoryExplorerGitStatusProvider>
  );
});
