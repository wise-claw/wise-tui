import { Button, Empty, Input, Space, Spin } from "antd";
import {
  DeploymentUnitOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { AppShortcutsPopoverBody } from "../AppShortcutsPopoverBody";
import { ArtifactsPanel } from "../ArtifactsPanel";
import { AssistantsPanel } from "../AssistantsPanel";
import { AutomationPanel } from "../AutomationPanel";
import { ChannelsPanel } from "../ChannelsPanel";
import { ClaudeHooksConfigPanel, type ClaudeHooksConfigPanelHandle } from "../ClaudeHooksConfigPanel";
import { AutoApprovePanel } from "../AutoApprovePanel";
import { DataCleanupPanel } from "../DataCleanupPanel";
import { DefaultConfigPanel } from "../DefaultConfigPanel";
import { AgentRegistrySection } from "../ClaudeConfigDirPanel/AgentRegistrySection";
import { ClaudeSandboxHelpPopoverBody } from "../ClaudeSandboxHelpPopoverBody";
import { EmployeeConfigModal } from "../EmployeeConfigModal";
import { ExtensionsPanel } from "../ExtensionsPanel";
import { MyExtensionsPanel } from "../MyExtensionsPanel";
import { ClaudePluginMarketHub } from "../ClaudePluginMarketHub";
import { McpHub } from "../McpHub";
import { SettingsViewModeProvider } from "../SettingsView";
import { SkillsHub } from "../SkillsHub";
import { WorkflowConfigModal } from "../WorkflowConfigModal";
import { AUTHOR_TABS, type AuthorPane } from "./AuthorPanelTabs";
import { writeAuthorPaneToStorage } from "./authorPaneStorage";
import { AuthorPanelPageShell } from "./AuthorPanelPageShell";
import { CursorSdkDiagnosticTab } from "./tabs/CursorSdkDiagnosticTab";
import { WorkspacesTab } from "./tabs/WorkspacesTab";
import "./index.css";

const PANELS_WITH_OWN_SHELL = new Set<AuthorPane>([
  "workspaces",
  "extensions",
  "my-extensions",
  "assistants",
  "mcp",
  "skills",
  "claude-plugins",
  "hooks",
  "workflows",
  "channels",
  "automation",
  "artifacts",
  "engine-registry",
  "cursor-sdk-diagnostic",
]);

type EmployeeConfigProps = ComponentProps<typeof EmployeeConfigModal>;
type WorkflowConfigProps = ComponentProps<typeof WorkflowConfigModal>;
type McpHubProps = ComponentProps<typeof McpHub>;
type SkillsHubProps = ComponentProps<typeof SkillsHub>;
type WorkspacesTabProps = ComponentProps<typeof WorkspacesTab>;
type AssistantsPanelProps = ComponentProps<typeof AssistantsPanel>;

export interface AuthorPanelProps {
  pane: AuthorPane;
  onPaneChange: (pane: AuthorPane) => void;
  onBack: () => void;
  workspacesTabProps: WorkspacesTabProps;
  employeeConfigProps: EmployeeConfigProps | null;
  workflowConfigProps: WorkflowConfigProps | null;
  mcpHubProps: McpHubProps;
  skillsHubProps: SkillsHubProps;
  assistantsPanelProps?: AssistantsPanelProps;
  repositoryPath?: string | null;
  automationPanelProps: ComponentProps<typeof AutomationPanel>;
  artifactsPanelProps: ComponentProps<typeof ArtifactsPanel>;
  workflowStudioAction?: ReactNode;
  /** 工作台配置主内容区是否在前台展示 */
  configLayerActive?: boolean;
}

export function AuthorPanel({
  pane,
  onPaneChange: _onPaneChange,
  onBack,
  workspacesTabProps,
  employeeConfigProps,
  workflowConfigProps,
  mcpHubProps,
  skillsHubProps,
  assistantsPanelProps,
  repositoryPath,
  automationPanelProps,
  artifactsPanelProps,
  workflowStudioAction,
  configLayerActive = true,
}: AuthorPanelProps) {
  const [hooksSearch, setHooksSearch] = useState("");
  const hooksPanelRef = useRef<ClaudeHooksConfigPanelHandle | null>(null);
  const activeTab = AUTHOR_TABS.find((item) => item.key === pane) ?? AUTHOR_TABS[0];
  const hooksRepositoryPath = repositoryPath?.trim() || undefined;

  useEffect(() => {
    writeAuthorPaneToStorage(pane);
  }, [pane]);

  const content = useMemo(() => {
    switch (pane) {
      case "workspaces":
        return <WorkspacesTab {...workspacesTabProps} />;
      case "agents":
        return employeeConfigProps ? (
          <EmployeeConfigModal {...employeeConfigProps} open inline />
        ) : (
          <AuthorUnavailable label="员工角色" />
        );
      case "workflows":
        return workflowConfigProps ? (
          <AuthorPanelPageShell
            icon={activeTab.icon}
            title={activeTab.label}
            subtitle={activeTab.description}
            actions={workflowStudioAction}
          >
            <div className="author-panel-workflows">
              <WorkflowConfigModal {...workflowConfigProps} open inline />
            </div>
          </AuthorPanelPageShell>
        ) : (
          <AuthorUnavailable label="委派协议" />
        );
      case "mcp":
        return <McpHub {...mcpHubProps} onClose={undefined} />;
      case "skills":
        return <SkillsHub {...skillsHubProps} onClose={undefined} />;
      case "claude-plugins":
        return <ClaudePluginMarketHub onClose={undefined} />;
      case "hooks":
        return (
          <AuthorPanelPageShell
            icon={activeTab.icon}
            title={activeTab.label}
            subtitle={activeTab.description}
            actions={
              <Space size={8} wrap>
                <Input
                  allowClear
                  size="small"
                  className="author-panel-hooks__search"
                  prefix={<SearchOutlined />}
                  placeholder="搜索事件、匹配器或处理器"
                  value={hooksSearch}
                  onChange={(event) => setHooksSearch(event.target.value)}
                />
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => void hooksPanelRef.current?.refresh()}
                >
                  刷新
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => hooksPanelRef.current?.openCreateModal()}
                >
                  新增触发器
                </Button>
                <Button
                  size="small"
                  icon={<DeploymentUnitOutlined />}
                  onClick={() => window.dispatchEvent(new CustomEvent("wise:open-hooks-flow"))}
                >
                  事件流程
                </Button>
              </Space>
            }
          >
            <div className="author-panel-hooks">
              <ClaudeHooksConfigPanel
                repositoryPath={hooksRepositoryPath}
                active
                listSearch={hooksSearch}
                onBindActions={(actions) => {
                  hooksPanelRef.current = actions;
                }}
              />
            </div>
          </AuthorPanelPageShell>
        );
      case "defaults":
        return <DefaultConfigPanel />;
      case "data-cleanup":
        return <DataCleanupPanel />;
      case "auto-approve":
        return <AutoApprovePanel />;
      case "my-extensions":
        return (
          <MyExtensionsPanel
            repositoryPath={repositoryPath}
            configLayerActive={configLayerActive}
          />
        );
      case "extensions":
        return <ExtensionsPanel />;
      case "assistants":
        return <AssistantsPanel {...assistantsPanelProps} />;
      case "engine-registry":
        return <AgentRegistrySection />;
      case "cursor-sdk-diagnostic":
        return (
          <AuthorPanelPageShell
            icon={activeTab.icon}
            title={activeTab.label}
            subtitle={activeTab.description}
            className="author-panel-page--cursor-sdk-diagnostic"
          >
            <CursorSdkDiagnosticTab repositoryPath={repositoryPath} />
          </AuthorPanelPageShell>
        );
      case "automation":
        return automationPanelProps ? (
          <AutomationPanel {...automationPanelProps} onClose={onBack} />
        ) : (
          <AuthorUnavailable label="定时自动化" />
        );
      case "artifacts":
        return artifactsPanelProps ? (
          <ArtifactsPanel {...artifactsPanelProps} />
        ) : (
          <AuthorUnavailable label="产物检查台" />
        );
      case "channels":
        return <ChannelsPanel />;
      case "shortcuts":
        return <AppShortcutsPopoverBody density="default" />;
      case "sandbox":
        return <ClaudeSandboxHelpPopoverBody />;
      default:
        return <AuthorUnavailable label="工作台配置" />;
    }
  }, [
    activeTab.description,
    activeTab.icon,
    activeTab.label,
    automationPanelProps,
    artifactsPanelProps,
    assistantsPanelProps,
    employeeConfigProps,
    hooksSearch,
    hooksRepositoryPath,
    mcpHubProps,
    onBack,
    pane,
    repositoryPath,
    skillsHubProps,
    workflowConfigProps,
    workflowStudioAction,
    workspacesTabProps,
    configLayerActive,
  ]);

  const wrappedContent =
    content && !PANELS_WITH_OWN_SHELL.has(pane) ? (
      <AuthorPanelPageShell
        icon={activeTab.icon}
        title={activeTab.label}
        subtitle={activeTab.description}
        className={
          pane === "defaults"
            ? "author-panel-page--default-config"
            : pane === "data-cleanup"
              ? "author-panel-page--data-cleanup"
              : undefined
        }
      >
        {content}
      </AuthorPanelPageShell>
    ) : (
      content
    );

  return (
    <SettingsViewModeProvider value="page">
      <div className="author-panel">
        <main
          className="author-panel__main author-panel__main--inline-page-head"
          aria-label={activeTab.label}
        >
          <div className="author-panel__scroll">
            {wrappedContent ?? <Spin size="small" />}
          </div>
        </main>
      </div>
    </SettingsViewModeProvider>
  );
}

function AuthorUnavailable({ label }: { label: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${label} 在当前上下文不可用`} />;
}
