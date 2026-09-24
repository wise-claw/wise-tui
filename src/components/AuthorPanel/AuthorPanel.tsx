import { Button, Empty, Input, Space, Spin } from "antd";
import {
  DeploymentUnitOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { AppShortcutsPopoverBody } from "../AppShortcutsPopoverBody";
import type { ArtifactsPanel as ArtifactsPanelComponent } from "../ArtifactsPanel";
import type { AssistantsPanel as AssistantsPanelComponent } from "../AssistantsPanel";
import type { AutomationPanel as AutomationPanelComponent } from "../AutomationPanel";
import type { ClaudeHooksConfigPanelHandle } from "../ClaudeHooksConfigPanel";
import { ClaudeSandboxHelpPopoverBody } from "../ClaudeSandboxHelpPopoverBody";
import type { EmployeeConfigModal as EmployeeConfigModalComponent } from "../EmployeeConfigModal";
import type { McpHub as McpHubComponent } from "../McpHub";
import { SettingsViewModeProvider } from "../SettingsView";
import type { SkillsHub as SkillsHubComponent } from "../SkillsHub";
import type { WorkflowConfigModal as WorkflowConfigModalComponent } from "../WorkflowConfigModal";
import { AUTHOR_TABS, type AuthorPane } from "./AuthorPanelTabs";
import { writeAuthorPaneToStorage } from "./authorPaneStorage";
import { AuthorPanelPageShell } from "./AuthorPanelPageShell";
import { WorkspacesTab } from "./tabs/WorkspacesTab";
import "./index.css";

// Only one pane is visible at a time; loading every pane (x6 canvas, plugin
// market, hooks editor, ...) up front made the first open of the
// configuration center pay for all of them.
const ArtifactsPanel = lazy(() =>
  import("../ArtifactsPanel").then((m) => ({ default: m.ArtifactsPanel })),
);
const AssistantsPanel = lazy(() =>
  import("../AssistantsPanel").then((m) => ({ default: m.AssistantsPanel })),
);
const AutomationPanel = lazy(() =>
  import("../AutomationPanel").then((m) => ({ default: m.AutomationPanel })),
);
const ChannelsPanel = lazy(() =>
  import("../ChannelsPanel").then((m) => ({ default: m.ChannelsPanel })),
);
const ClaudeHooksConfigPanel = lazy(() =>
  import("../ClaudeHooksConfigPanel").then((m) => ({ default: m.ClaudeHooksConfigPanel })),
);
const AutoApprovePanel = lazy(() =>
  import("../AutoApprovePanel").then((m) => ({ default: m.AutoApprovePanel })),
);
const CodeReviewSettingsPanel = lazy(() =>
  import("../CodeReviewSettingsPanel").then((m) => ({ default: m.CodeReviewSettingsPanel })),
);
const DataCleanupPanel = lazy(() =>
  import("../DataCleanupPanel").then((m) => ({ default: m.DataCleanupPanel })),
);
const DefaultConfigPanel = lazy(() =>
  import("../DefaultConfigPanel").then((m) => ({ default: m.DefaultConfigPanel })),
);
const AgentRegistrySection = lazy(() =>
  import("../ClaudeConfigDirPanel/AgentRegistrySection").then((m) => ({
    default: m.AgentRegistrySection,
  })),
);
const EmployeeConfigModal = lazy(() =>
  import("../EmployeeConfigModal").then((m) => ({ default: m.EmployeeConfigModal })),
);
const ExtensionsPanel = lazy(() =>
  import("../ExtensionsPanel").then((m) => ({ default: m.ExtensionsPanel })),
);
const MyExtensionsPanel = lazy(() =>
  import("../MyExtensionsPanel").then((m) => ({ default: m.MyExtensionsPanel })),
);
const ClaudePluginMarketHub = lazy(() =>
  import("../ClaudePluginMarketHub").then((m) => ({ default: m.ClaudePluginMarketHub })),
);
const McpHub = lazy(() => import("../McpHub").then((m) => ({ default: m.McpHub })));
const SkillsHub = lazy(() => import("../SkillsHub").then((m) => ({ default: m.SkillsHub })));
const AgentsExplorerPanel = lazy(() =>
  import("../AgentsExplorerPanel").then((m) => ({ default: m.AgentsExplorerPanel })),
);
const WorkflowConfigModal = lazy(() =>
  import("../WorkflowConfigModal").then((m) => ({ default: m.WorkflowConfigModal })),
);

const PANELS_WITH_OWN_SHELL = new Set<AuthorPane>([
  "workspaces",
  "extensions",
  "my-extensions",
  "assistants",
  "mcp",
  "skills",
  "agents-explorer",
  "claude-plugins",
  "hooks",
  "workflows",
  "channels",
  "automation",
  "artifacts",
  "engine-registry",
]);

type EmployeeConfigProps = ComponentProps<typeof EmployeeConfigModalComponent>;
type WorkflowConfigProps = ComponentProps<typeof WorkflowConfigModalComponent>;
type McpHubProps = ComponentProps<typeof McpHubComponent>;
type SkillsHubProps = ComponentProps<typeof SkillsHubComponent>;
type WorkspacesTabProps = ComponentProps<typeof WorkspacesTab>;
type AssistantsPanelProps = ComponentProps<typeof AssistantsPanelComponent>;

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
  automationPanelProps: ComponentProps<typeof AutomationPanelComponent>;
  artifactsPanelProps: ComponentProps<typeof ArtifactsPanelComponent>;
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
          <AuthorPanelPageShell
            icon={activeTab.icon}
            title={activeTab.label}
            subtitle={activeTab.description}
          >
            <EmployeeConfigModal {...employeeConfigProps} open inline />
          </AuthorPanelPageShell>
        ) : (
          <AuthorUnavailable label="席位" />
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
      case "agents-explorer":
        return <AgentsExplorerPanel repositoryPath={repositoryPath} onClose={undefined} />;
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
      case "code-review":
        return <CodeReviewSettingsPanel />;
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
        return (
          <AuthorPanelPageShell
            icon={activeTab.icon}
            title={activeTab.label}
            subtitle={activeTab.description}
          >
            <ClaudeSandboxHelpPopoverBody />
          </AuthorPanelPageShell>
        );
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
              : pane === "auto-approve"
                ? "author-panel-page--auto-approve"
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
            <Suspense fallback={<Spin size="small" />}>
              {wrappedContent ?? <Spin size="small" />}
            </Suspense>
          </div>
        </main>
      </div>
    </SettingsViewModeProvider>
  );
}

function AuthorUnavailable({ label }: { label: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${label} 在当前上下文不可用`} />;
}
