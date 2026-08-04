import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { message } from "antd";
import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { setAppSetting, getAppSetting } from "../services/appSettingsStore";
import {
  normalizeRepositoryPathKey as normalizeRepositoryPathForMatch,
  parseRepositoryMainSessionBindings,
  repositoryPathsMatch,
  REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY,
  resolveRepositoryForSession,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
  resolveSessionFromBindingValue,
  isProjectMainSessionBindingKey,
} from "../utils/repositoryMainSessionBinding";
import {
  isOmcBatchHistoryStubSessionId,
  parseOmcBatchHistoryStubAnchorSessionId,
} from "../utils/omcEmployeeBatchHistory";
import { pickFirstWorkspaceSidebarHistorySession } from "../utils/repositoryWorkspaceTree";
import {
  resolveWorkspaceMode,
  type WorkspaceFocus,
} from "../utils/workspaceMode";
import { shouldKeepProjectFocusWhenSwitchingSession } from "../utils/workspaceSelectionState";
import { findSessionByTabOrClaudeId } from "../utils/claudeSessionSelection";
import { markExplicitSidebarSessionSelect } from "../utils/explicitSidebarSessionSelect";

interface UseAppSessionRoutingOptions {
  repositories: Repository[];
  projects: ProjectItem[];
  activeProjectId: string | null;
  activeRepositoryId: number | null;
  activeWorkspaceFocus: WorkspaceFocus;
  activeSessionId: string | null;
  sessions: ClaudeSession[];
  sessionsLiveRef: RefObject<ClaudeSession[]>;
  setActiveRepositoryWithOwner: (repositoryId: number) => void;
  handleUpdateRepositoryMainOwnerAgent: (
    repositoryId: number,
    mainOwnerAgentName: string | null,
  ) => Promise<void>;
  handleRemoveRepository: (repository: Repository) => Promise<void>;
  handleDetachRepositoryFromProject: (projectId: string, repositoryId: number) => Promise<void>;
  closeSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  switchSession: (sessionId: string) => void;
  releaseSessionHostProcess: (
    sessionId: string,
    ctx?: import("../services/releaseClaudeHostProcessesForWorkspaceScope").ReleaseWiseTabSessionContext,
  ) => Promise<void>;
  /** 关闭会话时清理 workflow 等 AppImpl 域内状态（绑定清理仍在本 hook 内）。 */
  onCloseSessionWorkflowCleanup: (creatorIds: Set<string>) => void;
}

