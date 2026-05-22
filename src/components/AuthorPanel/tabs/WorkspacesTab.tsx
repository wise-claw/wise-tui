import { FolderOpenOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Empty, Space, Tag, Tooltip } from "antd";
import type { Repository, StandaloneRepo, Workspace } from "../../../types";
import { repositoryFolderBasename } from "../../../utils/repositoryType";
import { ProjectTrellisCenter } from "../../ProjectTrellisCenter";
import { AuthorPanelPageShell } from "../AuthorPanelPageShell";

interface WorkspacesTabProps {
  workspaces: Workspace[];
  repositories: Repository[];
  standaloneRepos: StandaloneRepo[];
  activeWorkspaceId: string | null;
  activeRepositoryId: number | null;
  trellisWorkspaceId?: string | null;
  onCreateWorkspace: () => void;
  onAddStandaloneRepo?: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectStandaloneRepo: (repositoryId: number) => void;
  onOpenProjectSession?: (workspace: Workspace) => void | Promise<void>;
  onRequestSpecAgentUpdate?: (workspace: Workspace, area: string) => void | Promise<void>;
}

export function WorkspacesTab({
  workspaces,
  repositories,
  standaloneRepos,
  activeWorkspaceId,
  activeRepositoryId,
  trellisWorkspaceId,
  onCreateWorkspace,
  onAddStandaloneRepo,
  onSelectWorkspace,
  onSelectStandaloneRepo,
  onOpenProjectSession,
  onRequestSpecAgentUpdate,
}: WorkspacesTabProps) {
  const hasItems = workspaces.length > 0 || standaloneRepos.length > 0;
  const standaloneTrellisRepoId = trellisWorkspaceId?.startsWith("repo:")
    ? Number(trellisWorkspaceId.slice("repo:".length))
    : null;
  const trellisStandaloneRepo =
    standaloneTrellisRepoId !== null && Number.isFinite(standaloneTrellisRepoId)
      ? standaloneRepos.find((repo) => repo.id === standaloneTrellisRepoId)
      : null;
  const trellisStandaloneWorkspace: Workspace | null = trellisStandaloneRepo
    ? {
        id: `repo:${trellisStandaloneRepo.id}`,
        name: repositoryFolderBasename(trellisStandaloneRepo),
        repositoryIds: [trellisStandaloneRepo.id],
        createdAt: 0,
        updatedAt: 0,
        rootPath: trellisStandaloneRepo.path,
        sddMode: "wise_trellis",
      }
    : null;
  const trellisWorkspace =
    trellisStandaloneWorkspace ??
    workspaces.find(
      (workspace) =>
        workspace.id === (trellisWorkspaceId ?? "") &&
        (workspace.sddMode === "wise_trellis" || workspace.sddMode == null),
    ) ??
    null;

  return (
    <AuthorPanelPageShell
      className={`author-panel-workspaces${trellisWorkspace ? " author-panel-workspaces--trellis" : ""}`}
      icon={<FolderOpenOutlined />}
      title="工作区"
      subtitle="Workspace、成员仓库和 Wise Trellis 状态"
      actions={
        trellisWorkspace ? null : (
          <Space size={8} wrap>
            <Tooltip title="添加一个轻量 Claude Code 仓库入口">
              <Button size="small" onClick={onAddStandaloneRepo} disabled={!onAddStandaloneRepo}>
                添加单仓
              </Button>
            </Tooltip>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={onCreateWorkspace}>
              新建工作区
            </Button>
          </Space>
        )
      }
    >
      {trellisWorkspace ? (
        <section className="author-panel-workspaces__trellis" aria-label="工作区 Trellis">
          <ProjectTrellisCenter
            open
            inline
            project={trellisWorkspace}
            repositories={repositories}
            onOpenProjectSession={onOpenProjectSession}
            onRequestSpecAgentUpdate={onRequestSpecAgentUpdate}
          />
        </section>
      ) : !hasItems ? (
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
                        <Tag
                          icon={<FolderOpenOutlined />}
                          color={repo.sddMode === "wise_trellis" ? "success" : "default"}
                        >
                          {repo.sddMode === "wise_trellis" ? "Trellis 已启用" : "单仓会话"}
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
