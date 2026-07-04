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
import { App as AntdApp, ConfigProvider, Layout, Spin, theme } from "antd";
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
import type { PaneAuxLayout } from "./ClaudeSessions/paneAuxLayout";
import { waitLayoutFrames } from "../services/mainWindowLayout";
import type { EmployeeItem, Repository, WorkflowGraph, WorkflowTemplateItem } from "../types";
import { resolveCockpitHubPane, type ViewMode } from "../types/viewMode";
import { AUTHOR_CONFIG_NAV_SIDER_WIDTH_PX } from "../constants/mainLayoutWidths";
import { dispatchRepositoryFileEditorClosed, type OpenRepositoryFileDetail } from "../constants/workflowUiEvents";
import { requestExplorerFocus } from "../constants/explorerUiEvents";
import { writePendingExplorerReveal } from "../utils/pendingExplorerReveal";
import { resolveExplorerRevealTargetForOpen, resolveVisibleExplorerRevealTarget } from "../utils/explorerRevealTarget";
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
}

const RepositoryFileEditorOpenFileContext = createContext<OpenRepositoryFileHandler | null>(null);
const RepositoryFileEditorVisibilityContext = createContext(false);
const RepositoryFileEditorPanelContext = createContext<RepositoryFileEditorPanelContextValue | null>(null);

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
  centerAuxPanelsNode: ReactNode;
  fileEditorTargetPaneIndex: number | null;
}

function connectedClaudeSessionsPropsEqual(
  prev: ConnectedClaudeSessionsProps,
  next: ConnectedClaudeSessionsProps,
): boolean {
  if (prev.mainLayoutContentRef !== next.mainLayoutContentRef) return false;
  if (prev.centerAuxPanelsNode !== next.centerAuxPanelsNode) return false;
  if (prev.fileEditorTargetPaneIndex !== next.fileEditorTargetPaneIndex) return false;
  return claudeSessionsShellPropsEqual(prev.claudeSessionsProps, next.claudeSessionsProps);
}

