import type { ProjectItem, Repository } from "../types";
import { getRoleTags } from "./projectRepositoryRoles";

export interface RoleTagOption {
  /** 原始标签（保留首次出现时的大小写）。 */
  tag: string;
  /** 用于 SlashOption.label 与插入文本展示。 */
  label: string;
  /** 中文描述，例如「匹配 2 个仓库: web, api」。 */
  description: string;
  repoCount: number;
  repoNames: string[];
}

const MAX_OPTIONS = 32;

/**
 * 聚合活动项目里成员仓库的角色标签，去重（大小写不敏感）后按覆盖仓库数降序、标签字典序升序排序。
 *
 * - `project == null` 或无成员仓库 → 返回 []
 * - tag 文本经 `trim` + 跳过空串过滤
 * - 首次出现的大小写形态优先保留（不会把 "Frontend" 改成 "frontend"）
 * - 描述文本保留命中的仓库名顺序，便于用户理解该 roleTag 会派发到哪些成员仓库
 */
export function buildProjectRoleTagOptions(
  project: ProjectItem | null | undefined,
  repositories: ReadonlyArray<Repository>,
): RoleTagOption[] {
  if (!project) return [];
  if (project.repositoryIds.length === 0) return [];
  const memberRepos = repositories.filter((repo) => project.repositoryIds.includes(repo.id));
  if (memberRepos.length === 0) return [];

  type Accum = { tag: string; repoNames: string[] };
  const byLowerTag = new Map<string, Accum>();

  for (const repo of memberRepos) {
    const repoName = repo.name?.trim() || repo.path;
    for (const rawTag of getRoleTags(repo)) {
      const trimmed = rawTag.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      const existing = byLowerTag.get(key);
      if (existing) {
        if (!existing.repoNames.includes(repoName)) {
          existing.repoNames.push(repoName);
        }
      } else {
        byLowerTag.set(key, { tag: trimmed, repoNames: [repoName] });
      }
    }
  }

  const options: RoleTagOption[] = Array.from(byLowerTag.values()).map((acc) => {
    return {
      tag: acc.tag,
      label: acc.tag,
      description: `匹配 ${acc.repoNames.length} 个仓库: ${acc.repoNames.join(", ")}`,
      repoCount: acc.repoNames.length,
      repoNames: acc.repoNames.slice(),
    };
  });

  options.sort((a, b) => {
    if (b.repoCount !== a.repoCount) return b.repoCount - a.repoCount;
    return a.label.localeCompare(b.label, "en", { sensitivity: "base" });
  });

  return options.slice(0, MAX_OPTIONS);
}
