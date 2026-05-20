import type { EmployeeItem, ProjectItem, ProjectSddMode, Repository } from "../types";

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

/**
 * `wise_trellis` 项目下 EmployeeItem UI 入口应当隐藏；`project_owned` 项目保留旧 UI 作为 legacy 兜底。
 * 没有活跃项目时不隐藏（用户处于非项目语境时仍能配置员工）。
 */
export function shouldHideEmployeeUi(
  project: ProjectItem | undefined | null,
): boolean {
  return getProjectSddMode(project) === "wise_trellis" && project != null;
}

/** 成员是否关联到当前项目（projectIds 或项目下任一仓库）。无关联配置时视为全局可用。 */
export function employeeInProjectScope(
  employee: Pick<EmployeeItem, "projectIds" | "repositoryIds">,
  project: ProjectItem,
): boolean {
  if ((employee.projectIds ?? []).includes(project.id)) {
    return true;
  }
  const projectRepoIds = new Set(project.repositoryIds ?? []);
  if ((employee.repositoryIds ?? []).some((rid) => projectRepoIds.has(rid))) {
    return true;
  }
  const hasProjectLink = (employee.projectIds ?? []).length > 0;
  const hasRepoLink = (employee.repositoryIds ?? []).length > 0;
  return !hasProjectLink && !hasRepoLink;
}
