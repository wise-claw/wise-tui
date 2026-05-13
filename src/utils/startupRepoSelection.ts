import type { ProjectItem, Repository } from "../types";
import { selectFloatingRepositories } from "./floatingRepositories";

export const WORKSPACE_LAST_SESSION_REPO_ID_STORAGE_KEY =
  "wise.workspace.lastSessionRepoId.v1";

export interface StartupSelectionInput {
  /** 上一次活跃的 repo id；首次启动 / 缺失时为 null。 */
  lastSessionRepoId: number | null;
  /** 已按 pin 顺序排序的项目列表（与侧栏渲染顺序一致）。 */
  projects: ReadonlyArray<ProjectItem>;
  /** 已加载的全部仓库。 */
  repositories: ReadonlyArray<Repository>;
}

export interface StartupSelection {
  /** 启动后侧栏选中的 repo；空状态下为 null。 */
  repositoryId: number | null;
  /** 启动后激活的 owner project；游离 repo 或空状态下为 null。 */
  projectId: string | null;
  /** lastSessionRepoId 指向已删除 repo 时为 true，调用方应清理该 setting。 */
  shouldClearLastSession: boolean;
}

/**
 * 根据 lastSessionRepoId + 项目/仓库快照决定启动时侧栏首项。
 *
 * 优先级：
 * 1. lastSessionRepoId 命中现存 repo → 恢复该 repo（同时同步 owner project）
 * 2. lastSessionRepoId 命中但 repo 已删除 → 回退到首项策略，并标记需要清理 setting
 * 3. lastSessionRepoId 缺失 → 直接走首项策略
 *
 * 首项策略：游离 repo 优先（按 `repositories` 原序），无则回退到第一个项目的首 repo。
 * 该顺序与 LeftSidebar "顶层游离区在前 / project 卡在后" 的渲染契约保持一致。
 */
export function resolveStartupSelection(
  input: StartupSelectionInput,
): StartupSelection {
  const { lastSessionRepoId, projects, repositories } = input;

  if (lastSessionRepoId != null) {
    const matched = repositories.find((repo) => repo.id === lastSessionRepoId);
    if (matched) {
      const owner = projects.find((p) => p.repositoryIds.includes(matched.id));
      return {
        repositoryId: matched.id,
        projectId: owner?.id ?? null,
        shouldClearLastSession: false,
      };
    }
    const fallback = pickFirstItem(projects, repositories);
    return {
      repositoryId: fallback.repositoryId,
      projectId: fallback.projectId,
      shouldClearLastSession: true,
    };
  }

  const fallback = pickFirstItem(projects, repositories);
  return {
    repositoryId: fallback.repositoryId,
    projectId: fallback.projectId,
    shouldClearLastSession: false,
  };
}

function pickFirstItem(
  projects: ReadonlyArray<ProjectItem>,
  repositories: ReadonlyArray<Repository>,
): Pick<StartupSelection, "repositoryId" | "projectId"> {
  const floating = selectFloatingRepositories(projects, repositories);
  if (floating.length > 0) {
    return { repositoryId: floating[0].id, projectId: null };
  }
  for (const project of projects) {
    const firstId = project.repositoryIds.find((id) =>
      repositories.some((repo) => repo.id === id),
    );
    if (firstId != null) {
      return { repositoryId: firstId, projectId: project.id };
    }
  }
  return { repositoryId: null, projectId: null };
}
