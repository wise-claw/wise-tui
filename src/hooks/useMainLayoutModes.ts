import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { safeUnlisten, safeUnlistenPromise } from "../utils/safeTauriUnlisten";
import { message } from "antd";
import type { ClaudeSession, Repository } from "../types";
import {
  adjustMainWindowLogicalWidthByDelta,
  expandMainWindowByDualPaneCenterDelta,
  measureMainLayoutContentWidthPx,
  readMainWindowInnerSize,
  restoreMainWindowInnerSnapshot,
  setMainWindowLogicalInnerSize,
  shrinkMainWindowByDualPaneDelta,
  shrinkMainWindowToRemoveHorizontalSlack,
  waitLayoutFrames,
} from "../services/mainWindowLayout";
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
  dualPaneEnabled: boolean;
  dualPaneSecondarySessionId: string | null;
  repositories: Repository[];
  repositoryMainSessionBindings: Record<string, string>;
  sessions: ClaudeSession[];
  setActiveRepositoryId: (repositoryId: number | null) => void;
  setDualPaneEnabled: (enabled: boolean) => void;
  setDualPaneSecondaryRepositoryId: (repositoryId: number | null) => void;
  setDualPaneSecondarySessionId: (sessionId: string | null) => void;
}

export function useMainLayoutModes({
  activeRepository,
  activeSessionId,
  collapsed,
  createSession,
  dualPaneEnabled,
  dualPaneSecondarySessionId,
  repositories,
  repositoryMainSessionBindings,
  sessions,
  setActiveRepositoryId,
  setDualPaneEnabled,
  setDualPaneSecondaryRepositoryId,
  setDualPaneSecondarySessionId,
}: UseMainLayoutModesOptions) {
  const [rightCollapsed, setRightCollapsed] = useState(false);
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

  const dualWindowInnerSnapshotRef = useRef<{ width: number; height: number } | null>(null);
  const dualPaneCenterLogicalBeforeRef = useRef<number | null>(null);
  const dualPaneWindowDeltaLogicalRef = useRef<number | null>(null);
  const dualPaneWindowExpandConsumedRef = useRef(false);
  const mainLayoutContentRef = useRef<HTMLElement | null>(null);

  const sessionsLatestRef = useRef(sessions);
  sessionsLatestRef.current = sessions;
  const activeSessionIdLatestRef = useRef(activeSessionId);
  activeSessionIdLatestRef.current = activeSessionId;
  const repositoryMainBindingsLatestRef = useRef(repositoryMainSessionBindings);
  repositoryMainBindingsLatestRef.current = repositoryMainSessionBindings;

  const measureCurrentCenterWidth = useCallback(
    () =>
      measureMainLayoutContentWidthPx(mainLayoutContentRef.current, {
        leftCollapsed: collapsed,
        rightCollapsed: effectiveRightCollapsed,
        leftWidthPx: mainLayoutLeftWidthPx,
        rightWidthPx: mainLayoutRightWidthPx,
      }),
    [collapsed, effectiveRightCollapsed, mainLayoutLeftWidthPx, mainLayoutRightWidthPx],
  );

  const snapshotDualPaneWindowBeforeOpen = useCallback(() => {
    dualPaneWindowDeltaLogicalRef.current = null;
    dualPaneCenterLogicalBeforeRef.current = measureCurrentCenterWidth();
    void readMainWindowInnerSize()
      .then((size) => {
        dualWindowInnerSnapshotRef.current = size;
      })
      .catch(() => {
        dualWindowInnerSnapshotRef.current = null;
      });
  }, [measureCurrentCenterWidth]);

  const handleToggleDualPane = useCallback(async () => {
    if (dualPaneEnabled) {
      setDualPaneEnabled(false);
      setDualPaneSecondarySessionId(null);
      setDualPaneSecondaryRepositoryId(null);
      dualPaneWindowExpandConsumedRef.current = false;
      const deltaLogical = dualPaneWindowDeltaLogicalRef.current;
      dualPaneWindowDeltaLogicalRef.current = null;
      dualPaneCenterLogicalBeforeRef.current = null;
      await waitLayoutFrames(1);
      if (deltaLogical != null && deltaLogical > 0) {
        await shrinkMainWindowByDualPaneDelta(deltaLogical);
      } else {
        await restoreMainWindowInnerSnapshot(dualWindowInnerSnapshotRef.current);
      }
      dualWindowInnerSnapshotRef.current = null;
      await waitLayoutFrames(1);
      await shrinkMainWindowToRemoveHorizontalSlack();
      await shrinkMainWindowToRemoveHorizontalSlack();
      return;
    }
    if (!activeRepository) {
      message.warning("请先选择仓库");
      return;
    }
    try {
      snapshotDualPaneWindowBeforeOpen();
      setDualPaneSecondaryRepositoryId(null);
      const id = await createSession(activeRepository.path, repositorySessionTabDisplayName(activeRepository), {
        skipActivate: true,
      });
      setDualPaneSecondarySessionId(id);
      setDualPaneEnabled(true);
    } catch (error) {
      console.error("Failed to create dual-pane right session:", error);
      message.error("创建右侧主会话失败");
    }
  }, [activeRepository, createSession, dualPaneEnabled, snapshotDualPaneWindowBeforeOpen]);

  const handleToggleDualPaneRef = useRef(handleToggleDualPane);
  handleToggleDualPaneRef.current = handleToggleDualPane;

  const handleNewSecondarySession = useCallback(
    async (repository: Repository) => {
      setActiveRepositoryId(repository.id);
      if (!dualPaneEnabled) {
        snapshotDualPaneWindowBeforeOpen();
      }
      const id = await createSession(repository.path, repositorySessionTabDisplayName(repository), { skipActivate: true });
      setDualPaneSecondarySessionId(id);
      setDualPaneSecondaryRepositoryId(null);
      setDualPaneEnabled(true);
    },
    [createSession, dualPaneEnabled, setActiveRepositoryId, snapshotDualPaneWindowBeforeOpen],
  );

  const handleDualPaneSecondaryRepositorySelect = useCallback(
    async (repositoryId: number) => {
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

      let nextSecondary: string;
      if (boundOk && boundSession && boundSession.id !== leftId) {
        nextSecondary = boundSession.id;
      } else if (picked && picked.id !== leftId) {
        nextSecondary = picked.id;
      } else {
        try {
          nextSecondary = await createSession(repo.path, repositorySessionTabDisplayName(repo), { skipActivate: true });
        } catch (error) {
          console.error("Failed to switch dual-pane secondary repository:", error);
          message.error("切换右侧仓库失败");
          return;
        }
      }

      setDualPaneSecondaryRepositoryId(activeRepository?.id === repositoryId ? null : repositoryId);
      setDualPaneSecondarySessionId(nextSecondary);
    },
    [activeRepository?.id, createSession, repositories],
  );

  useEffect(() => {
    if (!dualPaneSecondarySessionId) return;
    if (!sessions.some((s) => s.id === dualPaneSecondarySessionId)) {
      setDualPaneSecondarySessionId(null);
    }
  }, [sessions, dualPaneSecondarySessionId]);

  useEffect(() => {
    if (!dualPaneEnabled) {
      dualPaneWindowExpandConsumedRef.current = false;
      return;
    }
    if (!dualPaneSecondarySessionId) return;
    if (dualPaneWindowExpandConsumedRef.current) return;

    const centerBefore = dualPaneCenterLogicalBeforeRef.current ?? 0;
    if (centerBefore <= 0) return;

    dualPaneWindowExpandConsumedRef.current = true;
    const aborted = { current: false };
    void (async () => {
      const deltaLogical = await expandMainWindowByDualPaneCenterDelta(centerBefore, {
        shouldAbort: () => aborted.current,
      });
      if (aborted.current) return;
      if (deltaLogical > 0) {
        dualPaneWindowDeltaLogicalRef.current = deltaLogical;
      }
    })();
    return () => {
      aborted.current = true;
    };
  }, [dualPaneEnabled, dualPaneSecondarySessionId]);

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
    void listen("global-toggle-dual-pane", () => {
      void handleToggleDualPaneRef.current();
    })
      .then((fn) => {
        if (!cancelled) unlistenDual = fn;
        else safeUnlisten(fn);
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
    const nextCollapsed = !rightCollapsed;
    setRightCollapsed(nextCollapsed);
    void (async () => {
      await waitLayoutFrames(2);
      const dw = nextCollapsed ? -mainLayoutRightWidthPx : mainLayoutRightWidthPx;
      await adjustMainWindowLogicalWidthByDelta(dw);
    })();
  }, [exitCompactLayoutMode, mainLayoutRightWidthPx, rightCollapsed]);

  return {
    compactLayoutMode,
    effectiveRightCollapsed,
    handleDualPaneSecondaryRepositorySelect,
    handleNewSecondarySession,
    handleToggleCompactLayoutMode,
    handleToggleDualPane,
    handleToggleRightPanel,
    mainLayoutContentRef,
    mainLayoutLeftWidthPx,
    mainLayoutRightWidthPx,
    setMainLayoutLeftWidthPx,
    setMainLayoutRightWidthPx,
  };
}
