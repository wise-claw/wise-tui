import type { ClaudeProjectSkill } from "../types";

export interface InstalledPluginSlashOptionInput {
  label: string;
  description?: string;
  group: "plugin-cmd";
}

const SLASH_SKILL_NAME_RE = /^[a-zA-Z0-9][-a-zA-Z0-9_.]*$/;

export function isSlashablePluginCommandName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 96 && SLASH_SKILL_NAME_RE.test(trimmed);
}

export function isInvocablePluginSlashSkill(skill: ClaudeProjectSkill): boolean {
  if (!isSlashablePluginCommandName(skill.name)) return false;
  if (skill.entryKind === "command") return true;
  if (skill.hasSkillMd) return true;
  return (skill.fileCount ?? 0) > 0;
}

export function pluginInstallRefFromCacheRel(rel: string | null | undefined): string | null {
  const parts = (rel ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[1]}@${parts[0]}`;
}

/** 将已安装插件扫描结果转为会话 `/` 补全项。 */
export function buildInstalledPluginSlashOptionsFromSkills(
  skills: readonly ClaudeProjectSkill[],
  reservedLabels: ReadonlySet<string>,
): InstalledPluginSlashOptionInput[] {
  const byKey = new Map<string, InstalledPluginSlashOptionInput>();

  for (const skill of skills) {
    if (!isInvocablePluginSlashSkill(skill)) continue;
    const label = skill.name.trim();
    const key = label.toLowerCase();
    if (reservedLabels.has(key) || byKey.has(key)) continue;

    const pluginRef = pluginInstallRefFromCacheRel(skill.pluginCacheRelPath);
    const pluginNote = pluginRef ? `（${pluginRef}）` : "（已安装插件）";
    const desc = skill.description?.trim();
    byKey.set(key, {
      group: "plugin-cmd",
      label,
      description: desc ? `${desc} ${pluginNote}` : `插件命令 ${pluginNote}`,
    });
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}
