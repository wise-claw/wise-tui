import { memo, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HoverHint } from "../shared/HoverHint";
import { Button, Empty, Input, Menu, Popconfirm, Spin } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import {
  ExplorerToolbarCollapseAllIcon,
  ExplorerToolbarNewFileIcon,
  ExplorerToolbarNewFolderIcon,
  ExplorerToolbarRefreshIcon,
} from "./explorerTreeChrome";
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
import {
  clampExplorerMenuPosition,
} from "./explorerUtils";

/** 高于终端 / composer 浮层，避免底部右键菜单被盖住。 */
const EXPLORER_CONTEXT_MENU_Z_INDEX = 5000;
const EXPLORER_CONTEXT_SUBMENU_Z_INDEX = 5010;

export interface RepositoryFilesExplorerProps {
  repositoryPath: string;
  repositoryLabel: string;
  search: string;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  onClearExplorerSearch?: () => void;
  /** 在仓库标题栏与文件树之间显示搜索框（左栏文件 Tab） */
  showSearchField?: boolean;
  onSearchChange?: (value: string) => void;
  /** 左栏整合头部：Tab 切换等 */
  headerPrefix?: ReactNode;
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
  repositoryLabel: _repositoryLabel,
  search,
  onOpenFile,
  onClearExplorerSearch,
  showSearchField = false,
  onSearchChange,
  headerPrefix,
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
        inlineRename: explorer.inlineRename,
      }),
    [
      explorer.filteredTree,
      explorer.expandedDirs,
      explorer.loadingDirKeys,
      explorer.inlineCreate,
      explorer.inlineRename,
      explorer.childrenMapRevision,
    ],
  );

  const pointerHoverRowsRef = useRef<readonly FlatRepositoryTreeRow[] | null>(flatTreeRows);
  pointerHoverRowsRef.current = flatTreeRows;
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const ctxMenuAdjustedForRef = useRef<string | null>(null);

  // 菜单挂载后按实测宽高上移/左移，避免贴底/贴右时被视口裁切。
  useLayoutEffect(() => {
    const ctx = explorer.explorerCtx;
    if (!ctx) {
      ctxMenuAdjustedForRef.current = null;
      return;
    }
    const adjustKey = `${ctx.path}@${ctx.x},${ctx.y}`;
    if (ctxMenuAdjustedForRef.current === adjustKey) {
      return;
    }
    const el = ctxMenuRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      return;
    }
    const next = clampExplorerMenuPosition(ctx.x, ctx.y, {
      width: rect.width,
      height: rect.height,
    });
    ctxMenuAdjustedForRef.current = `${ctx.path}@${next.x},${next.y}`;
    if (next.x !== ctx.x || next.y !== ctx.y) {
      explorer.setExplorerCtx({ ...ctx, x: next.x, y: next.y });
    }
  }, [explorer.explorerCtx, explorer.setExplorerCtx]);
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
          inlineRename={explorer.inlineRename}
          onInlineValueChange={explorer.handleInlineValueChange}
          onInlineCommit={explorer.handleInlineCommit}
          onInlineCancel={explorer.cancelInlineCreate}
          onInlineRenameCommit={explorer.handleInlineRenameCommit}
          gitStatusRevision={explorerDecorations.generation}
          editorDirtyRevision={explorerDecorations.editorDirtyRevision}
        />
      </RepositoryExplorerTreeActionsProvider>
    </div>
  );

  const showSearchRow = Boolean(showSearchField && onSearchChange);
  const explorerToolbarActions = (
    <span className="git-files-explorer-actions">
      <HoverHint title="新建文件">
        <Button
          type="text"
          size="small"
          icon={<ExplorerToolbarNewFileIcon />}
          onClick={explorer.handleToolbarNewFile}
          aria-label="新建文件"
        />
      </HoverHint>
      <HoverHint title="新建文件夹">
        <Button
          type="text"
          size="small"
          icon={<ExplorerToolbarNewFolderIcon />}
          onClick={explorer.handleToolbarNewFolder}
          aria-label="新建文件夹"
        />
      </HoverHint>
      <HoverHint title="刷新">
        <Button
          type="text"
          size="small"
          icon={<ExplorerToolbarRefreshIcon />}
          onClick={explorer.handleRefresh}
          aria-label="刷新"
        />
      </HoverHint>
      <HoverHint title="全部收起">
        <Button
          type="text"
          size="small"
          icon={<ExplorerToolbarCollapseAllIcon />}
          onClick={explorer.handleCollapseAll}
          aria-label="全部收起"
        />
      </HoverHint>
    </span>
  );

  return (
    <RepositoryExplorerGitStatusProvider value={explorerDecorations}>
    <div
      className={
        "git-files-mode" +
        (hideContextHeader ? " git-files-mode--context-header-hidden" : "")
      }
    >
      <div className="git-files-explorer-bar">
        {!hideContextHeader && headerPrefix ? (
          <div className="git-files-explorer-bar-prefix">{headerPrefix}</div>
        ) : null}
        {explorerToolbarActions}
      </div>
      {showSearchRow ? (
        <div className="git-files-explorer-search">
          <Input
            className="git-files-explorer-search-field"
            size="small"
            allowClear
            placeholder="搜索文件..."
            value={search}
            onChange={(e) => onSearchChange?.(e.target.value)}
          />
        </div>
      ) : null}
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
      {explorer.explorerCtx
        ? createPortal(
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
              <div
                ref={ctxMenuRef}
                className="git-files-ctx-menu-anchor"
                style={{
                  position: "fixed",
                  left: explorer.explorerCtx.x,
                  top: explorer.explorerCtx.y,
                  zIndex: EXPLORER_CONTEXT_MENU_Z_INDEX,
                }}
              >
                <Menu
                  className="git-files-ctx-menu"
                  classNames={{ popup: { root: "git-files-ctx-menu-popup" } }}
                  styles={{ popup: { root: { zIndex: EXPLORER_CONTEXT_SUBMENU_Z_INDEX } } }}
                  getPopupContainer={() => document.body}
                  selectable={false}
                  items={explorer.explorerContextMenuItems}
                />
              </div>
            </>,
            document.body,
          )
        : null}
      {explorer.deletePop ? (
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
