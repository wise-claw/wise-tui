import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { resolveProjectMainSessionAnchor } from "./projectSessionAnchor";
import { normalizeRepositoryPathKey } from "./repositoryMainSessionBinding";
import type { WorkspaceMode } from "./workspaceMode";

export interface FilterSessionsForWorkspaceInput {
  sessions: ReadonlyArray<ClaudeSession>;
  workspaceMode: WorkspaceMode;
  /** 当前 active 的项目；workspaceMode === "multi_repo" 时必须给出，否则视为退化。 */
  project: ProjectItem | null;
  repositories: ReadonlyArray<Repository>;
}

/**
 * ClaudeSessions 面板可见会话过滤器。
 *
 * - `multi_repo` 且 ownerProject 已知 → 仅保留 `repositoryPath === anchor.path` 的会话
 *   （遗留 per-repo session 仍留在 DB / sessions 数组中，但面板不再渲染）。
 * - 其余形态（`single_repo` / 游离 repo / 未派生出 ownerProject）→ 透传原列表。
 *
 * 复用 `resolveProjectMainSessionAnchor`，不重复 anchor 推导逻辑（参考
 * `.trellis/spec/guides/code-reuse-thinking-guide.md`）。
 */
export function filterSessionsForWorkspace(
  input: FilterSessionsForWorkspaceInput,
): ClaudeSession[] {
  const { sessions, workspaceMode, project, repositories } = input;

  if (workspaceMode === "single_repo" || !project) {
    return [...sessions];
  }

  const anchor = resolveProjectMainSessionAnchor(project, repositories);
  const anchorKey = normalizeRepositoryPathKey(anchor.path);
  if (!anchorKey) {
    return [...sessions];
  }

  return sessions.filter(
    (session) => normalizeRepositoryPathKey(session.repositoryPath) === anchorKey,
  );
}
