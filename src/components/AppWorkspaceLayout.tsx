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
import { type ChatInspectorProps, type CockpitInspectorProps } from "./Inspector";
import { RepositorySessionPanel } from "./Inspector/RepositorySessionPanel";
import type { MultiPaneSharedChatProps } from "./ClaudeSessions/ClaudeMultiPaneGrid";
import type { PaneLocalHeaderSharedProps } from "./ClaudeSessions/PaneLocalHeader";
import type { ClaudeSessionsProps as ClaudeSessionsExternalProps } from "./ClaudeSessions";
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
import type { EmployeeItem, Repository, WorkflowGraph, WorkflowTemplateItem } from "../types";
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
import { areInspectorShellPropsEqual } from "./Inspector/chatInspectorPropsEqual";
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
// 直接为 lazy 标注 props，让 `ComponentProps<typeof LazyClaudeSessions>` 能反推完整 props（含 paneHeaderSharedProps）。
const LazyClaudeSessions = lazy<ComponentType<ClaudeSessionsExternalProps>>(() =>
  claudeSessionsChunk.then((module) => ({ default: module.ClaudeSessions })),
);
const LazyTopbar = lazy(() => topbarChunk.then((module) => ({ default: module.Topbar })));
// 1 屏下把 PaneLocalButtons（运行 / 外部终端 / OpenAppMenu / FCC / 多屏切换）并入顶部 Topbar 右侧。
// 右栏折叠按钮单独提取为 RightPanelToggleButton，放在 Topbar 右侧最末（内置终端 / 多屏切换之后）。
const LazyPaneLocalButtons = lazy(() =>
  import("./ClaudeSessions/PaneLocalHeader").then((module) => ({ default: module.PaneLocalButtons })),
);
const LazyRightPanelToggleButton = lazy(() =>
  import("./ClaudeSessions/PaneLocalHeader").then((module) => ({ default: module.RightPanelToggleButton })),
);
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

const Inspector = lazy(() => import("./Inspector").then((module) => ({ default: module.Inspector })));
const CockpitSurface = lazy(() =>
  import("./CockpitSurface").then((module) => ({ default: module.CockpitSurface })),
);
const MemoLeftSidebar = memo(LazyLeftSidebar, areLeftSidebarPropsEqual);
const MemoClaudeSessions = memo(LazyClaudeSessions, claudeSessionsShellPropsEqual) as unknown as React.MemoExoticComponent<
  ComponentType<ClaudeSessionsProps>
>;
const MemoInspector = memo(Inspector, areInspectorShellPropsEqual);

// shell 层透传：仅在 `ClaudeSessionsExternalProps` 基础上补一个
// `paneHeaderSharedProps?`，其余三个辅助 prop（panelBelowMessages / hideMessages /
// hideSessionTools）由 ConnectedClaudeSessions 在 JSX 内部覆盖，本类型按原状保留。
// 注：`paneHeaderSharedProps` 已在 `ClaudeSessionsExternalProps` 中正式声明，此处不再额外扩展，
// 避免出现第二个类型入口与不同步风险。
type ClaudeSessionsProps = ClaudeSessionsExternalProps;
type LeftSidebarProps = Omit<
  ComponentProps<typeof LazyLeftSidebar>,
  | "dark"
  | "collapsed"
  | "siderWidth"
  | "onOpenActiveRepositoryFile"
>;
type RightPanelProps = ChatInspectorProps;
type InspectorCockpitProps = CockpitInspectorProps;

type OpenRepositoryFileHandler = (path: string, options?: GitPanelOpenFileOptions) => void;

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
  mdPreviewByPath: Record<string, boolean>;
  setEditorTabMdPreview: (relativePath: string, value: boolean) => void;
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
      setEditorTabMdPreview: (relativePath, value) => {
        // hook 阶段 1 改为 (rootPath, relativePath, value)；按当前 tab 的 rootPath 注入。
        const rootPath = activeTab?.rootPath ?? repositoryPath ?? "";
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
  useEffect(() => {
    if (!editorVisible) {
      setCenterAuxPanelsNodeForPane(paneIndex, null);
      return;
    }
    setCenterAuxPanelsNodeForPane(
      paneIndex,
      <RepositoryFileEditorPanelContext.Provider value={panelContextValue}>
        <RepositoryFileEditorVisibilityContext.Provider value={true}>
          <ConnectedRepositoryFileEditorPanel dark={dark} />
        </RepositoryFileEditorVisibilityContext.Provider>
      </RepositoryFileEditorPanelContext.Provider>,
    );
    return () => {
      setCenterAuxPanelsNodeForPane(paneIndex, null);
    };
    // panelContextValue 在 editorVisible 变化时已重新计算；只依赖 editorVisible / dark 即可。
  }, [editorVisible, dark, paneIndex, setCenterAuxPanelsNodeForPane, panelContextValue]);

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
}

