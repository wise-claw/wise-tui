import { Button, Empty, Menu, Popconfirm, Spin, Tooltip } from "antd";
import {
  ExclamationCircleOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  MinusSquareOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { ExplorerInlineCreateRow } from "./ExplorerInlineCreateRow";
import { RepositoryTreeNode } from "./RepositoryTreeNode";
import type { GitPanelOpenFileOptions } from "./types";
import { useRepositoryFilesExplorer } from "./useRepositoryFilesExplorer";

export interface RepositoryFilesExplorerProps {
  repositoryPath: string;
  repositoryLabel: string;
  search: string;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  onClearExplorerSearch?: () => void;
  /** Similar to the right Claude Code section: collapse to a title bar and click the repository name to expand. */
  sectionCollapsed?: boolean;
  onSectionCollapsedChange?: (collapsed: boolean) => void;
}

export function RepositoryFilesExplorer({
  repositoryPath,
  repositoryLabel,
  search,
  onOpenFile,
  onClearExplorerSearch,
  sectionCollapsed = false,
  onSectionCollapsedChange,
}: RepositoryFilesExplorerProps) {
  const explorer = useRepositoryFilesExplorer({
    repositoryPath,
    search,
    onClearExplorerSearch,
  });
  const rootInline = explorer.inlineCreate?.parentDir === "";
  const treeEmpty = explorer.filteredTree.length === 0 && !rootInline;
  const setSectionCollapsed = onSectionCollapsedChange;

  if (sectionCollapsed && setSectionCollapsed) {
    return (
      <div className="git-files-mode git-files-mode--section-collapsed">
        <div className="git-files-explorer-bar">
          <Tooltip title="点击展开文件树" mouseEnterDelay={0.35}>
            <button
              type="button"
              className="git-files-explorer-title git-files-explorer-title--toggle"
              title={repositoryPath}
              onClick={() => setSectionCollapsed(false)}
            >
              <span className="git-files-explorer-title-icon-wrap" aria-hidden>
                <FolderOpenOutlined />
              </span>
              <span className="git-files-explorer-title-text">{repositoryLabel || "资源管理器"}</span>
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }

  const treeBody = treeEmpty ? (
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

  return (
    <div className="git-files-mode">
      <div className="git-files-explorer-bar">
        {setSectionCollapsed ? (
          <Tooltip title="点击收起文件树" mouseEnterDelay={0.35}>
            <button
              type="button"
              className="git-files-explorer-title git-files-explorer-title--toggle"
              title={repositoryPath}
              onClick={() => setSectionCollapsed(true)}
            >
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
      </div>
      <div className="git-files-explorer-scroll-region">
        {explorer.loading && explorer.explorerEntries.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <Spin size="small" description="加载文件中..." />
          </div>
        ) : (
          treeBody
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
