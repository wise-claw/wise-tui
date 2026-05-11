import type { ProjectItem, Repository } from "../types";
import { repositoryFolderBasename } from "./repositoryType";

/** `active_project`：与侧栏当前项目一致；`all_projects`：在所有已添加仓库中匹配（钉钉「切换仓库」快捷指令等）。 */
export type DingTalkRepositoryResolveScope = "active_project" | "all_projects";

export function resolveRepositoryForDingTalkAutomation(params: {
  repositories: Repository[];
  projects: ProjectItem[];
  activeProjectId: string | null;
  activeRepositoryId: number | null;
  repositoryNameFilter: string | null | undefined;
  /** 默认仅当前项目下仓库，避免自动化误匹配到其它项目的同名目录。 */
  resolveScope?: DingTalkRepositoryResolveScope;
}): { repository: Repository | null; reason?: string } {
  const {
    repositories,
    projects,
    activeProjectId,
    activeRepositoryId,
    repositoryNameFilter,
    resolveScope = "active_project",
  } = params;
  const activeProject = activeProjectId != null ? projects.find((p) => p.id === activeProjectId) : null;
  const list =
    resolveScope === "all_projects"
      ? repositories
      : activeProject != null
        ? repositories.filter((r) => activeProject.repositoryIds.includes(r.id))
        : repositories;

  const q = (repositoryNameFilter ?? "").trim();
  if (!q) {
    if (activeRepositoryId != null) {
      const byActive = list.find((r) => r.id === activeRepositoryId);
      if (byActive) return { repository: byActive };
    }
    if (list.length === 1) {
      return { repository: list[0] ?? null };
    }
    return {
      repository: null,
      reason:
        "未指定 repositoryName 且无法默认仓库：请在侧栏选中仓库，或在入站 JSON 中填写 repositoryName（与侧栏仓库名或目录名匹配）。",
    };
  }

  const low = q.toLowerCase();
  const exactName = list.find((r) => r.name.trim().toLowerCase() === low);
  if (exactName) return { repository: exactName };
  const exactBasename = list.find((r) => repositoryFolderBasename(r).toLowerCase() === low);
  if (exactBasename) return { repository: exactBasename };
  const partial = list.find((r) => r.name.toLowerCase().includes(low));
  if (partial) return { repository: partial };
  const notFoundReason =
    resolveScope === "all_projects"
      ? `未在已添加仓库中找到匹配：${q}`
      : `未在当前项目下找到匹配仓库：${q}`;
  return { repository: null, reason: notFoundReason };
}
