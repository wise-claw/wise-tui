import {
  Suspense,
  createContext,
  lazy,
  memo,
  useCallback,
  useContext,
  useMemo,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { App as AntdApp, ConfigProvider, Layout, Spin, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { ClaudeSessions } from "./ClaudeSessions";
import { CommandPalette } from "./CommandPalette";
import { EmployeeConfigModal } from "./EmployeeConfigModal";
import type { GitPanelOpenFileOptions } from "./GitPanel";
import { LeftSidebar } from "./LeftSidebar";
import { MainLayoutResizeHandle } from "./MainLayoutResizeHandle";
import { McpHub } from "./McpHub";
import { ProgressMonitorDrawer } from "./ProgressMonitorDrawer";
import { RepositoryFileEditorPanel } from "./RepositoryFileEditorPanel";
import { RepositoryFilePreviewModal } from "./RepositoryFilePreviewModal";
import { SkillsHub } from "./SkillsHub";
import type * as PrdTaskSplitPanelModule from "./PrdTaskSplitPanel";
import type * as PromptsPanelModule from "./PromptsPanel";
import type * as RightPanelModule from "./RightPanel";
import type * as WorkflowConfigModalModule from "./WorkflowConfigModal";
import { useRepositoryFileEditor } from "../hooks/useRepositoryFileEditor";

const RightPanel = lazy(() => import("./RightPanel").then((module) => ({ default: module.RightPanel })));
const PrdTaskSplitPanel = lazy(() =>
  import("./PrdTaskSplitPanel").then((module) => ({ default: module.PrdTaskSplitPanel })),
);
const PromptsPanel = lazy(() => import("./PromptsPanel").then((module) => ({ default: module.PromptsPanel })));
const WorkflowConfigModal = lazy(() =>
  import("./WorkflowConfigModal").then((module) => ({ default: module.WorkflowConfigModal })),
);
const MemoLeftSidebar = memo(LeftSidebar);
const MemoClaudeSessions = memo(ClaudeSessions);
const MemoRightPanel = memo(RightPanel);

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
type PrdTaskSplitPanelProps = ComponentProps<typeof PrdTaskSplitPanelModule.PrdTaskSplitPanel>;
type PromptsPanelProps = ComponentProps<typeof PromptsPanelModule.PromptsPanel>;
type RightPanelProps = Omit<ComponentProps<typeof RightPanelModule.RightPanel>, "onOpenFile">;
type WorkflowConfigModalProps = ComponentProps<typeof WorkflowConfigModalModule.WorkflowConfigModal>;

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

const ConnectedRightPanel = memo(function ConnectedRightPanel({
  rightPanelProps,
}: {
  rightPanelProps: RightPanelProps;
}) {
  const openRepositoryFile = useRepositoryFileEditorOpenFile();
  return <MemoRightPanel {...rightPanelProps} onOpenFile={openRepositoryFile} />;
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
  promptsMode: boolean;
  taskSplitMode: boolean;
  taskPanelMode: boolean;
  mcpHubMode: boolean;
  skillsHubMode: boolean;
  compactLayoutMode: boolean;
  effectiveRightCollapsed: boolean;
  mainLayoutContentRef: RefObject<HTMLElement | null>;
  mainLayoutLeftWidthPx: number;
  mainLayoutRightWidthPx: number;
  leftSidebarProps: LeftSidebarProps;
  promptsPanelProps: PromptsPanelProps;
  claudeSessionsProps: ClaudeSessionsProps;
  rightPanelProps: RightPanelProps;
  commandPaletteProps: ComponentProps<typeof CommandPalette>;
  mcpHubProps: ComponentProps<typeof McpHub>;
  skillsHubProps: ComponentProps<typeof SkillsHub>;
  prdTaskSplitPanelProps: PrdTaskSplitPanelProps;
  progressMonitorDrawerProps: ComponentProps<typeof ProgressMonitorDrawer>;
  employeeConfigModalProps: ComponentProps<typeof EmployeeConfigModal> | null;
  workflowConfigModalProps: WorkflowConfigModalProps | null;
  onToggleCompactLayoutMode: () => void;
  onLeftWidthChange: (widthPx: number) => void;
  onRightWidthChange: (widthPx: number) => void;
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
  promptsMode,
  taskSplitMode,
  taskPanelMode,
  mcpHubMode,
  skillsHubMode,
  compactLayoutMode,
  effectiveRightCollapsed,
  mainLayoutContentRef,
  mainLayoutLeftWidthPx,
  mainLayoutRightWidthPx,
  leftSidebarProps,
  promptsPanelProps,
  claudeSessionsProps,
  rightPanelProps,
  commandPaletteProps,
  mcpHubProps,
  skillsHubProps,
  prdTaskSplitPanelProps,
  progressMonitorDrawerProps,
  employeeConfigModalProps,
  workflowConfigModalProps,
  onToggleCompactLayoutMode,
  onLeftWidthChange,
  onRightWidthChange,
}: AppWorkspaceLayoutProps) {
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;
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

  return (
    <RepositoryFileEditorOpenFileContext.Provider value={openRepositoryFile}>
      <RepositoryFileEditorVisibilityContext.Provider value={editorVisible}>
        <RepositoryFileEditorPanelContext.Provider value={editorPanelContextValue}>
          <ConfigProvider
            locale={zhCN}
            theme={{
              algorithm,
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

                {!promptsMode && !collapsed ? (
                  <MainLayoutResizeHandle
                    variant="left"
                    startWidthPx={mainLayoutLeftWidthPx}
                    onWidthChange={onLeftWidthChange}
                  />
                ) : null}

                {promptsMode ? (
                  <div className="app-full-width-main">
                    <Suspense fallback={<PanelLoadingFallback />}>
                      <PromptsPanel {...promptsPanelProps} />
                    </Suspense>
                  </div>
                ) : (
                  <div className="app-main-chat-with-right-pane">
                    <ConnectedClaudeSessions
                      claudeSessionsProps={claudeSessionsProps}
                      mainLayoutContentRef={mainLayoutContentRef}
                      panelBelowMessages={editorPanelNode}
                    />

                    {!effectiveRightCollapsed ? (
                      <MainLayoutResizeHandle
                        variant="right"
                        startWidthPx={mainLayoutRightWidthPx}
                        onWidthChange={onRightWidthChange}
                      />
                    ) : null}

                    <Suspense fallback={null}>
                      <ConnectedRightPanel rightPanelProps={rightPanelProps} />
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
                    {taskSplitMode ? (
                      <div className="app-task-split-overlay" role="dialog" aria-label="需求管理">
                        <Suspense fallback={<PanelLoadingFallback />}>
                          <PrdTaskSplitPanel {...prdTaskSplitPanelProps} />
                        </Suspense>
                      </div>
                    ) : null}
                  </div>
                )}
              </Layout>

              <ConnectedRepositoryFilePreviewModal />

              <ProgressMonitorDrawer {...progressMonitorDrawerProps} />

              {employeeConfigModalProps ? <EmployeeConfigModal {...employeeConfigModalProps} /> : null}
              {workflowConfigModalProps ? (
                <Suspense fallback={null}>
                  <WorkflowConfigModal {...workflowConfigModalProps} />
                </Suspense>
              ) : null}
            </AntdApp>
          </ConfigProvider>
        </RepositoryFileEditorPanelContext.Provider>
      </RepositoryFileEditorVisibilityContext.Provider>
    </RepositoryFileEditorOpenFileContext.Provider>
  );
}
