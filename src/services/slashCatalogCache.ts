import {
  isOmcPluginInstalled,
  listClaudePluginCacheSkills,
  listClaudeProjectSkills,
  listClaudeUserSkills,
} from "./claude";
import { listCodexUserSkills } from "./codex";
import { claudePluginListInstalled } from "./claudePluginMarket";
import type { ClaudeProjectSkill } from "../types";
import { resolveEngineSlashCatalogGroup } from "../constants/engineSlashCommands";
import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { CLAUDE_BUILTIN_SLASH_COMMANDS } from "../constants/claudeCodeSlashCommands";
import {
  buildComposerPluginInstallSlashCommands,
  buildComposerPluginInstalledSlashCommands,
} from "../constants/composerPluginSlashCommands";
import { buildInstalledPluginSlashOptionsFromSkills } from "../utils/installedPluginSlashCommands";

const CLAUDE_RESERVED_LABELS = new Set(
  CLAUDE_BUILTIN_SLASH_COMMANDS.map((cmd) => cmd.label.trim().toLowerCase()),
);

const CACHE_TTL_MS = 30_000;

export interface SlashCatalogDetectedCommand {
  label: string;
  description: string;
}

export interface SlashCatalogPluginCommand {
  label: string;
  description: string;
}

export interface SlashCatalogSnapshot {
  omcInstalled: boolean;
  detectedPluginCommands: SlashCatalogDetectedCommand[];
  installedPluginCommands: SlashCatalogPluginCommand[];
  installPluginCommands: SlashCatalogPluginCommand[];
  projectSkills: ClaudeProjectSkill[];
  userSkills: ClaudeProjectSkill[];
  pluginCacheSkills: ClaudeProjectSkill[];
  fetchedAt: number;
}

interface CacheEntry {
  key: string;
  snapshot: SlashCatalogSnapshot;
}

let cacheEntry: CacheEntry | null = null;
const inflightByKey = new Map<string, Promise<SlashCatalogSnapshot>>();

function cacheKey(
  repositoryPath: string | null,
  executionEngine: SessionExecutionEngine,
): string {
  const repo = repositoryPath?.trim() || "__global__";
  return `${resolveEngineSlashCatalogGroup(executionEngine)}:${repo}`;
}

function isFresh(entry: CacheEntry, key: string): boolean {
  return entry.key === key && Date.now() - entry.snapshot.fetchedAt < CACHE_TTL_MS;
}

export function invalidateSlashCatalogCache(): void {
  cacheEntry = null;
  inflightByKey.clear();
}

function staleSnapshotForKey(key: string): SlashCatalogSnapshot | null {
  if (cacheEntry?.key !== key) return null;
  return cacheEntry.snapshot;
}

async function fetchSlashCatalog(
  repositoryPath: string | null,
  executionEngine: SessionExecutionEngine,
): Promise<SlashCatalogSnapshot> {
  const repo = repositoryPath?.trim() || null;
  // 全局技能按执行环境识别：Codex（CLI/RPC）展示 `~/.codex/skills` 等用户级技能，
  // 其余引擎维持现状展示 Claude 用户级技能，避免跨引擎误用。
  const isCodexEngine = resolveEngineSlashCatalogGroup(executionEngine) === "codex";
  const userSkillsLoader = isCodexEngine ? listCodexUserSkills : listClaudeUserSkills;
  const [omcInstalled, cacheSkills, installedRows, projectSkills, userSkills] = await Promise.all([
    isOmcPluginInstalled().catch(() => false),
    listClaudePluginCacheSkills(repo).catch(() => []),
    claudePluginListInstalled(repo).catch(() => []),
    repo ? listClaudeProjectSkills(repo).catch(() => []) : Promise.resolve([]),
    userSkillsLoader().catch(() => []),
  ]);

  const detectedPluginCommands = buildInstalledPluginSlashOptionsFromSkills(
    cacheSkills,
    CLAUDE_RESERVED_LABELS,
  ).map((cmd) => ({
    label: cmd.label,
    description: cmd.description ?? "",
  }));

  return {
    omcInstalled,
    detectedPluginCommands,
    installedPluginCommands: buildComposerPluginInstalledSlashCommands(installedRows),
    installPluginCommands: buildComposerPluginInstallSlashCommands(installedRows),
    projectSkills,
    userSkills,
    pluginCacheSkills: cacheSkills,
    fetchedAt: Date.now(),
  };
}

export async function loadSlashCatalog(
  repositoryPath?: string | null,
  options?: { force?: boolean; executionEngine?: SessionExecutionEngine },
): Promise<SlashCatalogSnapshot> {
  const executionEngine = options?.executionEngine ?? "claude";
  const key = cacheKey(repositoryPath ?? null, executionEngine);
  if (!options?.force && cacheEntry && isFresh(cacheEntry, key)) {
    return cacheEntry.snapshot;
  }

  const existingInflight = inflightByKey.get(key);
  if (!options?.force && existingInflight) {
    return existingInflight;
  }

  const pending = fetchSlashCatalog(repositoryPath ?? null, executionEngine)
    .then((snapshot) => {
      cacheEntry = { key, snapshot };
      inflightByKey.delete(key);
      return snapshot;
    })
    .catch((error) => {
      inflightByKey.delete(key);
      const stale = staleSnapshotForKey(key);
      if (stale) return stale;
      throw error;
    });

  inflightByKey.set(key, pending);
  return pending;
}
