import type {
  ClaudeMcpItem,
  ClaudeMcpStatusResponse,
  ClaudeHooksStatusResponse,
  ClaudeProjectSkill,
  ClaudeSubagentItem,
} from "../types";

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

/**
 * 用户级 OMC 技能副本（常为 symlink），与 `plugins/cache` 中同名插件技能重复。
 * 合并时优先保留插件侧条目，与 Hooks 去掉独立 `omc` 字段同理。
 */
export function isDuplicateOmcUserSkill(
  skill: ClaudeProjectSkill,
  pluginSkills: ClaudeProjectSkill[],
): boolean {
  if (skill.skillScope !== "user") return false;
  const name = skill.name.trim().toLowerCase();
  if (!name) return false;
  return pluginSkills.some(
    (row) => isOmcPluginCacheSkill(row) && row.name.trim().toLowerCase() === name,
  );
}

/** Claude Code 技能面板：project → plugin → user，同名只保留先出现的来源。 */
export function mergeClaudeSkillsForPanel(
  project: ClaudeProjectSkill[],
  user: ClaudeProjectSkill[],
  plugin: ClaudeProjectSkill[],
): ClaudeProjectSkill[] {
  const seen = new Set<string>();
  const out: ClaudeProjectSkill[] = [];

  const pushUnique = (skills: ClaudeProjectSkill[]) => {
    for (const skill of skills) {
      const key = skill.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(skill);
    }
  };

  pushUnique(project);
  pushUnique(plugin);
  pushUnique(user.filter((skill) => !isDuplicateOmcUserSkill(skill, plugin)));

  return out;
}

export function filterOmcFromMcpStatus(data: ClaudeMcpStatusResponse): ClaudeMcpStatusResponse {
  return {
    ...data,
    pluginMcp: data.pluginMcp.filter((item) => !isOmcMcpItem(item)),
  };
}

const EMPTY_HOOK_SCOPE = {
  sourcePath: "",
  disableAllHooks: false,
  hooks: {},
} as const;

/** OMC 插件 hooks 已在 `plugins` 中展示；丢弃重复的 `omc` 字段。 */
export function filterOmcFromHooksStatus(data: ClaudeHooksStatusResponse): ClaudeHooksStatusResponse {
  return {
    ...data,
    omc: { ...EMPTY_HOOK_SCOPE },
  };
}

export function countHooksInScope(hooks: Record<string, { hooks: unknown[] }[]>): number {
  return Object.values(hooks).reduce(
    (sum, groups) => sum + groups.reduce((groupSum, group) => groupSum + group.hooks.length, 0),
    0,
  );
}
