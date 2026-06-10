import type { ClaudeSession, ProjectItem, Repository } from "../types";
import {
  isProjectRootSessionDisplayName,
  resolveRepositoryForSession,
} from "./repositoryMainSessionBinding";
import { resolveWorkspaceMainSession } from "./resolveWorkspaceMainSession";
import type { WorkspaceFocus } from "./workspaceMode";
import type { WorkspaceLastSelection } from "./startupRepoSelection";
import { resolveProjectExplorerOpenPath } from "./workspaceRepositoryTreeSelect";

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

export interface ChatTopbarContext {
  /** 成员仓回退；运行指令等需要 repository id 的场景使用。 */
  contextRepository: Repository | null;
  /** IDE 打开、LLM 代理、运行 cwd 等使用的目录。 */
  openPath: string;
}

/** 主会话顶栏工具区：工作区焦点与仓库焦点统一的目录与仓库解析。 */
export function resolveChatTopbarContext(input: {
  activeRepository: Repository | null | undefined;
  activeProject: ProjectItem | null | undefined;
  activeWorkspaceFocus: WorkspaceFocus;
  repositories: ReadonlyArray<Repository>;
  sessionRepositoryPath?: string | null;
}): ChatTopbarContext {
  const contextRepository =
    input.activeRepository ??
    resolveProjectComposerRepository(input.activeProject, input.repositories) ??
    null;

  const sessionPath = input.sessionRepositoryPath?.trim() ?? "";
  let openPath = "";
  if (input.activeWorkspaceFocus === "project" && input.activeProject) {
    openPath = resolveProjectExplorerOpenPath(input.activeProject, input.repositories).trim();
  }
  if (!openPath) {
    openPath = sessionPath || contextRepository?.path?.trim() || "";
  }

  return { contextRepository, openPath };
}

export const WORKSPACE_SCOPED_VIRTUAL_REPOSITORY_ID = -1;

/** 主聊天 / 多屏窗格用的仓库上下文：无选中仓时回退成员仓或工作区目录虚拟仓。 */
export function resolveChatContextRepository(input: {
  activeRepository: Repository | null | undefined;
  activeProject: ProjectItem | null | undefined;
  activeWorkspaceFocus: WorkspaceFocus;
  repositories: ReadonlyArray<Repository>;
  sessionRepositoryPath?: string | null;
  sessionRepositoryName?: string | null;
}): Repository | null {
  const topbar = resolveChatTopbarContext(input);
  if (topbar.contextRepository) return topbar.contextRepository;
  const openPath = topbar.openPath.trim();
  if (!openPath) return null;
  const name =
    input.activeProject?.name?.trim() ||
    input.sessionRepositoryName?.trim() ||
    openPath.split(/[/\\]/).filter(Boolean).pop() ||
    "工作区";
  return {
    id: WORKSPACE_SCOPED_VIRTUAL_REPOSITORY_ID,
    name,
    path: openPath,
    repositoryType: "frontend",
    createdAt: "",
    updatedAt: "",
  };
}

/** 是否具备进入多屏布局的目录上下文（不要求侧栏已选中具体仓库）。 */
export function canEnterMultiPaneLayout(input: {
  activeRepository: Repository | null | undefined;
  activeProject: ProjectItem | null | undefined;
  activeWorkspaceFocus: WorkspaceFocus;
  repositories: ReadonlyArray<Repository>;
  sessionRepositoryPath?: string | null;
}): boolean {
  return Boolean(
    resolveChatTopbarContext(input).openPath.trim(),
  );
}

export interface ResolveScheduledTasksRepositoryInput {
  activeRepository: Repository | null | undefined;
  activeProject: ProjectItem | null | undefined;
  activeWorkspaceFocus: WorkspaceFocus;
  repositories: ReadonlyArray<Repository>;
  /** 侧栏角标汇总；有值时优先打开已有定时任务的成员仓。 */
  scheduledTasksByRepoId?: Readonly<Record<number, { total: number }>>;
}

/** 定时任务叠层目标仓库：仓库焦点用当前仓，工作区焦点回退到项目成员仓。 */
export function resolveScheduledTasksRepository(
  input: ResolveScheduledTasksRepositoryInput,
): Repository | null {
  if (input.activeRepository) return input.activeRepository;
  if (input.activeWorkspaceFocus !== "project" || !input.activeProject) return null;

  const byRepoId = input.scheduledTasksByRepoId;
  if (byRepoId) {
    for (const repositoryId of input.activeProject.repositoryIds ?? []) {
      const repository = input.repositories.find((item) => item.id === repositoryId) ?? null;
      if (repository && (byRepoId[repositoryId]?.total ?? 0) > 0) {
        return repository;
      }
    }
  }

  return resolveProjectComposerRepository(input.activeProject, input.repositories);
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

export { resolveProjectExplorerOpenPath } from "./workspaceRepositoryTreeSelect";
