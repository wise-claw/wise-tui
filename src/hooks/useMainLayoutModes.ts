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
  computeMinLogicalCenterWidthForPaneCount,
  MAIN_LAYOUT_MULTI_PANE_EXPAND_BUFFER_PX,
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
  return { slotId: `pane-${Date.now()}-${paneSlotCounter}`, sessionId: null, repositoryId: null };
}

export function useMainLayoutModes({
  activeRepository,
  activeSessionId,
  collapsed,
  createSession,
  paneCount,
  extraPanes,
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
  const mainLayoutContentRef = useRef<HTMLElement | null>(null);

  const sessionsLatestRef = useRef(sessions);
  sessionsLatestRef.current = sessions;
  const activeSessionIdLatestRef = useRef(activeSessionId);
  activeSessionIdLatestRef.current = activeSessionId;
  const repositoryMainBindingsLatestRef = useRef(repositoryMainSessionBindings);
  repositoryMainBindingsLatestRef.current = repositoryMainSessionBindings;

  /** 切换到指定屏数，每次切换都会自适应调整窗口宽度。 */
  const handleChangePaneCount = useCallback(
    async (targetCount: PaneCount) => {
      if (targetCount === paneCount) return;

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
      if (paneCount === 1) {
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
      const oldCols = paneCount <= 2 ? paneCount : paneCount / 2;
      const newCols = targetCount <= 2 ? targetCount : targetCount / 2;
      const colDelta = newCols - oldCols;
      const PANE_UNIT_PX = 461; // MAIN_LAYOUT_MULTI_PANE_MIN_WIDTH_PX(460) + gap(1)

      // 调整 extraPanes 数组长度
      const neededExtra = targetCount - 1;
      setExtraPanes((prev) => {
        if (prev.length === neededExtra) return prev;
        if (prev.length > neededExtra) {
          // 截断多余窗格（不删除 session）
          return prev.slice(0, neededExtra);
        }
        // 追加空窗格
        const next = [...prev];
        while (next.length < neededExtra) {
          next.push(createPaneSlot());
        }
        return next;
      });

      setPaneCount(targetCount);

      // 等布局帧后调整窗口宽度
      await waitLayoutFrames(2);
      if (colDelta > 0 && typeof window !== "undefined") {
        // 增加列数：扩展窗口
        const expandPx = colDelta * PANE_UNIT_PX;
        try {
          await setMainWindowLogicalInnerSize(window.innerWidth + expandPx, window.innerHeight);
          multiPaneAccumulatedDeltaRef.current += expandPx;
        } catch {
          /* 浏览器 dev / 非 Tauri */
        }
      } else if (colDelta < 0 && typeof window !== "undefined") {
        // 减少列数：收缩窗口
        const shrinkPx = Math.abs(colDelta) * PANE_UNIT_PX;
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
    },
    [activeRepository, paneCount, setExtraPanes, setPaneCount],
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
            const expandPx = 461; // 460 + 1 gap
            try {
              await setMainWindowLogicalInnerSize(window.innerWidth + expandPx, window.innerHeight);
              multiPaneAccumulatedDeltaRef.current = expandPx;
            } catch {
              /* 浏览器 dev / 非 Tauri */
            }
          }
        } else {
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

  // 清理已不存在的 session 引用
  useEffect(() => {
    const sessionIds = new Set(sessions.map((s) => s.id));
    let changed = false;
    const cleaned = extraPanes.map((slot) => {
      if (slot.sessionId && !sessionIds.has(slot.sessionId)) {
        changed = true;
        return { ...slot, sessionId: null };
      }
      return slot;
    });
    if (changed) setExtraPanes(cleaned);
  }, [sessions, extraPanes, setExtraPanes]);

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
          if (unlistenDual) {
            // 已经监听了旧事件，取消新的以避免双重触发
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
