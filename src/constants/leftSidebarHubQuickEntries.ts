/** 左栏 AI 工作台快捷入口（与 Cockpit / Author 页面对应）。 */
export type LeftSidebarHubQuickEntryId =
  | "mcp"
  | "skills"
  | "automation"
  | "assistants"
  | "claude-plugins";

/** 侧栏展示顺序（固定）。 */
export const LEFT_SIDEBAR_HUB_QUICK_ENTRY_ORDER: readonly LeftSidebarHubQuickEntryId[] = [
  "mcp",
  "skills",
  "automation",
  "assistants",
  "claude-plugins",
] as const;

/** 默认勾选：MCP、技能、自动化。 */
export const DEFAULT_LEFT_SIDEBAR_HUB_QUICK_ENTRIES: readonly LeftSidebarHubQuickEntryId[] = [
  "mcp",
  "skills",
  "automation",
] as const;

export const LEFT_SIDEBAR_HUB_QUICK_ENTRY_LABELS: Record<LeftSidebarHubQuickEntryId, string> = {
  mcp: "MCP",
  skills: "技能",
  automation: "自动化",
  assistants: "助手",
  "claude-plugins": "插件市场",
};

const ALLOWED = new Set<string>(LEFT_SIDEBAR_HUB_QUICK_ENTRY_ORDER);

export function isLeftSidebarHubQuickEntryId(value: string): value is LeftSidebarHubQuickEntryId {
  return ALLOWED.has(value);
}

export function normalizeLeftSidebarHubQuickEntries(raw: unknown): LeftSidebarHubQuickEntryId[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_LEFT_SIDEBAR_HUB_QUICK_ENTRIES];
  }
  const seen = new Set<LeftSidebarHubQuickEntryId>();
  for (const item of raw) {
    if (typeof item === "string" && isLeftSidebarHubQuickEntryId(item)) {
      seen.add(item);
    }
  }
  return LEFT_SIDEBAR_HUB_QUICK_ENTRY_ORDER.filter((id) => seen.has(id));
}
