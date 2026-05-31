import type { ClaudeSession, ProjectItem, Repository } from "../types";
import {
  isProjectRootSessionDisplayName,
  resolveRepositoryForSession,
} from "./repositoryMainSessionBinding";
import { resolveWorkspaceMainSession } from "./resolveWorkspaceMainSession";
import type { WorkspaceFocus } from "./workspaceMode";
import type { WorkspaceLastSelection } from "./startupRepoSelection";

export interface BuildWorkspaceLastSelectionInput {
  focus: WorkspaceFocus;
  projectId: string | null;
  repositoryId: number | null;
}

/** 写入 appSettings 的侧栏选中快照。 */
export function buildWorkspaceLastSelection(
  input: BuildWorkspaceLastSelectionInput,
): WorkspaceLastSelection {
  return {
    focus: input.focus,
    projectId: input.projectId,
    repositoryId: input.focus === "repository" ? input.repositoryId : null,
  };
}

/** 工作区焦点下 composer/终端 用的成员仓回退（不改变侧栏仓库选中）。 */
export function resolveProjectComposerRepository(
  project: ProjectItem | null | undefined,
  repositories: ReadonlyArray<Repository>,
): Repository | null {
  if (!project) return null;
  const byId = new Map(repositories.map((repo) => [repo.id, repo] as const));
  for (const repoId of project.repositoryIds ?? []) {
    const repo = byId.get(repoId);
    if (repo) return repo;
  }
  return null;
}

/** 主聊天区是否应展示（工作区焦点或仓库焦点）。 */
export function isChatSurfaceReady(input: {
  activeRepository: Repository | null | undefined;
  activeWorkspaceFocus: WorkspaceFocus;
  activeProject: ProjectItem | null | undefined;
}): boolean {
  return Boolean(
    input.activeRepository ??
      (input.activeWorkspaceFocus === "project" && input.activeProject),
  );
}

export interface ResolveClaudePanelActiveSessionInput {
  sessions: ReadonlyArray<ClaudeSession>;
  allSessions: ReadonlyArray<ClaudeSession>;
  activeSessionId: string | null | undefined;
  activeWorkspaceFocus: WorkspaceFocus;
  activeProject: ProjectItem | null | undefined;
  activeRepository: Repository | null | undefined;
  repositories: ReadonlyArray<Repository>;
  repositoryMainBindings: Record<string, string>;
  workspaceMainSession: ClaudeSession | null;
}

/**
 * ClaudeSessions 主窗格当前应展示的会话。
 * 工作区焦点：项目主会话；仓库焦点：当前仓库上的 activeSessionId。
 */
export function resolveClaudePanelActiveSession(
  input: ResolveClaudePanelActiveSessionInput,
): ClaudeSession | undefined {
  const {
    sessions,
    allSessions,
    activeSessionId,
    activeWorkspaceFocus,
    activeProject,
    activeRepository,
    repositories,
    repositoryMainBindings,
    workspaceMainSession,
  } = input;

  if (activeWorkspaceFocus === "project" && activeProject) {
    if (activeSessionId) {
      const current =
        sessions.find((session) => session.id === activeSessionId) ??
        allSessions.find((session) => session.id === activeSessionId) ??
        null;
      if (current && isProjectRootSessionDisplayName(current.repositoryName ?? "")) {
        return current;
      }
    }
    return workspaceMainSession ?? undefined;
  }

  if (!activeRepository) {
    return undefined;
  }

  return sessions.find((session) => {
    if (session.id !== activeSessionId) return false;
    return (
      resolveRepositoryForSession({
        session,
        repositories: [...repositories],
        bindings: repositoryMainBindings,
        sessions: [...sessions],
        preferredRepositoryId: activeRepository.id,
      })?.id === activeRepository.id
    );
  });
}

export interface ResolveClaudeWorkspaceMainSessionInput {
  sessions: ReadonlyArray<ClaudeSession>;
  repositoryMainBindings: Record<string, string>;
  repositories: ReadonlyArray<Repository>;
  activeRepository: Repository | null | undefined;
  activeProject: ProjectItem | null | undefined;
  activeWorkspaceFocus: WorkspaceFocus;
  activeSessionId: string | null | undefined;
}

export function resolveClaudeWorkspaceMainSession(
  input: ResolveClaudeWorkspaceMainSessionInput,
): ClaudeSession | null {
  return resolveWorkspaceMainSession({
    sessions: input.sessions,
    bindings: input.repositoryMainBindings,
    repositories: input.repositories,
    activeRepository: input.activeRepository ?? null,
    activeProject: input.activeProject ?? null,
    activeWorkspaceFocus: input.activeWorkspaceFocus,
    activeSessionId: input.activeSessionId,
  });
}
