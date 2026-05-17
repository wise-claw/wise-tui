import { Button, Empty, Space, Tag, Tooltip, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
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
      <div className="author-panel-section-header">
        <div>
          <Typography.Title level={5}>Workspace Registry</Typography.Title>
          <Typography.Text type="secondary">
            Workspace is the Trellis and Mission scope. Standalone Repo stays lightweight for Chat, Git, files, and code graph.
          </Typography.Text>
        </div>
        <Space size={8}>
          <Tooltip title="Add a single repository without Trellis or Author governance">
            <Button size="small" onClick={onAddStandaloneRepo} disabled={!onAddStandaloneRepo}>
              Add Standalone Repo
            </Button>
          </Tooltip>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={onCreateWorkspace}>
            New Workspace
          </Button>
        </Space>
      </div>

      {!hasItems ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Workspace or Standalone Repo registered yet" />
      ) : (
        <div className="author-panel-workspaces__grid">
          <section className="author-panel-workspaces__column">
            <div className="author-panel-workspaces__column-title">Workspaces</div>
            {workspaces.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Workspace" />
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
                        {workspace.repositoryIds.length} repo{workspace.repositoryIds.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="author-panel-workspace-row__tags">
                      <Tag color={workspace.rootPath ? "success" : "warning"}>{workspace.rootPath ? "root ready" : "no root"}</Tag>
                      <Tag>{workspace.sddMode ?? "wise_trellis"}</Tag>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="author-panel-workspaces__column">
            <div className="author-panel-workspaces__column-title">Standalone Repos</div>
            {standaloneRepos.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Standalone Repo" />
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
                    <Tag>chat only</Tag>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
