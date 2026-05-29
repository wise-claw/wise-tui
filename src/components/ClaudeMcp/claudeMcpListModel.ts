import type { ClaudeMcpItem, ClaudeMcpRuntimeHealthEntry, ClaudeMcpStatusResponse } from "../../types";

export const EMPTY_MCP_DATA: ClaudeMcpStatusResponse = {
  user: [],
  local: [],
  projectShared: [],
  legacyUserSettings: [],
  legacyProjectSettings: [],
  pluginMcp: [],
};

export function removeMcpItemById(data: ClaudeMcpStatusResponse, itemId: string): ClaudeMcpStatusResponse {
  const filter = (items: ClaudeMcpItem[]) => items.filter((it) => it.id !== itemId);
  return {
    user: filter(data.user),
    local: filter(data.local),
    projectShared: filter(data.projectShared),
    legacyUserSettings: filter(data.legacyUserSettings),
    legacyProjectSettings: filter(data.legacyProjectSettings),
    pluginMcp: filter(data.pluginMcp),
  };
}

export function patchMcpItemEnabledById(
  data: ClaudeMcpStatusResponse,
  itemId: string,
  enabled: boolean,
): ClaudeMcpStatusResponse {
  const patchList = (items: ClaudeMcpItem[]): ClaudeMcpItem[] =>
    items.map((it) => (it.id === itemId ? { ...it, enabled } : it));
  return {
    user: patchList(data.user),
    local: patchList(data.local),
    projectShared: patchList(data.projectShared),
    legacyUserSettings: patchList(data.legacyUserSettings),
    legacyProjectSettings: patchList(data.legacyProjectSettings),
    pluginMcp: patchList(data.pluginMcp),
  };
}

export function mcpItemMatchesListSearch(item: ClaudeMcpItem, listSearch: string): boolean {
  const needle = listSearch.trim().toLowerCase();
  if (!needle) return true;
  const hay = [item.name, item.command, item.sourcePath, item.scope, item.pluginRef ?? "", ...item.tools]
    .join("\n")
    .toLowerCase();
  return hay.includes(needle);
}

export function filterMcpDataBySearch(data: ClaudeMcpStatusResponse, listSearch: string): ClaudeMcpStatusResponse {
  if (!listSearch.trim()) return data;
  const f = (items: ClaudeMcpItem[]) => items.filter((it) => mcpItemMatchesListSearch(it, listSearch));
  return {
    user: f(data.user),
    local: f(data.local),
    projectShared: f(data.projectShared),
    legacyUserSettings: f(data.legacyUserSettings),
    legacyProjectSettings: f(data.legacyProjectSettings),
    pluginMcp: f(data.pluginMcp),
  };
}

export function mergeRuntimeHealth(
  data: ClaudeMcpStatusResponse,
  health: ClaudeMcpRuntimeHealthEntry[],
): ClaudeMcpStatusResponse {
  const map = new Map<string, "connected" | "failed">();
  for (const h of health) {
    if (h.status === "connected" || h.status === "failed") {
      map.set(h.name, h.status);
    }
  }
  const patch = (items: ClaudeMcpItem[]): ClaudeMcpItem[] =>
    items.map((item) => ({
      ...item,
      runtimeStatus: map.has(item.name) ? map.get(item.name)! : item.runtimeStatus,
    }));
  return {
    user: patch(data.user),
    local: patch(data.local),
    projectShared: patch(data.projectShared),
    legacyUserSettings: patch(data.legacyUserSettings),
    legacyProjectSettings: patch(data.legacyProjectSettings),
    pluginMcp: patch(data.pluginMcp),
  };
}

export const MCP_SECTIONS: {
  key: keyof ClaudeMcpStatusResponse;
  title: string;
  hint: string;
}[] = [
  { key: "user", title: "用户范围", hint: "~/.claude.json · 本机全部工作区" },
  { key: "local", title: "当前仓库 · 本地", hint: "~/.claude.json · 仅本仓库（不提交 Git）" },
  {
    key: "pluginMcp",
    title: "已安装插件",
    hint: "~/.claude/settings.json（plugin@marketplace 启用 → extraKnownMarketplaces / plugins/<插件>）+ installed_plugins + plugins/cache 递归（只读，不扫 marketplaces）",
  },
  { key: "projectShared", title: "当前仓库 · 团队共享", hint: "仓库根目录 .mcp.json" },
  { key: "legacyUserSettings", title: "兼容 · 用户 settings", hint: "~/.claude/settings.json（旧式 MCP 块）" },
  {
    key: "legacyProjectSettings",
    title: "兼容 · 仓库 settings",
    hint: ".claude/settings.json（旧式 MCP 块）",
  },
];

export type McpFlatRow = { item: ClaudeMcpItem; sectionTitle: string; sectionKey: keyof ClaudeMcpStatusResponse };

export function flattenMcpItemsForHub(data: ClaudeMcpStatusResponse): McpFlatRow[] {
  const out: McpFlatRow[] = [];
  for (const { key, title } of MCP_SECTIONS) {
    for (const item of data[key]) {
      out.push({ item, sectionTitle: title, sectionKey: key });
    }
  }
  return out;
}
