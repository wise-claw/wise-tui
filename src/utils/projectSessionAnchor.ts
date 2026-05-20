import type { ProjectItem, Repository } from "../types";
import { normalizeRepositoryPathKey } from "./repositoryMainSessionBinding";
import { repositoryFolderBasename } from "./repositoryType";

export interface ProjectSessionAnchor {
  /** 新主会话写入 `ClaudeSession.repositoryPath` 的物理路径。空串表示项目既无 rootPath 也无成员仓库。 */
  path: string;
  /** 新主会话写入 `ClaudeSession.repositoryName` 的展示名。 */
  displayName: string;
  /** true 表示锚定在项目根目录（多仓 wise_trellis 项目）；false 表示锚定在某个具体成员仓库。 */
  isProjectRooted: boolean;
}

/** 多成员仓路径的最长公共父目录（用于无 rootPath 时推导项目级 cwd）。 */
export function longestCommonRepositoryPathPrefix(paths: ReadonlyArray<string>): string {
  const keys = paths.map((p) => normalizeRepositoryPathKey(p)).filter((k) => k.length > 0);
  if (keys.length === 0) return "";
  if (keys.length === 1) return keys[0]!;

  let prefix = keys[0]!;
  for (let i = 1; i < keys.length; i++) {
    const current = keys[i]!;
    while (
      prefix &&
      current !== prefix &&
      !current.startsWith(`${prefix}/`)
    ) {
      const slash = prefix.lastIndexOf("/");
      if (slash <= 0) {
        prefix = "";
        break;
      }
      prefix = prefix.slice(0, slash);
    }
    if (!prefix) break;
  }
  return prefix;
}

function isStrictParentRepositoryPath(parentKey: string, childKey: string): boolean {
  return (
    parentKey.length > 0 &&
    childKey.length > parentKey.length &&
    childKey.startsWith(`${parentKey}/`)
  );
}

/**
 * 计算项目级主会话的物理锚点。
 *
 * - 多仓（≥2 成员）→ 优先 `rootPath`；否则用成员路径的公共父目录；不与任一成员仓路径重合。
 * - 单仓 → 锚定该成员仓（与历史 per-repo 退化一致）。
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

  if (memberRepos.length >= 2) {
    if (trimmedRootPath.length > 0) {
      return {
        path: trimmedRootPath,
        displayName: `Project: ${project.name}`,
        isProjectRooted: true,
      };
    }
    const memberKeys = memberRepos.map((repo) => normalizeRepositoryPathKey(repo.path));
    const commonPrefix = longestCommonRepositoryPathPrefix(memberRepos.map((repo) => repo.path));
    const commonKey = normalizeRepositoryPathKey(commonPrefix);
    const isDistinctParent =
      commonKey.length > 0 &&
      memberKeys.every((key) => isStrictParentRepositoryPath(commonKey, key));
    if (isDistinctParent) {
      return {
        path: commonPrefix,
        displayName: `Project: ${project.name}`,
        isProjectRooted: true,
      };
    }
    return {
      path: "",
      displayName: project.name,
      isProjectRooted: false,
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
