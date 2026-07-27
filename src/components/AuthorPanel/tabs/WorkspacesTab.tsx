import { FolderOpenOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Empty, Space, Tag } from "antd";
import type { Repository, StandaloneRepo, Workspace } from "../../../types";
import { repositoryFolderBasename } from "../../../utils/repositoryType";
import { collectFlatWorkspaceRepositories } from "../../../utils/repositoryWorkspaceTree";
import { AuthorPanelPageShell } from "../AuthorPanelPageShell";

interface WorkspacesTabProps {
  workspaces: Workspace[];
  repositories: Repository[];
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
  repositories,
  standaloneRepos,
  activeWorkspaceId,
  activeRepositoryId,
  onCreateWorkspace,
  onAddStandaloneRepo,
  onSelectWorkspace,
  onSelectStandaloneRepo,
}: WorkspacesTabProps) {
  const flatRepos = collectFlatWorkspaceRepositories(repositories, standaloneRepos);
  const hasItems = workspaces.length > 0 || flatRepos.length > 0;

  return (
    <AuthorPanelPageShell
      className="author-panel-workspaces"
      icon={<FolderOpenOutlined />}
      title="工作区"
      subtitle="仓库即工作区；多仓 Project 仍可作为高级编排入口"
      actions={
        <Space size={8} wrap>
          <Button size="small" type="primary" onClick={onAddStandaloneRepo} disabled={!onAddStandaloneRepo}>
            添加仓库
          </Button>
          <Button size="small" icon={<PlusOutlined />} onClick={onCreateWorkspace}>
            多仓编排（高级）
          </Button>
        </Space>
      }
    >
      {!hasItems ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有仓库，请先添加仓库" />
      ) : (
        <>
          <section className="author-panel-workspaces__section">
            <h3 className="author-panel-workspaces__section-label">仓库（工作区）</h3>
            <div className="author-panel-workspaces__card">
              {flatRepos.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无仓库" />
              ) : (
                <div className="author-panel-workspaces__list">
                  {flatRepos.map((repo) => (
                    <button
                      key={repo.id}
                      type="button"
                      className={`author-panel-workspace-row${repo.id === activeRepositoryId ? " author-panel-workspace-row--active" : ""}`}
                      onClick={() => onSelectStandaloneRepo(repo.id)}
                    >
                      <span className="author-panel-workspace-row__main">
                        <span className="author-panel-workspace-row__name">{repositoryFolderBasename(repo)}</span>
                        <span className="author-panel-workspace-row__meta">{repo.path}</span>
                      </span>
                      <span className="author-panel-workspace-row__tags">
                        <Tag
                          icon={<FolderOpenOutlined />}
                          color={repo.sddMode === "wise_trellis" ? "success" : "default"}
                        >
                          {repo.sddMode === "wise_trellis" ? "Trellis 已启用" : "仓库工作区"}
                        </Tag>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="author-panel-workspaces__section">
            <h3 className="author-panel-workspaces__section-label">多仓编排（高级）</h3>
            <div className="author-panel-workspaces__card">
              {workspaces.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无多仓 Project" />
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
                          {workspace.rootPath ? ` · ${workspace.rootPath}` : " · 未绑定根目录"}
                        </span>
                      </span>
                      <span className="author-panel-workspace-row__tags">
                        <Tag color={workspace.sddMode === "wise_trellis" ? "success" : "default"}>
                          {workspace.sddMode === "wise_trellis" ? "Trellis 已启用" : "Claude Code 工作区"}
                        </Tag>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </AuthorPanelPageShell>
  );
}
