import type { ClaudeProjectSkill } from "../types";
import { isSlashCommandName } from "./slashCommandName";

export interface InstalledPluginSlashOptionInput {
  label: string;
  description?: string;
  group: "plugin-cmd";
}

export function isSlashablePluginCommandName(name: string): boolean {
  return isSlashCommandName(name);
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

    const desc = skill.description?.trim();
    byKey.set(key, {
      group: "plugin-cmd",
      label,
      description: desc || undefined,
    });
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}
