import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { CLAUDE_BUILTIN_SLASH_COMMANDS } from "../constants/claudeCodeSlashCommands";
import { isSlashCommandName } from "./slashCommandName";
import {
  COMPOSER_PLUGIN_SLASH_SUBCOMMANDS,
  type ComposerPluginSlashCommandEntry,
} from "../constants/composerPluginSlashCommands";
import type { ClaudeProjectSkill } from "../types";
import { listExecutionEnvironmentEngineMentionOptions } from "./executionEnvironmentDispatch";
import {
  shouldShowComposerPluginInstalledTemplates,
  shouldShowComposerPluginInstallTemplates,
  slashCommandMatchesQuery,
} from "./slashCommandMatch";

export interface SlashOption {
  type: "agent" | "team" | "file" | "command" | "execution_engine";
  label: string;
  description?: string;
  path?: string;
  name?: string;
  workflowId?: string;
  group?: "claude" | "skill" | "plugin" | "plugin-cmd";
  executionEngine?: SessionExecutionEngine;
  executionEngineAvailable?: boolean;
}

export const SLASH_POPOVER_MAX_OPTIONS = 48;

/** 仅 `/` 空查询时展示的常用 Claude 内置命令，避免一次性渲染近百条 */
const SLASH_EMPTY_QUERY_CLAUDE_HINTS = new Set([
  "add-dir",
  "agents",
  "background",
  "branch",
  "btw",
  "clear",
  "code-review",
  "compact",
  "config",
  "context",
  "diff",
  "doctor",
  "help",
  "mcp",
  "model",
  "plugin",
  "resume",
  "review",
  "skills",
]);

const CLAUDE_BUILTIN_COMMANDS: SlashOption[] = CLAUDE_BUILTIN_SLASH_COMMANDS.map((cmd) => ({
  type: "command",
  group: "claude",
  label: cmd.label,
  description: cmd.description,
}));

export const OMC_COMMANDS: SlashOption[] = [
  { type: "command", label: "ask", description: "OMC 多模型咨询路由" },
  { type: "command", label: "autopilot", description: "OMC 自动执行闭环" },
  { type: "command", label: "autoresearch", description: "OMC 持续研究迭代" },
  { type: "command", label: "cancel", description: "取消当前 OMC 模式" },
  { type: "command", label: "ccg", description: "Claude/Codex/Gemini 编排" },
  { type: "command", label: "debug", description: "OMC 会话诊断" },
  { type: "command", label: "deep-dive", description: "链路深挖与访谈" },
  { type: "command", label: "deep-interview", description: "需求深访谈" },
  { type: "command", label: "deepinit", description: "深度初始化项目上下文" },
  { type: "command", label: "doctor", description: "OMC 安装/状态自检" },
  { type: "command", label: "hud", description: "配置 HUD 展示" },
  { type: "command", label: "mcp-setup", description: "配置 MCP 服务" },
  { type: "command", label: "plan", description: "OMC 规划模式" },
  { type: "command", label: "ralph", description: "自循环执行直到完成" },
  { type: "command", label: "ralplan", description: "Ralph 共识规划入口" },
  { type: "command", label: "release", description: "发布流程助手" },
  { type: "command", label: "remember", description: "沉淀可复用知识" },
  { type: "command", label: "team", description: "多 Agent 协作执行" },
  { type: "command", label: "trace", description: "证据驱动追踪分析" },
  { type: "command", label: "ultraqa", description: "高强度 QA 循环" },
  { type: "command", label: "ultrawork", description: "高吞吐并行执行" },
  { type: "command", label: "verify", description: "结果核验与验收" },
  { type: "command", label: "review", description: "代码审查工作流" },
  { type: "command", label: "security-review", description: "安全审查工作流" },
  { type: "command", label: "simplify", description: "代码简化与整洁" },
  { type: "command", label: "update-config", description: "更新 OMC/Claude 配置" },
];

const PLUGIN_SUBCOMMANDS: SlashOption[] = COMPOSER_PLUGIN_SLASH_SUBCOMMANDS.map((cmd) => ({
  type: "command" as const,
  group: "plugin" as const,
  label: cmd.label,
  description: cmd.description,
}));

let runtimeBuiltinCache: { key: string; value: SlashOption[] } | null = null;

