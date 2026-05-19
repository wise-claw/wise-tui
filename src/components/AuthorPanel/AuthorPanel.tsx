import { Button, Empty, Input, Space, Spin, Typography } from "antd";
import {
  ArrowLeftOutlined,
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
import { ClaudeConfigDirPanel } from "../ClaudeConfigDirPanel";
import { AgentRegistrySection } from "../ClaudeConfigDirPanel/AgentRegistrySection";
import { ClaudeSandboxHelpPopoverBody } from "../ClaudeSandboxHelpPopoverBody";
import { EmployeeConfigModal } from "../EmployeeConfigModal";
import { ExtensionsPanel } from "../ExtensionsPanel";
import { McpHub } from "../McpHub";
import { ProjectTrellisCenter } from "../ProjectTrellisCenter";
import { PromptsPanel } from "../PromptsPanel";
import { SettingsViewModeProvider } from "../SettingsView";
import { SkillsHub } from "../SkillsHub";
import { WorkflowConfigModal } from "../WorkflowConfigModal";
import { getAppSetting, setAppSetting } from "../../services/appSettingsStore";
import { DEFAULT_AUTHOR_PANE } from "../../types/viewMode";
import {
  AUTHOR_TAB_GROUPS,
  AUTHOR_TAB_STORAGE_KEY,
  AUTHOR_TABS,
  isAuthorPane,
  type AuthorPane,
} from "./AuthorPanelTabs";
import { WorkspacesTab } from "./tabs/WorkspacesTab";
import "./index.css";

type EmployeeConfigProps = ComponentProps<typeof EmployeeConfigModal>;
type WorkflowConfigProps = ComponentProps<typeof WorkflowConfigModal>;
type PromptsPanelProps = ComponentProps<typeof PromptsPanel>;
type McpHubProps = ComponentProps<typeof McpHub>;
type SkillsHubProps = ComponentProps<typeof SkillsHub>;
type ProjectTrellisCenterProps = ComponentProps<typeof ProjectTrellisCenter>;
type WorkspacesTabProps = ComponentProps<typeof WorkspacesTab>;

export interface AuthorPanelProps {
  pane: AuthorPane;
  onPaneChange: (pane: AuthorPane) => void;
  onBack: () => void;
  workspacesTabProps: WorkspacesTabProps;
  employeeConfigProps: EmployeeConfigProps | null;
  workflowConfigProps: WorkflowConfigProps | null;
  mcpHubProps: McpHubProps;
  skillsHubProps: SkillsHubProps;
  promptsPanelProps: PromptsPanelProps;
  trellisSpecProps: ProjectTrellisCenterProps;
  repositoryPath?: string | null;
  automationPanelProps: ComponentProps<typeof AutomationPanel>;
  artifactsPanelProps: ComponentProps<typeof ArtifactsPanel>;
  workflowStudioAction?: ReactNode;
}

export function readAuthorPaneFromStorage(fallback: AuthorPane = DEFAULT_AUTHOR_PANE): AuthorPane {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(AUTHOR_TAB_STORAGE_KEY)?.trim() ?? "";
  return isAuthorPane(raw) ? raw : fallback;
}

export async function readAuthorPaneFromSettings(fallback: AuthorPane = DEFAULT_AUTHOR_PANE): Promise<AuthorPane> {
  const raw = (await getAppSetting(AUTHOR_TAB_STORAGE_KEY))?.trim() ?? "";
  return isAuthorPane(raw) ? raw : readAuthorPaneFromStorage(fallback);
}

export function writeAuthorPaneToStorage(pane: AuthorPane): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(AUTHOR_TAB_STORAGE_KEY, pane);
  }
  void setAppSetting(AUTHOR_TAB_STORAGE_KEY, pane).catch(() => {
    /* Last Author tab is a UI convenience; keep local fallback if settings write fails. */
  });
}

