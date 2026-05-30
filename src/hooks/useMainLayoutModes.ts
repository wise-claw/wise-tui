import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import { message } from "antd";
import type { ClaudeSession, ProjectItem, Repository } from "../types";
import {
  readMainWindowInnerSize,
  restoreMainWindowInnerSnapshot,
  setMainWindowLogicalInnerSize,
  shrinkMainWindowToRemoveHorizontalSlack,
  waitLayoutFrames,
} from "../services/mainWindowLayout";
import {
  columnCountForPaneCount,
  computeMinLogicalCenterWidthForPaneCount,
  MAIN_LAYOUT_MULTI_PANE_EXPAND_BUFFER_PX,
  MAIN_LAYOUT_MULTI_PANE_UNIT_PX,
  nextPaneCountInCycle,
  type PaneCount,
  type PaneSlot,
} from "../constants/mainLayoutWidths";
import {
  longestCommonRepositoryPathPrefix,
  resolveProjectMainSessionAnchor,
} from "../utils/projectSessionAnchor";
import { pickSessionForRepositorySidebarSelect } from "../utils/claudeSessionSelection";
import { loadSessionOwnerHints } from "../utils/sessionOwnerHints";
import { repositorySessionTabDisplayName } from "../utils/repositoryType";
import {
  isRepositoryMainSessionTab,
  normalizeRepositoryPathKey as normalizeRepositoryPathForMatch,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "../utils/repositoryMainSessionBinding";
import { usePersistedMainLayoutSiderWidths } from "./usePersistedMainLayoutSiderWidths";
import { listProjects } from "../services/projectState";
import {
  loadRightPanelDefaultCollapsed,
  saveRightPanelDefaultCollapsed,
  WISE_RIGHT_PANEL_DEFAULT_CHANGED,
} from "../services/wiseDefaultConfigStore";
import { RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK } from "../utils/rightPanelStorage";
import { planNextPaneSlotPlacement, isSessionBoundInPanes, normalizeExtraPanesToPaneCount } from "../utils/multiPaneSlots";
import { resolveTrellisBootstrapPath } from "../utils/trellisBootstrapPath";

const COMPACT_LAYOUT_WINDOW_WIDTH_PX = 700;
const COMPACT_LAYOUT_WINDOW_HEIGHT_PX = 600;

type CreateSession = (
  repositoryPath: string,
  repositoryName: string,
  opts?: { skipActivate?: boolean },
) => Promise<string>;

interface UseMainLayoutModesOptions {
  activeRepository: Repository | undefined;
  activeSessionId: string | null;
  collapsed: boolean;
  createSession: CreateSession;
  paneCount: PaneCount;
  extraPanes: PaneSlot[];
  projects: ProjectItem[];
  repositories: Repository[];
  repositoryMainSessionBindings: Record<string, string>;
  sessions: ClaudeSession[];
  setActiveRepositoryId: (repositoryId: number | null) => void;
  setPaneCount: (count: PaneCount) => void;
  setExtraPanes: (panes: PaneSlot[] | ((prev: PaneSlot[]) => PaneSlot[])) => void;
}

let paneSlotCounter = 0;
function createPaneSlot(): PaneSlot {
  paneSlotCounter += 1;
  return {
    slotId: `pane-${Date.now()}-${paneSlotCounter}`,
    sessionId: null,
    repositoryId: null,
  };
}

export function useMainLayoutModes({
  activeRepository,
  activeSessionId,
  collapsed,
  createSession,
  paneCount,
  extraPanes,
  projects,
  repositories,
  repositoryMainSessionBindings,
  sessions,
  setActiveRepositoryId,
  setPaneCount,
  setExtraPanes,
}: UseMainLayoutModesOptions) {
  const [rightCollapsed, setRightCollapsed] = useState(RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK);
  const [rightPanelDefaultCollapsed, setRightPanelDefaultCollapsed] = useState(
    RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
  );
  const [compactLayoutMode, setCompactLayoutMode] = useState(false);
  const compactLayoutSnapshotRef = useRef<{ width: number; height: number } | null>(null);
  const compactLayoutModeRef = useRef(false);
  compactLayoutModeRef.current = compactLayoutMode;

  const effectiveRightCollapsed = useMemo(
    () => compactLayoutMode || rightCollapsed,
    [compactLayoutMode, rightCollapsed],
  );
  const {
    leftWidthPx: mainLayoutLeftWidthPx,
    rightWidthPx: mainLayoutRightWidthPx,
    setLeftWidthPx: setMainLayoutLeftWidthPx,
    setRightWidthPx: setMainLayoutRightWidthPx,
  } = usePersistedMainLayoutSiderWidths({
    leftCollapsed: collapsed,
    rightCollapsed: effectiveRightCollapsed,
  });

  /** 进入多屏前（paneCount=1）的窗口快照，关闭多屏时恢复。 */
  const singlePaneWindowSnapshotRef = useRef<{ width: number; height: number } | null>(null);
  /** 累计从单屏基准扩展的逻辑像素增量，关闭多屏时按此值缩回。 */
  const multiPaneAccumulatedDeltaRef = useRef<number>(0);
  const paneChangeInFlightRef = useRef(false);
  const paneCountRef = useRef(paneCount);
  paneCountRef.current = paneCount;
  const mainLayoutContentRef = useRef<HTMLElement | null>(null);

  const sessionsLatestRef = useRef(sessions);
  sessionsLatestRef.current = sessions;
  const extraPanesLatestRef = useRef(extraPanes);
  extraPanesLatestRef.current = extraPanes;
  const activeSessionIdLatestRef = useRef(activeSessionId);
  activeSessionIdLatestRef.current = activeSessionId;
  const repositoryMainBindingsLatestRef = useRef(repositoryMainSessionBindings);
  repositoryMainBindingsLatestRef.current = repositoryMainSessionBindings;

  /** 切换到指定屏数，每次切换都会自适应调整窗口宽度。 */
  const handleChangePaneCount = useCallback(
    async (targetCount: PaneCount) => {
      if (paneChangeInFlightRef.current) return;
      if (targetCount === paneCountRef.current) return;
      paneChangeInFlightRef.current = true;
      const currentPaneCount = paneCountRef.current;

      try {
      // 关闭多屏 → 恢复到单屏快照
      if (targetCount === 1) {
        setPaneCount(1);
        setExtraPanes([]);
        const accumulated = multiPaneAccumulatedDeltaRef.current;
        multiPaneAccumulatedDeltaRef.current = 0;
        await waitLayoutFrames(1);
        if (accumulated > 0 && typeof window !== "undefined") {
          try {
            await setMainWindowLogicalInnerSize(
              Math.max(320, window.innerWidth - accumulated),
              window.innerHeight,
            );
          } catch {
            /* 浏览器 dev / 非 Tauri */
          }
        } else if (singlePaneWindowSnapshotRef.current) {
          await restoreMainWindowInnerSnapshot(singlePaneWindowSnapshotRef.current);
        }
        singlePaneWindowSnapshotRef.current = null;
        await waitLayoutFrames(1);
        await shrinkMainWindowToRemoveHorizontalSlack();
        await shrinkMainWindowToRemoveHorizontalSlack();
        return;
      }

      // 从单屏进入多屏：先快照窗口尺寸
      if (currentPaneCount === 1) {
        if (!activeRepository) {
          message.warning("请先选择仓库");
          return;
        }
        multiPaneAccumulatedDeltaRef.current = 0;
        try {
          singlePaneWindowSnapshotRef.current = await readMainWindowInnerSize();
        } catch {
          singlePaneWindowSnapshotRef.current = null;
        }
      }

      // 计算列数变化量（用于窗口宽度增减）
      const oldCols = columnCountForPaneCount(currentPaneCount);
      const newCols = columnCountForPaneCount(targetCount);
      const colDelta = newCols - oldCols;

      // 调整 extraPanes 数组长度
      setExtraPanes((prev) => normalizeExtraPanesToPaneCount(targetCount, prev, createPaneSlot));

      setPaneCount(targetCount);

      // 等布局帧后调整窗口宽度
      await waitLayoutFrames(2);
      if (colDelta > 0 && typeof window !== "undefined") {
        // 增加列数：扩展窗口
        const expandPx = colDelta * MAIN_LAYOUT_MULTI_PANE_UNIT_PX;
        try {
          await setMainWindowLogicalInnerSize(window.innerWidth + expandPx, window.innerHeight);
          multiPaneAccumulatedDeltaRef.current += expandPx;
        } catch {
          /* 浏览器 dev / 非 Tauri */
        }
      } else if (colDelta < 0 && typeof window !== "undefined") {
        // 减少列数：收缩窗口
        const shrinkPx = Math.abs(colDelta) * MAIN_LAYOUT_MULTI_PANE_UNIT_PX;
        try {
          const nextW = Math.max(
            computeMinLogicalCenterWidthForPaneCount(targetCount) + MAIN_LAYOUT_MULTI_PANE_EXPAND_BUFFER_PX + 600,
            window.innerWidth - shrinkPx,
          );
          await setMainWindowLogicalInnerSize(nextW, window.innerHeight);
          multiPaneAccumulatedDeltaRef.current = Math.max(0, multiPaneAccumulatedDeltaRef.current - shrinkPx);
        } catch {
          /* 浏览器 dev / 非 Tauri */
        }
      }
      } finally {
        paneChangeInFlightRef.current = false;
      }
    },
    [activeRepository, setExtraPanes, setPaneCount],
  );

  const handleChangePaneCountRef = useRef(handleChangePaneCount);
  handleChangePaneCountRef.current = handleChangePaneCount;

  /** Alt+K 循环切换屏数。 */
  const handleCyclePaneCount = useCallback(() => {
    const next = nextPaneCountInCycle(paneCount);
    void handleChangePaneCount(next);
  }, [handleChangePaneCount, paneCount]);

  const handleCyclePaneCountRef = useRef(handleCyclePaneCount);
  handleCyclePaneCountRef.current = handleCyclePaneCount;

  /** 为指定窗格选择仓库（创建或复用 session）。 */
  const handlePaneRepositorySelect = useCallback(
    async (slotIndex: number, repositoryId: number) => {
      const repo = repositories.find((r) => r.id === repositoryId);
      if (!repo?.path?.trim()) {
        message.warning("未找到所选仓库");
        return;
      }
      const ownerHints = loadSessionOwnerHints();
      const sessionsNow = sessionsLatestRef.current;
      const pathKey = normalizeRepositoryPathForMatch(repo.path);
      const leftId = activeSessionIdLatestRef.current?.trim() ?? "";

      const mainOwnerPick = resolveMainOwnerAgentNameForRepositoryPath(repositories, repo.path);
      const bound = resolveBoundMainSessionId(
        repo.path,
        repositoryMainBindingsLatestRef.current,
        sessionsNow,
        mainOwnerPick,
      );
      const boundSession = bound ? sessionsNow.find((s) => s.id === bound) : undefined;
      const boundOk = Boolean(boundSession && isRepositoryMainSessionTab(boundSession, pathKey, mainOwnerPick));
      const picked = pickSessionForRepositorySidebarSelect(sessionsNow, repo.path, ownerHints, {
        mainOwnerAgentName: mainOwnerPick,
      });

      let nextSessionId: string;
      if (boundOk && boundSession && boundSession.id !== leftId) {
        nextSessionId = boundSession.id;
      } else if (picked && picked.id !== leftId) {
        nextSessionId = picked.id;
      } else {
        try {
          nextSessionId = await createSession(repo.path, repositorySessionTabDisplayName(repo), { skipActivate: true });
        } catch (error) {
          console.error("Failed to switch pane repository:", error);
          message.error("切换窗格仓库失败");
          return;
        }
      }

      if (isSessionBoundInPanes(nextSessionId, leftId, extraPanesLatestRef.current, slotIndex)) {
        message.warning("该会话已在其它窗格中打开");
        return;
      }

      setExtraPanes((prev) => {
        const next = [...prev];
        if (next[slotIndex]) {
          next[slotIndex] = {
            ...next[slotIndex],
            sessionId: nextSessionId,
            repositoryId: activeRepository?.id === repositoryId ? null : repositoryId,
          };
        }
        return next;
      });
    },
    [activeRepository?.id, createSession, repositories, setExtraPanes],
  );

  /** 为指定窗格选择工作区：在该项目根目录直接新建会话（不绑定到具体仓库）。 */
  const handlePaneProjectNewSession = useCallback(
    async (
      slotIndex: number,
      projectId: string,
      projects: ProjectItem[],
      options?: { rootPath?: string | null; projectName?: string | null },
    ) => {
      const projectIdKey = projectId.trim();
      const project = projects.find((p) => p.id.trim() === projectIdKey);
      const explicitRootPath = options?.rootPath?.trim() ?? "";
      if (!project && !explicitRootPath) {
        message.warning("未找到所选工作区");
        return;
      }
      if (!project && explicitRootPath) {
        try {
          const displayName = `Project: ${options?.projectName?.trim() || projectIdKey || "工作区"}`;
          const sessionId = await createSession(explicitRootPath, displayName, { skipActivate: true });
          setExtraPanes((prev) => {
            const next = [...prev];
            if (next[slotIndex]) {
              next[slotIndex] = { ...next[slotIndex], sessionId, repositoryId: null };
            }
            return next;
          });
          return;
        } catch (error) {
          console.error("Failed to create pane project session via explicit root:", error);
          message.error("新建工作区执行会话失败");
          return;
        }
      }
      if (!project) return;
      const repoById = new Map(repositories.map((repo) => [repo.id, repo] as const));
      const memberRepos = project.repositoryIds
        .map((id) => repoById.get(id))
        .filter((repo): repo is Repository => Boolean(repo));
      const anchor = resolveProjectMainSessionAnchor(project, repositories);
      const commonParent = longestCommonRepositoryPathPrefix(memberRepos.map((repo) => repo.path)).trim();
      let preferredRootPath = explicitRootPath;
      if (!preferredRootPath) {
        const localRoot = (project.rootPath ?? "").trim();
        if (localRoot) {
          preferredRootPath = localRoot;
        } else {
          try {
            const latest = await listProjects();
            const dbProject = latest.find((p) => p.id.trim() === projectIdKey);
            const dbRoot = (dbProject?.rootPath ?? "").trim();
            if (dbRoot) {
              preferredRootPath = dbRoot;
            }
          } catch (error) {
            console.error("Failed to refresh projects for pane workspace root path:", error);
          }
        }
      }
      const projectRootAnchorPath = anchor.isProjectRooted ? anchor.path.trim() : "";
      const createPath = preferredRootPath || projectRootAnchorPath || commonParent;
      const createDisplayName = `Project: ${project.name}`;
      if (!createPath) {
        message.warning("该工作区未提供根目录，且无法推导公共父目录，无法新建工作区会话");
        return;
      }
      try {
        const sessionId = await createSession(createPath, createDisplayName, { skipActivate: true });
        setExtraPanes((prev) => {
          const next = [...prev];
          if (next[slotIndex]) {
            next[slotIndex] = { ...next[slotIndex], sessionId, repositoryId: null };
          }
          return next;
        });
      } catch (error) {
        console.error("Failed to create pane project session:", error);
        message.error("新建工作区执行会话失败");
      }
    },
    [createSession, repositories, setExtraPanes],
  );

  /** 为指定窗格创建新 session。 */
  const handleNewPaneSession = useCallback(
    async (slotIndex: number, repository: Repository) => {
      setActiveRepositoryId(repository.id);
      try {
        const id = await createSession(repository.path, repositorySessionTabDisplayName(repository), {
          skipActivate: true,
        });

        // 若当前是单屏，先切到双屏
        if (paneCount === 1) {
          const slot = createPaneSlot();
          slot.sessionId = id;
          slot.repositoryId = null;
          setExtraPanes([slot]);
          multiPaneAccumulatedDeltaRef.current = 0;
          try {
            singlePaneWindowSnapshotRef.current = await readMainWindowInnerSize();
          } catch {
            singlePaneWindowSnapshotRef.current = null;
          }
          setPaneCount(2);
          await waitLayoutFrames(2);
          // 2屏=1×2，需要增加1列
          if (typeof window !== "undefined") {
            const expandPx = MAIN_LAYOUT_MULTI_PANE_UNIT_PX;
            try {
              await setMainWindowLogicalInnerSize(window.innerWidth + expandPx, window.innerHeight);
              multiPaneAccumulatedDeltaRef.current = expandPx;
            } catch {
              /* 浏览器 dev / 非 Tauri */
            }
          }
        } else {
          if (isSessionBoundInPanes(id, activeSessionIdLatestRef.current, extraPanesLatestRef.current, slotIndex)) {
            message.warning("该会话已在其它窗格中打开");
            return;
          }
          setExtraPanes((prev) => {
            const next = [...prev];
            if (next[slotIndex]) {
              next[slotIndex] = { ...next[slotIndex], sessionId: id, repositoryId: null };
            }
            return next;
          });
        }
      } catch (error) {
        console.error("Failed to create pane session:", error);
        message.error("创建窗格执行会话失败");
      }
    },
    [createSession, paneCount, setActiveRepositoryId, setExtraPanes, setPaneCount],
  );

  /** 侧栏「新开会话」：按多屏规则占用下一空窗格并创建执行会话。 */
  const handleNewPaneSessionInNextSlot = useCallback(
    async (repository: Repository, sessionPath?: string) => {
      const path = (sessionPath ?? repository.path).trim();
      if (!path) {
        message.warning("仓库路径为空");
        return;
      }
      setActiveRepositoryId(repository.id);
      try {
        const sessionId = await createSession(path, repositorySessionTabDisplayName(repository), {
          skipActivate: true,
        });

        if (paneCount === 1) {
          const slot = createPaneSlot();
          slot.sessionId = sessionId;
          slot.repositoryId = null;
          setExtraPanes([slot]);
          multiPaneAccumulatedDeltaRef.current = 0;
          try {
            singlePaneWindowSnapshotRef.current = await readMainWindowInnerSize();
          } catch {
            singlePaneWindowSnapshotRef.current = null;
          }
          setPaneCount(2);
          await waitLayoutFrames(2);
          if (typeof window !== "undefined") {
            const expandPx = MAIN_LAYOUT_MULTI_PANE_UNIT_PX;
            try {
              await setMainWindowLogicalInnerSize(window.innerWidth + expandPx, window.innerHeight);
              multiPaneAccumulatedDeltaRef.current = expandPx;
            } catch {
              /* 浏览器 dev / 非 Tauri */
            }
          }
          return;
        }

        if (isSessionBoundInPanes(sessionId, activeSessionIdLatestRef.current, extraPanesLatestRef.current)) {
          message.warning("该会话已在其它窗格中打开");
          return;
        }

        const plan = planNextPaneSlotPlacement({
          paneCount,
          extraPanes,
          createSlot: createPaneSlot,
        });
        if (plan.nextPaneCount !== paneCount) {
          await handleChangePaneCount(plan.nextPaneCount);
        }
        setExtraPanes((prev) => {
          const base =
            plan.nextPaneCount !== paneCount || prev.length !== plan.nextExtraPanes.length
              ? plan.nextExtraPanes
              : prev;
          const next = [...base];
          if (next[plan.slotIndex]) {
            next[plan.slotIndex] = {
              ...next[plan.slotIndex],
              sessionId,
              repositoryId: null,
            };
          }
          return next;
        });
      } catch (error) {
        console.error("Failed to create pane session in next slot:", error);
        message.error("新开会话失败");
      }
    },
    [createSession, extraPanes, handleChangePaneCount, paneCount, setActiveRepositoryId, setExtraPanes, setPaneCount],
  );

  /** 工作区侧栏「新开会话」：在工作区根目录创建会话并占用下一窗格。 */
  const handleNewPaneProjectSessionInNextSlot = useCallback(
    async (project: ProjectItem) => {
      const anchorRepo = project.repositoryIds
        .map((repositoryId) => repositories.find((item) => item.id === repositoryId))
        .find((item): item is Repository => Boolean(item));
      if (anchorRepo) {
        setActiveRepositoryId(anchorRepo.id);
      }
      const plan = planNextPaneSlotPlacement({
        paneCount,
        extraPanes,
        createSlot: createPaneSlot,
      });
      if (plan.nextPaneCount !== paneCount) {
        if (paneCount === 1 && !activeRepository && !anchorRepo) {
          message.warning("请先选择仓库");
          return;
        }
        await handleChangePaneCount(plan.nextPaneCount);
      }
      const slotIndex = paneCount === 1 ? 0 : plan.slotIndex;
      const rootPath = resolveTrellisBootstrapPath({
        scope: "project",
        project,
        repositories,
        projects,
      });
      await handlePaneProjectNewSession(slotIndex, project.id, projects, {
        rootPath: rootPath ?? undefined,
        projectName: project.name,
      });
    },
    [
      activeRepository,
      extraPanes,
      handleChangePaneCount,
      handlePaneProjectNewSession,
      paneCount,
      projects,
      repositories,
      setActiveRepositoryId,
    ],
  );

  // 清理已不存在的 session 引用
  useEffect(() => {
    setExtraPanes((prev) => {
      const sessionIds = new Set(sessions.map((s) => s.id));
      let changed = false;
      const cleaned = prev.map((slot) => {
        if (slot.sessionId && !sessionIds.has(slot.sessionId)) {
          changed = true;
          return { ...slot, sessionId: null };
        }
        return slot;
      });
      return changed ? cleaned : prev;
    });
  }, [sessions, setExtraPanes]);

  // 持久化恢复或异常状态下，将 extraPanes 长度与 paneCount 对齐
  useEffect(() => {
    setExtraPanes((prev) => normalizeExtraPanesToPaneCount(paneCount, prev, createPaneSlot));
  }, [paneCount, setExtraPanes]);

  const exitCompactLayoutMode = useCallback(async () => {
    const snap = compactLayoutSnapshotRef.current;
    compactLayoutSnapshotRef.current = null;
    setCompactLayoutMode(false);
    await waitLayoutFrames(2);
    if (!snap) return;
    try {
      await setMainWindowLogicalInnerSize(snap.width, snap.height);
    } catch {
      /* browser dev / non-Tauri */
    }
  }, []);

  const handleToggleCompactLayoutMode = useCallback(() => {
    if (compactLayoutModeRef.current) {
      void exitCompactLayoutMode();
      return;
    }
    compactLayoutSnapshotRef.current = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    setCompactLayoutMode(true);
    void (async () => {
      await waitLayoutFrames(2);
      if (!compactLayoutModeRef.current) return;
      if (!compactLayoutSnapshotRef.current) return;
      try {
        await setMainWindowLogicalInnerSize(COMPACT_LAYOUT_WINDOW_WIDTH_PX, COMPACT_LAYOUT_WINDOW_HEIGHT_PX);
      } catch {
        /* browser dev / non-Tauri */
      }
    })();
  }, [exitCompactLayoutMode]);

  const handleToggleCompactLayoutModeRef = useRef(handleToggleCompactLayoutMode);
  handleToggleCompactLayoutModeRef.current = handleToggleCompactLayoutMode;

  useEffect(() => {
    let unlistenCompact: (() => void) | undefined;
    let unlistenDual: (() => void) | undefined;
    let cancelled = false;
    void listen("global-toggle-compact-layout", () => {
      handleToggleCompactLayoutModeRef.current();
    })
      .then((fn) => {
        if (!cancelled) unlistenCompact = fn;
        else safeUnlisten(fn);
      })
      .catch(() => {
        /* non-Tauri / event unavailable */
      });
    // 兼容旧事件名 + 新事件名
    void listen("global-toggle-dual-pane", () => {
      handleCyclePaneCountRef.current();
    })
      .then((fn) => {
        if (!cancelled) unlistenDual = fn;
        else safeUnlisten(fn);
      })
      .catch(() => {
        /* non-Tauri / event unavailable */
      });
    void listen("global-cycle-multi-pane", () => {
      handleCyclePaneCountRef.current();
    })
      .then((fn) => {
        if (!cancelled) {
          // 两个事件语义相同，只保留一个 listener 避免 Alt+K 双触发
          if (unlistenDual) {
            safeUnlisten(fn);
          } else {
            unlistenDual = fn;
          }
        } else {
          safeUnlisten(fn);
        }
      })
      .catch(() => {
        /* non-Tauri / event unavailable */
      });
    return () => {
      cancelled = true;
      safeUnlisten(unlistenCompact);
      safeUnlisten(unlistenDual);
    };
  }, []);

  const handleToggleRightPanel = useCallback(() => {
    if (compactLayoutModeRef.current) {
      void exitCompactLayoutMode();
      return;
    }
    setRightCollapsed((c) => !c);
  }, [exitCompactLayoutMode]);

  useEffect(() => {
    let cancelled = false;
    void loadRightPanelDefaultCollapsed().then((collapsed) => {
      if (cancelled) return;
      setRightPanelDefaultCollapsed(collapsed);
      if (!compactLayoutModeRef.current) {
        setRightCollapsed(collapsed);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const collapsed = (event as CustomEvent<{ collapsed?: boolean }>).detail?.collapsed;
      if (typeof collapsed !== "boolean") return;
      setRightPanelDefaultCollapsed(collapsed);
      if (!compactLayoutModeRef.current) {
        setRightCollapsed(collapsed);
      }
    };
    window.addEventListener(WISE_RIGHT_PANEL_DEFAULT_CHANGED, handler);
    return () => window.removeEventListener(WISE_RIGHT_PANEL_DEFAULT_CHANGED, handler);
  }, []);

  const handleSetRightPanelDefaultCollapsed = useCallback((collapsed: boolean) => {
    void saveRightPanelDefaultCollapsed(collapsed)
      .then(() => {
        setRightPanelDefaultCollapsed(collapsed);
        if (!compactLayoutModeRef.current) {
          setRightCollapsed(collapsed);
        }
      })
      .catch(() => {
        message.error("保存右侧面板默认状态失败");
      });
  }, []);

  return {
    compactLayoutMode,
    effectiveRightCollapsed,
    handlePaneRepositorySelect,
    handlePaneProjectNewSession,
    handleNewPaneSession,
    handleNewPaneSessionInNextSlot,
    handleNewPaneProjectSessionInNextSlot,
    handleChangePaneCount,
    handleCyclePaneCount,
    handleToggleCompactLayoutMode,
    handleToggleRightPanel,
    handleSetRightPanelDefaultCollapsed,
    rightPanelDefaultCollapsed,
    mainLayoutContentRef,
    mainLayoutLeftWidthPx,
    mainLayoutRightWidthPx,
    setMainLayoutLeftWidthPx,
    setMainLayoutRightWidthPx,
  };
}
