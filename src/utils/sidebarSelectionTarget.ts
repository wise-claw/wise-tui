import type { ProjectItem, Repository } from "../types";
import { resolveProjectMainSessionAnchor } from "./projectSessionAnchor";
import { repositorySessionTabDisplayName } from "./repositoryType";
import { resolveWorkspaceMode, type WorkspaceMode } from "./workspaceMode";

/**
 * 侧栏 / 启动 effect / 跨项目跳会话等"选中 repo"动作要打开的会话 cwd 决策结果。
 *
 * 与 `resolveProjectMainSessionAnchor` 区别：
 * - 该函数只负责"项目级会话锚点"
 * - 本函数面向"用户点 repo 节点 / 程序化进入 repo"的更上层决策：根据 workspaceMode 决定走项目主会话还是 per-repo session
 */
export type SidebarSelectionTarget =
  | {
      kind: "project-main";
      /** 项目主会话 cwd（rootPath 或退化到首 repo path）。 */
      path: string;
      displayName: string;
      /** 标识 owner project 的 id，便于上游沿着 owner 做 binding 查找。 */
      projectId: string;
    }
  | {
      kind: "per-repo";
      /** repo 自身的物理路径。 */
      path: string;
      displayName: string;
    };

export interface ResolveSidebarSelectionTargetInput {
  repository: Repository;
  ownerProject: ProjectItem | null;
  repositories: ReadonlyArray<Repository>;
  /** 可选；若省略则按 ownerProject + repositories 派生。 */
  workspaceMode?: WorkspaceMode;
}

/**
 * 决定"选中 repo"动作落到哪条会话上：
 *
 * - `multi_repo` 且 ownerProject 已知 → 项目主会话（cwd = anchor.path）
 * - 其它（single_repo / 游离 / ownerProject 缺失）→ per-repo session（cwd = repository.path）
 *
 * 路由只看 workspaceMode，避免新增 `repositoryIds.length` / `rootPath === repo.path` 等隐式判断。
 */
export function resolveSidebarSelectionTarget(
  input: ResolveSidebarSelectionTargetInput,
): SidebarSelectionTarget {
  const { repository, ownerProject, repositories } = input;
  const mode =
    input.workspaceMode ??
    resolveWorkspaceMode({
      activeProjectId: ownerProject?.id ?? null,
      projects: ownerProject ? [ownerProject] : [],
    });

  if (mode === "multi_repo" && ownerProject) {
    const anchor = resolveProjectMainSessionAnchor(ownerProject, repositories);
    if (anchor.path) {
      return {
        kind: "project-main",
        path: anchor.path,
        displayName: anchor.displayName,
        projectId: ownerProject.id,
      };
    }
  }

  return {
    kind: "per-repo",
    path: repository.path,
    displayName: repositorySessionTabDisplayName(repository),
  };
}
