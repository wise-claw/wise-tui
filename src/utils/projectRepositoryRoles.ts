import type { ProjectItem, ProjectSddMode, Repository } from "../types";

/**
 * 返回仓库的角色标签数组。优先使用新的 `roleTags`；为空时 fallback 到 legacy `[repositoryType]`。
 */
export function getRoleTags(repo: Repository): string[] {
  if (repo.roleTags && repo.roleTags.length > 0) {
    return repo.roleTags
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }
  const legacy = repo.repositoryType?.trim();
  return legacy ? [legacy] : [];
}

/**
 * 返回仓库的有效 SDD 模式。优先读取所属项目的 `sddMode`；无所属项目时回退到 legacy `repo.sddMode`，
 * 仍未匹配则默认 `wise_trellis`。
 *
 * 路径 X 后 `Project.sddMode` 是权威来源；保留 legacy 回退以支撑迁移期数据。
 */
export function getEffectiveRepoSddMode(
  repo: Repository,
  projects: ReadonlyArray<ProjectItem>,
): ProjectSddMode {
  const owner = projects.find((p) => p.repositoryIds.includes(repo.id));
  if (owner?.sddMode) return owner.sddMode;
  if (repo.sddMode === "wise_trellis") return "wise_trellis";
  if (repo.sddMode === "project_owned" || repo.sddMode === "off") return "project_owned";
  return "wise_trellis";
}

/**
 * 返回项目的有效 SDD 模式（默认 `wise_trellis`）。
 */
export function getProjectSddMode(project: ProjectItem | undefined | null): ProjectSddMode {
  return project?.sddMode ?? "wise_trellis";
}
