import type { ProjectItem, Repository } from "../types";

/**
 * 选出未关联到任何 project 的 repo。
 *
 * 利用 DB 已有的 M:N 关联表（migration 003）天然支持 repo 与 0 个 project 关联的能力；
 * 派生在前端完成，避免新增专门的后端 IPC。返回顺序保持输入 `repositories` 原顺序，
 * 以便 UI 渲染稳定。
 */
export function selectFloatingRepositories(
  projects: ReadonlyArray<ProjectItem>,
  repositories: ReadonlyArray<Repository>,
): Repository[] {
  const assignedIds = new Set<number>();
  for (const project of projects) {
    for (const repoId of project.repositoryIds) {
      assignedIds.add(repoId);
    }
  }
  return repositories.filter((repo) => !assignedIds.has(repo.id));
}
