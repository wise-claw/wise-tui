import { FolderOpenOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Empty, Space, Tag, Tooltip } from "antd";
import type { StandaloneRepo, Workspace } from "../../../types";
import { repositoryFolderBasename } from "../../../utils/repositoryType";

interface WorkspacesTabProps {
  workspaces: Workspace[];
  standaloneRepos: StandaloneRepo[];
  activeWorkspaceId: string | null;
  activeRepositoryId: number | null;
  onCreateWorkspace: () => void;
  onAddStandaloneRepo?: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectStandaloneRepo: (repositoryId: number) => void;
}

export function WorkspacesTab({
  workspaces,
  standaloneRepos,
  activeWorkspaceId,
  activeRepositoryId,
  onCreateWorkspace,
  onAddStandaloneRepo,
  onSelectWorkspace,
  onSelectStandaloneRepo,
}: WorkspacesTabProps) {
  const hasItems = workspaces.length > 0 || standaloneRepos.length > 0;

  return (
    <div className="author-panel-workspaces">
      <header className="author-panel-workspaces__page-head">
        <div className="author-panel-workspaces__page-head-row">
          <h1 className="author-panel-workspaces__page-title">工作区</h1>
          <Space size={8} wrap className="author-panel-workspaces__page-actions">
            <Tooltip title="添加一个不接入 Trellis / Mission 的轻量仓库">
              <Button size="small" onClick={onAddStandaloneRepo} disabled={!onAddStandaloneRepo}>
                添加单仓
              </Button>
            </Tooltip>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={onCreateWorkspace}>
              新建工作区
            </Button>
          </Space>
        </div>
        <p className="author-panel-workspaces__page-subtitle">项目、仓库和 Trellis 根目录</p>
      </header>

      {!hasItems ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有工作区或单仓，请先新建工作区或添加单仓" />
      ) : (
        <>
          <section className="author-panel-workspaces__section">
            <h3 className="author-panel-workspaces__section-label">工作区</h3>
            <div className="author-panel-workspaces__card">
              {workspaces.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无工作区" />
              ) : (
                <div className="author-panel-workspaces__list">
                  {workspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      type="button"
                      className={`author-panel-workspace-row${workspace.id === activeWorkspaceId ? " author-panel-workspace-row--active" : ""}`}
                      onClick={() => onSelectWorkspace(workspace.id)}
                    >
                      <span className="author-panel-workspace-row__main">
                        <span className="author-panel-workspace-row__name">{workspace.name}</span>
                        <span className="author-panel-workspace-row__meta">
                          {workspace.repositoryIds.length} 个仓库
                          {workspace.rootPath ? ` · ${workspace.rootPath}` : " · 未绑定 Trellis 根目录"}
                        </span>
                      </span>
                      <span className="author-panel-workspace-row__tags">
                        <Tag color={workspace.rootPath ? "success" : "warning"}>
                          {workspace.rootPath ? "根目录就绪" : "待绑定"}
                        </Tag>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="author-panel-workspaces__section">
            <h3 className="author-panel-workspaces__section-label">单仓入口</h3>
            <div className="author-panel-workspaces__card">
              {standaloneRepos.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无单仓入口" />
              ) : (
                <div className="author-panel-workspaces__list">
                  {standaloneRepos.map((repo) => (
                    <button
                      key={repo.id}
                      type="button"
                      className={`author-panel-workspace-row${repo.id === activeRepositoryId && !activeWorkspaceId ? " author-panel-workspace-row--active" : ""}`}
                      onClick={() => onSelectStandaloneRepo(repo.id)}
                    >
                      <span className="author-panel-workspace-row__main">
                        <span className="author-panel-workspace-row__name">{repositoryFolderBasename(repo)}</span>
                        <span className="author-panel-workspace-row__meta">{repo.path}</span>
                      </span>
                      <span className="author-panel-workspace-row__tags">
                        <Tag icon={<FolderOpenOutlined />}>单仓会话</Tag>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
