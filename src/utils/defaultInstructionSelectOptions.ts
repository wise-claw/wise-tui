import { CLAUDE_BUILTIN_SLASH_COMMANDS } from "../constants/claudeCodeSlashCommands";
import type { SlashCatalogSnapshot } from "../services/slashCatalogCache";
import { normalizeComposerDefaultInstruction } from "./composerDefaultInstruction";
import {
  defaultInstructionResolveContextFromCatalog,
  resolveComposerDefaultInstructionOutbound,
} from "./resolveComposerDefaultInstructionOutbound";
import {
  OMC_COMMANDS,
  SLASH_GROUP_TITLES,
  buildRuntimeBuiltinCommands,
  mapSlashCatalogToOptions,
  type SlashOption,
} from "./slashPopoverOptions";

export interface DefaultInstructionSelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface DefaultInstructionSelectOptionGroup {
  label: string;
  options: DefaultInstructionSelectOption[];
}

const CLAUDE_RESERVED_LABELS = new Set(
  CLAUDE_BUILTIN_SLASH_COMMANDS.map((cmd) => cmd.label.trim().toLowerCase()),
);

const OMC_VIRTUAL_GROUP_TITLE = "oh-my-claudecode";

const GROUP_ORDER = [
  "oh-my-claudecode",
  "Claude 内置",
  "已安装插件命令",
  "Skills 技能",
  "插件",
] as const;

export function slashCommandLabelToDefaultInstructionValue(label: string): string {
  return normalizeComposerDefaultInstruction(label);
}

function mergeDefaultInstructionCommands(items: SlashOption[]): SlashOption[] {
  const seen = new Set<string>();
  const result: SlashOption[] = [];
  for (const item of items) {
    if (item.type !== "command") continue;
    const key = item.label.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function toSelectOption(
  cmd: SlashOption,
  snapshot: Pick<
    SlashCatalogSnapshot,
    "omcInstalled" | "pluginCacheSkills" | "projectSkills" | "userSkills"
  >,
): DefaultInstructionSelectOption {
  const shortValue = slashCommandLabelToDefaultInstructionValue(cmd.label);
  const value = resolveComposerDefaultInstructionOutbound(
    shortValue,
    defaultInstructionResolveContextFromCatalog(snapshot),
  );
  return {
    value,
    label: value,
    description: cmd.description?.trim() || undefined,
  };
}

export function buildDefaultInstructionSelectOptionGroups(
  snapshot: Pick<
    SlashCatalogSnapshot,
    | "omcInstalled"
    | "detectedPluginCommands"
    | "installedPluginCommands"
    | "installPluginCommands"
    | "projectSkills"
    | "userSkills"
    | "pluginCacheSkills"
  >,
): DefaultInstructionSelectOptionGroup[] {
  const catalogOptions = mapSlashCatalogToOptions({
    detectedPluginCommands: snapshot.detectedPluginCommands,
    installedPluginCommands: snapshot.installedPluginCommands,
    installPluginCommands: snapshot.installPluginCommands,
    projectSkills: snapshot.projectSkills,
    userSkills: snapshot.userSkills,
    reservedSkillLabels: CLAUDE_RESERVED_LABELS,
  });

  const detectedLabels = new Set(
    snapshot.detectedPluginCommands.map((cmd) => cmd.label.trim().toLowerCase()),
  );
  const runtimeBuiltins = buildRuntimeBuiltinCommands(snapshot.omcInstalled, detectedLabels);
  const omcCommands: SlashOption[] = snapshot.omcInstalled
    ? OMC_COMMANDS.filter((cmd) => !detectedLabels.has(cmd.label.trim().toLowerCase()))
    : [];
  const omcLabelSet = new Set(omcCommands.map((cmd) => cmd.label.trim().toLowerCase()));
  const allCommands = mergeDefaultInstructionCommands([
    ...omcCommands,
    ...runtimeBuiltins,
    ...catalogOptions.detectedPluginSlashOptions,
    ...catalogOptions.skillSlashOptions,
  ]);

  const grouped = new Map<string, DefaultInstructionSelectOption[]>();
  for (const cmd of allCommands) {
    const isOmc = omcLabelSet.has(cmd.label.trim().toLowerCase());
    const groupKey = cmd.group ?? "claude";
    const title = isOmc
      ? OMC_VIRTUAL_GROUP_TITLE
      : (SLASH_GROUP_TITLES[groupKey] ?? groupKey);
    const option = toSelectOption(cmd, snapshot);
    const list = grouped.get(title) ?? [];
    if (list.some((item) => item.value.toLowerCase() === option.value.toLowerCase())) continue;
    list.push(option);
    grouped.set(title, list);
  }

  const orderedTitles = [
    ...GROUP_ORDER.filter((title) => grouped.has(title)),
    ...[...grouped.keys()].filter((title) => !GROUP_ORDER.includes(title as (typeof GROUP_ORDER)[number])),
  ];

  return orderedTitles
    .map((title) => {
      const options = grouped.get(title);
      if (!options?.length) return null;
      options.sort((left, right) =>
        left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
      );
      return { label: title, options };
    })
    .filter((group): group is DefaultInstructionSelectOptionGroup => group != null);
}

export function flattenDefaultInstructionSelectOptions(
  groups: readonly DefaultInstructionSelectOptionGroup[],
): DefaultInstructionSelectOption[] {
  const seen = new Set<string>();
  const result: DefaultInstructionSelectOption[] = [];
  for (const group of groups) {
    for (const option of group.options) {
      const key = option.value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(option);
    }
  }
  return result;
}

export function ensureDefaultInstructionOption(
  groups: DefaultInstructionSelectOptionGroup[],
  rawValue: string,
  snapshot?: Pick<
    SlashCatalogSnapshot,
    "omcInstalled" | "pluginCacheSkills" | "projectSkills" | "userSkills"
  >,
): DefaultInstructionSelectOptionGroup[] {
  const normalized = snapshot
    ? resolveComposerDefaultInstructionOutbound(
        rawValue,
        defaultInstructionResolveContextFromCatalog(snapshot),
      )
    : normalizeComposerDefaultInstruction(rawValue);
  if (!normalized) return groups;
  const exists = groups.some((group) =>
    group.options.some((option) => option.value.toLowerCase() === normalized.toLowerCase()),
  );
  if (exists) return groups;
  return [
    {
      label: "当前配置",
      options: [{ value: normalized, label: normalized }],
    },
    ...groups,
  ];
}
