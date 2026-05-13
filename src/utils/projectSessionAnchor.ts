import type { ProjectItem, Repository } from "../types";
import { repositoryFolderBasename } from "./repositoryType";

export interface ProjectSessionAnchor {
  /** 新主会话写入 `ClaudeSession.repositoryPath` 的物理路径。空串表示项目既无 rootPath 也无成员仓库。 */
  path: string;
  /** 新主会话写入 `ClaudeSession.repositoryName` 的展示名。 */
  displayName: string;
  /** true 表示锚定在项目根目录（多仓 wise_trellis 项目）；false 表示锚定在某个具体成员仓库。 */
  isProjectRooted: boolean;
}

/**
 * 计算项目级主会话的物理锚点。
 *
 * 多仓 wise_trellis 项目（且 rootPath 非空）→ 锚定项目根；
 * 其余场景（单仓 / project_owned / 未迁移 rootPath）→ 锚定首个成员仓库。
 *
 * 单仓项目（含 wise 自身）天然退化：rootPath 通常等于唯一仓库路径，二者一致；
 * 即便此时函数返回 isProjectRooted=false，行为与历史完全一致。
 */
export function resolveProjectMainSessionAnchor(
  project: ProjectItem,
  repositories: ReadonlyArray<Repository>,
): ProjectSessionAnchor {
  const byId = new Map(repositories.map((repo) => [repo.id, repo] as const));
  const memberRepos = project.repositoryIds
    .map((id) => byId.get(id))
    .filter((repo): repo is Repository => Boolean(repo));
  const trimmedRootPath = (project.rootPath ?? "").trim();

  const shouldAnchorAtProjectRoot =
    project.sddMode === "wise_trellis" &&
    trimmedRootPath.length > 0 &&
    memberRepos.length > 1;

  if (shouldAnchorAtProjectRoot) {
    return {
      path: trimmedRootPath,
      displayName: `Project: ${project.name}`,
      isProjectRooted: true,
    };
  }

  if (memberRepos.length === 0 && trimmedRootPath.length > 0) {
    return {
      path: trimmedRootPath,
      displayName: `Project: ${project.name}`,
      isProjectRooted: true,
    };
  }

  if (memberRepos.length === 0) {
    return {
      path: "",
      displayName: project.name,
      isProjectRooted: false,
    };
  }

  const primaryRepo = memberRepos[0]!;
  return {
    path: primaryRepo.path,
    displayName: `${project.name}/${repositoryFolderBasename(primaryRepo)}`,
    isProjectRooted: false,
  };
}
