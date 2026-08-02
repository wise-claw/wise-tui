import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from "react";
import { message } from "antd";
import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { prefetchGitStatus } from "../services/gitStatusWarmCache";
import { migratePromptContextSessionKey } from "../components/ClaudeChatInput/prompt-context";
import {
  releaseClaudeHostProcessesForProjectScope,
  releaseClaudeHostProcessesForRepositoryScope,
  type ReleaseWiseTabSessionContext,
} from "../services/releaseClaudeHostProcessesForWorkspaceScope";
import { resolveProjectMainSessionAnchor } from "../utils/projectSessionAnchor";
import { resolveSidebarSelectionTarget } from "../utils/sidebarSelectionTarget";
import {
  findOwnerProjectForRepositoryId,
  isMultiRepoProject,
  shouldSidebarRepositorySelectOnlyUpdateFocus,
  type WorkspaceFocus,
} from "../utils/workspaceMode";
import {
  findSessionByTabOrClaudeId,
  pickProjectMainSessionForSidebarSelect,
  pickSessionForRepositorySidebarSelect,
} from "../utils/claudeSessionSelection";
import { pickFirstWorkspaceSidebarHistorySession } from "../utils/repositoryWorkspaceTree";
import {
  isSessionBoundAsRepositoryMain,
  findReusableEmptyMainSession,
  projectMainSessionBindingKey,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "../utils/repositoryMainSessionBinding";
import { loadSessionOwnerHints, WISE_SESSION_OWNER_HINTS_CHANGED_EVENT } from "../utils/sessionOwnerHints";
import { resolveFocusedPaneTargetSlot } from "../utils/multiPaneSlots";
import { getActivePaneIndex } from "../stores/activePaneIndexStore";
import { requestPaneCenterView } from "../stores/paneCenterViewControlStore";
import {
  getClaudeSessionsSnapshot,
  publishClaudeSessions,
} from "../stores/claudeSessionsLiveStore";
import type { PaneCount, PaneSlot } from "../constants/mainLayoutWidths";
import type { UseViewModeApi } from "./useViewMode";

/** 侧栏选中后推迟主会话切换，让工作区/仓库高亮与 Git 面板先绘制。 */
function scheduleSidebarMainSessionEnsure(work: () => Promise<string | null>): void {
  queueMicrotask(() => {
    startTransition(() => {
      void work();
    });
  });
}

/** 复用空白主会话时顶到侧栏：bump createdAt，并同步 sessionsLatestRef。 */
function promoteReusableEmptyMainSession(
  sessionId: string,
  sessionsLatestRef: RefObject<ClaudeSession[]>,
): void {
  const id = sessionId.trim();
  if (!id) return;
  const now = Date.now();
  const prev = getClaudeSessionsSnapshot();
  let changed = false;
  const next = prev.map((session) => {
    if (session.id !== id) return session;
    if (session.createdAt === now) return session;
    changed = true;
    return { ...session, createdAt: now };
  });
  if (!changed) return;
  sessionsLatestRef.current = next;
  publishClaudeSessions(next);
}

interface UseAppSidebarSelectionOptions {
  repositories: Repository[];
  projects: ProjectItem[];
  activeProjectId: string | null;
  activeRepositoryId: number | null;
  activeWorkspaceFocus: WorkspaceFocus;
  repositoryListLoading: boolean;
  tabsHydrated: boolean;
  sessionsStructureKey: string;
  repositoryMainSessionBindings: Record<string, string>;
  sessionsLatestRef: RefObject<ClaudeSession[]>;
  repositoryMainBindingsLatestRef: RefObject<Record<string, string>>;
  repositoriesLatestRef: RefObject<Repository[]>;
  activeSessionIdLatestRef: RefObject<string | null>;
  releaseSessionHostProcessRef: RefObject<
    (
      sessionId: string,
      ctx?: ReleaseWiseTabSessionContext,
    ) => Promise<void>
  >;
  bindRepositoryMainSession: (
    repositoryPath: string,
    sessionId: string,
    opts?: { deferHostRelease?: boolean },
  ) => Promise<void>;
  bindRepositoryMainSessionRef: MutableRefObject<
    (
      repositoryPath: string,
      sessionId: string,
      opts?: { deferHostRelease?: boolean },
    ) => Promise<void>
  >;
  jumpToSessionWithRepository: (sessionId: string) => void;
  jumpToSessionWithRepositoryRef: MutableRefObject<(sessionId: string) => void>;
  createSession: (
    repositoryPath: string,
    repositoryName: string,
    opts?: {
      skipActivate?: boolean;
      initialModel?: string;
      immediateActivate?: boolean;
      onBeforeActivate?: (newId: string) => void;
    },
  ) => Promise<string>;
  switchSession: (sessionId: string) => void;
  cancelSession: (sessionId: string) => void;
  reloadFullDiskTranscript: (sessionId: string) => Promise<void>;
  setActiveRepositoryId: (repositoryId: number | null) => void;
  setActiveProjectId: (projectId: string) => void;
  setActiveRepositoryWithOwner: (repositoryId: number) => void;
  viewMode: UseViewModeApi;
  paneCountRef: RefObject<PaneCount>;
  extraPanes: PaneSlot[];
  handlePaneRepositorySelect: (slotIndex: number, repositoryId: number) => void | Promise<void>;
  handlePaneProjectNewSession: (
    slotIndex: number,
    projectId: string,
    projects: ProjectItem[],
  ) => void | Promise<void>;
  suppressProjectSelectToChatRef: RefObject<boolean>;
  onRestoreHistorySessionAsMainComplete?: () => void;
}

export function useAppSidebarSelection({
  repositories,
  projects,
  activeProjectId,
  activeRepositoryId,
  activeWorkspaceFocus,
  repositoryListLoading,
  tabsHydrated,
  sessionsStructureKey,
  repositoryMainSessionBindings,
  sessionsLatestRef,
  repositoryMainBindingsLatestRef,
  repositoriesLatestRef,
  activeSessionIdLatestRef,
  releaseSessionHostProcessRef,
  bindRepositoryMainSession,
  bindRepositoryMainSessionRef,
  jumpToSessionWithRepository,
  jumpToSessionWithRepositoryRef,
  createSession,
  switchSession,
  cancelSession,
  reloadFullDiskTranscript,
  setActiveRepositoryId,
  setActiveProjectId,
  setActiveRepositoryWithOwner,
  viewMode,
  paneCountRef,
  extraPanes,
  handlePaneRepositorySelect,
  handlePaneProjectNewSession,
  suppressProjectSelectToChatRef,
  onRestoreHistorySessionAsMainComplete,
}: UseAppSidebarSelectionOptions) {
  const sessionOwnerHintsRef = useRef(loadSessionOwnerHints());

  useEffect(() => {
    const onHintsUpdated = () => {
      sessionOwnerHintsRef.current = loadSessionOwnerHints();
    };
    window.addEventListener(WISE_SESSION_OWNER_HINTS_CHANGED_EVENT, onHintsUpdated);
    return () => {
      window.removeEventListener(WISE_SESSION_OWNER_HINTS_CHANGED_EVENT, onHintsUpdated);
    };
  }, []);

  const switchSessionIfNeeded = useCallback(
    (sessionId: string) => {
      const nextId = sessionId.trim();
      if (!nextId) {
        return;
      }
      if (activeSessionIdLatestRef.current?.trim() === nextId) {
        return;
      }
      switchSession(nextId);
    },
    [activeSessionIdLatestRef, switchSession],
  );

  function switchRepositoryDisplaySession(repository: Repository): string | null {
    const sessionsNow = sessionsLatestRef.current;
    const target = resolveSidebarSelectionTarget({ repository });
    const first = pickFirstWorkspaceSidebarHistorySession(sessionsNow, target.path);
    if (first) {
      switchSessionIfNeeded(first.id);
      return first.id;
    }
    const mainOwnerPick = resolveMainOwnerAgentNameForRepositoryPath(repositories, target.path);
    const boundId = resolveBoundMainSessionId(
      target.path,
      repositoryMainSessionBindings,
      sessionsNow,
      mainOwnerPick,
    );
    if (boundId) {
      switchSessionIfNeeded(boundId);
      return boundId;
    }
    const latestForRepo = pickSessionForRepositorySidebarSelect(
      sessionsNow,
      target.path,
      sessionOwnerHintsRef.current,
      { mainOwnerAgentName: mainOwnerPick },
    );
    if (latestForRepo) {
      switchSessionIfNeeded(latestForRepo.id);
      return latestForRepo.id;
    }
    return null;
  }

  function bindRepositoryMainSessionTarget(repository: Repository): string | null {
    const target = resolveSidebarSelectionTarget({ repository });
    const sessionId = switchRepositoryDisplaySession(repository);
    if (sessionId) {
      void bindRepositoryMainSession(target.path, sessionId);
    }
    return sessionId;
  }

  const ensureSessionInFlightRef = useRef<string | null>(null);

  async function createAndBindRepositoryMainSession(
    repository: Repository,
    priorActiveId: string | null | undefined,
    opts?: { carryDraft?: boolean },
  ): Promise<string> {
    const target = resolveSidebarSelectionTarget({ repository });
    const ownerName = resolveMainOwnerAgentNameForRepositoryPath(repositories, target.path);
    const reusable = findReusableEmptyMainSession(
      sessionsLatestRef.current,
      target.path,
      ownerName,
    );
    if (reusable) {
      const carryDraftFromId = opts?.carryDraft ? priorActiveId ?? undefined : undefined;
      if (carryDraftFromId && carryDraftFromId !== reusable.id) {
        await migratePromptContextSessionKey(carryDraftFromId, reusable.id);
      }
      // 复用旧空白标签时仍应顶到侧栏（与真正 createSession 的 Date.now() 一致）。
      promoteReusableEmptyMainSession(reusable.id, sessionsLatestRef);
      switchSessionIfNeeded(reusable.id);
      void bindRepositoryMainSession(target.path, reusable.id);
      return reusable.id;
    }
    const carryDraftFromId = opts?.carryDraft ? priorActiveId ?? undefined : undefined;
    const id = await createSession(target.path, target.displayName, {
      immediateActivate: true,
      onBeforeActivate: carryDraftFromId
        ? (newId) => migratePromptContextSessionKey(carryDraftFromId, newId)
        : undefined,
    });
    void bindRepositoryMainSession(target.path, id, { deferHostRelease: true });
    scheduleReleaseScopedClaudeHostsBeforeNewMain({
      kind: "repository",
      repositoryPath: target.path,
      newSessionId: id,
      priorActiveId,
    });
    return id;
  }

  async function createAndBindProjectMainSession(
    project: ProjectItem,
    priorActiveId: string | null | undefined,
    opts?: { carryDraft?: boolean },
  ): Promise<string | null> {
    const anchor = resolveProjectMainSessionAnchor(project, repositories);
    if (!anchor.path) {
      message.warning("该 Workspace 缺少根目录，请先配置 rootPath");
      return null;
    }
    const reusable = findReusableEmptyMainSession(sessionsLatestRef.current, anchor.path, null);
    if (reusable) {
      const carryDraftFromId = opts?.carryDraft ? priorActiveId ?? undefined : undefined;
      if (carryDraftFromId && carryDraftFromId !== reusable.id) {
        await migratePromptContextSessionKey(carryDraftFromId, reusable.id);
      }
      promoteReusableEmptyMainSession(reusable.id, sessionsLatestRef);
      switchSessionIfNeeded(reusable.id);
      void bindRepositoryMainSession(projectMainSessionBindingKey(project.id), reusable.id);
      return reusable.id;
    }
    const carryDraftFromId = opts?.carryDraft ? priorActiveId ?? undefined : undefined;
    const id = await createSession(anchor.path, anchor.displayName, {
      immediateActivate: true,
      onBeforeActivate: carryDraftFromId
        ? (newId) => migratePromptContextSessionKey(carryDraftFromId, newId)
        : undefined,
    });
    void bindRepositoryMainSession(projectMainSessionBindingKey(project.id), id, {
      deferHostRelease: true,
    });
    scheduleReleaseScopedClaudeHostsBeforeNewMain({
      kind: "project",
      project,
      newSessionId: id,
      priorActiveId,
    });
    return id;
  }

  const bindProjectMainSessionTarget = useCallback(
    (project: ProjectItem): string | null => {
      const sessionsNow = sessionsLatestRef.current;
      const anchor = resolveProjectMainSessionAnchor(project, repositories);
      if (!anchor.path) {
        message.warning("该 Workspace 缺少根目录，请先配置 rootPath");
        return null;
      }
      const projectBindingKey = projectMainSessionBindingKey(project.id);
      const boundId = resolveBoundMainSessionId(
        projectBindingKey,
        repositoryMainSessionBindings,
        sessionsNow,
        null,
      );
      if (boundId) {
        switchSessionIfNeeded(boundId);
        return boundId;
      }
      const latestForProject = pickProjectMainSessionForSidebarSelect(
        sessionsNow,
        anchor.path,
        sessionOwnerHintsRef.current,
      );
      if (latestForProject) {
        switchSessionIfNeeded(latestForProject.id);
        void bindRepositoryMainSession(projectBindingKey, latestForProject.id);
        return latestForProject.id;
      }
      return null;
    },
    [
      bindRepositoryMainSession,
      repositories,
      repositoryMainSessionBindings,
      sessionsLatestRef,
      sessionsStructureKey,
      switchSessionIfNeeded,
    ],
  );

  async function ensureRepositoryMainSession(repository: Repository): Promise<string | null> {
    const target = resolveSidebarSelectionTarget({ repository });
    const flightKey = `repo:${target.path}`;
    if (ensureSessionInFlightRef.current === flightKey) {
      return null;
    }
    const existing = bindRepositoryMainSessionTarget(repository);
    if (existing) {
      return existing;
    }
    ensureSessionInFlightRef.current = flightKey;
    try {
      return await createAndBindRepositoryMainSession(
        repository,
        activeSessionIdLatestRef.current,
      );
    } finally {
      if (ensureSessionInFlightRef.current === flightKey) {
        ensureSessionInFlightRef.current = null;
      }
    }
  }

  async function ensureProjectMainSession(project: ProjectItem): Promise<string | null> {
    const anchor = resolveProjectMainSessionAnchor(project, repositories);
    const flightKey = `project:${project.id}:${anchor.path ?? ""}`;
    if (!anchor.path) {
      message.warning("该 Workspace 缺少根目录，请先配置 rootPath");
      return null;
    }
    if (ensureSessionInFlightRef.current === flightKey) {
      return null;
    }
    const existing = bindProjectMainSessionTarget(project);
    if (existing) {
      return existing;
    }
    ensureSessionInFlightRef.current = flightKey;
    try {
      return await createAndBindProjectMainSession(project, activeSessionIdLatestRef.current);
    } finally {
      if (ensureSessionInFlightRef.current === flightKey) {
        ensureSessionInFlightRef.current = null;
      }
    }
  }

  async function openRepositoryMainSession(
    repository: Repository,
    options?: { enterChat?: boolean },
  ): Promise<string | null> {
    setActiveRepositoryWithOwner(repository.id);
    if (options?.enterChat ?? true) {
      startTransition(() => {
        viewMode.enter({ kind: "chat" });
      });
    }
    if (shouldSidebarRepositorySelectOnlyUpdateFocus(repository, projects)) {
      return switchRepositoryDisplaySession(repository);
    }
    return ensureRepositoryMainSession(repository);
  }

  async function releasePriorActiveSessionHostBeforeNewMain(
    priorActiveId: string | null | undefined,
    newSessionId: string,
    alreadyReleasedTabIds?: ReadonlySet<string>,
  ): Promise<void> {
    const priorId = priorActiveId?.trim();
    const nextId = newSessionId.trim();
    if (!priorId || priorId === nextId) {
      return;
    }
    if (alreadyReleasedTabIds?.has(priorId)) {
      return;
    }
    const prior = sessionsLatestRef.current.find((s) => s.id === priorId);
    if (!prior) {
      return;
    }
    // 正在执行的前一会话（含 Codex RPC）应继续后台跑，新建主会话不得打断。
    if (prior.status === "running" || prior.status === "connecting") {
      return;
    }
    await releaseSessionHostProcessRef.current(prior.id);
  }

  async function releaseScopedClaudeHostsBeforeNewMain(
    params:
      | {
          kind: "repository";
          repositoryPath: string;
          newSessionId: string;
          priorActiveId?: string | null;
        }
      | {
          kind: "project";
          project: ProjectItem;
          newSessionId: string;
          priorActiveId?: string | null;
        },
  ): Promise<void> {
    const releaseOpts = {
      sessions: sessionsLatestRef.current,
      excludeSessionId: params.newSessionId,
      releaseWiseTabSession: (sessionId: string, ctx?: ReleaseWiseTabSessionContext) =>
        releaseSessionHostProcessRef.current(sessionId, ctx),
      onCancelTabSession: (sessionId: string) => cancelSession(sessionId),
    };
    const releasedTabIds =
      params.kind === "repository"
        ? await releaseClaudeHostProcessesForRepositoryScope({
            repositoryPath: params.repositoryPath,
            ...releaseOpts,
          })
        : await releaseClaudeHostProcessesForProjectScope({
            project: params.project,
            repositories: repositoriesLatestRef.current,
            ...releaseOpts,
          });
    await releasePriorActiveSessionHostBeforeNewMain(
      params.priorActiveId,
      params.newSessionId,
      releasedTabIds,
    );
  }

  function scheduleReleaseScopedClaudeHostsBeforeNewMain(
    params: Parameters<typeof releaseScopedClaudeHostsBeforeNewMain>[0],
  ): void {
    const run = () => {
      void releaseScopedClaudeHostsBeforeNewMain(params);
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        requestAnimationFrame(run);
      });
      return;
    }
    window.setTimeout(run, 0);
  }

  async function handleManualNewRepositorySession(repository: Repository): Promise<void> {
    const target = resolveSidebarSelectionTarget({ repository });
    const flightKey = `manual-new-repo:${target.path}`;
    if (ensureSessionInFlightRef.current === flightKey) {
      return;
    }
    ensureSessionInFlightRef.current = flightKey;
    try {
      startTransition(() => {
        viewMode.enter({ kind: "chat" });
      });
      const id = await createAndBindRepositoryMainSession(
        repository,
        activeSessionIdLatestRef.current,
        { carryDraft: true },
      );
      jumpToSessionWithRepository(id);
    } finally {
      if (ensureSessionInFlightRef.current === flightKey) {
        ensureSessionInFlightRef.current = null;
      }
    }
  }

  async function handleManualNewProjectSession(project: ProjectItem): Promise<void> {
    const byId = new Map(repositories.map((repo) => [repo.id, repo]));
    const repos = project.repositoryIds
      .map((id) => byId.get(id))
      .filter((repo): repo is Repository => Boolean(repo));
    const anchor = resolveProjectMainSessionAnchor(project, repositories);
    if (!anchor.path) {
      message.warning("该 Workspace 缺少根目录，请先配置 rootPath");
      return;
    }
    const flightKey = `manual-new-project:${project.id}:${anchor.path}`;
    if (ensureSessionInFlightRef.current === flightKey) {
      return;
    }
    ensureSessionInFlightRef.current = flightKey;
    try {
      const isStandaloneTrellisProject = project.id.startsWith("repo:");
      startTransition(() => {
        viewMode.enter({ kind: "chat" });
        if (repos[0]) {
          if (isStandaloneTrellisProject) {
            setActiveRepositoryWithOwner(repos[0].id);
          } else {
            setActiveProjectId(project.id);
            setActiveRepositoryId(repos[0].id);
          }
        } else if (!isStandaloneTrellisProject) {
          setActiveProjectId(project.id);
        }
      });
      const id = await createAndBindProjectMainSession(project, activeSessionIdLatestRef.current, {
        carryDraft: true,
      });
      if (id) {
        jumpToSessionWithRepository(id);
      }
    } finally {
      if (ensureSessionInFlightRef.current === flightKey) {
        ensureSessionInFlightRef.current = null;
      }
    }
  }

  const handleSidebarRepositorySelect = useCallback(
    (repositoryId: number | null) => {
      if (repositoryId == null) {
        setActiveRepositoryId(null);
        return;
      }
      const repository = repositories.find((item) => item.id === repositoryId);
      if (!repository) {
        return;
      }
      void openRepositoryMainSession(repository, { enterChat: false });
    },
    [repositories, setActiveRepositoryId, setActiveRepositoryWithOwner],
  );

  const startupFirstProjectRepoSessionAppliedRef = useRef(false);
  const sidebarSelectionEpochRef = useRef(0);

  const tryRouteSidebarSelectionToFocusedPane = useCallback(
    (kind: "repository" | "project", id: number | string): boolean => {
      const target = resolveFocusedPaneTargetSlot(
        paneCountRef.current ?? 1,
        getActivePaneIndex(),
        extraPanes,
      );
      if (target.kind === "extra") {
        if (kind === "repository") {
          void handlePaneRepositorySelect(target.slotIndex, Number(id));
        } else {
          void handlePaneProjectNewSession(target.slotIndex, String(id), projects);
        }
        return true;
      }
      return false;
    },
    [extraPanes, handlePaneProjectNewSession, handlePaneRepositorySelect, paneCountRef, projects],
  );

  const handlePickedActiveRepositoryForCurrentPane = useCallback(
    (repositoryId: number) => {
      if (paneCountRef.current === 1) {
        setActiveRepositoryId(repositoryId);
        return;
      }
      tryRouteSidebarSelectionToFocusedPane("repository", repositoryId);
    },
    [paneCountRef, setActiveRepositoryId, tryRouteSidebarSelectionToFocusedPane],
  );

  const handleSidebarRepositorySelectLeavingMcpHub = useCallback(
    (repositoryId: number | null) => {
      if (repositoryId == null) {
        startTransition(() => {
          if (viewMode.isCockpit || viewMode.isAuthor || viewMode.isInspect) {
            viewMode.back();
          }
        });
        handleSidebarRepositorySelect(repositoryId);
        return;
      }
      const repository = repositories.find((item) => item.id === repositoryId);
      if (!repository) {
        return;
      }
      prefetchGitStatus(repository.path);
      const leavingOverlay = viewMode.isCockpit || viewMode.isAuthor || viewMode.isInspect;
      if (!leavingOverlay && tryRouteSidebarSelectionToFocusedPane("repository", repositoryId)) {
        return;
      }
      if (
        !leavingOverlay &&
        viewMode.isChat &&
        activeRepositoryId === repositoryId &&
        activeWorkspaceFocus !== "project"
      ) {
        if (shouldSidebarRepositorySelectOnlyUpdateFocus(repository, projects)) {
          switchRepositoryDisplaySession(repository);
          return;
        }
        scheduleSidebarMainSessionEnsure(() => ensureRepositoryMainSession(repository));
        return;
      }
      const selectionEpoch = ++sidebarSelectionEpochRef.current;
      setActiveRepositoryWithOwner(repository.id);
      if (leavingOverlay) {
        startTransition(() => viewMode.back());
      } else if (!viewMode.isChat) {
        startTransition(() => {
          viewMode.enter({ kind: "chat" });
        });
      }
      if (sidebarSelectionEpochRef.current !== selectionEpoch) {
        return;
      }
      if (shouldSidebarRepositorySelectOnlyUpdateFocus(repository, projects)) {
        switchRepositoryDisplaySession(repository);
        return;
      }
      scheduleSidebarMainSessionEnsure(() => ensureRepositoryMainSession(repository));
    },
    [
      activeRepositoryId,
      activeWorkspaceFocus,
      handleSidebarRepositorySelect,
      projects,
      repositories,
      setActiveRepositoryWithOwner,
      tryRouteSidebarSelectionToFocusedPane,
      viewMode,
    ],
  );

  useEffect(() => {
    if (repositoryListLoading || !tabsHydrated) return;
    if (startupFirstProjectRepoSessionAppliedRef.current) return;

    if (activeWorkspaceFocus === "project" && activeProjectId) {
      const startupProject = projects.find((p) => p.id === activeProjectId) ?? null;
      if (!startupProject) return;
      startupFirstProjectRepoSessionAppliedRef.current = true;
      void ensureProjectMainSession(startupProject);
      if (!viewMode.isChat) {
        viewMode.enter({ kind: "chat" });
      }
      return;
    }

    if (activeRepositoryId == null) return;
    if (!repositories.some((r) => r.id === activeRepositoryId)) return;
    startupFirstProjectRepoSessionAppliedRef.current = true;
    const startupRepo = repositories.find((r) => r.id === activeRepositoryId) ?? null;
    const ownerProject = startupRepo
      ? findOwnerProjectForRepositoryId(startupRepo.id, projects)
      : null;
    if (startupRepo && isMultiRepoProject(ownerProject, projects) && ownerProject) {
      setActiveRepositoryWithOwner(startupRepo.id);
      void ensureProjectMainSession(ownerProject);
    } else if (startupRepo) {
      void ensureRepositoryMainSession(startupRepo);
    }
    if (!ownerProject) {
      viewMode.enter({ kind: "chat" });
    }
  }, [
    activeProjectId,
    activeRepositoryId,
    activeWorkspaceFocus,
    projects,
    repositories,
    repositoryListLoading,
    setActiveRepositoryWithOwner,
    tabsHydrated,
    viewMode,
  ]);

  const handleProjectSelectLeavingMcpHub = useCallback(
    (projectId: string) => {
      if (suppressProjectSelectToChatRef.current) {
        return;
      }
      const project = projects.find((p) => p.id === projectId) ?? null;
      if (!project) {
        setActiveProjectId(projectId);
        return;
      }
      const leavingOverlay = viewMode.isAuthor || viewMode.isInspect || viewMode.isCockpit;
      if (!leavingOverlay && tryRouteSidebarSelectionToFocusedPane("project", projectId)) {
        return;
      }
      if (
        !leavingOverlay &&
        viewMode.isChat &&
        activeProjectId === projectId &&
        activeWorkspaceFocus === "project"
      ) {
        return;
      }
      const selectionEpoch = ++sidebarSelectionEpochRef.current;
      setActiveProjectId(projectId);
      if (leavingOverlay) {
        startTransition(() => viewMode.back());
      } else if (!viewMode.isChat) {
        startTransition(() => {
          viewMode.enter({ kind: "chat" });
        });
      }
      if (sidebarSelectionEpochRef.current !== selectionEpoch) {
        return;
      }
      scheduleSidebarMainSessionEnsure(() => ensureProjectMainSession(project));
    },
    [
      activeProjectId,
      activeWorkspaceFocus,
      projects,
      setActiveProjectId,
      suppressProjectSelectToChatRef,
      tryRouteSidebarSelectionToFocusedPane,
      viewMode,
    ],
  );

  const jumpToSessionLeavingMcpHub = useCallback(
    (sessionId: string) => {
      viewMode.enter({ kind: "chat" });
      requestPaneCenterView(0, "messages");
      jumpToSessionWithRepository(sessionId);
    },
    [jumpToSessionWithRepository, viewMode],
  );

  async function openProjectMainSession(project: ProjectItem): Promise<string | null> {
    const byId = new Map(repositories.map((repo) => [repo.id, repo]));
    const repos = project.repositoryIds
      .map((id) => byId.get(id))
      .filter((repo): repo is Repository => Boolean(repo));
    const anchor = resolveProjectMainSessionAnchor(project, repositories);
    if (!anchor.path) {
      message.warning("该 Workspace 缺少根目录，请先配置 rootPath");
      return null;
    }
    const isStandaloneTrellisProject = project.id.startsWith("repo:");
    if (repos[0]) {
      if (isStandaloneTrellisProject) {
        setActiveRepositoryWithOwner(repos[0].id);
      } else {
        setActiveProjectId(project.id);
        setActiveRepositoryId(repos[0].id);
      }
    } else if (!isStandaloneTrellisProject) {
      setActiveProjectId(project.id);
    }
    startTransition(() => {
      viewMode.enter({ kind: "chat" });
    });

    return ensureProjectMainSession(project);
  }

  const canRestoreHistorySessionForDrawer = useCallback(
    (sessionId: string) => {
      const session = sessionsLatestRef.current.find((item) => item.id === sessionId);
      if (!session) return false;
      return !isSessionBoundAsRepositoryMain(
        session,
        repositoryMainBindingsLatestRef.current,
        sessionsLatestRef.current,
        repositories,
      );
    },
    [repositories, repositoryMainBindingsLatestRef, sessionsLatestRef],
  );

  const handleRestoreHistorySessionAsMain = useCallback(
    async (sessionId: string) => {
      const sid = sessionId.trim();
      if (!sid) return;
      const target = findSessionByTabOrClaudeId(sessionsLatestRef.current, sid);
      if (!target) {
        message.warning("未找到该会话");
        return;
      }
      if (!target.repositoryPath?.trim()) {
        message.warning("无法恢复：会话缺少仓库路径");
        return;
      }
      viewMode.enter({ kind: "chat" });
      await bindRepositoryMainSessionRef.current(target.repositoryPath, target.id);
      jumpToSessionWithRepositoryRef.current(target.id);
      if (target.claudeSessionId?.trim() || target.id.trim()) {
        try {
          await reloadFullDiskTranscript(target.id);
        } catch {
          /* 落盘略晚时不阻断恢复 */
        }
      }
      onRestoreHistorySessionAsMainComplete?.();
    },
    [
      bindRepositoryMainSessionRef,
      jumpToSessionWithRepositoryRef,
      onRestoreHistorySessionAsMainComplete,
      reloadFullDiskTranscript,
      viewMode,
    ],
  );

  return {
    ensureRepositoryMainSession,
    ensureProjectMainSession,
    openRepositoryMainSession,
    openProjectMainSession,
    handleManualNewRepositorySession,
    handleManualNewProjectSession,
    handleSidebarRepositorySelect,
    handleSidebarRepositorySelectLeavingMcpHub,
    handleProjectSelectLeavingMcpHub,
    handlePickedActiveRepositoryForCurrentPane,
    jumpToSessionLeavingMcpHub,
    canRestoreHistorySessionForDrawer,
    handleRestoreHistorySessionAsMain,
    switchRepositoryDisplaySession,
  };
}

export type AppSidebarSelectionApi = ReturnType<typeof useAppSidebarSelection>;
