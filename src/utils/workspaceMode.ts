import type { ProjectItem, Repository } from "../types";

export type WorkspaceMode = "single_repo" | "multi_repo";

/** 侧栏选中粒度：Workspace 项目行 vs 具体仓库行。 */
export type WorkspaceFocus = "project" | "repository";

export interface WorkspaceModeInput {
  /** 当前 active 的 project id；游离 repo / 无选中时为 null。 */
  activeProjectId: string | null;
  projects: ReadonlyArray<ProjectItem>;
}

/**
 * 派生当前 workspace 形态，作为下游 UI / Trellis bridge / startup effect 的统一判断依据。
 *
 * - `multi_repo`：active project 已配置 rootPath，或成员仓库数 ≥ 2
 * - `single_repo`：游离 repo（无 active project）、active project 不存在、单成员且无 rootPath
 *
 * 禁止下游再用 `project.repositoryIds.length` / `rootPath === repo.path` 等隐式条件分叉。
 */
export function resolveWorkspaceMode(input: WorkspaceModeInput): WorkspaceMode {
  const { activeProjectId, projects } = input;
  if (!activeProjectId) return "single_repo";
  const project = projects.find((p) => p.id === activeProjectId);
  if (!project) return "single_repo";
  const memberCount = project.repositoryIds.length;
  const hasRootPath = (project.rootPath ?? "").trim().length > 0;
  if (memberCount >= 2) return "multi_repo";
  if (hasRootPath) return "multi_repo";
  return "single_repo";
}

export function findOwnerProjectForRepositoryId(
  repositoryId: number,
  projects: ReadonlyArray<ProjectItem>,
): ProjectItem | null {
  return projects.find((project) => project.repositoryIds.includes(repositoryId)) ?? null;
}

export interface SidebarExpandedProjectInput {
  activeProjectId: string | null;
  activeRepositoryId: number | null;
  activeWorkspaceFocus?: WorkspaceFocus;
}

/** 侧栏启动/恢复选中态时，应展开以露出当前仓库的工作区 id。 */
export function resolveSidebarExpandedProjectId(
  projects: ReadonlyArray<ProjectItem>,
  input: SidebarExpandedProjectInput,
): string | null {
  const activeWorkspaceFocus = input.activeWorkspaceFocus ?? "repository";
  if (activeWorkspaceFocus === "project" && input.activeProjectId) {
    if (projects.some((project) => project.id === input.activeProjectId)) {
      return input.activeProjectId;
    }
  }
  if (input.activeRepositoryId != null) {
    const owner = findOwnerProjectForRepositoryId(input.activeRepositoryId, projects);
    if (owner) return owner.id;
  }
  if (input.activeProjectId && projects.some((project) => project.id === input.activeProjectId)) {
    return input.activeProjectId;
  }
  return projects[0]?.id ?? null;
}

/**
 * 重新打开应用时：若上次选中的不是「首个工作区下的首个仓库」，需要展开工作区列表区块。
 */
export function shouldRevealWorkspaceListOnRestore(
  projects: ReadonlyArray<ProjectItem>,
  input: SidebarExpandedProjectInput,
): boolean {
  const activeWorkspaceFocus = input.activeWorkspaceFocus ?? "repository";
  if (activeWorkspaceFocus === "project" && input.activeProjectId) {
    const projectIndex = projects.findIndex((project) => project.id === input.activeProjectId);
    if (projectIndex > 0) return true;
  }
  if (input.activeRepositoryId == null) return false;
  const owner = findOwnerProjectForRepositoryId(input.activeRepositoryId, projects);
  if (!owner) return false;
  const projectIndex = projects.findIndex((project) => project.id === owner.id);
  const repoIndex = owner.repositoryIds.indexOf(input.activeRepositoryId);
  return projectIndex > 0 || repoIndex > 0;
}

export function isMultiRepoProject(
  project: ProjectItem | null | undefined,
  projects: ReadonlyArray<ProjectItem>,
): boolean {
  if (!project) {
    return false;
  }
  return resolveWorkspaceMode({ activeProjectId: project.id, projects }) === "multi_repo";
}

/**
 * 多仓工作区内点仓库行：只更新侧栏高亮与文件树，不 bind / 切换 per-repo 主会话。
 */
export function shouldSidebarRepositorySelectOnlyUpdateFocus(
  repository: Repository,
  projects: ReadonlyArray<ProjectItem>,
): boolean {
  const owner = findOwnerProjectForRepositoryId(repository.id, projects);
  return isMultiRepoProject(owner, projects);
}
