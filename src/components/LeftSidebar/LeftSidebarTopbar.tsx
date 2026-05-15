import { Tooltip } from "antd";
import { ClaudeCodeUsageHeaderBtn } from "../ClaudeCodeUsagePopover";
import { IconSettings } from "../icons/IconSettings";
import {
  CodeKnowledgeGraphNavIcon,
  IconCompactLayout,
  McpNavIcon,
  SkillsNavIcon,
  WorkflowStudioNavIcon,
} from "./SidebarIcons";

interface LeftSidebarTopbarProps {
  compactLayoutMode: boolean;
  onToggleCompactLayoutMode?: () => void;
  onOpenSettings: () => void;
}

export function LeftSidebarTopbar({
  compactLayoutMode,
  onToggleCompactLayoutMode,
  onOpenSettings,
}: LeftSidebarTopbarProps) {
  return (
    <div className="app-left-sidebar-topbar">
      <div className="app-left-sidebar-topbar-drag app-logo-draggable" data-tauri-drag-region aria-hidden />
      <div className="app-left-sidebar-topbar-actions">
        <Tooltip title="设置：钉钉机器人、快捷键、Claude 沙箱与权限" mouseEnterDelay={0.35}>
          <button
            type="button"
            className="app-left-sidebar-compact-btn"
            aria-label="打开设置"
            onClick={onOpenSettings}
          >
            <IconSettings />
          </button>
        </Tooltip>
        {onToggleCompactLayoutMode ? (
          <Tooltip
            title={
              compactLayoutMode
                ? "退出小窗口模式（⌥S）"
                : "小窗口模式（收起右栏，窗口 700×600，快捷键 ⌥S）"
            }
            mouseEnterDelay={0.35}
          >
            <button
              type="button"
              className={`app-left-sidebar-compact-btn${compactLayoutMode ? " app-left-sidebar-compact-btn--active" : ""}`}
              aria-label={compactLayoutMode ? "退出小窗口模式" : "小窗口模式"}
              onClick={onToggleCompactLayoutMode}
            >
              <IconCompactLayout />
            </button>
          </Tooltip>
        ) : null}
        <ClaudeCodeUsageHeaderBtn />
      </div>
    </div>
  );
}

interface LeftSidebarTopNavStackProps {
  mcpNavActive: boolean;
  onOpenMcpHub?: () => void;
  skillsNavActive: boolean;
  onOpenSkillsHub?: () => void;
  workflowStudioNavActive?: boolean;
  onOpenWorkflowStudio?: () => void;
  codeKnowledgeGraphNavActive?: boolean;
  onOpenCodeKnowledgeGraph?: () => void;
}

export function LeftSidebarTopNavStack({
  mcpNavActive,
  onOpenMcpHub,
  skillsNavActive,
  onOpenSkillsHub,
  workflowStudioNavActive = false,
  onOpenWorkflowStudio,
  codeKnowledgeGraphNavActive = false,
  onOpenCodeKnowledgeGraph,
}: LeftSidebarTopNavStackProps) {
  if (!onOpenMcpHub && !onOpenSkillsHub && !onOpenWorkflowStudio && !onOpenCodeKnowledgeGraph) {
    return null;
  }

  return (
    <div className="app-left-sidebar-top-nav-stack">
      {onOpenMcpHub ? (
        <button
          type="button"
          className={`app-left-sidebar-mcp-nav${mcpNavActive ? " app-left-sidebar-mcp-nav--active" : ""}`}
          onClick={onOpenMcpHub}
        >
          <span className="app-left-sidebar-mcp-nav-icon" aria-hidden>
            <McpNavIcon />
          </span>
          <span className="app-left-sidebar-mcp-nav-label">MCP</span>
        </button>
      ) : null}
      {onOpenSkillsHub ? (
        <button
          type="button"
          className={`app-left-sidebar-skills-nav${skillsNavActive ? " app-left-sidebar-skills-nav--active" : ""}`}
          onClick={onOpenSkillsHub}
        >
          <span className="app-left-sidebar-skills-nav-icon" aria-hidden>
            <SkillsNavIcon />
          </span>
          <span className="app-left-sidebar-skills-nav-label">技能</span>
        </button>
      ) : null}
      {onOpenWorkflowStudio ? (
        <button
          type="button"
          className={`app-left-sidebar-workflow-nav${workflowStudioNavActive ? " app-left-sidebar-workflow-nav--active" : ""}`}
          aria-label="打开 Claude Code 工作流编排"
          onClick={onOpenWorkflowStudio}
        >
          <span className="app-left-sidebar-workflow-nav-icon" aria-hidden>
            <WorkflowStudioNavIcon />
          </span>
          <span className="app-left-sidebar-workflow-nav-label">工作流</span>
        </button>
      ) : null}
      {onOpenCodeKnowledgeGraph ? (
        <button
          type="button"
          className={`app-left-sidebar-graph-nav${codeKnowledgeGraphNavActive ? " app-left-sidebar-graph-nav--active" : ""}`}
          onClick={onOpenCodeKnowledgeGraph}
        >
          <span className="app-left-sidebar-graph-nav-icon" aria-hidden>
            <CodeKnowledgeGraphNavIcon />
          </span>
          <span className="app-left-sidebar-graph-nav-label">图谱</span>
        </button>
      ) : null}
    </div>
  );
}
