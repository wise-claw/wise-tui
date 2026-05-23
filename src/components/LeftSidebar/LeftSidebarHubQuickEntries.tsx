import type { ReactNode } from "react";
import type { LeftSidebarHubQuickEntryId } from "../../constants/leftSidebarHubQuickEntries";
import { LEFT_SIDEBAR_HUB_QUICK_ENTRY_LABELS, LEFT_SIDEBAR_HUB_QUICK_ENTRY_ORDER } from "../../constants/leftSidebarHubQuickEntries";
import {
  AssistantNavIcon,
  AutomationNavIcon,
  McpNavIcon,
  PluginMarketNavIcon,
  SkillsNavIcon,
} from "./SidebarIcons";

export interface LeftSidebarHubQuickEntriesProps {
  enabledEntryIds: readonly LeftSidebarHubQuickEntryId[];
  mcpHubActive?: boolean;
  skillsHubActive?: boolean;
  automationHubActive?: boolean;
  assistantsHubActive?: boolean;
  claudePluginsHubActive?: boolean;
  onOpenMcpHub?: () => void;
  onOpenSkillsHub?: () => void;
  onOpenAutomationHub?: () => void;
  onOpenAssistantsHub?: () => void;
  onOpenClaudePluginsHub?: () => void;
}

interface HubQuickEntry {
  key: LeftSidebarHubQuickEntryId;
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

function buildEntry(
  id: LeftSidebarHubQuickEntryId,
  props: LeftSidebarHubQuickEntriesProps,
): HubQuickEntry | null {
  switch (id) {
    case "mcp":
      if (!props.onOpenMcpHub) return null;
      return {
        key: id,
        label: LEFT_SIDEBAR_HUB_QUICK_ENTRY_LABELS[id],
        icon: <McpNavIcon />,
        active: Boolean(props.mcpHubActive),
        onClick: props.onOpenMcpHub,
      };
    case "skills":
      if (!props.onOpenSkillsHub) return null;
      return {
        key: id,
        label: LEFT_SIDEBAR_HUB_QUICK_ENTRY_LABELS[id],
        icon: <SkillsNavIcon />,
        active: Boolean(props.skillsHubActive),
        onClick: props.onOpenSkillsHub,
      };
    case "automation":
      if (!props.onOpenAutomationHub) return null;
      return {
        key: id,
        label: LEFT_SIDEBAR_HUB_QUICK_ENTRY_LABELS[id],
        icon: <AutomationNavIcon />,
        active: Boolean(props.automationHubActive),
        onClick: props.onOpenAutomationHub,
      };
    case "assistants":
      if (!props.onOpenAssistantsHub) return null;
      return {
        key: id,
        label: LEFT_SIDEBAR_HUB_QUICK_ENTRY_LABELS[id],
        icon: <AssistantNavIcon />,
        active: Boolean(props.assistantsHubActive),
        onClick: props.onOpenAssistantsHub,
      };
    case "claude-plugins":
      if (!props.onOpenClaudePluginsHub) return null;
      return {
        key: id,
        label: LEFT_SIDEBAR_HUB_QUICK_ENTRY_LABELS[id],
        icon: <PluginMarketNavIcon />,
        active: Boolean(props.claudePluginsHubActive),
        onClick: props.onOpenClaudePluginsHub,
      };
    default:
      return null;
  }
}

export function LeftSidebarHubQuickEntries(props: LeftSidebarHubQuickEntriesProps) {
  const enabled = new Set(props.enabledEntryIds);
  const entries = LEFT_SIDEBAR_HUB_QUICK_ENTRY_ORDER.map((id) => (enabled.has(id) ? buildEntry(id, props) : null)).filter(
    (item): item is HubQuickEntry => item != null,
  );

  if (entries.length === 0) return null;

  return (
    <div className="app-left-sidebar-hub-quick" role="navigation" aria-label="AI 工作台快捷入口">
      {entries.map((entry) => (
        <HubQuickButton key={entry.key} entry={entry} />
      ))}
    </div>
  );
}
