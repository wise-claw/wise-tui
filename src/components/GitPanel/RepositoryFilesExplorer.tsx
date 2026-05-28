import type { ReactNode } from "react";
import { Button, Empty, Input, Menu, Popconfirm, Spin, Tooltip } from "antd";
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
import { RepositoryTreeNode } from "./RepositoryTreeNode";
import type { GitPanelOpenFileOptions } from "./types";
import { useRepositoryFilesExplorer } from "./useRepositoryFilesExplorer";

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
  /** 收起态由外部头部承接时，不再渲染内置收起行 */
  hideCollapsedChrome?: boolean;
  /** 与 Git 面板一致的工作区 / 仓库选择器 */
  workspaceSelector?: WorkspaceSelectorProps;
}

export function RepositoryFilesExplorer({
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
  hideCollapsedChrome = false,
  workspaceSelector,
}: RepositoryFilesExplorerProps) {
  const trimmedRepositoryPath = repositoryPath.trim();
  const explorer = useRepositoryFilesExplorer({
    repositoryPath: trimmedRepositoryPath,
    search,
    onClearExplorerSearch,
  });
  const rootInline = explorer.inlineCreate?.parentDir === "";
  const treeEmpty = explorer.filteredTree.length === 0 && !rootInline;

  if (!trimmedRepositoryPath) {
    return (
      <div className="git-files-mode">
        <Empty description="请选择仓库以浏览文件" style={{ padding: "40px 0" }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }
  const setSectionCollapsed = onSectionCollapsedChange;
  const switchingRepositoryTree = explorer.treeStale && explorer.explorerEntries.length === 0;

  if (sectionCollapsed && setSectionCollapsed) {
    if (hideCollapsedChrome) {
      return <div className="git-files-mode git-files-mode--section-collapsed git-files-mode--external-header" />;
    }
    const label = repositoryLabel || "资源管理器";
    return (
      <div className="git-files-mode git-files-mode--section-collapsed">
        <div className="app-repository-row app-left-sidebar-files-explorer-collapsed-row">
          <div
            className="app-repository-item app-repository-item--repo app-repository-item--files-root app-repository-item--files-root-collapsed"
            title={repositoryPath}
          >
            <span
              className="app-repository-expand"
              role="button"
              tabIndex={0}
              aria-expanded={false}
              aria-label="展开文件树"
              onClick={(e) => {
                e.stopPropagation();
                setSectionCollapsed(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setSectionCollapsed(false);
                }
              }}
            >
              <ExpandIcon expanded={false} />
            </span>
            <span
              className="app-repository-icon-wrap app-left-sidebar-files-explorer-collapsed-hit"
              role="button"
              tabIndex={0}
              aria-label={`展开 ${label}`}
              onClick={() => setSectionCollapsed(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSectionCollapsed(false);
                }
              }}
            >
              <span className="app-repository-icon app-repository-icon--folder">
                <FolderOpenOutlined />
              </span>
            </span>
            <span
              className="app-repository-name app-left-sidebar-files-explorer-collapsed-hit"
              role="button"
              tabIndex={0}
              onClick={() => setSectionCollapsed(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSectionCollapsed(false);
                }
              }}
            >
              {label}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const treeBody = explorer.loadError ? (
    <Empty
      description={`文件树加载失败：${explorer.loadError}`}
      style={{ padding: "24px 0" }}
      image={Empty.PRESENTED_IMAGE_SIMPLE}
    />
  ) : treeEmpty ? (
    <Empty
      description={search.trim() ? "未找到匹配文件" : "暂无文件"}
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
      {explorer.filteredTree.map((node) => (
        <RepositoryTreeNode
          key={node.path}
          node={node}
          expandedDirs={explorer.expandedDirs}
          selectedPath={explorer.selected?.path ?? null}
          onToggleDir={explorer.handleToggleDir}
          onOpenFile={onOpenFile}
          depth={0}
          onSelectNode={explorer.handleSelectNode}
          inlineCreate={explorer.inlineCreate}
          onInlineValueChange={explorer.handleInlineValueChange}
          onInlineCommit={explorer.handleInlineCommit}
          onInlineCancel={explorer.cancelInlineCreate}
        />
      ))}
    </div>
  );

  const toolbarInSearchRow = Boolean(showSearchField && onSearchChange);
  const explorerToolbarActions = (
    <span className="git-files-explorer-actions">
      <Tooltip title="新建文件">
        <Button
          type="text"
          size="small"
          icon={<FileAddOutlined />}
          onClick={explorer.handleToolbarNewFile}
          aria-label="新建文件"
        />
      </Tooltip>
      <Tooltip title="新建文件夹">
        <Button
          type="text"
          size="small"
          icon={<FolderAddOutlined />}
          onClick={explorer.handleToolbarNewFolder}
          aria-label="新建文件夹"
        />
      </Tooltip>
      <Tooltip title="刷新">
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          onClick={explorer.handleRefresh}
          aria-label="刷新"
        />
      </Tooltip>
      <Tooltip title="全部收起">
        <Button
          type="text"
          size="small"
          icon={<MinusSquareOutlined />}
          onClick={explorer.handleCollapseAll}
          aria-label="全部收起"
        />
      </Tooltip>
    </span>
  );

  return (
    <div className="git-files-mode">
      <div className="git-files-explorer-bar">
        {headerPrefix ? <div className="git-files-explorer-bar-prefix">{headerPrefix}</div> : null}
        {workspaceSelector ? (
          <div className="git-files-explorer-workspace-selector">
            <GitPanelWorkspaceSelector
              {...workspaceSelector}
              activeRepositoryPath={repositoryPath}
            />
          </div>
        ) : setSectionCollapsed ? (
          <Tooltip title="点击收起文件树" mouseEnterDelay={0.35}>
            <button
              type="button"
              className="git-files-explorer-title git-files-explorer-title--toggle git-files-explorer-title--with-expand"
              title={repositoryPath}
              onClick={() => setSectionCollapsed(true)}
            >
              <span className="git-files-explorer-expand" aria-hidden>
                <ExpandIcon expanded />
              </span>
              <span className="git-files-explorer-title-icon-wrap" aria-hidden>
                <FolderOpenOutlined />
              </span>
              <span className="git-files-explorer-title-text">{repositoryLabel || "资源管理器"}</span>
            </button>
          </Tooltip>
        ) : (
          <span className="git-files-explorer-title" title={repositoryPath}>
            <span className="git-files-explorer-title-icon-wrap" aria-hidden>
              <FolderOpenOutlined />
            </span>
            <span className="git-files-explorer-title-text">{repositoryLabel || "资源管理器"}</span>
          </span>
        )}
        {workspaceSelector && setSectionCollapsed ? (
          <Tooltip title="收起文件树" mouseEnterDelay={0.35}>
            <Button
              type="text"
              size="small"
              className="git-files-explorer-section-collapse"
              aria-label="收起文件树"
              icon={<ExpandIcon expanded />}
              onClick={() => setSectionCollapsed(true)}
            />
          </Tooltip>
        ) : null}
        {!toolbarInSearchRow ? explorerToolbarActions : null}
      </div>
      {toolbarInSearchRow ? (
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
      <div
        className={`git-files-explorer-scroll-region${explorer.isRefreshing ? " git-files-explorer-scroll-region--refreshing" : ""}`}
      >
        {(explorer.loading || explorer.isRefreshing || switchingRepositoryTree) && explorer.explorerEntries.length === 0 ? (
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
            {treeBody}
          </>
        )}
      </div>
      {explorer.explorerCtx ? (
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
  );
}
