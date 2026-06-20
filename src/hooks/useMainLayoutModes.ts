import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import { message } from "antd";
import type { ClaudeSession, ProjectItem, Repository } from "../types";
import type { PaneRuntimeOverride } from "../types/paneRuntimeOverride";
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
  computeRestoreMultiPaneLogicalWidth,
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
import { repositorySessionTabDisplayName } from "../utils/repositoryType";
import { usePersistedMainLayoutSiderWidths } from "./usePersistedMainLayoutSiderWidths";
import { useMainWindowMinLogicalSize } from "./useMainWindowMinLogicalSize";
import { listProjects } from "../services/projectState";
import {
  loadRightPanelDefaultCollapsed,
  saveRightPanelDefaultCollapsed,
  WISE_RIGHT_PANEL_DEFAULT_CHANGED,
} from "../services/wiseDefaultConfigStore";
import { RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK } from "../utils/rightPanelStorage";
import {
  assignCompanionSessionToPaneSlot,
  assignSessionToNormalizedExtraPanes,
  extraPanesLayoutFingerprint,
  findFirstEmptyExtraPaneIndex,
  planNextPaneSlotPlacement,
  isSessionBoundInPanes,
  normalizeExtraPanesToPaneCount,
} from "../utils/multiPaneSlots";
import { resolveWorkspaceRootPath } from "../utils/projectSessionAnchor";
import type { WorkspaceFocus } from "../utils/workspaceMode";
import {
  canEnterMultiPaneLayout,
} from "../utils/workspaceSelectionState";

/** 多屏切换 in-flight 超时：防止 Tauri resize 挂起导致后续操作永久无响应。 */
const PANE_CHANGE_IN_FLIGHT_TIMEOUT_MS = 8000;

type CreateSession = (
  repositoryPath: string,
  repositoryName: string,
  opts?: { skipActivate?: boolean },
) => Promise<string>;

interface UseMainLayoutModesOptions {
  activeRepository: Repository | undefined;
  activeProject: ProjectItem | null | undefined;
  activeWorkspaceFocus: WorkspaceFocus;
  activeSessionId: string | null;
  activeSessionRepositoryPath?: string | null;
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
  /** 主窗格（Pane 0）运行时覆盖；新建额外窗格会话时默认继承。 */
  primaryPaneRuntimeOverride?: PaneRuntimeOverride | null;
  /** 新建额外窗格会话后同步主会话模型。 */
  updateSessionModel?: (sessionId: string, model: string) => void;
  /** AppImpl 多屏布局持久化 hydration 完成后为 true。 */
  paneLayoutHydrated?: boolean;
}

