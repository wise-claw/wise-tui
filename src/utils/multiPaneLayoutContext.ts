import type { ClaudeSession, ProjectItem, Repository } from "../types";
import type { WorkspaceFocus } from "./workspaceMode";
import { resolveProjectExplorerOpenPath } from "./workspaceRepositoryTreeSelect";
import { resolveProjectComposerRepository } from "./workspaceSelectionState";

/** 非持久化占位 id：表示「工作区目录上下文」而非侧栏注册仓库。 */
export const WORKSPACE_CONTEXT_REPOSITORY_ID = -1;

const WORKSPACE_CONTEXT_REPO_STAMP = "1970-01-01T00:00:00.000Z";

function buildWorkspaceContextRepository(path: string, displayName: string): Repository {
  const trimmedPath = path.trim();
  const name =
    displayName.trim() ||
    trimmedPath.split(/[/\\]/).filter(Boolean).pop() ||
    "工作区";
  return {
    id: WORKSPACE_CONTEXT_REPOSITORY_ID,
    name,
    path: trimmedPath,
    repositoryType: "document",
    createdAt: WORKSPACE_CONTEXT_REPO_STAMP,
    updatedAt: WORKSPACE_CONTEXT_REPO_STAMP,
  };
}

export function isWorkspaceContextRepository(repository: Repository | null | undefined): boolean {
  return repository?.id === WORKSPACE_CONTEXT_REPOSITORY_ID;
}

/** 是否允许从单屏进入多屏（不要求侧栏已选具体仓库）。 */
export function canEnterMultiPaneLayout(input: {
  activeRepository?: Repository | null;
  activeProject?: ProjectItem | null;
  activeWorkspaceFocus?: WorkspaceFocus;
  activeSession?: ClaudeSession | null;
  repositories: readonly Repository[];
}): boolean {
  return resolveMultiPaneContextRepository(input) != null;
}

/**
 * 多屏 / 主聊天区锚点仓库：仓库焦点用当前仓；工作区焦点优先工作区浏览目录，
 * 再回退成员仓或当前会话路径。
 */
export function resolveMultiPaneContextRepository(input: {
  activeRepository?: Repository | null;
  activeProject?: ProjectItem | null;
  activeWorkspaceFocus?: WorkspaceFocus;
  activeSession?: ClaudeSession | null;
  repositories: readonly Repository[];
}): Repository | undefined {
  if (input.activeRepository) {
    return input.activeRepository;
  }

  if (input.activeWorkspaceFocus === "project" && input.activeProject) {
    const workspacePath = resolveProjectExplorerOpenPath(input.activeProject, input.repositories).trim();
    if (workspacePath) {
      return buildWorkspaceContextRepository(workspacePath, input.activeProject.name ?? "");
    }
  }

  const composerRepo = resolveProjectComposerRepository(input.activeProject, input.repositories);
  if (composerRepo) {
    return composerRepo;
  }

  const sessionPath = input.activeSession?.repositoryPath?.trim() ?? "";
  if (sessionPath) {
    const sessionName =
      input.activeSession?.repositoryName?.trim() ||
      sessionPath.split(/[/\\]/).filter(Boolean).pop() ||
      "工作区";
    return buildWorkspaceContextRepository(sessionPath, sessionName);
  }

  return undefined;
}