const ConnectedClaudeSessions = memo(function ConnectedClaudeSessions({
  claudeSessionsProps,
  mainLayoutContentRef,
  centerAuxPanelsNode,
  fileEditorTargetPaneIndex,
}: ConnectedClaudeSessionsProps) {
  const fileEditorVisible = useContext(RepositoryFileEditorVisibilityContext);

  const resolvePaneAuxLayout = useCallback(
    (paneIndex: number): PaneAuxLayout => {
      if (!fileEditorVisible) {
        return { hideMessages: false, hideSessionTools: false };
      }
      if (fileEditorTargetPaneIndex != null) {
        const isTarget = paneIndex === fileEditorTargetPaneIndex;
        return {
          panelBelowMessages: isTarget ? centerAuxPanelsNode : undefined,
          hideMessages: isTarget,
          hideSessionTools: isTarget,
        };
      }
      // 文件编辑器默认落在主窗格；其它多屏窗格须保留消息列表，避免输入区被顶到列顶。
      const isPrimaryAuxPane = paneIndex === 0;
      return {
        panelBelowMessages: isPrimaryAuxPane ? centerAuxPanelsNode : undefined,
        hideMessages: isPrimaryAuxPane,
        hideSessionTools: isPrimaryAuxPane,
      };
    },
    [centerAuxPanelsNode, fileEditorTargetPaneIndex, fileEditorVisible],
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

const ConnectedCenterAuxPanels = memo(function ConnectedCenterAuxPanels({
  fileEditorNode,
}: {
  fileEditorNode: ReactNode;
}) {
  const fileEditorVisible = useContext(RepositoryFileEditorVisibilityContext);
  if (!fileEditorVisible) {
    return null;
  }
  return <div className="app-center-aux-panels">{fileEditorNode}</div>;
});

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
  const { onClosePreview, preview } = useRepositoryFileEditorPanelContextValue();
  return <LazyRepositoryFilePreviewModal preview={preview} onClose={onClosePreview} />;
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
  } = useRepositoryFileEditor({ repositoryPath: activeRepositoryPath });

  const [fileTreeOpenInNewPane, setFileTreeOpenInNewPane] = useState(false);
  const [fileEditorTargetPaneIndex, setFileEditorTargetPaneIndex] = useState<number | null>(null);
  const prevEditorVisibleRef = useRef(false);

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

  useEffect(() => {
    if (prevEditorVisibleRef.current && !editorVisible) {
      setFileEditorTargetPaneIndex(null);
      dispatchRepositoryFileEditorClosed();
    }
    prevEditorVisibleRef.current = editorVisible;
  }, [editorVisible]);

  const openRepositoryFileWithPreference = useCallback(
    async (relativePath: string, options?: GitPanelOpenFileOptions) => {
      const fromFileTree = options?.fromFileTree === true;
      const plainFile = isPlainRepositoryFileOpen(options);
      if (fromFileTree && fileTreeOpenInNewPane && plainFile) {
        const currentPaneCount = claudeSessionsProps.paneCount ?? 1;
        let targetPaneIndex = fileEditorTargetPaneIndex;
        const needsNewTarget =
          targetPaneIndex == null ||
          !editorVisible ||
          targetPaneIndex >= currentPaneCount;

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
              openRepositoryFile(relativePath, options);
              return;
            }
            await waitLayoutFrames(1);
          }
        }

        setFileEditorTargetPaneIndex(targetPaneIndex);
        openRepositoryFile(relativePath, options);
        return;
      }

      if (fromFileTree && !fileTreeOpenInNewPane) {
        setFileEditorTargetPaneIndex(null);
      }
      openRepositoryFile(relativePath, options);
    },
    [
      claudeSessionsProps.extraPanes,
      claudeSessionsProps.onChangePaneCount,
      claudeSessionsProps.paneCount,
      editorVisible,
      fileEditorTargetPaneIndex,
      fileTreeOpenInNewPane,
      openRepositoryFile,
    ],
  );

  const handleFileEditorTabContentChange = updateFileEditorTabContent;

  /** 切换编辑器 Tab 时让文件树跟随定位到该文件。仅当文件树已可见时才触发，不强制展开侧栏。 */
  const handleActivePathChange = useCallback(
    (path: string) => {
      setFileEditorActivePath(path);
      if (!path || !activeRepositoryPath?.trim()) return;
      const revealTarget = resolveVisibleExplorerRevealTarget({
        workspaceFileTreeRailOpen: showWorkspaceFileTreeRail,
        filesPanelPlacement: leftSidebarProps.filesPanelPlacement ?? "left",
        gitPanelPlacement: leftSidebarProps.gitPanelPlacement ?? "left",
        leftSidebarCollapsed: collapsed,
        leftSidebarParked,
        rightRailAvailable: chatRightRailMode,
      });
      if (!revealTarget) return;
      writePendingExplorerReveal({
        repositoryPath: activeRepositoryPath.trim(),
        relativePath: path,
        isDirectory: false,
        revealTarget,
      });
    },
    [
      setFileEditorActivePath,
      activeRepositoryPath,
      showWorkspaceFileTreeRail,
      leftSidebarProps.filesPanelPlacement,
      leftSidebarProps.gitPanelPlacement,
      collapsed,
      chatRightRailMode,
    ],
  );

  const editorPanelContextValue = useMemo<RepositoryFileEditorPanelContextValue>(
    () => ({
      activePath: fileEditorActivePath,
      activeSessionId: claudeSessionsProps.activeSessionId,
      dirty: editorDirty,
      editorVisible,
      mdPreviewByPath,
      setEditorTabMdPreview,
      onActivePathChange: handleActivePathChange,
      onClosePanel: closeFileEditorPanel,
      onClosePreview: closeRepositoryBinaryPreview,
      onCloseTab: closeFileEditorTab,
      onReloadTab: (relativePath: string) => {
        void reloadEditorTabFromDisk(relativePath);
      },
      onSave: () => {
        void saveEditor();
      },
      onTabContentChange: handleFileEditorTabContentChange,
      preview: repositoryBinaryPreview,
      repositoryPath:
        fileEditorTabs.find((tab) => tab.relativePath === fileEditorActivePath)?.rootPath ??
        activeRepositoryPath,
      saving: editorSaving,
      tabs: fileEditorTabs,
    }),
    [
      activeRepositoryPath,
      claudeSessionsProps.activeSessionId,
      closeFileEditorPanel,
      closeFileEditorTab,
      closeRepositoryBinaryPreview,
      editorDirty,
      editorSaving,
      editorVisible,
      fileEditorActivePath,
      fileEditorTabs,
      handleFileEditorTabContentChange,
      mdPreviewByPath,
      reloadEditorTabFromDisk,
      repositoryBinaryPreview,
      saveEditor,
      setEditorTabMdPreview,
      handleActivePathChange,
    ],
  );
  const editorPanelNode = useMemo(() => <ConnectedRepositoryFileEditorPanel dark={dark} />, [dark]);
  const centerAuxPanelsNode = useMemo(
    () => <ConnectedCenterAuxPanels fileEditorNode={editorPanelNode} />,
    [editorPanelNode],
  );

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
      // extra pane 的仓库）。必须作为 `fileRootPath` 传给 hook，否则 `useRepositoryFileEditor`
      // 内的 `loadEditorFile` 会 fallback 到 hook 默认的 `activeRepository.path`（primary pane
      // 仓库），导致"编辑器面板路由到正确 pane，但磁盘读的是别仓的文件"——典型表现是
      // 第二屏打开的是第一屏仓库的文件。
      openRepositoryFile(request.relativePath, {
        fileRootPath: request.repositoryPath,
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
    openRepositoryFile,
    repositoryFileOpenRequest,
    setFileEditorTargetPaneIndex,
    setFileTreeRailOpen,
    showWorkspaceFileTreeRail,
  ]);

  return (
    <RepositoryFileEditorOpenFileContext.Provider value={openRepositoryFileWithPreference}>
      <RepositoryFileEditorVisibilityContext.Provider value={editorVisible}>
        <RepositoryFileEditorPanelContext.Provider value={editorPanelContextValue}>
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
                            centerAuxPanelsNode={centerAuxPanelsNode}
                            fileEditorTargetPaneIndex={fileEditorTargetPaneIndex}
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
          </RepositoryFileEditorPanelContext.Provider>
        </RepositoryFileEditorVisibilityContext.Provider>
      </RepositoryFileEditorOpenFileContext.Provider>
  );
}
