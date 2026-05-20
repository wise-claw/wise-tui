import type { ClaudeMcpItem, ClaudeMcpStatusResponse, ClaudeProjectSkill, ClaudeSubagentItem } from "../types";

/** Normalized path check aligned with Rust `resolve_omc_plugin_root` (`~/.claude/plugins/cache/omc/oh-my-claudecode`). */
export function isOmcPluginPath(path: string | null | undefined): boolean {
  if (!path?.trim()) return false;
  const n = path.replace(/\\/g, "/").toLowerCase();
  return (
    n.includes("/.claude/plugins/cache/omc/") ||
    n.includes("/plugins/cache/omc/") ||
    n.includes("/oh-my-claudecode/")
  );
}

export function isOmcMcpItem(item: ClaudeMcpItem): boolean {
  const ref = item.pluginRef?.trim().toLowerCase() ?? "";
  if (ref.includes("@omc") || ref.startsWith("cache:omc/")) return true;
  return isOmcPluginPath(item.sourcePath);
}

export function isOmcSubagentItem(item: ClaudeSubagentItem): boolean {
  if (item.isCollaborationMode) return true;
  if (item.scope === "plugin" && isOmcPluginPath(item.sourcePath)) return true;
  return item.id.startsWith("plugin-mode:");
}

export function isOmcPluginCacheSkill(skill: ClaudeProjectSkill): boolean {
  const rel = skill.pluginCacheRelPath?.trim().toLowerCase() ?? "";
  if (rel.startsWith("omc/")) return true;
  return isOmcPluginPath(skill.pluginCacheRoot);
}

export function filterOmcFromMcpStatus(data: ClaudeMcpStatusResponse): ClaudeMcpStatusResponse {
  return {
    ...data,
    pluginMcp: data.pluginMcp.filter((item) => !isOmcMcpItem(item)),
  };
}

export function countHooksInScope(hooks: Record<string, { hooks: unknown[] }[]>): number {
  return Object.values(hooks).reduce(
    (sum, groups) => sum + groups.reduce((groupSum, group) => groupSum + group.hooks.length, 0),
    0,
  );
}