function sessionsIdSetFingerprint(sessions: readonly ClaudeSession[]): string {
  return [...sessions]
    .map((session) => session.id)
    .sort()
    .join(",");
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
  activeProject,
  activeWorkspaceFocus,
  activeSessionId,
  activeSessionRepositoryPath,
  collapsed,
  createSession,
  paneCount,
  extraPanes,
  projects,
  repositories,
  repositoryMainSessionBindings: _repositoryMainSessionBindings,
  sessions,
  setActiveRepositoryId,
  setPaneCount,
  setExtraPanes,
  primaryPaneRuntimeOverride = null,
  updateSessionModel,
  paneLayoutHydrated = false,
}: UseMainLayoutModesOptions) {
  const [rightCollapsed, setRightCollapsed] = useState(RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK);
  const [rightPanelDefaultCollapsed, setRightPanelDefaultCollapsed] = useState(
    RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
  );
  const effectiveRightCollapsed = rightCollapsed;
  const {
    leftWidthPx: mainLayoutLeftWidthPx,
    rightWidthPx: mainLayoutRightWidthPx,
    setLeftWidthPx: setMainLayoutLeftWidthPx,
    setRightWidthPx: setMainLayoutRightWidthPx,
  } = usePersistedMainLayoutSiderWidths({
    leftCollapsed: collapsed,
    rightCollapsed: effectiveRightCollapsed,
  });

  useMainWindowMinLogicalSize({
    paneCount,
    leftCollapsed: collapsed,
    rightCollapsed: effectiveRightCollapsed,
    leftWidthPx: mainLayoutLeftWidthPx,
    rightWidthPx: mainLayoutRightWidthPx,
  });

  /** 进入多屏前（paneCount=1）的窗口快照，关闭多屏时恢复。 */
  const singlePaneWindowSnapshotRef = useRef<{ width: number; height: number } | null>(null);
  /** 累计从单屏基准扩展的逻辑像素增量，关闭多屏时按此值缩回。 */
  const multiPaneAccumulatedDeltaRef = useRef<number>(0);
  const paneChangeInFlightRef = useRef(false);
  const [paneChangeInFlight, setPaneChangeInFlight] = useState(false);
  const multiPaneRestoreExpandDoneRef = useRef(false);
  const paneCountRef = useRef(paneCount);
  paneCountRef.current = paneCount;
  const mainLayoutContentRef = useRef<HTMLElement | null>(null);

  const multiPaneLayoutReady = useCallback(
    () =>
      canEnterMultiPaneLayout({
        activeRepository,
        activeProject,
        activeWorkspaceFocus,
        repositories,
        sessionRepositoryPath: activeSessionRepositoryPath,
      }),
    [
      activeProject,
      activeRepository,
      activeSessionRepositoryPath,
      activeWorkspaceFocus,
      repositories,
    ],
  );

  const sessionsLatestRef = useRef(sessions);
  sessionsLatestRef.current = sessions;
  const sessionsIdFingerprint = sessionsIdSetFingerprint(sessions);
  const extraPanesLatestRef = useRef(extraPanes);
  extraPanesLatestRef.current = extraPanes;
  const activeSessionIdLatestRef = useRef(activeSessionId);
  activeSessionIdLatestRef.current = activeSessionId;
  const primaryPaneRuntimeOverrideLatestRef = useRef(primaryPaneRuntimeOverride);
  primaryPaneRuntimeOverrideLatestRef.current = primaryPaneRuntimeOverride;

  const inheritMainSessionModel = useCallback(
    (sessionId: string) => {
      if (!updateSessionModel) return;
      const mainId = activeSessionIdLatestRef.current?.trim();
      if (!mainId || mainId === sessionId.trim()) return;
      const mainSession = sessionsLatestRef.current.find((item) => item.id === mainId);
      const model = mainSession?.model?.trim();
      if (model) {
        updateSessionModel(sessionId, model);
      }
    },
    [updateSessionModel],
  );

  const bindCompanionSessionToSlot = useCallback(
    (slot: PaneSlot, sessionId: string, repositoryId: number | null): PaneSlot =>
      assignCompanionSessionToPaneSlot(
        slot,
        sessionId,
        repositoryId,
        primaryPaneRuntimeOverrideLatestRef.current,
      ),
    [],
  );

  /** 切换到指定屏数，每次切换都会自适应调整窗口宽度。成功返回 true。 */
  const handleChangePaneCount = useCallback(
    async (targetCount: PaneCount): Promise<boolean> => {
      if (paneChangeInFlightRef.current) {
        message.info("正在调整多屏布局，请稍候");
        return false;
      }
      if (targetCount === paneCountRef.current) return false;
      paneChangeInFlightRef.current = true;
      setPaneChangeInFlight(true);
      const currentPaneCount = paneCountRef.current;
      const timeoutId = window.setTimeout(() => {
        if (paneChangeInFlightRef.current) {
          paneChangeInFlightRef.current = false;
          setPaneChangeInFlight(false);
          message.warning("多屏切换超时，已恢复操作");
        }
      }, PANE_CHANGE_IN_FLIGHT_TIMEOUT_MS);

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
        // 单次收敛即可：上方已按 accumulated delta / 快照恢复窗口尺寸，
        // shrink 内部会再等 2 帧测量并收窄。原先第二次 shrink 仅作保险，
        // 徒增 2 帧 + 2 次 IPC，是关闭多屏卡顿感的显性来源。
        await shrinkMainWindowToRemoveHorizontalSlack();
        return true;
      }

      // 从单屏进入多屏：先快照窗口尺寸
      if (currentPaneCount === 1) {
        if (!multiPaneLayoutReady()) {
          message.warning("请先选择工作区或仓库");
          return false;
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
      return true;
      } finally {
        window.clearTimeout(timeoutId);
        paneChangeInFlightRef.current = false;
        setPaneChangeInFlight(false);
      }
    },
    [multiPaneLayoutReady, setExtraPanes, setPaneCount],
  );

  /** 单屏下为首个额外窗格写入 session 并切到双屏（复用 handleChangePaneCount 与 in-flight 锁）。 */
  const promoteToDualPaneWithSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      setExtraPanes(() => {
        const slot = createPaneSlot();
        return [bindCompanionSessionToSlot(slot, sessionId, null)];
      });
      return handleChangePaneCount(2);
    },
    [bindCompanionSessionToSlot, handleChangePaneCount, setExtraPanes],
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

  /** 为指定窗格选择仓库：始终新建隔离执行会话（不复用主会话绑定）。 */
  const handlePaneRepositorySelect = useCallback(
    async (slotIndex: number, repositoryId: number) => {
      const repo = repositories.find((r) => r.id === repositoryId);
      if (!repo?.path?.trim()) {
        message.warning("未找到所选仓库");
        return;
      }
      setActiveRepositoryId(repo.id);
      const leftId = activeSessionIdLatestRef.current?.trim() ?? "";
      try {
        const nextSessionId = await createSession(
          repo.path,
          repositorySessionTabDisplayName(repo),
          { skipActivate: true },
        );
        inheritMainSessionModel(nextSessionId);
        if (isSessionBoundInPanes(nextSessionId, leftId, extraPanesLatestRef.current, slotIndex)) {
          message.warning("该会话已在其它窗格中打开");
          return;
        }
        setExtraPanes((prev) => {
          const next = [...prev];
          if (next[slotIndex]) {
            next[slotIndex] = bindCompanionSessionToSlot(
              next[slotIndex],
              nextSessionId,
              activeRepository?.id === repositoryId ? null : repositoryId,
            );
          }
          return next;
        });
      } catch (error) {
        console.error("Failed to switch pane repository:", error);
        message.error("切换窗格仓库失败");
      }
    },
    [
      activeRepository?.id,
      bindCompanionSessionToSlot,
      createSession,
      inheritMainSessionModel,
      repositories,
      setActiveRepositoryId,
      setExtraPanes,
    ],
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
          inheritMainSessionModel(sessionId);
          setExtraPanes((prev) => {
            const next = [...prev];
            if (next[slotIndex]) {
              next[slotIndex] = bindCompanionSessionToSlot(next[slotIndex], sessionId, null);
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
        inheritMainSessionModel(sessionId);
        setExtraPanes((prev) => {
          const next = [...prev];
          if (next[slotIndex]) {
            next[slotIndex] = bindCompanionSessionToSlot(next[slotIndex], sessionId, null);
          }
          return next;
        });
      } catch (error) {
        console.error("Failed to create pane project session:", error);
        message.error("新建工作区执行会话失败");
      }
    },
    [bindCompanionSessionToSlot, createSession, inheritMainSessionModel, repositories, setExtraPanes],
  );

  /** 为指定窗格创建新 session。 */
  const handleNewPaneSession = useCallback(
    async (slotIndex: number, repository: Repository) => {
      setActiveRepositoryId(repository.id);
      try {
        const id = await createSession(repository.path, repositorySessionTabDisplayName(repository), {
          skipActivate: true,
        });
        inheritMainSessionModel(id);

        // 若当前是单屏，先切到双屏
        if (paneCountRef.current === 1) {
          await promoteToDualPaneWithSession(id);
        } else {
          if (isSessionBoundInPanes(id, activeSessionIdLatestRef.current, extraPanesLatestRef.current, slotIndex)) {
            message.warning("该会话已在其它窗格中打开");
            return;
          }
          setExtraPanes((prev) => {
            const next = [...prev];
            if (next[slotIndex]) {
              next[slotIndex] = bindCompanionSessionToSlot(next[slotIndex], id, null);
            }
            return next;
          });
        }
      } catch (error) {
        console.error("Failed to create pane session:", error);
        message.error("创建窗格执行会话失败");
      }
    },
    [
      bindCompanionSessionToSlot,
      createSession,
      inheritMainSessionModel,
      promoteToDualPaneWithSession,
      setActiveRepositoryId,
      setExtraPanes,
    ],
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
        inheritMainSessionModel(sessionId);

        if (paneCountRef.current === 1) {
          await promoteToDualPaneWithSession(sessionId);
          return;
        }

        if (isSessionBoundInPanes(sessionId, activeSessionIdLatestRef.current, extraPanesLatestRef.current)) {
          message.warning("该会话已在其它窗格中打开");
          return;
        }

        const plan = planNextPaneSlotPlacement({
          paneCount: paneCountRef.current,
          extraPanes: extraPanesLatestRef.current,
          createSlot: createPaneSlot,
        });
        if (plan.nextPaneCount !== paneCountRef.current) {
          const expanded = await handleChangePaneCount(plan.nextPaneCount);
          if (!expanded && plan.nextPaneCount !== paneCountRef.current) {
            message.warning("正在切换屏数，请稍后再试");
            return;
          }
        }
        setExtraPanes((prev) =>
          assignSessionToNormalizedExtraPanes(
            paneCountRef.current,
            prev,
            sessionId,
            createPaneSlot,
            plan.slotIndex,
            primaryPaneRuntimeOverrideLatestRef.current,
          ),
        );
      } catch (error) {
        console.error("Failed to create pane session in next slot:", error);
        message.error("新开会话失败");
      }
    },
    [
      createSession,
      handleChangePaneCount,
      inheritMainSessionModel,
      promoteToDualPaneWithSession,
      setActiveRepositoryId,
      setExtraPanes,
    ],
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
        paneCount: paneCountRef.current,
        extraPanes: extraPanesLatestRef.current,
        createSlot: createPaneSlot,
      });
      if (plan.nextPaneCount !== paneCountRef.current) {
        if (paneCountRef.current === 1 && !multiPaneLayoutReady()) {
          message.warning("请先选择工作区或仓库");
          return;
        }
        const expanded = await handleChangePaneCount(plan.nextPaneCount);
        if (!expanded && plan.nextPaneCount !== paneCountRef.current) {
          message.warning("正在切换屏数，请稍后再试");
          return;
        }
      }
      const slotIndex =
        paneCountRef.current === 1
          ? 0
          : (findFirstEmptyExtraPaneIndex(extraPanesLatestRef.current) ?? plan.slotIndex);
      const rootPath = resolveWorkspaceRootPath({
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
      handleChangePaneCount,
      handlePaneProjectNewSession,
      multiPaneLayoutReady,
      projects,
      repositories,
      setActiveRepositoryId,
    ],
  );

  // 持久化恢复多屏后补一次窗口扩宽，避免 min-width 挤压导致启动卡顿
  useEffect(() => {
    if (!paneLayoutHydrated) return;
    if (multiPaneRestoreExpandDoneRef.current) return;
    multiPaneRestoreExpandDoneRef.current = true;
    const restoredCount = paneCountRef.current;
    if (restoredCount <= 1) return;

    void (async () => {
      if (paneChangeInFlightRef.current) return;
      paneChangeInFlightRef.current = true;
      const timeoutId = window.setTimeout(() => {
        paneChangeInFlightRef.current = false;
      }, PANE_CHANGE_IN_FLIGHT_TIMEOUT_MS);
      try {
        multiPaneAccumulatedDeltaRef.current = 0;
        try {
          singlePaneWindowSnapshotRef.current = await readMainWindowInnerSize();
        } catch {
          singlePaneWindowSnapshotRef.current = null;
        }
        await waitLayoutFrames(2);
        if (typeof window === "undefined") return;
        const currentWidth = window.innerWidth;
        const targetWidth = computeRestoreMultiPaneLogicalWidth(restoredCount, currentWidth);
        if (targetWidth != null) {
          try {
            await setMainWindowLogicalInnerSize(targetWidth, window.innerHeight);
            multiPaneAccumulatedDeltaRef.current += Math.max(0, targetWidth - currentWidth);
          } catch {
            /* 浏览器 dev / 非 Tauri */
          }
        }
      } finally {
        window.clearTimeout(timeoutId);
        paneChangeInFlightRef.current = false;
      }
    })();
  }, [paneLayoutHydrated]);

  // 清理已不存在的 session 引用（勿依赖 sessions 数组引用，流式时每帧是新对象）
  useEffect(() => {
    const sessionIds = new Set(sessionsLatestRef.current.map((s) => s.id));
    setExtraPanes((prev) => {
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
  }, [sessionsIdFingerprint, setExtraPanes]);

  // 持久化恢复或异常状态下，将 extraPanes 长度与 paneCount 对齐
  useEffect(() => {
    if (!paneLayoutHydrated) return;
    setExtraPanes((prev) => {
      const next = normalizeExtraPanesToPaneCount(paneCount, prev, createPaneSlot);
      if (next === prev) return prev;
      if (extraPanesLayoutFingerprint(next) === extraPanesLayoutFingerprint(prev)) {
        return prev;
      }
      return next;
    });
  }, [paneCount, paneLayoutHydrated, setExtraPanes]);

  useEffect(() => {
    let unlistenMultiPane: (() => void) | undefined;
    let unlistenLegacyDualPane: (() => void) | undefined;
    let cancelled = false;
    const onCycleMultiPane = () => {
      handleCyclePaneCountRef.current();
    };
    void listen("global-cycle-multi-pane", onCycleMultiPane)
      .then((fn) => {
        if (!cancelled) unlistenMultiPane = fn;
        else safeUnlisten(fn);
      })
      .catch(() => {
        /* non-Tauri / event unavailable */
      });
    // 兼容旧事件名（与 global-cycle-multi-pane 语义相同，各自独立监听）
    void listen("global-toggle-dual-pane", onCycleMultiPane)
      .then((fn) => {
        if (!cancelled) unlistenLegacyDualPane = fn;
        else safeUnlisten(fn);
      })
      .catch(() => {
        /* non-Tauri / event unavailable */
      });
    return () => {
      cancelled = true;
      safeUnlisten(unlistenMultiPane);
      safeUnlisten(unlistenLegacyDualPane);
    };
  }, []);

  const handleToggleRightPanel = useCallback(() => {
    setRightCollapsed((c) => !c);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRightPanelDefaultCollapsed().then((collapsed) => {
      if (cancelled) return;
      setRightPanelDefaultCollapsed(collapsed);
      setRightCollapsed(collapsed);
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
      setRightCollapsed(collapsed);
    };
    window.addEventListener(WISE_RIGHT_PANEL_DEFAULT_CHANGED, handler);
    return () => window.removeEventListener(WISE_RIGHT_PANEL_DEFAULT_CHANGED, handler);
  }, []);

  const handleSetRightPanelDefaultCollapsed = useCallback((collapsed: boolean) => {
    void saveRightPanelDefaultCollapsed(collapsed)
      .then(() => {
        setRightPanelDefaultCollapsed(collapsed);
        setRightCollapsed(collapsed);
      })
      .catch(() => {
        message.error("保存右侧面板默认状态失败");
      });
  }, []);

  return {
    effectiveRightCollapsed,
    handlePaneRepositorySelect,
    handlePaneProjectNewSession,
    handleNewPaneSession,
    handleNewPaneSessionInNextSlot,
    handleNewPaneProjectSessionInNextSlot,
    handleChangePaneCount,
    paneChangeInFlight,
    handleCyclePaneCount,
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
