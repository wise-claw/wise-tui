import { Button, Space, Tag, Tooltip, Typography } from "antd";
import {
  ApiOutlined,
  ApartmentOutlined,
  BranchesOutlined,
  CodeOutlined,
  FileSearchOutlined,
  FundProjectionScreenOutlined,
  MessageOutlined,
  ProjectOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import type {
  MissionWorkspaceAction,
  MissionWorkspaceActionTarget,
} from "../contextTarget";

interface MissionContextSwitchboardProps {
  target: MissionWorkspaceActionTarget;
  onAction?: (action: MissionWorkspaceAction, target: MissionWorkspaceActionTarget) => void;
  showEngineeringAction?: boolean;
}

export function MissionContextSwitchboard({
  target,
  onAction,
  showEngineeringAction = true,
}: MissionContextSwitchboardProps) {
  if (!target.projectId && target.repositoryIds.length === 0) {
    return null;
  }

  const hasRepository = target.primaryRepositoryId != null || target.repositoryIds.length > 0;
  const hasProject = Boolean(target.projectId);
  const hasWorkflow = Boolean(target.workflowId);
  const hasMonitorTarget = hasWorkflow || Boolean(target.selectedTaskId);
  const hasCodeAnchor = Boolean(target.selectedCodeAnchor?.filePath.trim());

  return (
    <section className="mission-context-switchboard" aria-label="Mission context switchboard">
      <div className="mission-context-switchboard__scope">
        <Space size={6} wrap>
          <Tag icon={<ProjectOutlined />}>{target.projectName || "Mission"}</Tag>
          {target.repositoryIds.length > 0 ? (
            <Tag>{target.repositoryIds.length} repos</Tag>
          ) : null}
          {target.selectedRequirementId ? (
            <Tag color="blue">Req {target.selectedRequirementId}</Tag>
          ) : null}
          {target.selectedTaskId ? (
            <Tag color="purple">Task {target.selectedTaskId}</Tag>
          ) : null}
        </Space>
        <Typography.Text className="mission-context-switchboard__path" title={target.rootPath}>
          {target.rootPath || "No project root"}
        </Typography.Text>
      </div>

      <Space size={6} wrap className="mission-context-switchboard__actions">
        <SwitchboardButton
          action="claude-session"
          icon={<MessageOutlined />}
          label="Main Session"
          disabled={!hasRepository && !target.rootPath}
          target={target}
          onAction={onAction}
        />
        <SwitchboardButton
          action="code-graph"
          icon={<CodeOutlined />}
          label="Code Graph"
          disabled={!hasRepository}
          target={target}
          onAction={onAction}
        />
        <SwitchboardButton
          action="workflow-config"
          icon={<ApartmentOutlined />}
          label="Workflow"
          disabled={!hasProject && !hasWorkflow}
          target={target}
          onAction={onAction}
        />
        <SwitchboardButton
          action="progress-monitor"
          icon={<FundProjectionScreenOutlined />}
          label="Monitor"
          disabled={!hasMonitorTarget}
          disabledTitle="Available after task or workflow context exists"
          target={target}
          onAction={onAction}
        />
        <SwitchboardButton
          action="prompts"
          icon={<BranchesOutlined />}
          label="Prompts"
          disabled={!hasProject}
          target={target}
          onAction={onAction}
        />
        <SwitchboardButton
          action="mcp-hub"
          icon={<ApiOutlined />}
          label="MCP"
          disabled={!hasRepository}
          target={target}
          onAction={onAction}
        />
        <SwitchboardButton
          action="skills-hub"
          icon={<SafetyCertificateOutlined />}
          label="Skills"
          disabled={!hasRepository}
          target={target}
          onAction={onAction}
        />
        <SwitchboardButton
          action="code-anchor"
          icon={<FileSearchOutlined />}
          label="Open Anchor"
          disabled={!hasCodeAnchor}
          disabledTitle="Select a task with a code anchor"
          target={target}
          onAction={onAction}
        />
        {showEngineeringAction ? (
          <SwitchboardButton
            action="engineering"
            icon={<ToolOutlined />}
            label="Diagnostics"
            target={target}
            onAction={onAction}
          />
        ) : null}
      </Space>
    </section>
  );
}

interface SwitchboardButtonProps {
  action: MissionWorkspaceAction;
  disabled?: boolean;
  disabledTitle?: string;
  icon: ReactNode;
  label: string;
  target: MissionWorkspaceActionTarget;
  onAction?: (action: MissionWorkspaceAction, target: MissionWorkspaceActionTarget) => void;
}

function SwitchboardButton({
  action,
  disabled = false,
  disabledTitle,
  icon,
  label,
  target,
  onAction,
}: SwitchboardButtonProps) {
  return (
    <Tooltip title={disabled ? disabledTitle : label} mouseEnterDelay={0.35}>
      <Button
        size="small"
        icon={icon}
        disabled={disabled || !onAction}
        onClick={() => onAction?.(action, target)}
      >
        {label}
      </Button>
    </Tooltip>
  );
}
