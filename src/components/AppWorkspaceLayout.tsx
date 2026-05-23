import {
  Suspense,
  createContext,
  lazy,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { App as AntdApp, ConfigProvider, Layout, Spin, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { AuthorPanel } from "./AuthorPanel/AuthorPanel";
import { AuthorPanelNav } from "./AuthorPanel/AuthorPanelNav";
import { ClaudeSessions, Topbar } from "./ClaudeSessions";
import { resolveWorkspaceMainSession } from "../utils/resolveWorkspaceMainSession";
import { CockpitOnboarding, type CockpitOnboardingProps } from "./Cockpit";
import {
  WorkspaceWelcomeLanding,
  type WorkspaceWelcomeLandingProps,
} from "./WorkspaceWelcomeLanding";
import { CommandPalette } from "./CommandPalette";
import type { GitPanelOpenFileOptions } from "./GitPanel";
import { type ChatInspectorProps, type CockpitInspectorProps } from "./Inspector";
import { LeftSidebar } from "./LeftSidebar";
import { MainLayoutResizeHandle } from "./MainLayoutResizeHandle";
import { McpHub } from "./McpHub";
import { ProgressMonitorDrawer } from "./ProgressMonitorDrawer";
import { RepositoryFileEditorPanel } from "./RepositoryFileEditorPanel";
import { RepositoryFilePreviewModal } from "./RepositoryFilePreviewModal";
import { SkillsHub } from "./SkillsHub";
import { AutomationPanel } from "./AutomationPanel";
import type * as PrdTaskSplitPanelModule from "./PrdTaskSplitPanel";
import { resolveCockpitHubPane, type InspectTool, type ViewMode } from "../types/viewMode";
import type { OpenRepositoryFileDetail } from "../constants/workflowUiEvents";
import { useRepositoryFileEditor } from "../hooks/useRepositoryFileEditor";

const Inspector = lazy(() => import("./Inspector").then((module) => ({ default: module.Inspector })));
const CockpitSurface = lazy(() =>
  import("./CockpitSurface").then((module) => ({ default: module.CockpitSurface })),
);
const RuntimeEventsInspector = lazy(() =>
  import("./Inspectors").then((m) => ({ default: m.RuntimeEventsInspector })),
);
const WorkflowGraphInspector = lazy(() =>
  import("./Inspectors").then((m) => ({ default: m.WorkflowGraphInspector })),
);
const SpecTimelineInspector = lazy(() =>
  import("./Inspectors").then((m) => ({ default: m.SpecTimelineInspector })),
);
const WiseCcWorkflowStudioPanel = lazy(() =>
  import("../features/cc-wf-studio/WiseCcWorkflowStudioPanel").then((m) => ({ default: m.WiseCcWorkflowStudioPanel })),
);
const LazyCodeKnowledgeGraphPanel = lazy(() =>
  import("./CodeKnowledgeGraph").then((m) => ({ default: m.CodeKnowledgeGraphPanel })),
);
type CodeKnowledgeGraphPanelProps = ComponentProps<typeof LazyCodeKnowledgeGraphPanel>;
const MemoLeftSidebar = memo(LeftSidebar);
const MemoClaudeSessions = memo(ClaudeSessions);
const MemoInspector = memo(Inspector);

type ClaudeSessionsProps = Omit<
  ComponentProps<typeof ClaudeSessions>,
  "panelBelowMessages" | "hideMessages" | "hideSessionTools"
>;
type LeftSidebarProps = Omit<
  ComponentProps<typeof LeftSidebar>,
  | "dark"
  | "collapsed"
  | "siderWidth"
  | "compactLayoutMode"
  | "onToggleCompactLayoutMode"
  | "onOpenActiveRepositoryFile"
>;
type AuthorPanelProps = ComponentProps<typeof AuthorPanel>;
type PrdTaskSplitPanelProps = ComponentProps<typeof PrdTaskSplitPanelModule.PrdTaskSplitPanel>;
type RightPanelProps = Omit<ChatInspectorProps, "onOpenFile">;
type InspectorCockpitProps = Omit<CockpitInspectorProps, "onOpenFile">;

type OpenRepositoryFileHandler = (path: string, options?: GitPanelOpenFileOptions) => void;

interface RepositoryFileEditorPanelContextValue {
  activePath: string | null;
  dirty: boolean;
  editorVisible: boolean;
  onActivePathChange: (path: string) => void;
  onClosePanel: () => void;
  onCloseTab: (relativePath: string, event?: ReactMouseEvent) => void;
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
  compactLayoutMode: boolean;
  dark: boolean;
  leftSidebarProps: LeftSidebarProps;
  onToggleCompactLayoutMode: () => void;
  parked: boolean;
  siderWidth: number;
}

const ConnectedLeftSidebar = memo(function ConnectedLeftSidebar({
  collapsed,
  compactLayoutMode,
  dark,
  leftSidebarProps,
  onToggleCompactLayoutMode,
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
      compactLayoutMode={compactLayoutMode}
      onToggleCompactLayoutMode={onToggleCompactLayoutMode}
      onOpenActiveRepositoryFile={openRepositoryFile}
    />
  );
});

interface ConnectedClaudeSessionsProps {
  claudeSessionsProps: ClaudeSessionsProps;
  mainLayoutContentRef: RefObject<HTMLElement | null>;
  panelBelowMessages: ReactNode;
}

const ConnectedClaudeSessions = memo(function ConnectedClaudeSessions({
  claudeSessionsProps,
  mainLayoutContentRef,
  panelBelowMessages,
}: ConnectedClaudeSessionsProps) {
  const editorVisible = useContext(RepositoryFileEditorVisibilityContext);
  return (
    <Layout.Content ref={mainLayoutContentRef} className="app-main-layout-content">
      <MemoClaudeSessions
        {...claudeSessionsProps}
        hideMessages={editorVisible}
        hideSessionTools={editorVisible}
        panelBelowMessages={panelBelowMessages}
        hideTopbar={true}
      />
    </Layout.Content>
  );
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
  const openRepositoryFile = useRepositoryFileEditorOpenFile();
  return (
    <MemoInspector
      viewMode={viewMode}
      chatInspectorProps={{ ...chatInspectorProps, onOpenFile: openRepositoryFile }}
      cockpitInspectorProps={{ ...cockpitInspectorProps, onOpenFile: openRepositoryFile }}
    />
  );
});

const ConnectedCodeKnowledgeGraphPanel = memo(function ConnectedCodeKnowledgeGraphPanel({
  codeKnowledgeGraphProps,
}: {
  codeKnowledgeGraphProps: CodeKnowledgeGraphPanelProps;
}) {
  const openRepositoryFile = useRepositoryFileEditorOpenFile();
  return (
    <LazyCodeKnowledgeGraphPanel
      {...codeKnowledgeGraphProps}
      onOpenRepositoryFile={(relativePath) => {
        openRepositoryFile(relativePath);
      }}
    />
  );
});

const ConnectedRepositoryFileEditorPanel = memo(function ConnectedRepositoryFileEditorPanel({
  dark,
}: {
  dark: boolean;
}) {
  const {
    activePath,
    dirty,
    editorVisible,
    onActivePathChange,
    onClosePanel,
    onCloseTab,
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
    <RepositoryFileEditorPanel
      activePath={activePath}
      dark={dark}
      dirty={dirty}
      repositoryPath={repositoryPath}
      saving={saving}
      tabs={tabs}
      onActivePathChange={onActivePathChange}
      onClosePanel={onClosePanel}
      onCloseTab={onCloseTab}
      onSave={onSave}
      onTabContentChange={onTabContentChange}
    />
  );
});

const ConnectedRepositoryFilePreviewModal = memo(function ConnectedRepositoryFilePreviewModal() {
  const { onClosePreview, preview } = useRepositoryFileEditorPanelContextValue();
  return <RepositoryFilePreviewModal preview={preview} onClose={onClosePreview} />;
});

export interface AppWorkspaceLayoutProps {
  activeRepositoryPath: string | null | undefined;
  dark: boolean;
  collapsed: boolean;
  /** 顶层 ViewMode；Inspector / 主屏分发 / 旧布尔判定都按它派发。 */
  viewMode: ViewMode;
  ccWfStudioSessionPath: string | null;
  onCloseCcWorkflowStudio: () => void;
  /** Stage 5 / E7：四个 Trellis Inspector 透镜统一通过 viewMode.back() 关闭。 */
  onCloseTrellisInspector: () => void;
  compactLayoutMode: boolean;
  effectiveRightCollapsed: boolean;
  mainLayoutContentRef: RefObject<HTMLElement | null>;
  mainLayoutLeftWidthPx: number;
  mainLayoutRightWidthPx: number;
  leftSidebarProps: LeftSidebarProps;
  authorPanelProps: AuthorPanelProps;
  claudeSessionsProps: ClaudeSessionsProps;
  /** 历史名 `rightPanelProps`，与 ChatInspector 的 props 一致。 */
  chatInspectorProps: RightPanelProps;
  /** Inspector 在 cockpit 模式下使用的 props（Mission 概览 + 子代理活动 + 活动仓库 Git）。 */
  cockpitInspectorProps: InspectorCockpitProps;
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
  /** 需求拆分助手全屏：收起左栏，主区仅展示 PRD 拆分面板 */
  cockpitPrdSplitFullscreen?: boolean;
  onCockpitActiveAssistantIdChange?: (assistantId: string | null) => void;
  commandPaletteProps: ComponentProps<typeof CommandPalette>;
  mcpHubProps: ComponentProps<typeof McpHub>;
  skillsHubProps: ComponentProps<typeof SkillsHub>;
  codeKnowledgeGraphProps: CodeKnowledgeGraphPanelProps;
  prdTaskSplitPanelProps: PrdTaskSplitPanelProps;
  progressMonitorDrawerProps: ComponentProps<typeof ProgressMonitorDrawer>;
  onToggleCompactLayoutMode: () => void;
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

type TrellisInspectorTool = Extract<
  InspectTool,
  { kind: "runtime-events" | "workflow-graph" | "spec-timeline" }
>;

function isTrellisInspectorTool(tool: InspectTool): tool is TrellisInspectorTool {
  return tool.kind === "runtime-events" || tool.kind === "workflow-graph" || tool.kind === "spec-timeline";
}

function TrellisInspectorOverlay({
  tool,
  onClose,
}: {
  tool: TrellisInspectorTool;
  onClose: () => void;
}) {
  switch (tool.kind) {
    case "runtime-events":
      return (
        <RuntimeEventsInspector
          rootPath={tool.rootPath}
          projectId={tool.projectId}
          onClose={onClose}
        />
      );
    case "workflow-graph":
      return (
        <WorkflowGraphInspector
          rootPath={tool.rootPath}
          projectId={tool.projectId}
          onClose={onClose}
        />
      );
    case "spec-timeline":
      return <SpecTimelineInspector rootPath={tool.rootPath} onClose={onClose} />;
  }
}

export function AppWorkspaceLayout({
  activeRepositoryPath,
  dark,
  collapsed,
  viewMode,
  ccWfStudioSessionPath,
  onCloseCcWorkflowStudio,
  onCloseTrellisInspector,
  compactLayoutMode,
  effectiveRightCollapsed,
  mainLayoutContentRef,
  mainLayoutLeftWidthPx,
  mainLayoutRightWidthPx,
  leftSidebarProps,
  authorPanelProps,
  claudeSessionsProps,
  chatInspectorProps,
  cockpitInspectorProps,
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
  cockpitPrdSplitFullscreen = false,
  onCockpitActiveAssistantIdChange,
  commandPaletteProps,
  mcpHubProps,
  skillsHubProps,
  codeKnowledgeGraphProps,
  prdTaskSplitPanelProps,
  progressMonitorDrawerProps,
  onToggleCompactLayoutMode,
  onLeftWidthChange,
  onRightWidthChange,
  onConsumeRepositoryFileOpenRequest,
  repositoryFileOpenRequest,
}: AppWorkspaceLayoutProps) {
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;

  const mainSessionForDataLink = useMemo(
    () =>
      resolveWorkspaceMainSession({
        sessions: claudeSessionsProps.sessions,
        bindings: claudeSessionsProps.repositoryMainBindings ?? {},
        repositories: claudeSessionsProps.repositories ?? [],
        activeRepository: claudeSessionsProps.activeRepository,
        activeProject: claudeSessionsProps.activeProject,
        activeWorkspaceFocus: claudeSessionsProps.activeWorkspaceFocus,
        activeSessionId: claudeSessionsProps.activeSessionId,
      }),
    [
      claudeSessionsProps.sessions,
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
  const mcpHubMode = viewMode.kind === "author" && viewMode.pane === "mcp";
  const skillsHubMode = viewMode.kind === "author" && viewMode.pane === "skills";
  const codeKnowledgeGraphMode =
    viewMode.kind === "inspect" && viewMode.tool.kind === "code-graph";
  const ccWfStudioMode =
    viewMode.kind === "inspect" && viewMode.tool.kind === "workflow-studio";
  const trellisInspectorTool =
    viewMode.kind === "inspect" && isTrellisInspectorTool(viewMode.tool)
      ? viewMode.tool
      : null;
  const chatRightRailMode = !authorMode && !missionControlMode;
  const leftSidebarParked = cockpitPrdSplitFullscreen;
  const [authorShellMounted, setAuthorShellMounted] = useState(authorMode);
  const [cockpitShellMounted, setCockpitShellMounted] = useState(missionControlMode);

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
    if (missionControlMode) setCockpitShellMounted(true);
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
    openRepositoryFile,
    repositoryBinaryPreview,
    saveEditor,
    setFileEditorActivePath,
    setFileEditorTabs,
  } = useRepositoryFileEditor({ repositoryPath: activeRepositoryPath });

  const handleFileEditorTabContentChange = useCallback(
    (relativePath: string, content: string) => {
      setFileEditorTabs((prev) =>
        prev.map((tab) => (tab.relativePath === relativePath ? { ...tab, content } : tab)),
      );
    },
    [setFileEditorTabs],
  );

  const editorPanelContextValue = useMemo<RepositoryFileEditorPanelContextValue>(
    () => ({
      activePath: fileEditorActivePath,
      dirty: editorDirty,
      editorVisible,
      onActivePathChange: setFileEditorActivePath,
      onClosePanel: closeFileEditorPanel,
      onClosePreview: closeRepositoryBinaryPreview,
      onCloseTab: closeFileEditorTab,
      onSave: () => {
        void saveEditor();
      },
      onTabContentChange: handleFileEditorTabContentChange,
      preview: repositoryBinaryPreview,
      repositoryPath: activeRepositoryPath,
      saving: editorSaving,
      tabs: fileEditorTabs,
    }),
    [
      activeRepositoryPath,
      closeFileEditorPanel,
      closeFileEditorTab,
      closeRepositoryBinaryPreview,
      editorDirty,
      editorSaving,
      editorVisible,
      fileEditorActivePath,
      fileEditorTabs,
      handleFileEditorTabContentChange,
      repositoryBinaryPreview,
      saveEditor,
      setFileEditorActivePath,
    ],
  );
  const editorPanelNode = useMemo(() => <ConnectedRepositoryFileEditorPanel dark={dark} />, [dark]);

  useEffect(() => {
    const request = repositoryFileOpenRequest;
    const repositoryPath = activeRepositoryPath?.trim() ?? "";
    const targetPath = request?.repositoryPath?.trim() ?? "";
    if (!request || !targetPath || !repositoryPath) return;
    if (repositoryPath !== targetPath) return;
    openRepositoryFile(request.relativePath, { line: request.line ?? null });
    onConsumeRepositoryFileOpenRequest();
  }, [activeRepositoryPath, onConsumeRepositoryFileOpenRequest, openRepositoryFile, repositoryFileOpenRequest]);

  return (
    <RepositoryFileEditorOpenFileContext.Provider value={openRepositoryFile}>
      <RepositoryFileEditorVisibilityContext.Provider value={editorVisible}>
        <RepositoryFileEditorPanelContext.Provider value={editorPanelContextValue}>
          <ConfigProvider
            locale={zhCN}
            theme={{
              algorithm,
              /** 代码图谱等叠层局部 z-index 较高，避免 Message 被盖住看不见 */
              components: {
                Message: { zIndexPopup: 20000 },
                Notification: { zIndexPopup: 20000 },
              },
            }}
          >
            <AntdApp>
              {workspaceWelcomeFullscreen && workspaceWelcomeProps ? (
                <div className="app-workspace-welcome-fullscreen">
                  <WorkspaceWelcomeLanding {...workspaceWelcomeProps} />
                </div>
              ) : null}
              <Layout
                className={`app-main-layout${authorMode ? " app-main-layout--author" : ""}${
                  cockpitPrdSplitFullscreen ? " app-main-layout--prd-split-fullscreen" : ""
                }${workspaceWelcomeFullscreen ? " app-main-layout--welcome-hidden" : ""}`}
                style={{ minWidth: 0, flex: 1, minHeight: 0, height: "100%" }}
              >
                {authorMode ? (
                  authorShellMounted ? (
                    <AuthorPanelNav
                      dark={dark}
                      collapsed={collapsed}
                      parked={false}
                      siderWidth={mainLayoutLeftWidthPx}
                      pane={authorPanelProps.pane}
                      onPaneChange={authorPanelProps.onPaneChange}
                      onBack={authorPanelProps.onBack}
                    />
                  ) : null
                ) : (
                  <ConnectedLeftSidebar
                    dark={dark}
                    collapsed={collapsed}
                    parked={leftSidebarParked}
                    siderWidth={mainLayoutLeftWidthPx}
                    compactLayoutMode={compactLayoutMode}
                    onToggleCompactLayoutMode={onToggleCompactLayoutMode}
                    leftSidebarProps={leftSidebarProps}
                  />
                )}

                {!leftSidebarParked && !collapsed ? (
                  <MainLayoutResizeHandle
                    variant="left"
                    startWidthPx={mainLayoutLeftWidthPx}
                    onWidthChange={onLeftWidthChange}
                  />
                ) : null}

                <div className="app-workspace-main">
                  <div
                    className={`app-main-chat-with-right-pane${
                      authorMode || missionControlMode ? " app-workspace-layer--parked" : ""
                    }`}
                  >
                    {chatRightRailMode && (
                      <Topbar
                        activeProject={claudeSessionsProps.activeProject}
                        activeWorkspaceFocus={claudeSessionsProps.activeWorkspaceFocus}
                        activeRepository={claudeSessionsProps.activeRepository}
                        activeSessionRepositoryPath={claudeSessionsProps.activeRepository?.path}
                        mainSessionForDataLink={mainSessionForDataLink}
                        onToggleSidebar={claudeSessionsProps.onToggleSidebar}
                        onToggleRightPanel={claudeSessionsProps.onToggleRightPanel}
                        rightPanelDefaultCollapsed={claudeSessionsProps.rightPanelDefaultCollapsed}
                        onSetRightPanelDefaultCollapsed={claudeSessionsProps.onSetRightPanelDefaultCollapsed}
                        onToggleTerminal={claudeSessionsProps.onToggleTerminal}
                        onSearch={claudeSessionsProps.onSearch}
                        collapsed={claudeSessionsProps.collapsed}
                        rightCollapsed={claudeSessionsProps.rightCollapsed}
                        terminalCollapsed={claudeSessionsProps.terminalCollapsed}
                        onAutoFixRunError={claudeSessionsProps.onAutoFixRunError}
                        dualPaneEnabled={claudeSessionsProps.dualPaneEnabled}
                        onToggleDualPane={claudeSessionsProps.onToggleDualPane}
                      />
                    )}

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
                      <ConnectedClaudeSessions
                        claudeSessionsProps={claudeSessionsProps}
                        mainLayoutContentRef={mainLayoutContentRef}
                        panelBelowMessages={editorPanelNode}
                      />

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
                              <ConnectedInspector
                                viewMode={viewMode}
                                chatInspectorProps={chatInspectorProps}
                                cockpitInspectorProps={cockpitInspectorProps}
                              />
                            </Suspense>
                          </div>
                        </>
                      ) : null}
                    </div>

                    <CommandPalette {...commandPaletteProps} />
                    {mcpHubMode ? (
                      <div className="app-mcp-hub-overlay" role="region" aria-label="MCP 管理">
                        <McpHub {...mcpHubProps} />
                      </div>
                    ) : null}
                    {skillsHubMode ? (
                      <div className="app-skills-hub-overlay" role="region" aria-label="skills.sh 技能目录">
                        <SkillsHub {...skillsHubProps} />
                      </div>
                    ) : null}
                    {codeKnowledgeGraphMode ? (
                      <div className="app-code-graph-overlay" role="region" aria-label="代码知识图谱">
                        <Suspense
                          fallback={
                            <div className="app-code-graph-lazy-fallback" aria-busy="true" aria-live="polite">
                              <Spin size="large" />
                            </div>
                          }
                        >
                          <ConnectedCodeKnowledgeGraphPanel codeKnowledgeGraphProps={codeKnowledgeGraphProps} />
                        </Suspense>
                      </div>
                    ) : null}
                    {trellisInspectorTool ? (
                      <Suspense fallback={null}>
                        <TrellisInspectorOverlay tool={trellisInspectorTool} onClose={onCloseTrellisInspector} />
                      </Suspense>
                    ) : null}
                    {ccWfStudioSessionPath ? (
                      <Suspense fallback={null}>
                        <WiseCcWorkflowStudioPanel
                          repositoryPath={ccWfStudioSessionPath}
                          overlayVisible={ccWfStudioMode}
                          onClose={onCloseCcWorkflowStudio}
                        />
                      </Suspense>
                    ) : null}
                  </div>

                  {cockpitShellMounted ? (
                    <div
                      className={`app-full-width-main app-cockpit-workspace-layer${
                        !missionControlMode ? " app-workspace-layer--parked" : ""
                      }${cockpitPrdSplitFullscreen ? " app-cockpit-workspace-layer--prd-split-fullscreen" : ""}`}
                    >
                      <Layout.Content className="app-main-layout-content">
                        {cockpitEmpty ? (
                          <CockpitOnboarding {...cockpitOnboardingProps} />
                        ) : cockpitHubPane === "mcp" ? (
                          <McpHub {...mcpHubProps} />
                        ) : cockpitHubPane === "skills" ? (
                          <SkillsHub {...skillsHubProps} />
                        ) : cockpitHubPane === "automation" ? (
                          <AutomationPanel {...authorPanelProps.automationPanelProps} />
                        ) : (
                          <Suspense fallback={<PanelLoadingFallback />}>
                            <CockpitSurface
                              activeProjectId={cockpitSurfaceActiveProjectId}
                              activeProjectName={cockpitSurfaceActiveProjectName}
                              hasInitialTarget={cockpitSurfaceHasInitialTarget}
                              initialAssistantId={cockpitSurfaceInitialAssistantId}
                              resumeAssistantId={cockpitSurfaceResumeAssistantId}
                              openRequestKey={cockpitSurfaceOpenRequestKey}
                              prdTaskSplitPanelProps={prdTaskSplitPanelProps}
                              onActiveAssistantIdChange={onCockpitActiveAssistantIdChange}
                            />
                          </Suspense>
                        )}
                      </Layout.Content>
                    </div>
                  ) : null}

                  {authorShellMounted ? (
                    <div
                      className={`app-full-width-main app-author-workspace-layer${!authorMode ? " app-workspace-layer--parked" : ""}`}
                    >
                      <AuthorPanel {...authorPanelProps} />
                    </div>
                  ) : null}
                </div>
              </Layout>

              <ConnectedRepositoryFilePreviewModal />

              <ProgressMonitorDrawer {...progressMonitorDrawerProps} />

            </AntdApp>
          </ConfigProvider>
        </RepositoryFileEditorPanelContext.Provider>
      </RepositoryFileEditorVisibilityContext.Provider>
    </RepositoryFileEditorOpenFileContext.Provider>
  );
}
