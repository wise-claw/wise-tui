import { Tooltip } from "antd";
import type { ReactNode } from "react";
import { ChatIcon, McpNavIcon, SkillsNavIcon } from "./SidebarIcons";

export interface LeftSidebarHubQuickEntriesProps {
  assistantHubActive?: boolean;
  mcpHubActive?: boolean;
  skillsHubActive?: boolean;
  authorDisabled?: boolean;
  authorDisabledTooltip?: string;
  onOpenAssistantHub?: () => void;
  onOpenMcpHub?: () => void;
  onOpenSkillsHub?: () => void;
}

interface HubQuickEntry {
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  workspaceScoped?: boolean;
}

function HubQuickButton({
  entry,
  authorDisabled,
  authorDisabledTooltip,
}: {
  entry: HubQuickEntry;
  authorDisabled: boolean;
  authorDisabledTooltip?: string;
}) {
  const disabled = Boolean(entry.workspaceScoped && authorDisabled);
  const className = [
    "app-left-sidebar-hub-quick__btn",
    entry.active ? "app-left-sidebar-hub-quick__btn--active" : "",
    disabled ? "app-left-sidebar-hub-quick__btn--disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const button = (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-disabled={disabled}
      aria-current={entry.active ? "page" : undefined}
      onClick={() => {
        if (disabled) return;
        entry.onClick();
      }}
    >
      <span className="app-left-sidebar-hub-quick__icon" aria-hidden>
        {entry.icon}
      </span>
      <span className="app-left-sidebar-hub-quick__label">{entry.label}</span>
    </button>
  );

  if (!disabled) return button;

  return (
    <Tooltip title={authorDisabledTooltip ?? "需要工作区"} placement="right">
      <span className="app-left-sidebar-hub-quick__tooltip-wrap">{button}</span>
    </Tooltip>
  );
}

export function LeftSidebarHubQuickEntries({
  assistantHubActive = false,
  mcpHubActive = false,
  skillsHubActive = false,
  authorDisabled = false,
  authorDisabledTooltip,
  onOpenAssistantHub,
  onOpenMcpHub,
  onOpenSkillsHub,
}: LeftSidebarHubQuickEntriesProps) {
  const entries: HubQuickEntry[] = [];

  if (onOpenMcpHub) {
    entries.push({
      key: "mcp",
      label: "MCP",
      icon: <McpNavIcon />,
      active: mcpHubActive,
      onClick: onOpenMcpHub,
      workspaceScoped: true,
    });
  }
  if (onOpenSkillsHub) {
    entries.push({
      key: "skills",
      label: "技能",
      icon: <SkillsNavIcon />,
      active: skillsHubActive,
      onClick: onOpenSkillsHub,
      workspaceScoped: true,
    });
  }
  if (onOpenAssistantHub) {
    entries.push({
      key: "assistant",
      label: "助手",
      icon: <ChatIcon />,
      active: assistantHubActive,
      onClick: onOpenAssistantHub,
    });
  }

  if (entries.length === 0) return null;

  return (
    <div className="app-left-sidebar-hub-quick" role="navigation" aria-label="AI 工作台快捷入口">
      {entries.map((entry) => (
        <HubQuickButton
          key={entry.key}
          entry={entry}
          authorDisabled={authorDisabled}
          authorDisabledTooltip={authorDisabledTooltip}
        />
      ))}
    </div>
  );
}
