import { Suspense, lazy, type ComponentProps, type RefObject } from "react";
import { App as AntdApp, ConfigProvider, Drawer, Layout, Spin, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { ClaudeSessions } from "./ClaudeSessions";
import { CommandPalette } from "./CommandPalette";
import { EmployeeConfigModal } from "./EmployeeConfigModal";
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

const RightPanel = lazy(() => import("./RightPanel").then((module) => ({ default: module.RightPanel })));
const PrdTaskSplitPanel = lazy(() =>
  import("./PrdTaskSplitPanel").then((module) => ({ default: module.PrdTaskSplitPanel })),
);
const PromptsPanel = lazy(() => import("./PromptsPanel").then((module) => ({ default: module.PromptsPanel })));
const WorkflowConfigModal = lazy(() =>
  import("./WorkflowConfigModal").then((module) => ({ default: module.WorkflowConfigModal })),
);

type ClaudeSessionsProps = Omit<ComponentProps<typeof ClaudeSessions>, "panelBelowMessages">;
type LeftSidebarProps = Omit<
  ComponentProps<typeof LeftSidebar>,
  "dark" | "collapsed" | "siderWidth" | "compactLayoutMode" | "onToggleCompactLayoutMode"
>;
type PrdTaskSplitPanelProps = ComponentProps<typeof PrdTaskSplitPanelModule.PrdTaskSplitPanel>;
type PromptsPanelProps = ComponentProps<typeof PromptsPanelModule.PromptsPanel>;
type RightPanelProps = ComponentProps<typeof RightPanelModule.RightPanel>;
type WorkflowConfigModalProps = ComponentProps<typeof WorkflowConfigModalModule.WorkflowConfigModal>;

export interface AppWorkspaceLayoutProps {
  dark: boolean;
  collapsed: boolean;
  promptsMode: boolean;
  taskSplitMode: boolean;
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
  repositoryFileEditorPanelProps: ComponentProps<typeof RepositoryFileEditorPanel> | null;
  rightPanelProps: RightPanelProps;
  commandPaletteProps: ComponentProps<typeof CommandPalette>;
  mcpHubProps: ComponentProps<typeof McpHub>;
  skillsHubProps: ComponentProps<typeof SkillsHub>;
  prdTaskSplitPanelProps: PrdTaskSplitPanelProps;
  repositoryFilePreviewModalProps: ComponentProps<typeof RepositoryFilePreviewModal>;
  progressMonitorDrawerProps: ComponentProps<typeof ProgressMonitorDrawer>;
  employeeConfigModalProps: ComponentProps<typeof EmployeeConfigModal> | null;
  workflowConfigModalProps: WorkflowConfigModalProps | null;
  onToggleCompactLayoutMode: () => void;
  onLeftWidthChange: (widthPx: number) => void;
  onRightWidthChange: (widthPx: number) => void;
  onCloseTaskSplit: () => void;
}

function PanelLoadingFallback() {
  return (
    <div className="app-file-editor-loading">
      <Spin size="small" />
    </div>
  );
}

export function AppWorkspaceLayout({
  dark,
  collapsed,
  promptsMode,
  taskSplitMode,
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
  repositoryFileEditorPanelProps,
  rightPanelProps,
  commandPaletteProps,
  mcpHubProps,
  skillsHubProps,
  prdTaskSplitPanelProps,
  repositoryFilePreviewModalProps,
  progressMonitorDrawerProps,
  employeeConfigModalProps,
  workflowConfigModalProps,
  onToggleCompactLayoutMode,
  onLeftWidthChange,
  onRightWidthChange,
  onCloseTaskSplit,
}: AppWorkspaceLayoutProps) {
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm,
      }}
    >
      <AntdApp>
        <Layout className="app-main-layout" style={{ minWidth: 0, flex: 1, minHeight: 0, height: "100%" }}>
          <LeftSidebar
            {...leftSidebarProps}
            dark={dark}
            collapsed={collapsed}
            siderWidth={mainLayoutLeftWidthPx}
            compactLayoutMode={compactLayoutMode}
            onToggleCompactLayoutMode={onToggleCompactLayoutMode}
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
              <Layout.Content ref={mainLayoutContentRef} className="app-main-layout-content">
                <ClaudeSessions
                  {...claudeSessionsProps}
                  panelBelowMessages={
                    repositoryFileEditorPanelProps ? (
                      <RepositoryFileEditorPanel {...repositoryFileEditorPanelProps} />
                    ) : null
                  }
                />
              </Layout.Content>

              {!effectiveRightCollapsed ? (
                <MainLayoutResizeHandle
                  variant="right"
                  startWidthPx={mainLayoutRightWidthPx}
                  onWidthChange={onRightWidthChange}
                />
              ) : null}

              <Suspense fallback={null}>
                <RightPanel {...rightPanelProps} />
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
            </div>
          )}
          <Drawer
            open={taskSplitMode}
            onClose={onCloseTaskSplit}
            title={null}
            closable={false}
            placement="right"
            width="100vw"
            styles={{
              body: {
                height: "100vh",
                overflow: "hidden",
                padding: 0,
                display: "flex",
                flexDirection: "column",
              },
            }}
            destroyOnHidden={false}
            rootClassName="app-task-split-fullscreen-drawer"
          >
            <Suspense fallback={<PanelLoadingFallback />}>
              <PrdTaskSplitPanel {...prdTaskSplitPanelProps} />
            </Suspense>
          </Drawer>
        </Layout>

        <RepositoryFilePreviewModal {...repositoryFilePreviewModalProps} />

        <ProgressMonitorDrawer {...progressMonitorDrawerProps} />

        {employeeConfigModalProps ? <EmployeeConfigModal {...employeeConfigModalProps} /> : null}
        {workflowConfigModalProps ? (
          <Suspense fallback={null}>
            <WorkflowConfigModal {...workflowConfigModalProps} />
          </Suspense>
        ) : null}
      </AntdApp>
    </ConfigProvider>
  );
}
