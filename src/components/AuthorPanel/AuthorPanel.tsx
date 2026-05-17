import { Button, Empty, Input, Space, Spin, Typography } from "antd";
import { ArrowLeftOutlined, SearchOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { ClaudeHooksConfigPanel } from "../ClaudeHooksConfigPanel";
import { EmployeeConfigModal } from "../EmployeeConfigModal";
import { McpHub } from "../McpHub";
import { ProjectTrellisCenter } from "../ProjectTrellisCenter";
import { PromptsPanel } from "../PromptsPanel";
import { SkillsHub } from "../SkillsHub";
import { WorkflowConfigModal } from "../WorkflowConfigModal";
import { getAppSetting, setAppSetting } from "../../services/appSettingsStore";
import { AUTHOR_TAB_STORAGE_KEY, AUTHOR_TABS, isAuthorPane, type AuthorPane } from "./AuthorPanelTabs";
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
  workflowStudioAction?: ReactNode;
}

export function readAuthorPaneFromStorage(fallback: AuthorPane = "workspaces"): AuthorPane {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(AUTHOR_TAB_STORAGE_KEY)?.trim() ?? "";
  return isAuthorPane(raw) ? raw : fallback;
}

export async function readAuthorPaneFromSettings(fallback: AuthorPane = "workspaces"): Promise<AuthorPane> {
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
  workflowStudioAction,
}: AuthorPanelProps) {
  const [hooksSearch, setHooksSearch] = useState("");
  const activeTab = AUTHOR_TABS.find((item) => item.key === pane) ?? AUTHOR_TABS[0];

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
          <AuthorUnavailable label="Agents" />
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
          <AuthorUnavailable label="Workflows" />
        );
      case "mcp":
        return <McpHub {...mcpHubProps} onClose={undefined} />;
      case "skills":
        return <SkillsHub {...skillsHubProps} onClose={undefined} />;
      case "hooks":
        return (
          <div className="author-panel-hooks">
            <div className="author-panel-section-header author-panel-section-header--compact">
              <div>
                <Typography.Title level={5}>Hooks</Typography.Title>
                <Typography.Text type="secondary">
                  Manage Claude hook scopes for the current repository context.
                </Typography.Text>
              </div>
              <Input
                allowClear
                size="small"
                className="author-panel-hooks__search"
                prefix={<SearchOutlined />}
                placeholder="Search event, matcher, handler"
                value={hooksSearch}
                onChange={(event) => setHooksSearch(event.target.value)}
              />
            </div>
            <ClaudeHooksConfigPanel
              repositoryPath={repositoryPath?.trim() || undefined}
              active
              listSearch={hooksSearch}
            />
          </div>
        );
      case "prompts":
        return <PromptsPanel {...promptsPanelProps} />;
      case "trellis-spec":
        return <ProjectTrellisCenter {...trellisSpecProps} open inline onClose={undefined} />;
      default:
        return <AuthorUnavailable label="Author" />;
    }
  }, [
    employeeConfigProps,
    hooksSearch,
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
    <div className="author-panel">
      <header className="author-panel__header">
        <Space size={8}>
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={onBack}>
            Back
          </Button>
          <div>
            <Typography.Title level={4}>Author</Typography.Title>
            <Typography.Text type="secondary">
              Configure the contracts that future Mission runs depend on.
            </Typography.Text>
          </div>
        </Space>
        <Typography.Text type="secondary" className="author-panel__active-label">
          {activeTab.label}
        </Typography.Text>
      </header>
      <div className="author-panel__body">
        <nav className="author-panel__tabs" aria-label="Author navigation">
          {AUTHOR_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`author-panel-tab${tab.key === pane ? " author-panel-tab--active" : ""}`}
              onClick={() => onPaneChange(tab.key)}
            >
              <span className="author-panel-tab__icon" aria-hidden>
                {tab.icon}
              </span>
              <span className="author-panel-tab__label">{tab.label}</span>
            </button>
          ))}
        </nav>
        <main className="author-panel__content" aria-label={activeTab.label}>
          {content ?? <Spin size="small" />}
        </main>
      </div>
    </div>
  );
}

function AuthorUnavailable({ label }: { label: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${label} is not available in this context`} />;
}
