import type { Repository } from "../types";
import { repositorySessionTabDisplayName } from "./repositoryType";

/**
 * 侧栏「点仓库行」时要打开/绑定的 per-repo 会话 cwd。
 *
 * 项目级主会话由 `openProjectMainSession` / `resolveProjectMainSessionAnchor` 单独处理；
 * 多仓工作区内点仓库不得再路由到项目主会话。
 */
export interface SidebarSelectionTarget {
  path: string;
  displayName: string;
}

export interface ResolveSidebarSelectionTargetInput {
  repository: Repository;
}

export function resolveSidebarSelectionTarget(
  input: ResolveSidebarSelectionTargetInput,
): SidebarSelectionTarget {
  const { repository } = input;
  return {
    path: repository.path,
    displayName: repositorySessionTabDisplayName(repository),
  };
}
