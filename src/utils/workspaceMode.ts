import type { ProjectItem } from "../types";

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
