import {
  Suspense,
  createContext,
  lazy,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { App as AntdApp, ConfigProvider, Layout, Spin, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { AuthorPanel } from "./AuthorPanel";
import { ClaudeSessions } from "./ClaudeSessions";
import { CockpitOnboarding, type CockpitOnboardingProps } from "./Cockpit";
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
import type * as MissionControlModule from "./MissionControl";
import type * as PromptsPanelModule from "./PromptsPanel";
import type { ViewMode } from "../types/viewMode";
import type { OpenRepositoryFileDetail } from "../constants/workflowUiEvents";
import { useRepositoryFileEditor } from "../hooks/useRepositoryFileEditor";

const Inspector = lazy(() => import("./Inspector").then((module) => ({ default: module.Inspector })));
const MissionControl = lazy(() =>
  import("./MissionControl").then((module) => ({ default: module.MissionControl })),
);
const PromptsPanel = lazy(() => import("./PromptsPanel").then((module) => ({ default: module.PromptsPanel })));
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
type MissionControlProps = ComponentProps<typeof MissionControlModule.MissionControl>;
type PromptsPanelProps = ComponentProps<typeof PromptsPanelModule.PromptsPanel>;
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
  siderWidth: number;
}

const ConnectedLeftSidebar = memo(function ConnectedLeftSidebar({
  collapsed,
  compactLayoutMode,
  dark,
  leftSidebarProps,
  onToggleCompactLayoutMode,
  siderWidth,
}: ConnectedLeftSidebarProps) {
  const openRepositoryFile = useRepositoryFileEditorOpenFile();
  return (
    <MemoLeftSidebar
      {...leftSidebarProps}
      dark={dark}
      collapsed={collapsed}
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
  compactLayoutMode: boolean;
  effectiveRightCollapsed: boolean;
  mainLayoutContentRef: RefObject<HTMLElement | null>;
  mainLayoutLeftWidthPx: number;
  mainLayoutRightWidthPx: number;
  leftSidebarProps: LeftSidebarProps;
  authorPanelProps: AuthorPanelProps;
  promptsPanelProps: PromptsPanelProps;
  claudeSessionsProps: ClaudeSessionsProps;
  /** 历史名 `rightPanelProps`，与 ChatInspector 的 props 一致。 */
  chatInspectorProps: RightPanelProps;
  /** Inspector 在 cockpit 模式下使用的 props（Mission 概览 + 子代理活动 + 活动仓库 Git）。 */
  cockpitInspectorProps: InspectorCockpitProps;
  /** Cockpit 主屏空态：用户没有任何 Workspace / Standalone Repo 时引导创建。 */
  cockpitEmpty: boolean;
  cockpitOnboardingProps: CockpitOnboardingProps;
  commandPaletteProps: ComponentProps<typeof CommandPalette>;
  mcpHubProps: ComponentProps<typeof McpHub>;
  skillsHubProps: ComponentProps<typeof SkillsHub>;
  codeKnowledgeGraphProps: CodeKnowledgeGraphPanelProps;
  missionControlProps: MissionControlProps;
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

export function AppWorkspaceLayout({
  activeRepositoryPath,
  dark,
  collapsed,
  viewMode,
  ccWfStudioSessionPath,
  onCloseCcWorkflowStudio,
  compactLayoutMode,
  effectiveRightCollapsed,
  mainLayoutContentRef,
  mainLayoutLeftWidthPx,
  mainLayoutRightWidthPx,
  leftSidebarProps,
  authorPanelProps,
  promptsPanelProps,
  claudeSessionsProps,
  chatInspectorProps,
  cockpitInspectorProps,
  cockpitEmpty,
  cockpitOnboardingProps,
  commandPaletteProps,
  mcpHubProps,
  skillsHubProps,
  codeKnowledgeGraphProps,
  missionControlProps,
  progressMonitorDrawerProps,
  onToggleCompactLayoutMode,
  onLeftWidthChange,
  onRightWidthChange,
  onConsumeRepositoryFileOpenRequest,
  repositoryFileOpenRequest,
}: AppWorkspaceLayoutProps) {
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;

  /**
   * 旧布尔派生：本组件保留按 ViewMode 内部派生的旧布尔语义（与 P0 阶段
   * `viewMode.legacy.*` 完全等价），用于驱动主屏分支与叠层渲染。AppImpl 不再
   * 单独传 6 个布尔——这些纯粹是 ViewMode 上的语义投影。
   */
  const authorMode = viewMode.kind === "author";
  const missionControlMode = viewMode.kind === "cockpit";
  const promptsMode = viewMode.kind === "author" && viewMode.pane === "prompts";
  const mcpHubMode = viewMode.kind === "author" && viewMode.pane === "mcp";
  const skillsHubMode = viewMode.kind === "author" && viewMode.pane === "skills";
  const codeKnowledgeGraphMode =
    viewMode.kind === "inspect" && viewMode.tool.kind === "code-graph";
  const ccWfStudioMode =
    viewMode.kind === "inspect" && viewMode.tool.kind === "workflow-studio";

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
              <Layout className="app-main-layout" style={{ minWidth: 0, flex: 1, minHeight: 0, height: "100%" }}>
                <ConnectedLeftSidebar
                  dark={dark}
                  collapsed={collapsed}
                  siderWidth={mainLayoutLeftWidthPx}
                  compactLayoutMode={compactLayoutMode}
                  onToggleCompactLayoutMode={onToggleCompactLayoutMode}
                  leftSidebarProps={leftSidebarProps}
                />

                {!promptsMode && !authorMode && !collapsed ? (
                  <MainLayoutResizeHandle
                    variant="left"
                    startWidthPx={mainLayoutLeftWidthPx}
                    onWidthChange={onLeftWidthChange}
                  />
                ) : null}

                {authorMode ? (
                  <div className="app-full-width-main">
                    <AuthorPanel {...authorPanelProps} />
                  </div>
                ) : promptsMode ? (
                  <div className="app-full-width-main">
                    <Suspense fallback={<PanelLoadingFallback />}>
                      <PromptsPanel {...promptsPanelProps} />
                    </Suspense>
                  </div>
                ) : (
                  <div className="app-main-chat-with-right-pane">
                    {missionControlMode ? (
                      <Layout.Content ref={mainLayoutContentRef} className="app-main-layout-content">
                        {cockpitEmpty ? (
                          <CockpitOnboarding {...cockpitOnboardingProps} />
                        ) : (
                          <Suspense fallback={<PanelLoadingFallback />}>
                            <MissionControl {...missionControlProps} />
                          </Suspense>
                        )}
                      </Layout.Content>
                    ) : (
                      <ConnectedClaudeSessions
                        claudeSessionsProps={claudeSessionsProps}
                        mainLayoutContentRef={mainLayoutContentRef}
                        panelBelowMessages={editorPanelNode}
                      />
                    )}

                    {!effectiveRightCollapsed ? (
                      <MainLayoutResizeHandle
                        variant="right"
                        startWidthPx={mainLayoutRightWidthPx}
                        onWidthChange={onRightWidthChange}
                      />
                    ) : null}

                    <Suspense fallback={null}>
                      <ConnectedInspector
                        viewMode={viewMode}
                        chatInspectorProps={chatInspectorProps}
                        cockpitInspectorProps={cockpitInspectorProps}
                      />
                    </Suspense>

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
                )}
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