export function useAppSessionRouting({
  repositories,
  projects,
  activeProjectId,
  activeRepositoryId,
  activeWorkspaceFocus,
  activeSessionId,
  sessionsLiveRef,
  setActiveRepositoryWithOwner,
  handleUpdateRepositoryMainOwnerAgent,
  handleRemoveRepository,
  handleDetachRepositoryFromProject,
  closeSession,
  deleteSession,
  switchSession,
  releaseSessionHostProcess,
  onCloseSessionWorkflowCleanup,
}: UseAppSessionRoutingOptions) {
  const [repositoryMainSessionBindings, setRepositoryMainSessionBindings] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await getAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY);
        if (cancelled) return;
        const fromDisk = parseRepositoryMainSessionBindings(raw);
        setRepositoryMainSessionBindings((current) => ({ ...fromDisk, ...current }));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePersistRepositoryMainOwnerAgent = useCallback(
    async (repository: Repository, mainOwnerAgentName: string | null) => {
      try {
        await handleUpdateRepositoryMainOwnerAgent(repository.id, mainOwnerAgentName);
        const key = normalizeRepositoryPathForMatch(repository.path);
        setRepositoryMainSessionBindings((prev) => {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [handleUpdateRepositoryMainOwnerAgent],
  );

  const migrateRepositoryMainSessionBindingTabIds = useCallback((fromTabId: string, toClaudeSessionId: string) => {
    setRepositoryMainSessionBindings((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(prev)) {
        if (v === fromTabId) {
          next[k] = toClaudeSessionId;
          changed = true;
        }
      }
      if (!changed) return prev;
      void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const sessionsLatestRef = sessionsLiveRef;

  const closeSessionsForRepositoryPath = useCallback(
    (repositoryPath: string) => {
      const related = sessionsLatestRef.current.filter((session) =>
        repositoryPathsMatch(session.repositoryPath, repositoryPath),
      );
      for (const session of related) {
        closeSession(session.id);
      }
    },
    [closeSession, sessionsLatestRef],
  );

  const handleRemoveRepositoryWithSessionCleanup = useCallback(
    async (repository: Repository) => {
      closeSessionsForRepositoryPath(repository.path);
      await handleRemoveRepository(repository);
    },
    [closeSessionsForRepositoryPath, handleRemoveRepository],
  );

  const handleDetachRepositoryFromProjectWithSessionCleanup = useCallback(
    async (projectId: string, repositoryId: number) => {
      const repository = repositories.find((item) => item.id === repositoryId);
      if (repository) {
        closeSessionsForRepositoryPath(repository.path);
      }
      await handleDetachRepositoryFromProject(projectId, repositoryId);
    },
    [closeSessionsForRepositoryPath, handleDetachRepositoryFromProject, repositories],
  );

  const repositoriesLatestRef = useRef(repositories);
  repositoriesLatestRef.current = repositories;

  const repositoryMainBindingsLatestRef = useRef(repositoryMainSessionBindings);
  repositoryMainBindingsLatestRef.current = repositoryMainSessionBindings;

  const releaseSessionHostProcessRef = useRef(releaseSessionHostProcess);
  releaseSessionHostProcessRef.current = releaseSessionHostProcess;

  const bindRepositoryMainSession = useCallback(
    async (
      repositoryPath: string,
      sessionId: string,
      opts?: { deferHostRelease?: boolean },
    ) => {
      const key = normalizeRepositoryPathForMatch(repositoryPath);
      const nextId = sessionId.trim();
      if (!nextId) {
        return;
      }
      const prevRaw = repositoryMainBindingsLatestRef.current[key]?.trim();
      if (prevRaw && prevRaw !== nextId && !opts?.deferHostRelease) {
        const mainOwner = isProjectMainSessionBindingKey(key)
          ? null
          : resolveMainOwnerAgentNameForRepositoryPath(repositoriesLatestRef.current, key);
        const prevTabId = resolveBoundMainSessionId(
          key,
          repositoryMainBindingsLatestRef.current,
          sessionsLatestRef.current,
          mainOwner,
        );
        const prevSession =
          (prevTabId ? sessionsLatestRef.current.find((s) => s.id === prevTabId) : null) ??
          resolveSessionFromBindingValue(prevRaw, sessionsLatestRef.current);
        if (prevSession && prevSession.id !== nextId) {
          window.setTimeout(() => {
            void releaseSessionHostProcessRef.current(prevSession.id);
          }, 0);
        }
      }
      setRepositoryMainSessionBindings((prev) => {
        if (prev[key] === nextId) return prev;
        const next = { ...prev, [key]: nextId };
        void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [sessionsLatestRef],
  );

  const handleCloseSession = useCallback(
    (sessionId: string) => {
      const session = sessionsLatestRef.current.find((s) => s.id === sessionId);
      const creatorIds = new Set<string>([sessionId]);
      if (session?.claudeSessionId?.trim()) {
        creatorIds.add(session.claudeSessionId.trim());
      }
      onCloseSessionWorkflowCleanup(creatorIds);
      if (session?.repositoryPath) {
        const key = normalizeRepositoryPathForMatch(session.repositoryPath);
        setRepositoryMainSessionBindings((prev) => {
          if (prev[key] !== sessionId) return prev;
          const next = { ...prev };
          delete next[key];
          void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
      }
      closeSession(sessionId);
    },
    [closeSession, onCloseSessionWorkflowCleanup, sessionsLatestRef],
  );

  const handleDeleteHistorySession = useCallback(
    async (sessionId: string) => {
      const session = sessionsLatestRef.current.find((s) => s.id === sessionId);
      if (session?.repositoryPath) {
        const key = normalizeRepositoryPathForMatch(session.repositoryPath);
        setRepositoryMainSessionBindings((prev) => {
          if (prev[key] !== sessionId) return prev;
          const next = { ...prev };
          delete next[key];
          void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
      }
      await deleteSession(sessionId);
    },
    [deleteSession, sessionsLatestRef],
  );

  const activeSessionIdLatestRef = useRef(activeSessionId);
  activeSessionIdLatestRef.current = activeSessionId;

  const jumpToSessionWithRepository = useCallback(
    (sessionId: string) => {
      const sid = sessionId.trim();
      if (!sid) return;
      if (isOmcBatchHistoryStubSessionId(sid)) {
        const anchor = parseOmcBatchHistoryStubAnchorSessionId(sid);
        if (anchor) {
          void message.info("此为批量 OMC 历史占位标签，正在跳转到发起该批次的主会话。");
          jumpToSessionWithRepository(anchor);
        }
        return;
      }
      const target = findSessionByTabOrClaudeId(sessionsLatestRef.current, sid);
      const canonicalId = target?.id ?? sid;
      const currentActive = activeSessionIdLatestRef.current?.trim() ?? "";
      const alreadyActive =
        canonicalId === currentActive ||
        (target != null &&
          (target.id === currentActive || target.claudeSessionId?.trim() === currentActive));
      // 侧栏显式点选：即使已是当前会话也打标，挡住随后 auto-ensure 抢焦。
      markExplicitSidebarSessionSelect(canonicalId);
      if (alreadyActive) {
        return;
      }
      if (!target?.repositoryPath) {
        switchSession(canonicalId);
        return;
      }
      const repo = resolveRepositoryForSession({
        session: target,
        repositories,
        bindings: repositoryMainSessionBindings,
        sessions: sessionsLatestRef.current,
        preferredRepositoryId: activeRepositoryId,
      });
      const activeProjectForJump = activeProjectId
        ? projects.find((item) => item.id === activeProjectId) ?? null
        : null;
      const keepProjectFocus = shouldKeepProjectFocusWhenSwitchingSession({
        session: target,
        activeWorkspaceFocus,
        activeProject: activeProjectForJump,
        repositories,
        workspaceMode: resolveWorkspaceMode({ activeProjectId, projects }),
      });
      if (repo && !keepProjectFocus && repo.id !== activeRepositoryId) {
        setActiveRepositoryWithOwner(repo.id);
      }
      switchSession(canonicalId);
    },
    [
      activeProjectId,
      activeRepositoryId,
      activeWorkspaceFocus,
      projects,
      repositories,
      repositoryMainSessionBindings,
      setActiveRepositoryWithOwner,
      switchSession,
      sessionsLatestRef,
    ],
  );

  const jumpToSessionWithRepositoryRef = useRef(jumpToSessionWithRepository);
  jumpToSessionWithRepositoryRef.current = jumpToSessionWithRepository;

  const handleArchiveWorkspaceSession = useCallback(
    (sessionId: string) => {
      const sid = sessionId.trim();
      if (!sid) return;
      const sessionsNow = sessionsLatestRef.current;
      const target = sessionsNow.find((item) => item.id === sid);
      const repoPath = target?.repositoryPath?.trim() ?? "";
      const wasActive = (activeSessionIdLatestRef.current?.trim() ?? "") === sid;
      handleCloseSession(sid);
      if (!wasActive || !repoPath) return;
      const next = pickFirstWorkspaceSidebarHistorySession(
        sessionsNow.filter((item) => item.id !== sid),
        repoPath,
      );
      if (next) {
        jumpToSessionWithRepositoryRef.current(next.id);
      }
    },
    [handleCloseSession, sessionsLatestRef],
  );

  const bindRepositoryMainSessionRef = useRef(bindRepositoryMainSession);
  bindRepositoryMainSessionRef.current = bindRepositoryMainSession;

  return {
    repositoryMainSessionBindings,
    repositoryMainBindingsLatestRef,
    repositoriesLatestRef,
    sessionsLatestRef,
    activeSessionIdLatestRef,
    releaseSessionHostProcessRef,
    migrateRepositoryMainSessionBindingTabIds,
    handlePersistRepositoryMainOwnerAgent,
    bindRepositoryMainSession,
    bindRepositoryMainSessionRef,
    jumpToSessionWithRepository,
    jumpToSessionWithRepositoryRef,
    handleArchiveWorkspaceSession,
    handleCloseSession,
    handleDeleteHistorySession,
    handleRemoveRepositoryWithSessionCleanup,
    handleDetachRepositoryFromProjectWithSessionCleanup,
    closeSessionsForRepositoryPath,
  };
}

export type AppSessionRoutingApi = ReturnType<typeof useAppSessionRouting>;
