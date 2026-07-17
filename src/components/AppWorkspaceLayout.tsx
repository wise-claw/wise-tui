import {
  Suspense,
  createContext,
  lazy,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ComponentProps,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type * as React from "react";
import { App as AntdApp, ConfigProvider, Layout, message, Spin, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { AuthorPanelProps } from "./AuthorPanel/AuthorPanel";
import type { CockpitOnboardingProps } from "./Cockpit/CockpitOnboarding";
import type { WorkspaceWelcomeLandingProps } from "./WorkspaceWelcomeLanding";
import type { CommandPalette } from "./CommandPalette";
import type { GitPanelOpenFileOptions } from "./GitPanel";
import type { PaneTopbarSharedProps } from "./ClaudeSessions/Topbar";
import type { ClaudeSessionsProps as ClaudeSessionsExternalProps } from "./ClaudeSessions";
import {
  clearPaneEditorPanelContext,
  getPaneEditorPanelContextSnapshot,
  setPaneEditorPanelContext,
  subscribePaneEditorPanelContext,
} from "../stores/paneEditorPanelContextStore";
import { getActivePaneIndex } from "../stores/activePaneIndexStore";
import { MainLayoutResizeHandle } from "./MainLayoutResizeHandle";
import type { McpHub } from "./McpHub";
import type { ProgressMonitorDrawer } from "./ProgressMonitorDrawer";
import type { MonitorHistorySessionTranscriptDrawer } from "./ProgressMonitorPanel/MonitorHistorySessionTranscriptDrawer";
import type { RepositoryFileEditorPanel } from "./RepositoryFileEditorPanel";
import type { RepositoryFilePreviewModal } from "./RepositoryFilePreviewModal";
import type { SkillsHub } from "./SkillsHub";
import type { ScheduledTasksOverlayTarget } from "./RepositoryScheduledTasksModal";
import { resolveWorkspaceMainSession } from "../utils/resolveWorkspaceMainSession";
import type { PaneCount, PaneSlot } from "../constants/mainLayoutWidths";
import {
  loadFileTreeOpenInNewPaneFromStore,
  WISE_FILE_TREE_OPEN_IN_NEW_PANE_CHANGED,
} from "../services/wiseDefaultConfigStore";
import { planFileViewerPaneIndex } from "../utils/fileViewerPanePlacement";
import { resolveRepositoryForSession } from "../utils/repositoryMainSessionBinding";
import type { PaneAuxLayout } from "./ClaudeSessions/paneAuxLayout";
import { waitLayoutFrames } from "../services/mainWindowLayout";
import type { EmployeeItem, WorkflowGraph, WorkflowTemplateItem } from "../types";
import { resolveCockpitHubPane, type ViewMode } from "../types/viewMode";
import { AUTHOR_CONFIG_NAV_SIDER_WIDTH_PX } from "../constants/mainLayoutWidths";
import { dispatchRepositoryFileEditorClosed, type OpenRepositoryFileDetail } from "../constants/workflowUiEvents";
import { requestExplorerFocus } from "../constants/explorerUiEvents";
import { writePendingExplorerReveal } from "../utils/pendingExplorerReveal";
import { resolveExplorerRevealTargetForOpen } from "../utils/explorerRevealTarget";
import { useRepositoryFileEditor } from "../hooks/useRepositoryFileEditor";
import { useWorkspaceFileTreeRail } from "../hooks/useWorkspaceFileTreeRail";
import { hydrateOpenAppPreference } from "../services/openAppPreference";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  areLeftSidebarContentPropsEqual,
  areLeftSidebarPropsEqual,
} from "./LeftSidebar/leftSidebarPropsEqual";
import { claudeSessionsShellPropsEqual } from "./ClaudeSessions/claudeSessionsPropsEqual";
import { CenterViewControlContext, useCenterView } from "./ClaudeSessions/claudeChatHelpers";
import { registerPaneCenterViewSetter } from "../stores/paneCenterViewControlStore";
import { useWorkspaceMemoPanelOpen } from "../stores/workspaceMemoPanelStore";
import type { CenterView } from "./ClaudeSessions/ClaudeChat";
import { WORKSPACE_MEMO_PANEL_NODE } from "./WorkspaceMemoPanel";
import { WorkspaceFileTreeRail } from "./WorkspaceFileTreeRail";
import type { WorkspaceFileTreeRailContext } from "./WorkspaceFileTreeRail/types";
import { WorkspaceViewportLoading } from "./WorkspaceViewportLoading";
/** 与 AppWorkspaceLayout 求值并行预拉取首屏关键子 chunk。 */
const leftSidebarChunk = import("./LeftSidebar");
const claudeSessionsChunk = import("./ClaudeSessions");
const topbarChunk = import("./ClaudeSessions/Topbar");

const LazyLeftSidebar = lazy(() =>
  leftSidebarChunk.then((module) => ({ default: module.LeftSidebar })),
);
// 直接为 lazy 标注 props，让 `ComponentProps<typeof LazyClaudeSessions>` 能反推完整 props（含 paneTopbarShared）。
const LazyClaudeSessions = lazy<ComponentType<ClaudeSessionsExternalProps>>(() =>
  claudeSessionsChunk.then((module) => ({ default: module.ClaudeSessions })),
);
const LazyTopbar = lazy(() => topbarChunk.then((module) => ({ default: module.Topbar })));
// 单例 hydrate：AppWorkspaceLayout 一旦进入 import graph 即触发；多 pane 共用同一份内存副本。
// 多次调用由 `hydrateOpenAppPreference` 内部 `hydrated/hydrating` 守卫去重。
void hydrateOpenAppPreference();
const LazyAuthorPanel = lazy(() =>
  import("./AuthorPanel/AuthorPanel").then((module) => ({ default: module.AuthorPanel })),
);
const LazyAuthorPanelNav = lazy(() =>
  import("./AuthorPanel/AuthorPanelNav").then((module) => ({ default: module.AuthorPanelNav })),
);
const LazyCockpitOnboarding = lazy(() =>
  import("./Cockpit/CockpitOnboarding").then((module) => ({ default: module.CockpitOnboarding })),
);
const LazyWorkspaceWelcomeLanding = lazy(() =>
  import("./WorkspaceWelcomeLanding").then((module) => ({ default: module.WorkspaceWelcomeLanding })),
);
const LazyCommandPalette = lazy(() =>
  import("./CommandPalette").then((module) => ({ default: module.CommandPalette })),
);
const LazyMcpHub = lazy(() => import("./McpHub").then((module) => ({ default: module.McpHub })));
const LazySkillsHub = lazy(() => import("./SkillsHub").then((module) => ({ default: module.SkillsHub })));
const LazyAutomationPanel = lazy(() =>
  import("./AutomationPanel").then((module) => ({ default: module.AutomationPanel })),
);
const LazyRepositoryScheduledTasksModal = lazy(() =>
  import("./RepositoryScheduledTasksModal").then((module) => ({
    default: module.RepositoryScheduledTasksModal,
  })),
);
const LazyProgressMonitorDrawer = lazy(() =>
  import("./ProgressMonitorDrawer").then((module) => ({ default: module.ProgressMonitorDrawer })),
);
const LazyMonitorHistorySessionTranscriptDrawer = lazy(() =>
  import("./ProgressMonitorPanel/MonitorHistorySessionTranscriptDrawer").then((module) => ({
    default: module.MonitorHistorySessionTranscriptDrawer,
  })),
);
const LazyRepositoryFileEditorPanel = lazy(() =>
  import("./RepositoryFileEditorPanel").then((module) => ({ default: module.RepositoryFileEditorPanel })),
);
const LazyRepositoryFilePreviewModal = lazy(() =>
  import("./RepositoryFilePreviewModal").then((module) => ({ default: module.RepositoryFilePreviewModal })),
);

const CockpitSurface = lazy(() =>
  import("./CockpitSurface").then((module) => ({ default: module.CockpitSurface })),
);
const MemoLeftSidebar = memo(LazyLeftSidebar, areLeftSidebarPropsEqual);
const MemoClaudeSessions = memo(LazyClaudeSessions, claudeSessionsShellPropsEqual) as unknown as React.MemoExoticComponent<
  ComponentType<ClaudeSessionsProps>
>;

// shell 层透传：仅在 `ClaudeSessionsExternalProps` 基础上补一个
// `paneTopbarShared?`，其余三个辅助 prop（panelBelowMessages / hideMessages /
// hideSessionTools）由 ConnectedClaudeSessions 在 JSX 内部覆盖，本类型按原状保留。
// 注：`paneTopbarShared` 已在 `ClaudeSessionsExternalProps` 中正式声明，此处不再额外扩展，
// 避免出现第二个类型入口与不同步风险。
type ClaudeSessionsProps = ClaudeSessionsExternalProps;
type LeftSidebarProps = Omit<
  ComponentProps<typeof LazyLeftSidebar>,
  | "dark"
  | "collapsed"
  | "siderWidth"
  | "onOpenActiveRepositoryFile"
>;

type OpenRepositoryFileHandler = (path: string, options?: GitPanelOpenFileOptions) => void;

/** 把指定文件在文件树中展开父目录链并滚动高亮定位。多 pane 下按文件所属仓库根路由。 */
type RevealFileInExplorerHandler = (
  repositoryPath: string,
  relativePath: string,
  isDirectory?: boolean,
) => void;

let fileViewerPaneSlotCounter = 0;
function createFileViewerPaneSlot(): PaneSlot {
  fileViewerPaneSlotCounter += 1;
  return {
    slotId: `file-viewer-${Date.now()}-${fileViewerPaneSlotCounter}`,
    sessionId: null,
    repositoryId: null,
  };
}

function isPlainRepositoryFileOpen(options?: GitPanelOpenFileOptions): boolean {
  return !options?.fromGitChanges && !options?.fromCommit && !options?.fromCommitCompare;
}

interface RepositoryFileEditorPanelContextValue {
  activePath: string | null;
  activeSessionId: string | null;
  dirty: boolean;
  editorVisible: boolean;
  /**
   * md 预览状态按 `${rootPath}::${relativePath}` 键空间持久化（详见 hook 内 `previewKey`
   * 与新导出的 `mdPreviewReducer`）。setter 必须带 rootPath 一起传，避免 wrapper 用 active
   * tab 的 rootPath 替代表达时与被点击 tab 实际 rootPath 不一致。
   */
  mdPreviewByPath: Record<string, boolean>;
  setEditorTabMdPreview: (rootPath: string, relativePath: string, value: boolean) => void;
  onActivePathChange: (path: string) => void;
  onClosePanel: () => void;
  onCloseTab: (relativePath: string, event?: ReactMouseEvent) => void;
  onReloadTab: (relativePath: string) => void;
  onSave: () => void;
  onTabContentChange: (relativePath: string, content: string) => void;
  preview: ComponentProps<typeof RepositoryFilePreviewModal>["preview"];
  repositoryPath: string | null | undefined;
  saving: boolean;
  tabs: ComponentProps<typeof RepositoryFileEditorPanel>["tabs"];
  onClosePreview: () => void;
  /** 该 panel 归属的 pane 索引；多 pane 下让面板内组件能定位自己的 pane host。 */
  paneIndex?: number;
}

const RepositoryFileEditorOpenFileContext = createContext<OpenRepositoryFileHandler | null>(null);
const RepositoryFileEditorVisibilityContext = createContext(false);
const RepositoryFileEditorPanelContext = createContext<RepositoryFileEditorPanelContextValue | null>(null);
const RepositoryFileEditorRevealInExplorerContext = createContext<RevealFileInExplorerHandler | null>(null);
function useRepositoryFileEditorRevealInExplorer(): RevealFileInExplorerHandler | null {
  return useContext(RepositoryFileEditorRevealInExplorerContext);
}
/** 多 pane 下：file preview modal 仍为单例，由当前正在显示 modal 的 pane host 注入 preview state。
 *  type 形如 `LazyRepositoryFilePreviewModal` 的 `preview` 形参 + `onClose` 句柄。 */
type LayoutFilePreview = {
  preview: ComponentProps<typeof RepositoryFilePreviewModal>["preview"];
  onClose: () => void;
};
const RepositoryFilePreviewModalContext = createContext<LayoutFilePreview | null>(null);

/** 多 pane 下每个 pane host 注册到 layout 的 API 表面：layout 端 dispatcher / routing
 *  按 target paneIndex 拿对应 host 的 hook 实例。 */
interface PaneEditorApi {
  paneIndex: number;
  repositoryPath: string | null | undefined;
  openRepositoryFile: (relativePath: string, options?: GitPanelOpenFileOptions) => void;
}

function useRepositoryFileEditorOpenFile(): OpenRepositoryFileHandler {
  const value = useContext(RepositoryFileEditorOpenFileContext);
  if (!value) {
    throw new Error("Repository file editor open file context is missing");
  }
  return value;
}

function useRepositoryFileEditorPanelContextValue(): RepositoryFileEditorPanelContextValue {
  const value = useContext(RepositoryFileEditorPanelContext);
  if (!value) {
    throw new Error("Repository file editor panel context is missing");
  }
  return value;
}

/** 多 pane 下每个 pane 自己的文件编辑器宿主。挂载一份独立的 `useRepositoryFileEditor`，
 *  mount 时通过 `registerPaneEditor` 把自己的 `openRepositoryFile` 暴露给 layout dispatcher；
 *  同时向 layout 上报"自己的 editorPanelNode（编辑器 ReactNode）"，让 `resolvePaneAuxLayout`
 *  按 pane 决定是否挂 `panelBelowMessages`。 */
interface PaneEditorHostProps {
  paneIndex: number;
  repositoryPath: string | null | undefined;
  activeSessionId: string | null;
  dark: boolean;
  registerPaneEditor: (paneIndex: number, api: PaneEditorApi) => void;
  unregisterPaneEditor: (paneIndex: number) => void;
  setCenterAuxPanelsNodeForPane: (paneIndex: number, node: ReactNode) => void;
  layoutBinaryPreviewRef: React.MutableRefObject<
    Map<
      number,
      {
        preview: ComponentProps<typeof RepositoryFilePreviewModal>["preview"];
        onClose: () => void;
      }
    >
  >;
  bumpLayoutBinaryPreviewVersion: () => void;
}

function PaneEditorHost({
  paneIndex,
  repositoryPath,
  activeSessionId,
  dark,
  registerPaneEditor,
  unregisterPaneEditor,
  setCenterAuxPanelsNodeForPane,
  layoutBinaryPreviewRef,
  bumpLayoutBinaryPreviewVersion,
}: PaneEditorHostProps) {
  const {
    closeFileEditorPanel,
    closeFileEditorTab,
    closeRepositoryBinaryPreview,
    editorDirty,
    editorSaving,
    editorVisible,
    fileEditorActivePath,
    fileEditorTabs,
    mdPreviewByPath,
    openRepositoryFile,
    reloadEditorTabFromDisk,
    repositoryBinaryPreview,
    saveEditor,
    setEditorTabMdPreview,
    setFileEditorActivePath,
    updateFileEditorTabContent,
  } = useRepositoryFileEditor({ repositoryPath: repositoryPath ?? null, paneIndex });

  // 把当前 host 的 openRepositoryFile 注册到 layout 的 dispatcher Map。
  useEffect(() => {
    registerPaneEditor(paneIndex, { paneIndex, repositoryPath, openRepositoryFile });
    return () => unregisterPaneEditor(paneIndex);
  }, [paneIndex, repositoryPath, openRepositoryFile, registerPaneEditor, unregisterPaneEditor]);

  // 把 per-pane editorVisible 反向写入 ref；host 重新计算 editorVisible 时上抛。
  useEffect(() => {
    if (typeof activeSessionId === "string" && activeSessionId === "") {
      /* placeholder, no-op */
    }
  }, [activeSessionId]);

  const activeTab = fileEditorTabs.find((tab) => tab.relativePath === fileEditorActivePath) ?? null;
  const panelContextValue = useMemo<RepositoryFileEditorPanelContextValue | null>(() => {
    if (!editorVisible) return null;
    return {
      paneIndex,
      activePath: fileEditorActivePath,
      activeSessionId,
      dirty: editorDirty,
      editorVisible: true,
      mdPreviewByPath,
      setEditorTabMdPreview: (rootPath, relativePath, value) => {
        // Panel 调用方已经持有 tab 的根路径（多 pane 跨 rootPath 时不会借由 active tab 替代表达），
        // 这里薄透传即可。键空间 = `${rootPath}::${relativePath}`，由 hook 内 `previewKey` 负责拼装。
        setEditorTabMdPreview(rootPath, relativePath, value);
      },
      onActivePathChange: (path) => {
        setFileEditorActivePath(path);
      },
      onClosePanel: closeFileEditorPanel,
      onClosePreview: closeRepositoryBinaryPreview,
      onCloseTab: closeFileEditorTab,
      onReloadTab: (relativePath) => {
        void reloadEditorTabFromDisk(relativePath);
      },
      onSave: () => {
        void saveEditor();
      },
      onTabContentChange: updateFileEditorTabContent,
      preview: repositoryBinaryPreview,
      repositoryPath: activeTab?.rootPath ?? repositoryPath ?? null,
      saving: editorSaving,
      tabs: fileEditorTabs,
    };
  }, [
    paneIndex,
    fileEditorActivePath,
    activeSessionId,
    editorDirty,
    editorVisible,
    mdPreviewByPath,
    setEditorTabMdPreview,
    activeTab?.rootPath,
    repositoryPath,
    setFileEditorActivePath,
    closeFileEditorPanel,
    closeRepositoryBinaryPreview,
    closeFileEditorTab,
    reloadEditorTabFromDisk,
    saveEditor,
    updateFileEditorTabContent,
    repositoryBinaryPreview,
    editorSaving,
    fileEditorTabs,
  ]);

  // editorVisible 变化时把节点 / null 投到 layout 的 per-pane map。
  // 关键性能修复：不再把 `panelContextValue` 作为依赖、也不再把含其的 Provider JSX 直接存入 map。
  // 否则打开一个文件过程中 panelContextValue 变化十几次（加 tab / 设 active / 加载 content /
  // contentSync / dirty），每次都 bump `centerAuxPanelsNodeByPaneVersion` → 整个 layout +
  // ConnectedClaudeSessions + MemoClaudeSessions 重渲 → 「第二屏开/关文件超级慢」。
  // 改存稳定的 `PaneEditorPanelBridge` 元素（只随 editorVisible / dark / paneIndex 变化），
  // panelContextValue 由下方 effect 写入 per-pane 外部 store，bridge 用 useSyncExternalStore
  // 订阅并局部重渲，不波及 layout。
  useEffect(() => {
    if (!editorVisible) {
      setCenterAuxPanelsNodeForPane(paneIndex, null);
      return;
    }
    setCenterAuxPanelsNodeForPane(
      paneIndex,
      <PaneEditorPanelBridge paneIndex={paneIndex} dark={dark} />,
    );
    return () => {
      setCenterAuxPanelsNodeForPane(paneIndex, null);
    };
  }, [editorVisible, dark, paneIndex, setCenterAuxPanelsNodeForPane]);

  // 把最新 panelContextValue 写入 per-pane 外部 store。bridge 订阅本 store 局部重渲，
  // 避免 panelContextValue 频繁变化时 bump layout version。
  useEffect(() => {
    setPaneEditorPanelContext(paneIndex, panelContextValue);
  }, [paneIndex, panelContextValue]);

  // host 卸载时清掉本 pane 的 context 值，避免 bridge 读到陈旧引用。
  useEffect(() => {
    return () => {
      clearPaneEditorPanelContext(paneIndex);
    };
  }, [paneIndex]);

  // binary preview modal：把本 host 的 `repositoryBinaryPreview` + 关闭句柄上抛到 layout。
  // layout 内的 `ConnectedRepositoryFilePreviewModal` 读这个 ref 渲染单例 modal。
  useEffect(() => {
    if (repositoryBinaryPreview == null) {
      layoutBinaryPreviewRef.current.delete(paneIndex);
    } else {
      layoutBinaryPreviewRef.current.set(paneIndex, {
        preview: repositoryBinaryPreview,
        onClose: closeRepositoryBinaryPreview,
      });
    }
    bumpLayoutBinaryPreviewVersion();
    return () => {
      layoutBinaryPreviewRef.current.delete(paneIndex);
      bumpLayoutBinaryPreviewVersion();
    };
  }, [repositoryBinaryPreview, closeRepositoryBinaryPreview, paneIndex]);

  return null;
}

interface ConnectedLeftSidebarProps {
  collapsed: boolean;
  dark: boolean;
  leftSidebarProps: LeftSidebarProps;
  parked: boolean;
  siderWidth: number;
}

const ConnectedLeftSidebar = memo(function ConnectedLeftSidebar({
  collapsed,
  dark,
  leftSidebarProps,
  parked,
  siderWidth,
}: ConnectedLeftSidebarProps) {
  const openRepositoryFile = useRepositoryFileEditorOpenFile();
  return (
    <MemoLeftSidebar
      {...leftSidebarProps}
      dark={dark}
      collapsed={collapsed}
      parked={parked}
      siderWidth={siderWidth}
      onOpenActiveRepositoryFile={openRepositoryFile}
    />
  );
}, (prev, next) =>
  prev.collapsed === next.collapsed &&
  prev.dark === next.dark &&
  prev.parked === next.parked &&
  prev.siderWidth === next.siderWidth &&
  areLeftSidebarContentPropsEqual(prev.leftSidebarProps, next.leftSidebarProps));

interface ConnectedWorkspaceFileTreeRailProps {
  widthPx: number;
  macTitlebarInset: boolean;
  context: WorkspaceFileTreeRailContext;
  onClose: () => void;
}

const ConnectedWorkspaceFileTreeRail = memo(function ConnectedWorkspaceFileTreeRail({
  widthPx,
  macTitlebarInset,
  context,
  onClose,
}: ConnectedWorkspaceFileTreeRailProps) {
  return (
    <WorkspaceFileTreeRail
      widthPx={widthPx}
      macTitlebarInset={macTitlebarInset}
      {...context}
      onClose={onClose}
    />
  );
});

interface ConnectedClaudeSessionsProps {
  claudeSessionsProps: ClaudeSessionsProps;
  mainLayoutContentRef: RefObject<HTMLElement | null>;
  /**
   * 多 pane 下每个 pane 各自的 centerAuxPanel 节点（file editor）。
   * - `undefined`：该 pane 未挂文件编辑器，正常显示消息列表。
   * - `ReactNode`：该 pane 的 panelBelowMessages 渲染内容。
   * 0 号 pane（primary）总是被包含；1..N-1 仅在打开过本 pane 的文件时挂载。
   * `version` 单独抽出做浅比较：每次 host mount/unmount 时 +1，避免节点引用变化穿透。
   */
  centerAuxPanelsNodeByPane: Map<number, ReactNode>;
  centerAuxPanelsNodeByPaneVersion: number;
  /** 单屏中栏「消息/文件」视图值（由 layout 壳层提升持有，透传给 ClaudeSessions）。 */
  centerView?: CenterView;
}

function connectedClaudeSessionsPropsEqual(
  prev: ConnectedClaudeSessionsProps,
  next: ConnectedClaudeSessionsProps,
): boolean {
  if (prev.mainLayoutContentRef !== next.mainLayoutContentRef) return false;
  if (prev.centerAuxPanelsNodeByPaneVersion !== next.centerAuxPanelsNodeByPaneVersion) return false;
  if (prev.centerView !== next.centerView) return false;
  return claudeSessionsShellPropsEqual(prev.claudeSessionsProps, next.claudeSessionsProps);
}

const ConnectedClaudeSessions = memo(function ConnectedClaudeSessions({
  claudeSessionsProps,
  mainLayoutContentRef,
  centerAuxPanelsNodeByPane,
  centerAuxPanelsNodeByPaneVersion,
  centerView,
}: ConnectedClaudeSessionsProps) {
  const memoOpen = useWorkspaceMemoPanelOpen();
  const resolvePaneAuxLayout = useCallback(
    (paneIndex: number): PaneAuxLayout => {
      // 多 pane 下各 pane 独立判断自己是否挂文件编辑器。
      // 挂了编辑器时也不再隐藏消息列表：由 ClaudeChat 内的 Segmented 切换器在
      // 「消息」与「文件」视图间互斥切换，当前视图占满整个主区，无需关文件即可查看消息。
      // 离屏 pane 的性能护栏由 deferHeavySubtree 在下游保留
      // （hidePaneMessages = hideMessages || deferHeavySubtree）。
      // 全局备忘录优先占 pane 0 的同一 slot（与打开文件一致）。
      const panel =
        paneIndex === 0 && memoOpen
          ? WORKSPACE_MEMO_PANEL_NODE
          : centerAuxPanelsNodeByPane.get(paneIndex);
      if (panel == null) {
        return { hideMessages: false, hideSessionTools: false };
      }
      return {
        panelBelowMessages: panel,
        hideMessages: false,
        hideSessionTools: false,
      };
    },
    [centerAuxPanelsNodeByPane, memoOpen],
  );

  const primaryAux = resolvePaneAuxLayout(0);
  return (
    <Layout.Content ref={mainLayoutContentRef} className="app-main-layout-content">
      <MemoClaudeSessions
        {...claudeSessionsProps}
        hideMessages={primaryAux.hideMessages}
        hideSessionTools={primaryAux.hideSessionTools}
        panelBelowMessages={primaryAux.panelBelowMessages}
        resolvePaneAuxLayout={resolvePaneAuxLayout}
        centerAuxPanelsNodeByPaneVersion={centerAuxPanelsNodeByPaneVersion}
        centerView={centerView}
        hideTopbar={true}
      />
    </Layout.Content>
  );
}, connectedClaudeSessionsPropsEqual);

const ConnectedRepositoryFileEditorPanel = memo(function ConnectedRepositoryFileEditorPanel({
  dark,
}: {
  dark: boolean;
}) {
  const openFile = useRepositoryFileEditorOpenFile();
  const revealInExplorer = useRepositoryFileEditorRevealInExplorer();
  const {
    activePath,
    activeSessionId,
    dirty,
    editorVisible,
    mdPreviewByPath,
    setEditorTabMdPreview,
    onActivePathChange,
    onClosePanel,
    onCloseTab,
    onReloadTab,
    onSave,
    onTabContentChange,
    repositoryPath,
    saving,
    tabs,
  } = useRepositoryFileEditorPanelContextValue();
  if (!editorVisible) {
    return null;
  }
  return (
    <Suspense fallback={<PanelLoadingFallback />}>
      <LazyRepositoryFileEditorPanel
        activePath={activePath}
        activeSessionId={activeSessionId}
        dark={dark}
        dirty={dirty}
        mdPreviewByPath={mdPreviewByPath}
        onMdPreviewTabChange={setEditorTabMdPreview}
        repositoryPath={repositoryPath}
        saving={saving}
        tabs={tabs}
        onActivePathChange={onActivePathChange}
        onClosePanel={onClosePanel}
        onCloseTab={onCloseTab}
        onReloadTab={onReloadTab}
        onSave={onSave}
        onTabContentChange={onTabContentChange}
        onNavigateToFile={openFile}
        onRevealInExplorer={revealInExplorer ?? undefined}
      />
    </Suspense>
  );
});

/**
 * per-pane 文件编辑器面板的"桥接"渲染单元。`PaneEditorHost` 在 `editorVisible` 变化时把本组件
 * 作为稳定元素存入 `centerAuxPanelsNodeByPane`（layout 只在 visibility 变化时 bump version）；
 * 面板真正消费的 `panelContextValue`（tabs / activePath / dirty / contentSync 派生）由 host
 * 写入 per-pane 外部 store，本组件用 `useSyncExternalStore` 订阅，变化时**局部重渲**，
 * 不触发 `AppWorkspaceLayout` 重渲。这是修复「第二屏开/关文件超级慢」的关键：打开一个文件过程中
 * panelContextValue 变化十几次，原先每次都 bump layout version 全局重渲，现在只重渲本 bridge。
 */
const PaneEditorPanelBridge = memo(function PaneEditorPanelBridge({
  paneIndex,
  dark,
}: {
  paneIndex: number;
  dark: boolean;
}) {
  const subscribe = useCallback(
    (listener: () => void) => subscribePaneEditorPanelContext(paneIndex, listener),
    [paneIndex],
  );
  const getSnapshot = useCallback(
    () => getPaneEditorPanelContextSnapshot(paneIndex),
    [paneIndex],
  );
  const value = useSyncExternalStore(
    subscribe,
    getSnapshot,
  ) as RepositoryFileEditorPanelContextValue | null;
  if (!value) return null;
  return (
    <RepositoryFileEditorPanelContext.Provider value={value}>
      <RepositoryFileEditorVisibilityContext.Provider value={true}>
        <ConnectedRepositoryFileEditorPanel dark={dark} />
      </RepositoryFileEditorVisibilityContext.Provider>
    </RepositoryFileEditorPanelContext.Provider>
  );
});

const ConnectedRepositoryFilePreviewModal = memo(function ConnectedRepositoryFilePreviewModal() {
  // 多 pane 下：modal 仍为 layout 单例，preview state 由 layout 内的
  // `RepositoryFilePreviewModalContext.Provider` 注入（取各 host 上报中第一个非空）。
  const ctx = useContext(RepositoryFilePreviewModalContext);
  if (ctx == null) {
    return null;
  }
  return <LazyRepositoryFilePreviewModal preview={ctx.preview} onClose={ctx.onClose} />;
});

export interface AppWorkspaceLayoutProps {
  activeRepositoryPath: string | null | undefined;
  dark: boolean;
  collapsed: boolean;
  /** 顶层 ViewMode；Inspector / 主屏分发 / 旧布尔判定都按它派发。 */
  viewMode: ViewMode;
  /** Cockpit 定时自动化 Hub 关闭（返回上一 ViewMode）。 */
  onCloseCockpitAutomationHub: () => void;
  /** Cockpit 助手 Hub / 对话关闭（返回上一 ViewMode）。 */
  onCloseCockpit: () => void;
  effectiveRightCollapsed: boolean;
  mainLayoutContentRef: RefObject<HTMLElement | null>;
  mainLayoutLeftWidthPx: number;
  mainLayoutRightWidthPx: number;
  leftSidebarProps: LeftSidebarProps;
  authorPanelProps: AuthorPanelProps;
  claudeSessionsProps: ClaudeSessionsProps;
  /** 流式正文节流：壳层 memo 用，避免每 token 重算顶栏等。 */
  sessionsStructureKey: string;
  /** 顶栏「远程」区跳转创作台远程入口 */
  onOpenRemoteChannels?: () => void;
  /** Cockpit 主屏空态：用户没有任何 Workspace / Standalone Repo 时引导创建。 */
  cockpitEmpty: boolean;
  cockpitOnboardingProps: CockpitOnboardingProps;
  /** 未选中仓库时在主窗口全屏展示欢迎页（隐藏侧栏/顶栏/右栏）。 */
  workspaceWelcomeFullscreen?: boolean;
  workspaceWelcomeProps?: WorkspaceWelcomeLandingProps;
  /** Cockpit hub/conversation 子状态决策(Stage 3 Wave A 引入)。 */
  cockpitSurfaceActiveProjectId: string | null;
  cockpitSurfaceActiveProjectName: string | null;
  /** 显式 FAB 入口已触发 → 直接进入 conversation 子态,跳过 hub。 */
  cockpitSurfaceHasInitialTarget: boolean;
  /** 会话快捷条指定内置助手 id，直达该助手对话页。 */
  cockpitSurfaceInitialAssistantId?: string | null;
  /** 普通助手入口再次打开时恢复上次助手会话。 */
  cockpitSurfaceResumeAssistantId?: string | null;
  /** 显式打开助手/需求拆分入口的递增信号。 */
  cockpitSurfaceOpenRequestKey: number;
  scheduledTasksOverlay?: ScheduledTasksOverlayTarget | null;
  onCloseScheduledTasksOverlay?: () => void;
  scheduledTasksOverlayEmployees?: EmployeeItem[];
  scheduledTasksOverlayWorkflowTemplates?: WorkflowTemplateItem[];
  scheduledTasksOverlayWorkflowGraphsByWorkflowId?: Record<string, WorkflowGraph>;
  onCockpitActiveAssistantIdChange?: (assistantId: string | null) => void;
  onClearCockpitInitialAssistant?: () => void;
  commandPaletteProps: ComponentProps<typeof CommandPalette>;
  mcpHubProps: ComponentProps<typeof McpHub>;
  skillsHubProps: ComponentProps<typeof SkillsHub>;
  progressMonitorDrawerProps: ComponentProps<typeof ProgressMonitorDrawer>;
  historyTranscriptDrawerProps: ComponentProps<typeof MonitorHistorySessionTranscriptDrawer>;
  onLeftWidthChange: (widthPx: number) => void;
  onRightWidthChange: (widthPx: number) => void;
  onConsumeRepositoryFileOpenRequest: () => void;
  repositoryFileOpenRequest?: OpenRepositoryFileDetail | null;
}

function PanelLoadingFallback() {
  return (
    <div className="app-file-editor-loading">
      <Spin size="small" />
    </div>
  );
}

export function AppWorkspaceLayout({
  activeRepositoryPath,
  dark,
  collapsed,
  viewMode,
  onCloseCockpitAutomationHub,
  onCloseCockpit,
  effectiveRightCollapsed: _effectiveRightCollapsed,
  mainLayoutContentRef,
  mainLayoutLeftWidthPx,
  mainLayoutRightWidthPx,
  leftSidebarProps,
  authorPanelProps,
  claudeSessionsProps,
  sessionsStructureKey,
  onOpenRemoteChannels,
  cockpitEmpty,
  cockpitOnboardingProps,
  workspaceWelcomeFullscreen = false,
  workspaceWelcomeProps,
  cockpitSurfaceActiveProjectId,
  cockpitSurfaceActiveProjectName,
  cockpitSurfaceHasInitialTarget,
  cockpitSurfaceInitialAssistantId,
  cockpitSurfaceResumeAssistantId,
  cockpitSurfaceOpenRequestKey,
  scheduledTasksOverlay = null,
  onCloseScheduledTasksOverlay,
  scheduledTasksOverlayEmployees = [],
  scheduledTasksOverlayWorkflowTemplates = [],
  scheduledTasksOverlayWorkflowGraphsByWorkflowId = {},
  onCockpitActiveAssistantIdChange,
  onClearCockpitInitialAssistant,
  commandPaletteProps,
  mcpHubProps,
  skillsHubProps,
  progressMonitorDrawerProps,
  historyTranscriptDrawerProps,
  onLeftWidthChange,
  onRightWidthChange: _onRightWidthChange,
  onConsumeRepositoryFileOpenRequest,
  repositoryFileOpenRequest,
}: AppWorkspaceLayoutProps) {
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;
  const claudeSessionsRef = useRef(claudeSessionsProps.sessions);
  claudeSessionsRef.current = claudeSessionsProps.sessions;
  const claudeSessionsPropsRef = useRef(claudeSessionsProps);
  claudeSessionsPropsRef.current = claudeSessionsProps;

  const mainSessionForDataLink = useMemo(
    () =>
      resolveWorkspaceMainSession({
        sessions: claudeSessionsRef.current,
        bindings: claudeSessionsProps.repositoryMainBindings ?? {},
        repositories: claudeSessionsProps.repositories ?? [],
        activeRepository: claudeSessionsProps.activeRepository,
        activeProject: claudeSessionsProps.activeProject,
        activeWorkspaceFocus: claudeSessionsProps.activeWorkspaceFocus,
        activeSessionId: claudeSessionsProps.activeSessionId,
      }),
    [
      sessionsStructureKey,
      claudeSessionsProps.repositoryMainBindings,
      claudeSessionsProps.repositories,
      claudeSessionsProps.activeRepository,
      claudeSessionsProps.activeProject,
      claudeSessionsProps.activeWorkspaceFocus,
      claudeSessionsProps.activeSessionId,
    ],
  );

  /**
   * 旧布尔派生：本组件保留按 ViewMode 内部派生的旧布尔语义（与 P0 阶段
   * `viewMode.legacy.*` 完全等价），用于驱动主屏分支与叠层渲染。AppImpl 不再
   * 单独传 6 个布尔——这些纯粹是 ViewMode 上的语义投影。
   */
  const authorMode = viewMode.kind === "author";
  const missionControlMode = viewMode.kind === "cockpit";
  const cockpitHubPane =
    viewMode.kind === "cockpit" ? resolveCockpitHubPane(viewMode) : null;
  const mcpHubMode =
    (viewMode.kind === "author" && viewMode.pane === "mcp") ||
    (viewMode.kind === "inspect" && viewMode.tool.kind === "mcp-hub");
  const skillsHubMode =
    (viewMode.kind === "author" && viewMode.pane === "skills") ||
    (viewMode.kind === "inspect" && viewMode.tool.kind === "skills-hub");
  const chatRightRailMode = !authorMode && !missionControlMode;
  const leftSidebarParked = false;
  const {
    fileTreeRailOpen,
    toggleFileTreeRail,
    setFileTreeRailOpen,
    fileTreeRailWidthPx,
    setFileTreeRailWidthPx,
  } = useWorkspaceFileTreeRail();
  const showWorkspaceFileTreeRail =
    chatRightRailMode && fileTreeRailOpen && !workspaceWelcomeFullscreen && !leftSidebarParked;
  const [workspaceFileTreeRailContext, setWorkspaceFileTreeRailContext] =
    useState<WorkspaceFileTreeRailContext | null>(null  );

  const getClaudeSessionsForTopbar = useCallback(() => claudeSessionsRef.current, []);

  const onSessionInsightsAiAnalysis = useMemo(
    () =>
      mainSessionForDataLink
        ? async (prompt: string) => {
            const props = claudeSessionsPropsRef.current;
            props.onSwitchSession(mainSessionForDataLink.id);
            await props.onExecuteSession(mainSessionForDataLink.id, prompt);
          }
        : undefined,
    [mainSessionForDataLink?.id],
  );

  // 1 屏下顶部 Topbar 的 props（跨整宽，覆盖中栏 + 右栏）。多屏（paneCount>1）不再渲染
  // 全局 Topbar，由 `ClaudeMultiPaneGrid` 每个 pane 内部的 `<Topbar>` 自管
  // （窗口级控件只在 primary pane；仓库级按钮每个 pane 都有，作用于各自仓库）。
  const topbarProps = useMemo(
    () => ({
      activeProject: claudeSessionsProps.activeProject,
      activeWorkspaceFocus: claudeSessionsProps.activeWorkspaceFocus,
      activeRepository: claudeSessionsProps.activeRepository,
      onToggleSidebar: claudeSessionsPropsRef.current.onToggleSidebar,
      onToggleTerminal: claudeSessionsPropsRef.current.onToggleTerminal,
      onSearch: claudeSessionsPropsRef.current.onSearch,
      collapsed: claudeSessionsProps.collapsed,
      fileTreeRailOpen: showWorkspaceFileTreeRail,
      terminalCollapsed: claudeSessionsProps.terminalCollapsed,
      terminalPanelMounted: claudeSessionsProps.terminalPanelMounted,
      paneCount: claudeSessionsProps.paneCount,
      paneChangeInFlight: claudeSessionsProps.paneChangeInFlight,
      onChangePaneCount: claudeSessionsPropsRef.current.onChangePaneCount,
      onOpenRemoteChannels,
    }),
    [
      claudeSessionsProps.activeProject,
      claudeSessionsProps.activeWorkspaceFocus,
      claudeSessionsProps.activeRepository,
      claudeSessionsProps.collapsed,
      showWorkspaceFileTreeRail,
      claudeSessionsProps.terminalCollapsed,
      claudeSessionsProps.terminalPanelMounted,
      claudeSessionsProps.paneCount,
      claudeSessionsProps.paneChangeInFlight,
      onOpenRemoteChannels,
    ],
  );

  /** 多屏时每个 pane 顶栏共用的回调与状态聚合；下沉到 `ClaudeMultiPaneGrid` 经
   *  `MultiPaneSharedChatProps.paneTopbarShared` 派发到每个 pane 的 `<Topbar>`。
   *  primary pane 展开后补全主会话仓库（含窗口级按钮）；extra pane 展开后将窗口级回调
   *  置 undefined（只渲染仓库级按钮，作用于各自仓库）。此处是 `paneTopbarShared` 的唯一组装点，
   *  单源 `useMemo` 引用稳定，避免 `ConnectedClaudeSessions` 必重渲。 */
  const paneTopbarShared = useMemo<PaneTopbarSharedProps>(
    () => ({
      onAutoFixRunError: claudeSessionsPropsRef.current.onAutoFixRunError,
      paneCount: claudeSessionsProps.paneCount ?? 1,
      paneChangeInFlight: claudeSessionsPropsRef.current.paneChangeInFlight,
      onChangePaneCount: claudeSessionsPropsRef.current.onChangePaneCount,
      onSessionInsightsAiAnalysis,
      onDispatchSessionFeedbackLoop: claudeSessionsPropsRef.current.onDispatchSessionFeedbackLoop,
      getClaudeSessions: getClaudeSessionsForTopbar,
      onToggleSidebar: claudeSessionsPropsRef.current.onToggleSidebar,
      onToggleTerminal: claudeSessionsPropsRef.current.onToggleTerminal,
      onSearch: claudeSessionsPropsRef.current.onSearch,
      onSearchForRepository: claudeSessionsPropsRef.current.onSearchForRepository,
      collapsed: claudeSessionsProps.collapsed,
      fileTreeRailOpen: showWorkspaceFileTreeRail,
      terminalCollapsed: claudeSessionsProps.terminalCollapsed,
      terminalPanelMounted: claudeSessionsProps.terminalPanelMounted,
      onOpenRemoteChannels,
    }),
    [
      claudeSessionsProps.paneCount,
      claudeSessionsProps.paneChangeInFlight,
      onSessionInsightsAiAnalysis,
      claudeSessionsProps.collapsed,
      showWorkspaceFileTreeRail,
      claudeSessionsProps.terminalCollapsed,
      claudeSessionsProps.terminalPanelMounted,
      onOpenRemoteChannels,
    ],
  );

  /** 透传给 `<MemoClaudeSessions>` 的 props：原 `claudeSessionsProps` 与 `paneTopbarShared` 合并。
   *  合并后 `ClaudeSessions` 内部不再二次组装 `paneTopbarShared`，单源 `useMemo` 引用稳定。 */
  const claudeSessionsPropsWithHeader = useMemo<ClaudeSessionsProps>(
    () => ({
      ...claudeSessionsProps,
      paneTopbarShared,
    }),
    [claudeSessionsProps, paneTopbarShared],
  );

  const [authorShellMounted, setAuthorShellMounted] = useState(authorMode);
  const [cockpitShellMounted, setCockpitShellMounted] = useState(missionControlMode);
  const showCockpitShell = missionControlMode || cockpitShellMounted;

  useEffect(() => {
    if (authorMode) setAuthorShellMounted(true);
  }, [authorMode]);

  useEffect(() => {
    if (!authorMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element) {
        if (
          target.closest(
            ".ant-modal-wrap, .ant-drawer-open, .ant-image-preview-root, .ant-select-dropdown, .ant-dropdown, .ant-picker-dropdown, .ant-popover, .ant-color-picker-dropdown",
          )
        ) {
          return;
        }
      }
      event.preventDefault();
      authorPanelProps.onBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authorMode, authorPanelProps.onBack]);

  useEffect(() => {
    if (missionControlMode) {
      setCockpitShellMounted(true);
      return;
    }
    const unmountCockpitShell = () => setCockpitShellMounted(false);
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(unmountCockpitShell, { timeout: 800 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timeoutId = window.setTimeout(unmountCockpitShell, 0);
    return () => window.clearTimeout(timeoutId);
  }, [missionControlMode]);

  // 多 pane 化：每个 pane 挂载一份 `useRepositoryFileEditor`，由 `PaneEditorHost` 内部
  // 组件 mount 时调用 `registerPaneEditor` 注册到 `paneEditorApisRef`，layout 内
  // dispatcher / routing 按目标 `paneIndex` 拿对应 host 的 hook 实例 API。
  const paneEditorApisRef = useRef<Map<number, PaneEditorApi>>(new Map());
  // 仅作为 `paneEditorApisRef` 变化信号，驱动下游依赖面板可见性 map 的 hook 重算。
  const [paneEditorApisVersion, setPaneEditorApisVersion] = useState(0);
  // 待消费队列：当 dispatcher 按 rootPath 没命中 host 时（host 还在 mount 时序晚于
  // request 进入的极端窗口），把请求入队；host mount 时按自身 repositoryPath 消费
  // （参见 `registerPaneEditor`）。队列按 rootPath 聚合，最后一个 relativePath 生效。
  // 这是修复 bug 5-2「第二屏搜文件回车没反应」的关键防线 — host 1 还没 register 到
  // `paneEditorApisRef` 时也不会再污染 host[0] 或丢失请求。
  const pendingFileOpensByRootRef = useRef<
    Map<string, { relativePath: string; options?: GitPanelOpenFileOptions }>
  >(new Map());
  const registerPaneEditor = useCallback(
    (paneIndex: number, api: PaneEditorApi) => {
      paneEditorApisRef.current.set(paneIndex, api);
      // host 刚 mount 进 ref，立刻按自身 repositoryPath 消化 pending 队列里的请求。
      const hostRoot = api.repositoryPath?.trim() ?? "";
      if (hostRoot) {
        const pending = pendingFileOpensByRootRef.current.get(hostRoot);
        if (pending) {
          pendingFileOpensByRootRef.current.delete(hostRoot);
          try {
            api.openRepositoryFile(pending.relativePath, pending.options);
          } catch (err) {
            // 防御性 swallow：hook 内已经吃掉大多数异常，这里只保 queue 清掉。
            console.warn("[paneEditorHost] consume pending open failed", err);
          }
        }
      }
      setPaneEditorApisVersion((v) => v + 1);
    },
    [],
  );
  const unregisterPaneEditor = useCallback((paneIndex: number) => {
    paneEditorApisRef.current.delete(paneIndex);
    setPaneEditorApisVersion((v) => v + 1);
  }, []);

  /** 多 pane 下 binary preview modal 单例：由各 host 上报自己当前 preview 状态。
   *  当任一 host 持非 null preview 时，layout 渲染 modal；多 host 同时持 preview 时取
   *  第一个非空（host mount 顺序：pane 0 优先）。 */
  const layoutBinaryPreviewRef = useRef<
    Map<
      number,
      {
        preview: ComponentProps<typeof RepositoryFilePreviewModal>["preview"];
        onClose: () => void;
      }
    >
  >(new Map());
  const [layoutBinaryPreviewVersion, bumpLayoutBinaryPreviewVersionState] = useState(0);
  const bumpLayoutBinaryPreviewVersion = useCallback(() => {
    bumpLayoutBinaryPreviewVersionState((v) => v + 1);
  }, []);
  const activeLayoutBinaryPreview = useMemo(() => {
    void layoutBinaryPreviewVersion;
    for (const entry of layoutBinaryPreviewRef.current.values()) {
      if (entry.preview != null) return entry;
    }
    return null;
  }, [layoutBinaryPreviewVersion]);

  /** 多 pane 下每 pane 的 file editor ReactNode 集合（panel != null 即 editorVisible）。
   *  用 ref 持有最新值，state 触发 re-render 让 `resolvePaneAuxLayout` 重新读。 */
  const centerAuxPanelsNodeByPaneRef = useRef<Map<number, ReactNode>>(new Map());
  const [centerAuxPanelsNodeByPaneVersion, setCenterAuxPanelsNodeByPaneVersion] = useState(0);
  const centerAuxPanelsNodeByPane = useMemo(
    () => new Map(centerAuxPanelsNodeByPaneRef.current),
    [centerAuxPanelsNodeByPaneVersion],
  );
  const setCenterAuxPanelsNodeForPane = useCallback((paneIndex: number, node: ReactNode) => {
    const current = centerAuxPanelsNodeByPaneRef.current.get(paneIndex);
    if (current === node) return;
    if (node == null) {
      centerAuxPanelsNodeByPaneRef.current.delete(paneIndex);
    } else {
      centerAuxPanelsNodeByPaneRef.current.set(paneIndex, node);
    }
    setCenterAuxPanelsNodeByPaneVersion((v) => v + 1);
  }, []);

  // 单屏中栏「消息/文件」视图切换：状态提升到 layout 壳层，使 1 屏全局 Topbar（下方
  // `<LazyTopbar>`）与 ClaudeSessions 内的 ClaudeChat 共享同一份 centerView。多屏（paneCount>1）
  // 不渲染全局 Topbar，各 pane 在 ClaudeMultiPaneGrid 内独立 useCenterView；此处 primary 的
  // panelBelowMessages 取自 `centerAuxPanelsNodeByPane.get(0)`，与 ConnectedClaudeSessions 的
  // resolvePaneAuxLayout(0) 同源（备忘录打开时优先占同一 slot）。放在
  // centerAuxPanelsNodeByPane 定义之后以避开 TDZ。
  const memoOpen = useWorkspaceMemoPanelOpen();
  const primaryPanelBelowMessages = memoOpen
    ? WORKSPACE_MEMO_PANEL_NODE
    : centerAuxPanelsNodeByPane.get(0);
  const { centerView, setCenterView, visible: centerSwitcherVisible } = useCenterView(
    primaryPanelBelowMessages,
    false, // 单屏 primary 的 hideMessages 恒为 false
  );

  // 单屏下把 pane 0 的 setCenterView 注册到跨层控制通道，供
  // useRepositoryFileEditor.openRepositoryFile 在打开文件时请求切到「文件」视图。
  // 多屏（paneCount>1）跳过：pane 0 由 MultiPanePrimaryCell 注册，且此处 setCenterView
  // 是「死 setter」（Provider 被 pane cell 遮蔽、Topbar 不渲染），注册会抢占 pane 0。
  // 依赖须含 paneCount，否则单/多屏切换时门控不重算。
  useEffect(() => {
    if ((claudeSessionsProps.paneCount ?? 1) > 1) return;
    registerPaneCenterViewSetter(0, setCenterView);
    return () => registerPaneCenterViewSetter(0, null);
  }, [claudeSessionsProps.paneCount, setCenterView]);

  /** 多 pane 下要 mount 的 PaneEditorHost 配置列表。
   *  pane 0 = primary（active 仓库）；pane 1..N-1 = extra panes。
   *
   *  派生策略与 ChatHost 的 `resolvedPaneRepositories` (ClaudeSessionsChatHost.tsx)
   *  对齐：先 `slot.repositoryId` → 再 `slot.sessionId`（走 `resolveRepositoryForSession`
   *  解析，含 `repositoryMainBindings`）→ 最后 `activeRepositoryPath` 兜底。
   *
   *  旧实现用 `session?.repositoryPath?.trim() || ...` 派生，存在「session 找到但
   *  session.repositoryPath 为空字符串（dataLink 还在加载）时短路成空字符串」的反
   *  模式 —— `paneEditorHostConfigs[1].repositoryPath` 此时为空/null，dispatcher 按
   *  rootPath 精确匹配永远无法命中 host[1]，retry 12×60ms 后降级到 host[0] 把请求
   *  错误路由到 primary pane，pane 1 搜的文件实际由 pane 0 仓库 hook 加载 ——
   *  表现为「第二屏打开的不是第二屏选择的仓库的文件」。
   *
   *  单 pane (paneCount === 1) 时仅 mount pane 0，行为与单实例完全一致。 */
  const paneEditorHostConfigs = useMemo(() => {
    const sessions = claudeSessionsProps.sessions ?? [];
    const repositories = claudeSessionsProps.repositories ?? [];
    const repositoryMainBindings = claudeSessionsProps.repositoryMainBindings ?? {};
    const extraPanes = claudeSessionsProps.extraPanes ?? [];
    const currentPaneCount = claudeSessionsProps.paneCount ?? 1;
    const configs: Array<{ paneIndex: number; repositoryPath: string | null | undefined }> = [
      { paneIndex: 0, repositoryPath: activeRepositoryPath ?? null },
    ];
    for (let i = 0; i < extraPanes.length && i + 1 < currentPaneCount; i++) {
      const slot = extraPanes[i];
      let resolvedRepoPath: string | null = null;
      // 1) slot 已显式绑定仓库：直接取该仓库的 path。
      if (slot.repositoryId != null) {
        const repo = repositories.find((r) => r.id === slot.repositoryId);
        const path = repo?.path?.trim() ?? "";
        if (path) resolvedRepoPath = path;
      }
      // 2) slot 已占会话：通过会话 + bindings 解析出仓库（不依赖左栏 active repo）。
      if (!resolvedRepoPath && slot.sessionId) {
        const paneSession = sessions.find((s) => s.id === slot.sessionId);
        if (paneSession) {
          const repo = resolveRepositoryForSession({
            session: paneSession,
            repositories,
            bindings: repositoryMainBindings,
            sessions,
          });
          const path = repo?.path?.trim() ?? paneSession.repositoryPath?.trim() ?? "";
          if (path) resolvedRepoPath = path;
        }
      }
      // 3) 兜底：使用 primary active 仓库（典型：尚未绑会话的新建 slot）。
      if (!resolvedRepoPath && activeRepositoryPath?.trim()) {
        resolvedRepoPath = activeRepositoryPath.trim();
      }
      configs.push({
        paneIndex: i + 1,
        repositoryPath: resolvedRepoPath,
      });
    }
    return configs;
  }, [
    activeRepositoryPath,
    claudeSessionsProps.extraPanes,
    claudeSessionsProps.paneCount,
    claudeSessionsProps.repositories,
    claudeSessionsProps.repositoryMainBindings,
    claudeSessionsProps.sessions,
  ]);

  /** 多 pane dispatcher：按 `opts.fileRootPath` 路由到对应 pane host 的 `openRepositoryFile`。
   *  fallback 顺序：
   *  1) `fileRootPath` 精确匹配 `paneEditorApisRef` 中某 host 的 `repositoryPath`。
   *  2) 否则（rootPath 为空，或 rootPath 未命中）→ 走 fileEditorTargetPaneIndex
   *     指定的 host（仅适用 rootPath 为空的"无 rootPath"调用方：例如
   *     `openRepositoryFileWithPreference` 在 `fileTreeOpenInNewPane` 路径下
   *     由 line 1179 显式 setFileEditorTargetPaneIndex 后立即调本函数），并校验
   *     该 host 的 repositoryPath 与 rootPath 一致（避免 stale target 把请求串到
   *     错 pane）。
   *  3) 都没有 → primary (pane 0) host。
   *  4) 极端边界（所有 host 都没注册）→ message.warning 提示。
   *
   *  关键防线：`fileEditorTargetPaneIndex` 是历史 target，不能直接作为 rootPath
   *  非空情况下的 fallback。否则在同一仓库跨多 pane / 上一轮在 pane 1 打开后，
   *  routing useEffect 命中 primary repo 时（matchedPaneIndex=null）会保留 stale
   *  target=1，导致本 dispatcher 把请求错误路由到 pane 1（即 bug 5-3 根因）。 */
  const [fileEditorTargetPaneIndex, setFileEditorTargetPaneIndex] = useState<number | null>(null);
  /** fileEditorTargetPaneIndex 的 ref：routing 的 setFileEditorTargetPaneIndex 是异步 state，
   *  但 openRepositoryFileInPaneByRootPath 在同一 useEffect 同步调用，闭包拿到的是旧 target。
   *  retry 用 ref 读最新 target，确保 host repositoryPath 不匹配时仍能 fallback 到 routing 刚设的 target host。 */
  const fileEditorTargetPaneIndexRef = useRef<number | null>(null);
  fileEditorTargetPaneIndexRef.current = fileEditorTargetPaneIndex;
  const [fileTreeOpenInNewPane, setFileTreeOpenInNewPane] = useState(false);
  /** paneCount 的 ref：供 retry fallback 判断当前是否多屏 —— 多屏下不回退 primary host，
   *  避免 exactMatch 失败时把第二屏文件错开到第一屏（错屏 + close 按钮不在本屏）。 */
  const paneCountRef = useRef(claudeSessionsProps.paneCount ?? 1);
  paneCountRef.current = claudeSessionsProps.paneCount ?? 1;

  const openRepositoryFileInPaneByRootPath = useCallback(
    (relativePath: string, options?: GitPanelOpenFileOptions, targetPaneIndexOverride?: number | null) => {
      const rootPath = options?.fileRootPath?.trim() ?? "";
      // 优先 routing 设定的 targetPaneIndex 指向的 host（若 rootPath 匹配，或 rootPath 为空）。
      // 关键：避免「两 host 同 repo（如 pane 1 空槽 fallback active，或 pane 1 绑了与 primary
      // 相同的 repo）时，find 按 insertion order 总命中 host[0]」导致第二屏文件错开到第一屏、
      // 或多屏不 fallback 后第二屏打不开。routing 已按 rootPath 匹配到正确 pane，此处信任它。
      // 注：routing 的 setFileEditorTargetPaneIndex 是异步 state，本函数同步调用时闭包拿到的
      // 是旧值；故 routing 通过 `targetPaneIndexOverride` 显式传入刚算出的 matchedPaneIndex。
      // `undefined` 表示调用者未传（用 ref 最新值）；`null` 表示明确无 target（primary 操作）。
      const targetIdx =
        targetPaneIndexOverride !== undefined
          ? targetPaneIndexOverride
          : fileEditorTargetPaneIndexRef.current;
      const targetHost = targetIdx != null ? paneEditorApisRef.current.get(targetIdx) : undefined;
      // routing 显式指定目标 pane（override 为 number）且 rootPath 非空：直接信任，跳过
      // host.repositoryPath 校验。原因：host.repositoryPath 派生自 slot/session，可能在
      // session.repositoryPath 未加载 / slot 兜底到 active 仓库时暂态错误，但 hook 内
      // `resolveFileRootPath` 优先用 `options.fileRootPath` 加载文件，不依赖 host.repositoryPath。
      // 若此处校验 host.repositoryPath === rootPath，会因配置暂态错误误判失败 → retry 720ms
      // →「第二屏打开文件超级慢」。routing 已通过 slot/session/repositoryId 三重匹配锁定目标，
      // 校验多余。rootPath 为空时不走本快路（fileTreeOpenInNewPane 无 fileRootPath，仍需
      // host.repositoryPath 对齐才能正确加载）。
      const routingExplicit = typeof targetPaneIndexOverride === "number";
      if (routingExplicit && rootPath && targetHost) {
        targetHost.openRepositoryFile(relativePath, options);
        return;
      }
      const targetHostMatches =
        targetHost != null && (rootPath ? targetHost.repositoryPath?.trim() === rootPath : true);
      if (targetHostMatches) {
        targetHost.openRepositoryFile(relativePath, options);
        return;
      }
      // exactMatch：rootPath 非空时，find 第一个 repositoryPath 匹配的 host
      // （典型：primary repo 文件，target 未匹配 extra pane，find 命中 host[0]）。
      const exactMatch = rootPath
        ? Array.from(paneEditorApisRef.current.entries()).find(
            ([, api]) => api.repositoryPath?.trim() === rootPath,
          )?.[1]
        : undefined;
      if (exactMatch) {
        exactMatch.openRepositoryFile(relativePath, options);
        return;
      }
      // rootPath 为空：fallback target host（若存在）或 primary
      if (!rootPath) {
        const fallback = targetHost ?? paneEditorApisRef.current.get(0);
        if (fallback) {
          fallback.openRepositoryFile(relativePath, options);
          return;
        }
        message.warning("请先选择工作区或仓库");
        return;
      }
      // rootPath 非空但无 host 匹配（host 还在 mount 时序晚于 request 的极端窗口）：
      // 入 pending 队列等目标 host mount 后消费（`registerPaneEditor` 已处理）。
      pendingFileOpensByRootRef.current.set(rootPath, { relativePath, options });
      // retry：每 60ms 重试到 pending 被某 host 消费或超时 720ms。
      let attempts = 0;
      const retry = () => {
        attempts += 1;
        const pending = pendingFileOpensByRootRef.current.get(rootPath);
        if (!pending) return; // 已消费
        // 第一道：target host 匹配（host mount 后 repositoryPath 对齐）。
        const th = targetIdx != null ? paneEditorApisRef.current.get(targetIdx) : undefined;
        if (th && th.repositoryPath?.trim() === rootPath) {
          pendingFileOpensByRootRef.current.delete(rootPath);
          th.openRepositoryFile(pending.relativePath, pending.options);
          return;
        }
        // 第二道：exactMatch（任一 host repositoryPath 匹配）。
        const hit = Array.from(paneEditorApisRef.current.entries()).find(
          ([, api]) => api.repositoryPath?.trim() === rootPath,
        )?.[1];
        if (hit) {
          pendingFileOpensByRootRef.current.delete(rootPath);
          hit.openRepositoryFile(pending.relativePath, pending.options);
          return;
        }
        // 第三道：超时 fallback。单屏（paneCount===1）回退 primary（2→1 屏 host[1] 已 unmount）。
        // 多屏下回退 target host —— `resolveFileRootPath` 优先 `options.fileRootPath`，
        // 即使 target host 的 repositoryPath 不匹配，文件仍按 rootPath 加载并写入 target pane，
        // 避免多屏下"打不开"。target host 也不存在时（target=null，典型 primary 操作）回退 primary。
        if (attempts >= 12) {
          pendingFileOpensByRootRef.current.delete(rootPath);
          if (paneCountRef.current === 1) {
            const fb = paneEditorApisRef.current.get(0);
            if (fb) {
              fb.openRepositoryFile(pending.relativePath, pending.options);
              return;
            }
          } else if (th) {
            th.openRepositoryFile(pending.relativePath, pending.options);
            return;
          } else {
            const fb = paneEditorApisRef.current.get(0);
            if (fb) {
              fb.openRepositoryFile(pending.relativePath, pending.options);
              return;
            }
          }
          message.warning("未找到目标仓库的编辑器，请重试");
          return;
        }
        window.setTimeout(retry, 60);
      };
      window.setTimeout(retry, 60);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void loadFileTreeOpenInNewPaneFromStore().then((value) => {
      if (!cancelled) setFileTreeOpenInNewPane(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ openInNewPane?: boolean }>).detail;
      if (typeof detail?.openInNewPane === "boolean") {
        setFileTreeOpenInNewPane(detail.openInNewPane);
      } else {
        void loadFileTreeOpenInNewPaneFromStore().then(setFileTreeOpenInNewPane);
      }
    };
    window.addEventListener(WISE_FILE_TREE_OPEN_IN_NEW_PANE_CHANGED, onChanged as EventListener);
    return () => {
      window.removeEventListener(WISE_FILE_TREE_OPEN_IN_NEW_PANE_CHANGED, onChanged as EventListener);
    };
  }, []);

  const prevAnyPaneEditorVisibleRef = useRef(false);
  /**
   * 任一 pane 的 file editor 由可见 → 不可见时，广播关闭事件给 scroll 等监听者；
   * `prevAnyPaneEditorVisibleRef` 记录上一次的"全局是否任意 pane 编辑器可见"快照。
   * 由 `centerAuxPanelsNodeByPane` 派生：panel != null 即该 pane 编辑器可见。
   */
  useEffect(() => {
    const anyVisible = Array.from(centerAuxPanelsNodeByPaneRef.current.values()).some(
      (node) => node != null,
    );
    if (prevAnyPaneEditorVisibleRef.current && !anyVisible) {
      setFileEditorTargetPaneIndex(null);
      dispatchRepositoryFileEditorClosed();
    }
    prevAnyPaneEditorVisibleRef.current = anyVisible;
  }, [centerAuxPanelsNodeByPaneVersion]);

  const openRepositoryFileWithPreference = useCallback(
    async (relativePath: string, options?: GitPanelOpenFileOptions) => {
      const fromFileTree = options?.fromFileTree === true;
      const plainFile = isPlainRepositoryFileOpen(options);
      if (fromFileTree && fileTreeOpenInNewPane && plainFile) {
        const currentPaneCount = claudeSessionsProps.paneCount ?? 1;
        let targetPaneIndex = fileEditorTargetPaneIndex;
        const needsNewTarget =
          targetPaneIndex == null || targetPaneIndex >= currentPaneCount;

        if (needsNewTarget) {
          const plan = planFileViewerPaneIndex({
            paneCount: currentPaneCount as PaneCount,
            extraPanes: claudeSessionsProps.extraPanes ?? [],
            createSlot: createFileViewerPaneSlot,
          });
          targetPaneIndex = plan.targetPaneIndex;

          if (plan.nextPaneCount !== currentPaneCount && claudeSessionsProps.onChangePaneCount) {
            const expanded = await Promise.resolve(
              claudeSessionsProps.onChangePaneCount(plan.nextPaneCount) as void | boolean,
            );
            if (expanded === false) {
              setFileEditorTargetPaneIndex(null);
              openRepositoryFileInPaneByRootPath(relativePath, options, null);
              return;
            }
            await waitLayoutFrames(1);
          }
        }

        setFileEditorTargetPaneIndex(targetPaneIndex);
        openRepositoryFileInPaneByRootPath(relativePath, options, targetPaneIndex);
        return;
      }

      if (fromFileTree && !fileTreeOpenInNewPane) {
        // 多屏下路由到最近聚焦的 pane：文件树是全局的（绑定 primary 仓库，不绑定某屏），
        // 用户点击某屏聚焦后，文件树点击的文件应在该屏打开。activeIdx 为 null（未聚焦 / 单屏）
        // 或超出当前屏数时 fallback primary。传 number override 走 routingExplicit 快路，直接在
        // target host 打开（按 options.fileRootPath 加载，不依赖 host.repositoryPath 校验）。
        const currentPaneCount = claudeSessionsProps.paneCount ?? 1;
        const activeIdx = currentPaneCount > 1 ? getActivePaneIndex() : null;
        if (activeIdx != null && activeIdx < currentPaneCount) {
          setFileEditorTargetPaneIndex(activeIdx);
          openRepositoryFileInPaneByRootPath(relativePath, options, activeIdx);
          return;
        }
        setFileEditorTargetPaneIndex(null);
        openRepositoryFileInPaneByRootPath(relativePath, options, null);
        return;
      }
      openRepositoryFileInPaneByRootPath(relativePath, options);
    },
    [
      claudeSessionsProps.extraPanes,
      claudeSessionsProps.onChangePaneCount,
      claudeSessionsProps.paneCount,
      fileEditorTargetPaneIndex,
      fileTreeOpenInNewPane,
      openRepositoryFileInPaneByRootPath,
    ],
  );

  /** 切换编辑器 Tab 时让文件树跟随定位到该文件。仅当文件树已可见时才触发，不强制展开侧栏。
   *  当前 hook 的 `setFileEditorActivePath` 是"按 paneIndex 的 setter 闭包"；routing
   *  useEffect 路由时已锁定目标 pane，这里通过 paneEditorApisRef 找到目标 host 的
   *  setter 调用，从而把 reveal 目标也写到正确 host 的 active path。 */
  useEffect(() => {
    const request = repositoryFileOpenRequest;
    // `repositoryFileOpenRequest` 是"打开文件"事件的唯一 source of truth：`openRepositoryFileByEvent`
    // 已经在写入前校验过目标仓库合法。因此 routing 时仅需判断 `request.repositoryPath`
    // 是否落在某一已绑定 pane 仓库范围内（包括 active 仓库 / 各 extra pane 的
    // session.repositoryPath / slot.repositoryId）；不再依赖 UI 层的 `commandPaletteProps.repositoryPath`
    // 作为 override 判定 —— 因为 `commandPaletteProps.onClose` 会在 `onOpenInApp`
    // 同一渲染周期清掉对应的 `searchRepositoryPathOverride`，React 18 合批后
    // `commandPaletteProps.repositoryPath` 会回退到 `activeRepository.path`，导致多 pane
    // 下"在第二屏搜索 → 应当路由到第二屏"的请求被此处提前 return 退掉，文件编辑器
    // fallback 到 primary pane。
    const targetPath = request?.repositoryPath?.trim() ?? "";
    if (!request || !targetPath) return;

    // 多屏下将文件编辑器路由到正确的窗格。
    // 注意：仅当目标仓库命中某个 extra pane 时才 setFileEditorTargetPaneIndex(i+1)，
    // 命中前**不要**先 set(null)。原因：用户从 primary pane（顶栏 ⌘K / 左栏文件树）
    // 打开 primary repo 的文件时，extraPanes 不会命中任何 slot；如果提前 reset 为
    // null，pane 1 已挂载的 `panelBelowMessages` 会被卸下，pane 1 上的 tab 列表
    // 看似"被关闭"。正确语义：primary repo 的文件保持 fileEditorTargetPaneIndex
    // 不动（或保持 null），让 resolvePaneAuxLayout 走 primary pane fallback 分支
    // 渲染（其它 pane 仍可保留消息列表，编辑器沿用前一目标位置）。
    const currentPaneCount = claudeSessionsProps.paneCount ?? 1;
    // routing 算出的目标 pane：传给 openRepositoryFileInPaneByRootPath 作为 override，
    // 避免依赖异步 state（setFileEditorTargetPaneIndex 在本 useEffect 同步调用时还未生效）。
    let routingTargetPaneIndex: number | null = null;
    if (currentPaneCount > 1 && request.repositoryPath) {
      const extraPanes = claudeSessionsProps.extraPanes ?? [];
      const sessions = claudeSessionsProps.sessions ?? [];
      const repositories = claudeSessionsProps.repositories ?? [];
      const targetRepositoryId =
        request.repositoryId != null
          ? request.repositoryId
          : repositories.find((repo) => repo.path?.trim() === targetPath)?.id ?? null;
      let matchedPaneIndex: number | null = null;
      for (let i = 0; i < extraPanes.length; i++) {
        const slot = extraPanes[i];
        if (!slot.sessionId) continue;
        const session = sessions.find((s) => s.id === slot.sessionId);
        const sessionRepoPath = session?.repositoryPath?.trim() ?? "";
        const slotRepo =
          slot.repositoryId != null
            ? repositories.find((repo) => repo.id === slot.repositoryId)?.path?.trim() ?? ""
            : "";
        if (
          sessionRepoPath === targetPath ||
          (targetRepositoryId != null && slot.repositoryId === targetRepositoryId) ||
          (slotRepo && slotRepo === targetPath)
        ) {
          matchedPaneIndex = i + 1;
          break;
        }
      }
      if (matchedPaneIndex != null) {
        setFileEditorTargetPaneIndex(matchedPaneIndex);
        routingTargetPaneIndex = matchedPaneIndex;
      }
      // 未匹配：保持 fileEditorTargetPaneIndex 现状（可能为 null，也可能为上一目标），
      // 让 resolvePaneAuxLayout 走默认（primary pane 显示）或沿用上次路由；不主动 reset
      // 避免误卸下其它 pane 的编辑器节点。
    }

    const revealTarget = resolveExplorerRevealTargetForOpen({
      workspaceFileTreeRailOpen: showWorkspaceFileTreeRail,
      filesPanelPlacement: leftSidebarProps.filesPanelPlacement ?? "left",
      gitPanelPlacement: leftSidebarProps.gitPanelPlacement ?? "left",
      leftSidebarCollapsed: collapsed,
      leftSidebarParked,
      rightRailAvailable: chatRightRailMode,
    });

    if (revealTarget === "workspace-rail" && !fileTreeRailOpen) {
      setFileTreeRailOpen(true);
    } else if (revealTarget === "left-sidebar" || revealTarget === "right-rail") {
      requestExplorerFocus(revealTarget);
    }

    const pendingReveal = {
      repositoryPath: targetPath,
      relativePath: request.relativePath,
      isDirectory: Boolean(request.isDirectory),
      revealTarget,
    };
    requestAnimationFrame(() => {
      writePendingExplorerReveal(pendingReveal);
    });

    if (!request.isDirectory) {
      // 关键：`request.repositoryPath` 是文件所属仓库的真实根（多 pane 下可能是
      // extra pane 的仓库）。`openRepositoryFileInPaneByRootPath` 优先用 routing 刚算出的
      // `routingTargetPaneIndex` 指向的 host（若 rootPath 匹配），否则按 `fileRootPath`
      // 在 `paneEditorApisRef` 中 find 匹配 host。传 override 是为避开异步 state 时序
      // （setFileEditorTargetPaneIndex 在本 useEffect 同步调用时还未生效）。
      // 上面的 `if (!request || !targetPath) return` 已保证 `request.repositoryPath` 非空。
      openRepositoryFileInPaneByRootPath(
        request.relativePath,
        {
          fileRootPath: request.repositoryPath ?? undefined,
          line: request.line ?? null,
          fromFileTree: true,
        },
        routingTargetPaneIndex,
      );
    }
    onConsumeRepositoryFileOpenRequest();
  }, [
    activeRepositoryPath,
    chatRightRailMode,
    claudeSessionsProps.extraPanes,
    claudeSessionsProps.paneCount,
    claudeSessionsProps.sessions,
    collapsed,
    fileTreeRailOpen,
    leftSidebarParked,
    leftSidebarProps.filesPanelPlacement,
    leftSidebarProps.gitPanelPlacement,
    onConsumeRepositoryFileOpenRequest,
    openRepositoryFileInPaneByRootPath,
    paneEditorApisVersion,
    repositoryFileOpenRequest,
    setFileEditorTargetPaneIndex,
    setFileTreeRailOpen,
    showWorkspaceFileTreeRail,
  ]);

  /** 在文件树中定位到指定文件/目录：算出目标文件树实例，必要时打开 workspace rail 或请求
   *  侧栏文件树聚焦，再通过 pendingExplorerReveal（sessionStorage + 全局事件）让对应
   *  `useRepositoryFilesExplorer` 展开父目录链并 setSelected。与「搜索/外链打开文件」走同一条
   *  reveal 通路。供中栏编辑器顶栏按钮与 tab 右键菜单调用。 */
  const revealFileInExplorer = useCallback<RevealFileInExplorerHandler>(
    (repositoryPath, relativePath, isDirectory = false) => {
      const targetPath = repositoryPath.trim();
      const targetRelative = relativePath.trim();
      if (!targetPath || !targetRelative) {
        return;
      }
      const revealTarget = resolveExplorerRevealTargetForOpen({
        workspaceFileTreeRailOpen: showWorkspaceFileTreeRail,
        filesPanelPlacement: leftSidebarProps.filesPanelPlacement ?? "left",
        gitPanelPlacement: leftSidebarProps.gitPanelPlacement ?? "left",
        leftSidebarCollapsed: collapsed,
        leftSidebarParked,
        rightRailAvailable: chatRightRailMode,
      });
      if (revealTarget === "workspace-rail" && !fileTreeRailOpen) {
        setFileTreeRailOpen(true);
      } else if (revealTarget === "left-sidebar" || revealTarget === "right-rail") {
        requestExplorerFocus(revealTarget);
      }
      const pendingReveal = {
        repositoryPath: targetPath,
        relativePath: targetRelative,
        isDirectory,
        revealTarget,
      };
      requestAnimationFrame(() => {
        writePendingExplorerReveal(pendingReveal);
      });
    },
    [
      showWorkspaceFileTreeRail,
      leftSidebarProps.filesPanelPlacement,
      leftSidebarProps.gitPanelPlacement,
      collapsed,
      leftSidebarParked,
      chatRightRailMode,
      fileTreeRailOpen,
      setFileTreeRailOpen,
    ],
  );

  return (
    <RepositoryFileEditorRevealInExplorerContext.Provider value={revealFileInExplorer}>
    <RepositoryFileEditorOpenFileContext.Provider value={openRepositoryFileWithPreference}>
      {/* 多 pane 下 Visibility/Panel Context 由各 PaneEditorHost 内部按 paneIndex 注入；
          这里仅在单 pane（paneCount === 1）时透传；多 pane 时为 fallback 占位空壳，
          实际面板由 per-pane host 提供。 */}
      <RepositoryFileEditorVisibilityContext.Provider value={false}>
        <RepositoryFileEditorPanelContext.Provider value={null}>
          {/* file preview modal 单例：layout 持 `activeLayoutBinaryPreview`（从各 host 上报中
              取第一个非空），modal 通过本 Context 读取。 */}
          <RepositoryFilePreviewModalContext.Provider value={activeLayoutBinaryPreview}>
          <ConfigProvider
            locale={zhCN}
            tooltip={{ unique: true }}
            theme={{
              algorithm,
              /**
               * 全局设计基线：统一字体、字号、行高、圆角，让 AntD 组件与自定义
               * 面板向 13px 正文基准收敛，减少「AntD 14px vs 面板 10-11px」的割裂感。
               * 单点配置即可级联到所有 AntD 组件。
               */
              token: {
                fontFamily:
                  '-apple-system, BlinkMacSystemFont, "SF Pro SC", "SF Pro Text", "PingFang SC", "Helvetica Neue", "Microsoft YaHei", "Segoe UI", Arial, sans-serif',
                fontSize: 13,
                lineHeight: 1.55,
                borderRadius: 8,
                borderRadiusLG: 10,
                borderRadiusSM: 6,
                wireframe: false,
              },
              /** MCP/技能等叠层局部 z-index 较高，避免 Message 被盖住看不见 */
              components: {
                Message: { zIndexPopup: 20000 },
                Notification: { zIndexPopup: 20000 },
              },
            }}
          >
            <AntdApp>
              {workspaceWelcomeFullscreen && workspaceWelcomeProps ? (
                <div className="app-workspace-welcome-fullscreen">
                  <Suspense fallback={<PanelLoadingFallback />}>
                    <LazyWorkspaceWelcomeLanding {...workspaceWelcomeProps} />
                  </Suspense>
                </div>
              ) : null}
              <Layout
                className={`app-main-layout${authorMode ? " app-main-layout--author" : ""}${
                  workspaceWelcomeFullscreen ? " app-main-layout--welcome-hidden" : ""
                }`}
                style={{ minWidth: 0, flex: 1, minHeight: 0, height: "100%" }}
              >
                <Suspense fallback={null}>
                  <ConnectedLeftSidebar
                    dark={dark}
                    collapsed={collapsed}
                    parked={authorMode || leftSidebarParked}
                    siderWidth={mainLayoutLeftWidthPx}
                    leftSidebarProps={{
                      ...leftSidebarProps,
                      repoPanelRightRailAvailable: chatRightRailMode,
                      fileTreeRailOpen,
                      onToggleFileTreeRail: chatRightRailMode ? toggleFileTreeRail : undefined,
                      onWorkspaceFileTreeRailContextChange: chatRightRailMode
                        ? setWorkspaceFileTreeRailContext
                        : undefined,
                    }}
                  />
                </Suspense>
                {authorMode && authorShellMounted ? (
                  <Suspense fallback={null}>
                    <LazyAuthorPanelNav
                      dark={dark}
                      collapsed={collapsed}
                      parked={false}
                      siderWidth={AUTHOR_CONFIG_NAV_SIDER_WIDTH_PX}
                      pane={authorPanelProps.pane}
                      onPaneChange={authorPanelProps.onPaneChange}
                      onBack={authorPanelProps.onBack}
                    />
                  </Suspense>
                ) : null}

                {!leftSidebarParked && !collapsed ? (
                  <MainLayoutResizeHandle
                    variant="left"
                    startWidthPx={mainLayoutLeftWidthPx}
                    onWidthChange={onLeftWidthChange}
                  />
                ) : null}

                {showWorkspaceFileTreeRail && workspaceFileTreeRailContext ? (
                  <>
                    <ConnectedWorkspaceFileTreeRail
                      widthPx={fileTreeRailWidthPx}
                      macTitlebarInset={collapsed}
                      context={workspaceFileTreeRailContext}
                      onClose={() => setFileTreeRailOpen(false)}
                    />
                    <MainLayoutResizeHandle
                      variant="left"
                      startWidthPx={fileTreeRailWidthPx}
                      onWidthChange={setFileTreeRailWidthPx}
                    />
                  </>
                ) : null}

                <div className="app-workspace-main">
                  <div
                    className={`app-main-chat-with-right-pane${
                      authorMode || missionControlMode ? " app-workspace-layer--parked" : ""
                    }`}
                  >
                    {chatRightRailMode && (claudeSessionsProps.paneCount ?? 1) === 1 ? (
                      // 1 屏：跨整宽全局 Topbar（覆盖中栏 + 右栏）。多屏时不渲染，由各 pane 顶栏自管。
                      <Suspense fallback={null}>
                        <LazyTopbar
                          {...topbarProps}
                          centerView={centerView}
                          onCenterViewChange={setCenterView}
                          centerSwitcherVisible={centerSwitcherVisible}
                          centerSwitcherFilesLabel={memoOpen ? "备忘录" : "文件"}
                        />
                      </Suspense>
                    ) : null}

                    <div
                      className="app-main-chat-and-rail-body"
                      style={
                        chatRightRailMode
                          ? ({
                              "--app-right-panel-width": `${mainLayoutRightWidthPx}px`,
                            } as CSSProperties)
                          : undefined
                      }
                    >
                      <ErrorBoundary type="local" fallbackTitle="智能对话会话模块出错">
                        <Suspense fallback={<WorkspaceViewportLoading />}>
                          <CenterViewControlContext.Provider value={setCenterView}>
                          <ConnectedClaudeSessions
                            claudeSessionsProps={claudeSessionsPropsWithHeader}
                            centerView={centerView}
                            mainLayoutContentRef={mainLayoutContentRef}
                            centerAuxPanelsNodeByPane={centerAuxPanelsNodeByPane}
                            centerAuxPanelsNodeByPaneVersion={centerAuxPanelsNodeByPaneVersion}
                          />
                          </CenterViewControlContext.Provider>
                        </Suspense>
                      </ErrorBoundary>
                    </div>

                    <Suspense fallback={null}>
                      <LazyCommandPalette {...commandPaletteProps} />
                    </Suspense>
                    {mcpHubMode ? (
                      <div className="app-mcp-hub-overlay" role="region" aria-label="MCP 管理">
                        <ErrorBoundary type="local" fallbackTitle="MCP 管理面板出错">
                          <Suspense fallback={<PanelLoadingFallback />}>
                            <LazyMcpHub {...mcpHubProps} />
                          </Suspense>
                        </ErrorBoundary>
                      </div>
                    ) : null}
                    {skillsHubMode ? (
                      <div className="app-skills-hub-overlay" role="region" aria-label="skills.sh 技能目录">
                        <ErrorBoundary type="local" fallbackTitle="技能目录面板出错">
                          <Suspense fallback={<PanelLoadingFallback />}>
                            <LazySkillsHub {...skillsHubProps} />
                          </Suspense>
                        </ErrorBoundary>
                      </div>
                    ) : null}
                    {scheduledTasksOverlay && onCloseScheduledTasksOverlay ? (
                      <div className="app-scheduled-tasks-overlay" role="region" aria-label="定时任务">
                        <ErrorBoundary type="local" fallbackTitle="定时任务面板出错">
                          <Suspense fallback={<PanelLoadingFallback />}>
                            <LazyRepositoryScheduledTasksModal
                              open
                              presentation="overlay"
                              onClose={onCloseScheduledTasksOverlay}
                              repositoryPath={scheduledTasksOverlay.path}
                              repositoryDisplayName={scheduledTasksOverlay.name}
                              employees={scheduledTasksOverlayEmployees}
                              workflowTemplates={scheduledTasksOverlayWorkflowTemplates}
                              workflowGraphsByWorkflowId={scheduledTasksOverlayWorkflowGraphsByWorkflowId}
                            />
                          </Suspense>
                        </ErrorBoundary>
                      </div>
                    ) : null}
                  </div>

                   {showCockpitShell ? (
                    <div
                      className={`app-full-width-main app-cockpit-workspace-layer${
                        !missionControlMode ? " app-workspace-layer--parked" : ""
                      }`}
                    >
                      <Layout.Content className="app-main-layout-content">
                        <ErrorBoundary type="local" fallbackTitle="需求与自动化调度面板出错">
                          {cockpitEmpty ? (
                            <Suspense fallback={<PanelLoadingFallback />}>
                              <LazyCockpitOnboarding {...cockpitOnboardingProps} />
                            </Suspense>
                          ) : cockpitHubPane === "mcp" ? (
                            <Suspense fallback={<PanelLoadingFallback />}>
                              <LazyMcpHub {...mcpHubProps} />
                            </Suspense>
                          ) : cockpitHubPane === "skills" ? (
                            <Suspense fallback={<PanelLoadingFallback />}>
                              <LazySkillsHub {...skillsHubProps} />
                            </Suspense>
                          ) : cockpitHubPane === "automation" ? (
                            <Suspense fallback={<PanelLoadingFallback />}>
                              <LazyAutomationPanel
                                {...authorPanelProps.automationPanelProps}
                                onClose={onCloseCockpitAutomationHub}
                              />
                            </Suspense>
                          ) : (
                            <Suspense fallback={<PanelLoadingFallback />}>
                              <CockpitSurface
                                activeProjectId={cockpitSurfaceActiveProjectId}
                                activeProjectName={cockpitSurfaceActiveProjectName}
                                hasInitialTarget={cockpitSurfaceHasInitialTarget}
                                initialAssistantId={cockpitSurfaceInitialAssistantId}
                                resumeAssistantId={cockpitSurfaceResumeAssistantId}
                                openRequestKey={cockpitSurfaceOpenRequestKey}
                                onClose={onCloseCockpit}
                                onActiveAssistantIdChange={onCockpitActiveAssistantIdChange}
                                onClearInitialAssistant={onClearCockpitInitialAssistant}
                              />
                            </Suspense>
                          )}
                        </ErrorBoundary>
                      </Layout.Content>
                    </div>
                  ) : null}

                  {authorShellMounted ? (
                    <div
                      className={`app-full-width-main app-author-workspace-layer${!authorMode ? " app-workspace-layer--parked" : ""}`}
                    >
                      <ErrorBoundary type="local" fallbackTitle="协同设计开发面板出错">
                        <Suspense fallback={<PanelLoadingFallback />}>
                          <LazyAuthorPanel {...authorPanelProps} configLayerActive={authorMode} />
                        </Suspense>
                      </ErrorBoundary>
                    </div>
                  ) : null}
                </div>
              </Layout>

              {/* 多 pane 下的 per-pane 文件编辑器宿主。挂载顺序与 `ClaudeMultiPaneGrid` 的
                  pane 渲染顺序一致：pane 0（primary，active 仓库） + pane 1..N-1（extra panes）。
                  每个 host 各自调 `useRepositoryFileEditor`，registerPaneEditor 注册到 layout
                  dispatcher。Host 返回 null，仅靠 useEffect 上报 editor panel / preview 状态。 */}
              {paneEditorHostConfigs.map((config) => (
                <PaneEditorHost
                  key={config.paneIndex}
                  paneIndex={config.paneIndex}
                  repositoryPath={config.repositoryPath}
                  activeSessionId={claudeSessionsProps.activeSessionId}
                  dark={dark}
                  registerPaneEditor={registerPaneEditor}
                  unregisterPaneEditor={unregisterPaneEditor}
                  setCenterAuxPanelsNodeForPane={setCenterAuxPanelsNodeForPane}
                  layoutBinaryPreviewRef={layoutBinaryPreviewRef}
                  bumpLayoutBinaryPreviewVersion={bumpLayoutBinaryPreviewVersion}
                />
              ))}

              <Suspense fallback={null}>
                <ConnectedRepositoryFilePreviewModal />
              </Suspense>

              <Suspense fallback={null}>
                <LazyProgressMonitorDrawer {...progressMonitorDrawerProps} />
              </Suspense>

              <Suspense fallback={null}>
                <LazyMonitorHistorySessionTranscriptDrawer {...historyTranscriptDrawerProps} />
              </Suspense>

            </AntdApp>
          </ConfigProvider>
          </RepositoryFilePreviewModalContext.Provider>
          </RepositoryFileEditorPanelContext.Provider>
        </RepositoryFileEditorVisibilityContext.Provider>
      </RepositoryFileEditorOpenFileContext.Provider>
    </RepositoryFileEditorRevealInExplorerContext.Provider>
  );
}
