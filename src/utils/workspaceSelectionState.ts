import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { sessionMatchesProjectWorkspaceFocus } from "./projectSessionPanelFilter";
import { resolveRepositoryForSession } from "./repositoryMainSessionBinding";
import { resolveWorkspaceMainSession } from "./resolveWorkspaceMainSession";
import type { WorkspaceFocus, WorkspaceMode } from "./workspaceMode";
import type { WorkspaceLastSelection } from "./startupRepoSelection";
import {
  resolveProjectDirectoryOpenPath,
  resolveProjectExplorerOpenPath,
} from "./workspaceRepositoryTreeSelect";

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
    // 仓库焦点时优先使用显式选中的仓库路径，避免项目级会话的 repositoryPath 覆盖。
    // 项目级会话（ensureProjectMainSession 创建）的 repositoryPath 可能是 workspace
    // 根目录而非具体仓库目录，导致打开外部终端 / 文件目录时路径错误。
    openPath = input.activeRepository?.path?.trim() ?? (sessionPath || contextRepository?.path?.trim() || "");
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
  workspaceMode?: WorkspaceMode;
}

function findSessionByTabOrClaudeId(
  sessions: ReadonlyArray<ClaudeSession>,
  sessionKey: string,
): ClaudeSession | null {
  const trimmed = sessionKey.trim();
  if (!trimmed) return null;
  return (
    sessions.find((session) => session.id === trimmed || session.claudeSessionId === trimmed) ?? null
  );
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
    workspaceMode = "multi_repo",
  } = input;

  if (activeWorkspaceFocus === "project" && activeProject) {
    if (activeSessionId) {
      const current =
        findSessionByTabOrClaudeId(sessions, activeSessionId) ??
        findSessionByTabOrClaudeId(allSessions, activeSessionId);
      if (
        current &&
        sessionMatchesProjectWorkspaceFocus(current, {
          workspaceMode,
          project: activeProject,
          repositories,
        })
      ) {
        return current;
      }
    }
    return workspaceMainSession ?? undefined;
  }

  if (!activeRepository) {
    return undefined;
  }

  const activeKey = activeSessionId?.trim() ?? "";
  return sessions.find((session) => {
    if (activeKey && session.id !== activeKey && session.claudeSessionId !== activeKey) {
      return false;
    }
    if (!activeKey) return false;
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
  workspaceMode?: WorkspaceMode;
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
    workspaceMode: input.workspaceMode,
  });
}

export interface ShouldKeepProjectFocusWhenSwitchingSessionInput {
  session: ClaudeSession;
  activeWorkspaceFocus: WorkspaceFocus;
  activeProject: ProjectItem | null | undefined;
  repositories: ReadonlyArray<Repository>;
  workspaceMode?: WorkspaceMode;
}

/** 工作区焦点下切换到工作区主会话时，不应把侧栏焦点打回成员仓库。 */
export function shouldKeepProjectFocusWhenSwitchingSession(
  input: ShouldKeepProjectFocusWhenSwitchingSessionInput,
): boolean {
  return (
    input.activeWorkspaceFocus === "project" &&
    input.activeProject != null &&
    sessionMatchesProjectWorkspaceFocus(input.session, {
      workspaceMode: input.workspaceMode ?? "multi_repo",
      project: input.activeProject,
      repositories: input.repositories,
    })
  );
}

export { resolveProjectExplorerOpenPath } from "./workspaceRepositoryTreeSelect";

/** Claude 项目级技能锚点：工作区焦点用 rootPath/公共父路径；仓库焦点用当前成员仓路径。 */
export function resolveClaudeProjectSkillsScopePath(input: {
  activeWorkspaceFocus: WorkspaceFocus;
  activeProject: ProjectItem | null | undefined;
  activeRepository: Repository | null | undefined;
  repositories: ReadonlyArray<Repository>;
}): string {
  if (input.activeWorkspaceFocus === "project" && input.activeProject) {
    return resolveProjectDirectoryOpenPath(input.activeProject, input.repositories).trim();
  }
  return input.activeRepository?.path?.trim() ?? "";
}
