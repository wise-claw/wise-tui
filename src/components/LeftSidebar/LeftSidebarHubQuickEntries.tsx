import type { ReactNode } from "react";
import { McpNavIcon, SkillsNavIcon, AutomationNavIcon } from "./SidebarIcons";

export interface LeftSidebarHubQuickEntriesProps {
  mcpHubActive?: boolean;
  skillsHubActive?: boolean;
  automationHubActive?: boolean;
  onOpenMcpHub?: () => void;
  onOpenSkillsHub?: () => void;
  onOpenAutomationHub?: () => void;
}

interface HubQuickEntry {
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}

function HubQuickButton({ entry }: { entry: HubQuickEntry }) {
  const className = [
    "app-left-sidebar-hub-quick__btn",
    entry.active ? "app-left-sidebar-hub-quick__btn--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      aria-current={entry.active ? "page" : undefined}
      onClick={entry.onClick}
    >
      <span className="app-left-sidebar-hub-quick__icon" aria-hidden>
        {entry.icon}
      </span>
      <span className="app-left-sidebar-hub-quick__label">{entry.label}</span>
    </button>
  );
}

export function LeftSidebarHubQuickEntries({
  mcpHubActive = false,
  skillsHubActive = false,
  automationHubActive = false,
  onOpenMcpHub,
  onOpenSkillsHub,
  onOpenAutomationHub,
}: LeftSidebarHubQuickEntriesProps) {
  const entries: HubQuickEntry[] = [];

  if (onOpenMcpHub) {
    entries.push({
      key: "mcp",
      label: "MCP",
      icon: <McpNavIcon />,
      active: mcpHubActive,
      onClick: onOpenMcpHub,
    });
  }
  if (onOpenSkillsHub) {
    entries.push({
      key: "skills",
      label: "技能",
      icon: <SkillsNavIcon />,
      active: skillsHubActive,
      onClick: onOpenSkillsHub,
    });
  }
  if (onOpenAutomationHub) {
    entries.push({
      key: "automation",
      label: "自动化",
      icon: <AutomationNavIcon />,
      active: automationHubActive,
      onClick: onOpenAutomationHub,
    });
  }

  if (entries.length === 0) return null;

  return (
    <div className="app-left-sidebar-hub-quick" role="navigation" aria-label="AI 工作台快捷入口">
      {entries.map((entry) => (
        <HubQuickButton key={entry.key} entry={entry} />
      ))}
    </div>
  );
}