export function AuthorPanel({
  pane,
  onPaneChange,
  onBack,
  workspacesTabProps,
  employeeConfigProps,
  workflowConfigProps,
  mcpHubProps,
  skillsHubProps,
  promptsPanelProps,
  trellisSpecProps,
  repositoryPath,
  automationPanelProps,
  artifactsPanelProps,
  workflowStudioAction,
}: AuthorPanelProps) {
  const [hooksSearch, setHooksSearch] = useState("");
  const hooksPanelRef = useRef<ClaudeHooksConfigPanelHandle | null>(null);
  const activeTab = AUTHOR_TABS.find((item) => item.key === pane) ?? AUTHOR_TABS[0];
  const activeGroupTitle =
    AUTHOR_TAB_GROUPS.find((group) => group.items.some((item) => item.key === activeTab.key))?.title ?? "工作台";
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
          <AuthorUnavailable label="智能体角色" />
        );
      case "workflows":
        return workflowConfigProps ? (
          <div className="author-panel-workflows">
            {workflowStudioAction ? (
              <div className="author-panel-workflows__action">{workflowStudioAction}</div>
            ) : null}
            <WorkflowConfigModal {...workflowConfigProps} open inline />
          </div>
        ) : (
          <AuthorUnavailable label="委派协议" />
        );
      case "mcp":
        return <McpHub {...mcpHubProps} onClose={undefined} />;
      case "skills":
        return <SkillsHub {...skillsHubProps} onClose={undefined} />;
      case "hooks":
        return (
          <div className="author-panel-hooks">
            <div className="author-panel-hooks-toolbar">
              <Space size={8} wrap className="author-panel-hooks-toolbar__actions">
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
            </div>
            <ClaudeHooksConfigPanel
              repositoryPath={hooksRepositoryPath}
              active
              listSearch={hooksSearch}
              onBindActions={(actions) => {
                hooksPanelRef.current = actions;
              }}
            />
          </div>
        );
      case "prompts":
        return <PromptsPanel {...promptsPanelProps} />;
      case "trellis-spec":
        return <ProjectTrellisCenter {...trellisSpecProps} open inline onClose={undefined} />;
      case "claude-config":
        return <ClaudeConfigDirPanel />;
      case "extensions":
        return <ExtensionsPanel />;
      case "assistants":
        return <AssistantsPanel />;
      case "engine-registry":
        return <AgentRegistrySection />;
      case "automation":
        return <AutomationPanel {...automationPanelProps} />;
      case "artifacts":
        return <ArtifactsPanel {...artifactsPanelProps} />;
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
    automationPanelProps,
    artifactsPanelProps,
    employeeConfigProps,
    hooksSearch,
    hooksRepositoryPath,
    mcpHubProps,
    pane,
    promptsPanelProps,
    repositoryPath,
    skillsHubProps,
    trellisSpecProps,
    workflowConfigProps,
    workflowStudioAction,
    workspacesTabProps,
  ]);

  return (
    <SettingsViewModeProvider value="page">
      <div className="author-panel">
        <header className="author-panel__header">
          <Space size={8}>
            <Button size="small" icon={<ArrowLeftOutlined />} onClick={onBack}>
              返回
            </Button>
            <div>
              <Typography.Title level={4}>{activeTab.label}</Typography.Title>
              <Typography.Text type="secondary">
                {activeTab.description}
              </Typography.Text>
            </div>
          </Space>
          <Typography.Text type="secondary" className="author-panel__active-label">
            工作台配置 / {activeGroupTitle}
          </Typography.Text>
        </header>
        <div className="author-panel__body">
          <nav className="author-panel__tabs" aria-label="工作台配置导航">
            {AUTHOR_TAB_GROUPS.map((group) => (
              <div className="author-panel-tab-group" key={group.title}>
                <div className="author-panel-tab-group__title">{group.title}</div>
                {group.items.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`author-panel-tab${tab.key === pane ? " author-panel-tab--active" : ""}`}
                    onClick={() => onPaneChange(tab.key)}
                  >
                    <span className="author-panel-tab__icon" aria-hidden>
                      {tab.icon}
                    </span>
                    <span className="author-panel-tab__text">
                      <span className="author-panel-tab__label">{tab.label}</span>
                      <span className="author-panel-tab__description">{tab.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <main className="author-panel__content" aria-label={activeTab.label}>
            {content ?? <Spin size="small" />}
          </main>
        </div>
      </div>
    </SettingsViewModeProvider>
  );
}

function AuthorUnavailable({ label }: { label: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${label} 在当前上下文不可用`} />;
}
