import type { SlashCatalogSnapshot } from "../services/slashCatalogCache";
import { loadSlashCatalog } from "../services/slashCatalogCache";
import type { ClaudeProjectSkill } from "../types";
import { normalizeComposerDefaultInstruction } from "./composerDefaultInstruction";
import {
  isInvocablePluginSlashSkill,
  pluginInstallRefFromCacheRel,
} from "./installedPluginSlashCommands";
import { OMC_COMMANDS } from "./slashPopoverOptions";

export const OMC_PLUGIN_SLASH_NAMESPACE = "oh-my-claudecode";

const OMC_SHORT_COMMAND_LABELS = new Set(
  OMC_COMMANDS.map((cmd) => cmd.label.trim().toLowerCase()),
);

export interface DefaultInstructionResolveContext {
  omcInstalled: boolean;
  pluginCacheSkills: readonly ClaudeProjectSkill[];
  projectSkills: readonly ClaudeProjectSkill[];
}

export function pluginNamespaceFromCacheRel(rel: string | null | undefined): string | null {
  const parts = (rel ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) return null;
  return parts[1] ?? null;
}

export function buildPluginSlashCommandPath(namespace: string, commandLabel: string): string {
  const cmd = commandLabel.trim().replace(/^\//, "");
  const ns = namespace.trim().replace(/^\//, "").replace(/:$/, "");
  if (!ns || !cmd) return normalizeComposerDefaultInstruction(commandLabel);
  return `/${ns}:${cmd}`;
}

export function isNamespacedSlashCommand(instruction: string): boolean {
  const normalized = normalizeComposerDefaultInstruction(instruction);
  return /^\/[^/\s]+:[^/\s]+/u.test(normalized);
}

export function defaultInstructionResolveContextFromCatalog(
  snapshot: Pick<
    SlashCatalogSnapshot,
    "omcInstalled" | "pluginCacheSkills" | "projectSkills"
  >,
): DefaultInstructionResolveContext {
  return {
    omcInstalled: snapshot.omcInstalled,
    pluginCacheSkills: snapshot.pluginCacheSkills,
    projectSkills: snapshot.projectSkills,
  };
}

export async function loadDefaultInstructionResolveContext(
  repositoryPath?: string | null,
): Promise<DefaultInstructionResolveContext> {
  const snapshot = await loadSlashCatalog(repositoryPath?.trim() || null);
  return defaultInstructionResolveContextFromCatalog(snapshot);
}

function resolveFromPluginSkills(
  commandKey: string,
  skills: readonly ClaudeProjectSkill[],
): string | null {
  for (const skill of skills) {
    if (!isInvocablePluginSlashSkill(skill)) continue;
    if (skill.name.trim().toLowerCase() !== commandKey) continue;
    const namespace = pluginNamespaceFromCacheRel(skill.pluginCacheRelPath);
    if (!namespace) continue;
    return buildPluginSlashCommandPath(namespace, skill.name);
  }
  return null;
}

/** 将配置的默认指令解析为 Claude Code 实际执行的斜杠命令（如 `/oh-my-claudecode:ultrawork`）。 */
export function resolveComposerDefaultInstructionOutbound(
  instruction: string,
  context?: DefaultInstructionResolveContext,
): string {
  const normalized = normalizeComposerDefaultInstruction(instruction);
  if (!normalized) return "";
  if (isNamespacedSlashCommand(normalized)) return normalized;

  const commandKey = normalized.replace(/^\//, "").toLowerCase();
  const skills = [...(context?.pluginCacheSkills ?? []), ...(context?.projectSkills ?? [])];
  const fromSkills = resolveFromPluginSkills(commandKey, skills);
  if (fromSkills) return fromSkills;

  if (context?.omcInstalled && OMC_SHORT_COMMAND_LABELS.has(commandKey)) {
    return buildPluginSlashCommandPath(OMC_PLUGIN_SLASH_NAMESPACE, commandKey);
  }

  return normalized;
}

export function defaultInstructionAliasValues(
  configured: string,
  context?: DefaultInstructionResolveContext,
): string[] {
  const normalized = normalizeComposerDefaultInstruction(configured);
  const outbound = resolveComposerDefaultInstructionOutbound(configured, context);
  const aliases = new Set<string>();
  if (normalized) aliases.add(normalized);
  if (outbound) aliases.add(outbound);
  const namespaced = outbound.match(/^\/([^:]+):(.+)$/u);
  if (namespaced?.[2]) {
    aliases.add(`/${namespaced[2]}`);
  }
  return [...aliases];
}