function connectedClaudeSessionsPropsEqual(
  prev: ConnectedClaudeSessionsProps,
  next: ConnectedClaudeSessionsProps,
): boolean {
  if (prev.mainLayoutContentRef !== next.mainLayoutContentRef) return false;
  if (prev.centerAuxPanelsNodeByPaneVersion !== next.centerAuxPanelsNodeByPaneVersion) return false;
  return claudeSessionsShellPropsEqual(prev.claudeSessionsProps, next.claudeSessionsProps);
}

const ConnectedClaudeSessions = memo(function ConnectedClaudeSessions({
  claudeSessionsProps,
  mainLayoutContentRef,
  centerAuxPanelsNodeByPane,
}: ConnectedClaudeSessionsProps) {
  const resolvePaneAuxLayout = useCallback(
    (paneIndex: number): PaneAuxLayout => {
      // 多 pane 下各 pane 独立判断自己是否挂文件编辑器；未挂时正常显示消息列表。
      const panel = centerAuxPanelsNodeByPane.get(paneIndex);
      if (panel == null) {
        return { hideMessages: false, hideSessionTools: false };
      }
      return {
        panelBelowMessages: panel,
        hideMessages: true,
        hideSessionTools: true,
      };
    },
    [centerAuxPanelsNodeByPane],
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
        hideTopbar={true}
      />
    </Layout.Content>
  );
}, connectedClaudeSessionsPropsEqual);

const ConnectedInspector = memo(function ConnectedInspector({
  viewMode,
  chatInspectorProps,
  cockpitInspectorProps,
}: {
  viewMode: ViewMode;
  chatInspectorProps: RightPanelProps;
  cockpitInspectorProps: InspectorCockpitProps;
}) {
  return (
    <MemoInspector
      viewMode={viewMode}
      chatInspectorProps={chatInspectorProps}
      cockpitInspectorProps={cockpitInspectorProps}
    />
  );
}, areInspectorShellPropsEqual);

