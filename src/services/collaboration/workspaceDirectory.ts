import type { ProjectItem, Repository } from "../../types";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import { addRepositoryToProject, createProject } from "../projectState";

/** 与左侧工作区列表一致：路径末段目录名。 */
export function repositoryWorkspaceLabel(repo: Pick<Repository, "path" | "name">): string {
  return repositoryFolderBasename(repo);
}

export function ownerProjectForRepository(
  projects: readonly ProjectItem[],
  repositoryId: number,
): ProjectItem | undefined {
  return projects.find((p) => p.repositoryIds.includes(repositoryId));
}

/** 项目下拉展示名：优先成员仓库的侧栏名，避免显示过期的 projects.name。 */
export function projectWorkspaceLabel(
  project: ProjectItem,
  repositories: readonly Repository[],
): string {
  const members = project.repositoryIds
    .map((id) => repositories.find((r) => r.id === id))
    .filter((r): r is Repository => r != null)
    .map(repositoryWorkspaceLabel);
  if (members.length === 1) return members[0];
  if (members.length > 1) return members.join("、");
  const icon = project.iconDisplayName?.trim();
  if (icon) return icon;
  return project.name.trim() || "未命名工作区";
}

export function resolveBindingProjectId(
  projects: readonly ProjectItem[],
  repositoryId: number,
  preferredProjectId?: string | null,
): string | null {
  if (preferredProjectId) {
    const preferred = projects.find((p) => p.id === preferredProjectId && p.repositoryIds.includes(repositoryId));
    if (preferred) return preferred.id;
  }
  return ownerProjectForRepository(projects, repositoryId)?.id ?? null;
}

export function repositorySelectOptions(
  repositories: readonly Repository[],
  projects: readonly ProjectItem[] = [],
): { value: number; label: string }[] {
  return [...repositories]
    .sort((a, b) => repositoryWorkspaceLabel(a).localeCompare(repositoryWorkspaceLabel(b), "zh-CN"))
    .map((r) => {
      const owner = ownerProjectForRepository(projects, r.id);
      const label = repositoryWorkspaceLabel(r);
      return { value: r.id, label: owner ? label : `${label}（未加入项目）` };
    });
}

export function projectSelectOptions(
  projects: readonly ProjectItem[],
  repositories: readonly Repository[],
): { value: string; label: string }[] {
  return projects
    .filter((p) => p.repositoryIds.some((id) => repositories.some((r) => r.id === id)))
    .map((p) => ({ value: p.id, label: projectWorkspaceLabel(p, repositories) }));
}

function replaceProject(projects: ProjectItem[], next: ProjectItem): ProjectItem[] {
  const idx = projects.findIndex((p) => p.id === next.id);
  if (idx < 0) return [...projects, next];
  const copy = [...projects];
  copy[idx] = next;
  return copy;
}

/**
 * 绑定需要 project_repositories 成员关系。仓库已在项目中则直接返回；
 * 否则加入首选项目，或按该仓库目录名新建一个项目再关联。
 */
export async function ensureRepositoryProject(
  projects: ProjectItem[],
  repo: Repository,
  preferredProjectId?: string | null,
): Promise<{ projectId: string; projects: ProjectItem[] }> {
  const existing = resolveBindingProjectId(projects, repo.id, preferredProjectId);
  if (existing) return { projectId: existing, projects };

  if (preferredProjectId && projects.some((p) => p.id === preferredProjectId)) {
    const updated = await addRepositoryToProject(preferredProjectId, repo.id);
    return { projectId: preferredProjectId, projects: replaceProject(projects, updated) };
  }

  const created = await createProject(repositoryWorkspaceLabel(repo), repo.path);
  const withRepo = await addRepositoryToProject(created.id, repo.id);
  return { projectId: withRepo.id, projects: replaceProject(projects, withRepo) };
}