function mergeSlashCommandOptions(items: SlashOption[]): SlashOption[] {
  const seen = new Set<string>();
  const result: SlashOption[] = [];
  for (const item of items) {
    const key = item.label.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function buildRuntimeBuiltinCommands(
  omcInstalled: boolean,
  detectedPluginLabels: ReadonlySet<string>,
): SlashOption[] {
  const key = `${omcInstalled ? 1 : 0}:${[...detectedPluginLabels].sort().join(",")}`;
  if (runtimeBuiltinCache?.key === key) {
    return runtimeBuiltinCache.value;
  }
  const value = mergeSlashCommandOptions([...CLAUDE_BUILTIN_COMMANDS]);
  runtimeBuiltinCache = { key, value };
  return value;
}

function mapPluginSlashEntries(
  entries: ReadonlyArray<ComposerPluginSlashCommandEntry>,
  group: "plugin" = "plugin",
): SlashOption[] {
  return entries.map((cmd) => ({
    type: "command" as const,
    group,
    label: cmd.label,
    description: cmd.description,
  }));
}

function mapDetectedPluginSlashEntries(
  entries: ReadonlyArray<{ label: string; description: string }>,
): SlashOption[] {
  return entries.map((cmd) => ({
    type: "command" as const,
    group: "plugin-cmd" as const,
    label: cmd.label,
    description: cmd.description,
  }));
}

function isSlashableSkillName(name: string): boolean {
  return isSlashCommandName(name);
}

function skillIsInvocableAsSlashCommand(skill: ClaudeProjectSkill): boolean {
  if (!isSlashableSkillName(skill.name)) return false;
  if (skill.hasSkillMd) return true;
  return (skill.fileCount ?? 0) > 0;
}

export function buildSkillSlashOptionsFromList(
  input: {
    projectSkills: ClaudeProjectSkill[];
    userSkills?: ClaudeProjectSkill[];
  },
  reservedLabels: ReadonlySet<string>,
): SlashOption[] {
  const byKey = new Map<string, SlashOption>();

  const push = (skill: ClaudeProjectSkill, defaultDescription: string) => {
    if (!skillIsInvocableAsSlashCommand(skill)) return;
    const label = skill.name.trim();
    const k = label.toLowerCase();
    if (reservedLabels.has(k)) return;
    if (byKey.has(k)) return;
    const desc = skill.description?.trim();
    byKey.set(k, {
      type: "command",
      group: "skill",
      label,
      description: desc && desc.length > 0 ? desc : defaultDescription,
    });
  };

  for (const skill of input.projectSkills) {
    push(skill, "项目技能");
  }
  for (const skill of input.userSkills ?? []) {
    push(skill, "全局技能");
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

function buildPluginSlashOptions(
  query: string,
  installedPluginCommands: SlashOption[],
  installCommands: SlashOption[],
): SlashOption[] {
  const subcommands = PLUGIN_SUBCOMMANDS.filter((cmd) => slashCommandMatchesQuery(cmd.label, query));
  const installed = shouldShowComposerPluginInstalledTemplates(query)
    ? installedPluginCommands.filter((cmd) => slashCommandMatchesQuery(cmd.label, query))
    : [];
  const installs = shouldShowComposerPluginInstallTemplates(query)
    ? installCommands.filter((cmd) => slashCommandMatchesQuery(cmd.label, query))
    : [];
  return [...subcommands, ...installed, ...installs];
}

function splitRuntimeBuiltins(runtimeBuiltins: SlashOption[]): {
  claude: SlashOption[];
} {
  const claude: SlashOption[] = [];
  for (const row of runtimeBuiltins) {
    if (row.group === "claude") claude.push(row);
  }
  return { claude };
}

function filterSlashCommandRows(rows: SlashOption[], query: string): SlashOption[] {
  const q = query.trim();
  if (!q) return rows;
  return rows.filter((row) => slashCommandMatchesQuery(row.label, query));
}

function filterSkillRows(rows: SlashOption[], query: string): SlashOption[] {
  const q = query.trim();
  if (!q) return [];
  return rows.filter(
    (row) =>
      slashCommandMatchesQuery(row.label, query) ||
      slashCommandMatchesQuery(row.description ?? "", query),
  );
}

export interface SlashFilteredResult {
  options: SlashOption[];
  truncated: boolean;
}

export function getFilteredSlashOptions(
  query: string,
  detectedPluginSlashOptions: SlashOption[],
  installedPluginSlashOptions: SlashOption[],
  installPluginSlashOptions: SlashOption[],
  skillSlashOptions: SlashOption[],
  omcInstalled: boolean,
  detectedPluginLabels: ReadonlySet<string>,
): SlashFilteredResult {
  const runtimeBuiltins = buildRuntimeBuiltinCommands(omcInstalled, detectedPluginLabels);
  const { claude } = splitRuntimeBuiltins(runtimeBuiltins);
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  const claudeFiltered = hasQuery
    ? filterSlashCommandRows(claude, query)
    : claude.filter((row) => SLASH_EMPTY_QUERY_CLAUDE_HINTS.has(row.label.trim().toLowerCase()));
  const detectedFiltered = filterSlashCommandRows(detectedPluginSlashOptions, query);
  const pluginFiltered = buildPluginSlashOptions(
    query,
    installedPluginSlashOptions,
    installPluginSlashOptions,
  );
  const skillsFiltered = filterSkillRows(skillSlashOptions, query);

  const merged = [
    ...claudeFiltered,
    ...detectedFiltered,
    ...pluginFiltered,
    ...skillsFiltered,
  ];
  const truncated = merged.length > SLASH_POPOVER_MAX_OPTIONS;
  return {
    options: merged.slice(0, SLASH_POPOVER_MAX_OPTIONS),
    truncated,
  };
}

export function mapSlashCatalogToOptions(input: {
  detectedPluginCommands: ReadonlyArray<{ label: string; description: string }>;
  installedPluginCommands: ReadonlyArray<ComposerPluginSlashCommandEntry>;
  installPluginCommands: ReadonlyArray<ComposerPluginSlashCommandEntry>;
  projectSkills: ClaudeProjectSkill[];
  userSkills?: ClaudeProjectSkill[];
  reservedSkillLabels: ReadonlySet<string>;
}): {
  detectedPluginSlashOptions: SlashOption[];
  installedPluginSlashOptions: SlashOption[];
  installPluginSlashOptions: SlashOption[];
  skillSlashOptions: SlashOption[];
} {
  return {
    detectedPluginSlashOptions: mapDetectedPluginSlashEntries(input.detectedPluginCommands),
    installedPluginSlashOptions: mapPluginSlashEntries(input.installedPluginCommands),
    installPluginSlashOptions: mapPluginSlashEntries(input.installPluginCommands),
    skillSlashOptions: buildSkillSlashOptionsFromList(
      {
        projectSkills: input.projectSkills,
        userSkills: input.userSkills,
      },
      input.reservedSkillLabels,
    ),
  };
}

export const SLASH_GROUP_TITLES: Record<NonNullable<SlashOption["group"]>, string> = {
  claude: "Claude 内置",
  "plugin-cmd": "已安装插件命令",
  plugin: "插件",
  skill: "Skills 技能",
};

export function buildSlashOptionSections(options: SlashOption[]): Array<{
  group: NonNullable<SlashOption["group"]>;
  title: string;
  items: Array<{ option: SlashOption; flatIndex: number }>;
}> {
  const sections: Array<{
    group: NonNullable<SlashOption["group"]>;
    title: string;
    items: Array<{ option: SlashOption; flatIndex: number }>;
  }> = [];

  for (const group of ["claude", "plugin-cmd", "plugin", "skill"] as const) {
    const items = options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => option.type === "command" && option.group === group)
      .map(({ option, index }) => ({ option, flatIndex: index }));

    if (items.length === 0) continue;
    sections.push({
      group,
      title: SLASH_GROUP_TITLES[group],
      items,
    });
  }

  return sections;
}

export function getFilteredAtOptions(
  query: string,
  fileResults: SlashOption[],
  employeeOptions: Array<{ id: string; name: string }>,
  teamOptions: Array<{ id: string; name: string }>,
  hideEmployeesInAtMode = false,
  codexAvailable = true,
  cursorAvailable = true,
  geminiAvailable = false,
  opencodeAvailable = false,
): SlashOption[] {
  const teams: SlashOption[] = teamOptions.map((team) => ({
    type: "team" as const,
    label: team.name,
    name: team.name,
    workflowId: team.id,
  }));

  const executionEngines: SlashOption[] = listExecutionEnvironmentEngineMentionOptions({
    codexAvailable,
    cursorAvailable,
    geminiAvailable,
    opencodeAvailable,
  }).map((row) => ({
    type: "execution_engine" as const,
    label: row.title,
    name: row.mentionName,
    description: row.description,
    executionEngine: row.engine,
    executionEngineAvailable: row.available,
  }));

  const agents: SlashOption[] = hideEmployeesInAtMode
    ? []
    : employeeOptions.map((employee) => ({
        type: "agent" as const,
        label: employee.name,
        name: employee.name,
      }));

  const q = query.toLowerCase();
  const filtered = [
    ...executionEngines.filter(
      (row) =>
        !q ||
        row.label.toLowerCase().includes(q) ||
        (row.name ?? "").toLowerCase().includes(q) ||
        (row.description ?? "").toLowerCase().includes(q) ||
        "执行环境".includes(q) ||
        "派发".includes(q),
    ),
    ...agents.filter((a) => !q || a.label.toLowerCase().includes(q)),
    ...teams.filter((t) => !q || t.label.toLowerCase().includes(q)),
    ...fileResults.filter(
      (f) => !q || f.label.toLowerCase().includes(q) || (f.description ?? "").toLowerCase().includes(q),
    ),
  ];

  return filtered.slice(0, 20);
}