const ConnectedRepositoryFileEditorPanel = memo(function ConnectedRepositoryFileEditorPanel({
  dark,
}: {
  dark: boolean;
}) {
  const openFile = useRepositoryFileEditorOpenFile();
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
      />
    </Suspense>
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
  /** 历史名 `rightPanelProps`，与 ChatInspector 的 props 一致。 */
  chatInspectorProps: RightPanelProps;
  /** Inspector 在 cockpit 模式下使用的 props（Mission 概览 + 子代理活动 + 活动仓库 Git）。 */
  cockpitInspectorProps: InspectorCockpitProps;
  /**
   * 右栏「仓库会话」面板所需的共享回调与上下文。
   * 由 AppImpl 组装（与中栏 `claudeSessionsProps` 同源的 session-id 参数化 handlers），
   * AppWorkspaceLayout 在此将其渲染为 `RepositorySessionPanel` 并注入 ChatInspector。
   */
  repositorySideSessionSharedProps: MultiPaneSharedChatProps;
  repositorySideSessionContext: {
    /** 默认配置 `showRightInspectorRepositorySession` 实时值；false 时右栏中部不渲染仓库会话面板。 */
    visible: boolean;
    sessionId: string | null;
    repository: Repository | null;
    onEnsureSession: () => void;
    onCreateNewSession: () => void;
  };
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
  effectiveRightCollapsed,
  mainLayoutContentRef,
  mainLayoutLeftWidthPx,
  mainLayoutRightWidthPx,
  leftSidebarProps,
  authorPanelProps,
  claudeSessionsProps,
  sessionsStructureKey,
  onOpenRemoteChannels,
  chatInspectorProps,
  cockpitInspectorProps,
  repositorySideSessionSharedProps,
  repositorySideSessionContext,
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
  onRightWidthChange,
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

  // 1 屏下把 PaneLocalButtons（运行 / 外部终端 / OpenAppMenu / FCC / 多屏切换 / 右栏）整体并入
  // 顶部 Topbar 右侧；多屏时各 pane 自管，slot 为 null（Topbar 改渲染多屏切换按钮）。
  // 无活动会话时 slot 为 null，Topbar 仍渲染窗口级控件 + 搜索 + 终端 + 多屏切换。
  // 依赖只用 id / path 标量，避免 `mainSessionForDataLink` / `activeRepository` 引用漂移触发 slot 重算。
  const paneLocalButtonsSlot = useMemo(() => {
    if ((claudeSessionsProps.paneCount ?? 1) !== 1) return null;
    const session = mainSessionForDataLink;
    if (!session) return null;
    const repository = claudeSessionsProps.activeRepository;
    const repositoryPath =
      repository?.path?.trim() || session.repositoryPath?.trim() || "";
    return (
      <Suspense fallback={null}>
        <LazyPaneLocalButtons
          session={session}
          repository={repository}
          repositoryPath={repositoryPath}
          paneCount={claudeSessionsProps.paneCount ?? 1}
          inTopbarContext
          onAutoFixRunError={claudeSessionsPropsRef.current.onAutoFixRunError}
          paneChangeInFlight={claudeSessionsPropsRef.current.paneChangeInFlight}
          onChangePaneCount={claudeSessionsPropsRef.current.onChangePaneCount}
          mainSessionForDataLink={mainSessionForDataLink}
          onSessionInsightsAiAnalysis={onSessionInsightsAiAnalysis}
          onDispatchSessionFeedbackLoop={claudeSessionsPropsRef.current.onDispatchSessionFeedbackLoop}
          getClaudeSessions={getClaudeSessionsForTopbar}
        />
      </Suspense>
    );
  }, [
    claudeSessionsProps.paneCount,
    claudeSessionsProps.paneChangeInFlight,
    mainSessionForDataLink?.id,
    claudeSessionsProps.activeRepository?.path,
    onSessionInsightsAiAnalysis,
    getClaudeSessionsForTopbar,
  ]);

  // 1 屏下右栏折叠/展开按钮单独放到 Topbar 最右；多屏或无活动会话时为 null（各 pane 自管）。
  const rightPanelToggleSlot = useMemo(() => {
    if ((claudeSessionsProps.paneCount ?? 1) !== 1) return null;
    if (!mainSessionForDataLink) return null;
    return (
      <Suspense fallback={null}>
        <LazyRightPanelToggleButton
          rightCollapsed={claudeSessionsProps.rightCollapsed}
          onToggleRightPanel={claudeSessionsPropsRef.current.onToggleRightPanel}
          rightPanelDefaultCollapsed={claudeSessionsProps.rightPanelDefaultCollapsed}
          onSetRightPanelDefaultCollapsed={claudeSessionsPropsRef.current.onSetRightPanelDefaultCollapsed}
        />
      </Suspense>
    );
  }, [
    claudeSessionsProps.paneCount,
    mainSessionForDataLink?.id,
    claudeSessionsProps.rightCollapsed,
    claudeSessionsProps.rightPanelDefaultCollapsed,
  ]);

  // 1 屏下顶部 Topbar 的 props（跨整宽，覆盖中栏 + 右栏）。多屏（paneCount>1）不再渲染
  // 单独的全局 Topbar 行，由各 pane 的 PaneLocalHeader 自管（窗口级控件只在 primary pane）。
  // 仅注入 TopbarProps 实际消费字段；多出的 `paneHeaderSharedProps` 字段不再下放到 Topbar，
  // 由 `ClaudeSessions` 通过 `claudeSessionsProps.paneHeaderSharedProps` 单独注入。
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
      paneLocalButtonsSlot,
      rightPanelToggleSlot,
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
      paneLocalButtonsSlot,
      rightPanelToggleSlot,
    ],
  );

  /** 多屏时每个 pane 自己 header 共用的回调聚合；下沉到 `ClaudeMultiPaneGrid` 经
   *  `MultiPaneSharedChatProps` 派发到每个 `<PaneLocalHeader />`。补全全局顶栏字段，
   *  使 primary pane 的 PaneLocalHeader 能渲染窗口级控件（侧栏 / 终端 / RemoteEntry / WorkspaceQuickActions）。
   *  此处是 `paneHeaderSharedProps` 的**唯一组装点**——`ClaudeSessions` 不再二次封装，
   *  避免 `ConnectedClaudeSessions` 必重渲。 */
  const paneHeaderSharedProps = useMemo<PaneLocalHeaderSharedProps>(
    () => ({
      onAutoFixRunError: claudeSessionsPropsRef.current.onAutoFixRunError,
      paneChangeInFlight: claudeSessionsPropsRef.current.paneChangeInFlight,
      onChangePaneCount: claudeSessionsPropsRef.current.onChangePaneCount,
      mainSessionForDataLink,
      onSessionInsightsAiAnalysis,
      onDispatchSessionFeedbackLoop: claudeSessionsPropsRef.current.onDispatchSessionFeedbackLoop,
      getClaudeSessions: getClaudeSessionsForTopbar,
      rightCollapsed: claudeSessionsProps.rightCollapsed,
      onToggleRightPanel: claudeSessionsPropsRef.current.onToggleRightPanel,
      rightPanelDefaultCollapsed: claudeSessionsProps.rightPanelDefaultCollapsed,
      onSetRightPanelDefaultCollapsed: claudeSessionsPropsRef.current.onSetRightPanelDefaultCollapsed,
      onToggleSidebar: claudeSessionsPropsRef.current.onToggleSidebar,
      onToggleTerminal: claudeSessionsPropsRef.current.onToggleTerminal,
      onSearch: claudeSessionsPropsRef.current.onSearch,
      collapsed: claudeSessionsProps.collapsed,
      fileTreeRailOpen: showWorkspaceFileTreeRail,
      terminalCollapsed: claudeSessionsProps.terminalCollapsed,
      terminalPanelMounted: claudeSessionsProps.terminalPanelMounted,
      onOpenRemoteChannels,
      activeProject: claudeSessionsProps.activeProject,
      activeWorkspaceFocus: claudeSessionsProps.activeWorkspaceFocus,
    }),
    [
      mainSessionForDataLink,
      claudeSessionsProps.paneChangeInFlight,
      onSessionInsightsAiAnalysis,
      claudeSessionsProps.rightCollapsed,
      claudeSessionsProps.rightPanelDefaultCollapsed,
      claudeSessionsProps.collapsed,
      showWorkspaceFileTreeRail,
      claudeSessionsProps.terminalCollapsed,
      claudeSessionsProps.terminalPanelMounted,
      claudeSessionsProps.activeProject,
      claudeSessionsProps.activeWorkspaceFocus,
      onOpenRemoteChannels,
    ],
  );

  /** 透传给 `<MemoClaudeSessions>` 的 props：原 `claudeSessionsProps` 与 `paneHeaderSharedProps` 合并。
   *  合并后 `ClaudeSessions` 内部不再二次组装 `paneHeaderSharedProps`，单源 `useMemo` 引用稳定。 */
  const claudeSessionsPropsWithHeader = useMemo<ClaudeSessionsProps>(
    () => ({
      ...claudeSessionsProps,
      paneHeaderSharedProps,
    }),
    [claudeSessionsProps, paneHeaderSharedProps],
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
  const [fileTreeOpenInNewPane, setFileTreeOpenInNewPane] = useState(false);

  const openRepositoryFileInPaneByRootPath = useCallback(
    (relativePath: string, options?: GitPanelOpenFileOptions) => {
      const rootPath = options?.fileRootPath?.trim() ?? "";
      const exactMatch =
        rootPath
          ? Array.from(paneEditorApisRef.current.entries()).find(
              ([, api]) => api.repositoryPath?.trim() === rootPath,
            )?.[1]
          : undefined;
      const targetByTarget =
        rootPath
          ? undefined
          : paneEditorApisRef.current.get(fileEditorTargetPaneIndex ?? 0);
      const target = exactMatch ?? targetByTarget;
      if (target) {
        target.openRepositoryFile(relativePath, options);
        return;
      }
      // 精确匹配失败：若 rootPath 非空，先入 pending 队列等目标 host mount 后消费
      // （`registerPaneEditor` 已处理），避免污染错 pane（pane 0）；不再回退到
      // primary host 是 bug 5-2 的关键修复。
      if (rootPath) {
        pendingFileOpensByRootRef.current.set(rootPath, { relativePath, options });
        // 同时往 primary host 也入一份「临时」：当多 pane 收紧到单 pane（paneCount
        // 从 2 变 1）时，原 pane 1 的 host 已 unmount，唯一剩下的 host[0] 的
        // repositoryPath 仍是 pane 0 repo — 与 rootPath 不匹配，但仍期望该请求不丢。
        // 此时启动一轮 retry：每 60ms 重试到 pending 队列被某 host 消费或超时 800ms。
        let attempts = 0;
        const retry = () => {
          attempts += 1;
          const pending = pendingFileOpensByRootRef.current.get(rootPath);
          if (!pending) return; // 已消费
          // 第一道：精确匹配（host mount 后会自然命中）。
          const hit = Array.from(paneEditorApisRef.current.entries()).find(
            ([, api]) => api.repositoryPath?.trim() === rootPath,
          )?.[1];
          if (hit) {
            pendingFileOpensByRootRef.current.delete(rootPath);
            hit.openRepositoryFile(pending.relativePath, pending.options);
            return;
          }
          // 第二道：放宽到 active repository 作为合理 fallback（仅 rootPath 非空
          // 且所有 pane 都没注册场景；典型：用户从 2 屏切回 1 屏且请求来自 pane 1）。
          if (attempts >= 12) {
            pendingFileOpensByRootRef.current.delete(rootPath);
            const fallback = paneEditorApisRef.current.get(0);
            if (fallback) {
              fallback.openRepositoryFile(pending.relativePath, pending.options);
              return;
            }
            message.warning("请先选择工作区或仓库");
            return;
          }
          window.setTimeout(retry, 60);
        };
        window.setTimeout(retry, 60);
        return;
      }
      // rootPath 为空：使用文件树「文件树新屏打开」路径（`openRepositoryFileWithPreference`
      // 在 `fileTreeOpenInNewPane` 分支显式 set target 后调用本函数）。
      const fallback = paneEditorApisRef.current.get(0);
      if (!fallback) {
        message.warning("请先选择工作区或仓库");
        return;
      }
      fallback.openRepositoryFile(relativePath, options);
    },
    [fileEditorTargetPaneIndex],
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
              openRepositoryFileInPaneByRootPath(relativePath, options);
              return;
            }
            await waitLayoutFrames(1);
          }
        }

        setFileEditorTargetPaneIndex(targetPaneIndex);
        openRepositoryFileInPaneByRootPath(relativePath, options);
        return;
      }

      if (fromFileTree && !fileTreeOpenInNewPane) {
        setFileEditorTargetPaneIndex(null);
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
      // extra pane 的仓库）。`openRepositoryFileInPaneByRootPath` 会按 `fileRootPath`
      // 在 `paneEditorApisRef` 中找对应 pane 的 host hook 实例调用，避免路由到
      // 错 pane。fallback 顺序：精确匹配 → fileEditorTargetPaneIndex → primary pane。
      // 上面的 `if (!request || !targetPath) return` 已保证 `request.repositoryPath` 非空。
      openRepositoryFileInPaneByRootPath(request.relativePath, {
        fileRootPath: request.repositoryPath ?? undefined,
        line: request.line ?? null,
        fromFileTree: true,
      });
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

  return (
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
                        <LazyTopbar {...topbarProps} />
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
                          <ConnectedClaudeSessions
                            claudeSessionsProps={claudeSessionsPropsWithHeader}
                            mainLayoutContentRef={mainLayoutContentRef}
                            centerAuxPanelsNodeByPane={centerAuxPanelsNodeByPane}
                            centerAuxPanelsNodeByPaneVersion={centerAuxPanelsNodeByPaneVersion}
                          />
                        </Suspense>
                      </ErrorBoundary>

                      {chatRightRailMode ? (
                        <>
                          <div
                            className={`app-right-panel-rail${
                              effectiveRightCollapsed ? " app-right-panel-rail--collapsed" : ""
                            }`}
                            aria-hidden={effectiveRightCollapsed}
                          >
                            <MainLayoutResizeHandle
                              variant="right"
                              startWidthPx={mainLayoutRightWidthPx}
                              onWidthChange={onRightWidthChange}
                            />
                          </div>
                          <div
                            className={`app-right-panel-rail__panel${
                              effectiveRightCollapsed ? " app-right-panel-rail__panel--collapsed" : ""
                            }`}
                            aria-hidden={effectiveRightCollapsed}
                          >
                            <Suspense fallback={null}>
                              <ErrorBoundary type="local" fallbackTitle="右侧属性检查器出错">
                                <ConnectedInspector
                                  viewMode={viewMode}
                                  chatInspectorProps={{
                                    ...chatInspectorProps,
                                    repositorySessionPanel:
                                      (viewMode.kind === "chat" || viewMode.kind === "inspect") &&
                                      repositorySideSessionContext.visible ? (
                                        <RepositorySessionPanel
                                          shared={repositorySideSessionSharedProps}
                                          sessionId={repositorySideSessionContext.sessionId}
                                          repository={repositorySideSessionContext.repository}
                                          onEnsureSession={repositorySideSessionContext.onEnsureSession}
                                          onCreateNewSession={repositorySideSessionContext.onCreateNewSession}
                                        />
                                      ) : null,
                                  }}
                                  cockpitInspectorProps={cockpitInspectorProps}
                                />
                              </ErrorBoundary>
                            </Suspense>
                          </div>
                        </>
                      ) : null}
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
  );
}
