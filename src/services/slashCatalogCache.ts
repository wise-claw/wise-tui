import { isOmcPluginInstalled, listClaudePluginCacheSkills, listClaudeProjectSkills } from "./claude";
import { claudePluginListInstalled } from "./claudePluginMarket";
import type { ClaudeProjectSkill } from "../types";
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
  pluginCacheSkills: ClaudeProjectSkill[];
  fetchedAt: number;
}

interface CacheEntry {
  key: string;
  snapshot: SlashCatalogSnapshot;
}

let cacheEntry: CacheEntry | null = null;
let inflight: Promise<SlashCatalogSnapshot> | null = null;

function cacheKey(repositoryPath: string | null): string {
  return repositoryPath?.trim() || "__global__";
}

function isFresh(entry: CacheEntry, key: string): boolean {
  return entry.key === key && Date.now() - entry.snapshot.fetchedAt < CACHE_TTL_MS;
}

export function invalidateSlashCatalogCache(): void {
  cacheEntry = null;
  inflight = null;
}

async function fetchSlashCatalog(repositoryPath: string | null): Promise<SlashCatalogSnapshot> {
  const repo = repositoryPath?.trim() || null;
  const [omcInstalled, cacheSkills, installedRows, projectSkills] = await Promise.all([
    isOmcPluginInstalled().catch(() => false),
    listClaudePluginCacheSkills(repo).catch(() => []),
    claudePluginListInstalled(repo).catch(() => []),
    repo ? listClaudeProjectSkills(repo).catch(() => []) : Promise.resolve([]),
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
    pluginCacheSkills: cacheSkills,
    fetchedAt: Date.now(),
  };
}

export async function loadSlashCatalog(
  repositoryPath?: string | null,
  options?: { force?: boolean },
): Promise<SlashCatalogSnapshot> {
  const key = cacheKey(repositoryPath ?? null);
  if (!options?.force && cacheEntry && isFresh(cacheEntry, key)) {
    return cacheEntry.snapshot;
  }

  if (!options?.force && inflight) {
    return inflight;
  }

  const pending = fetchSlashCatalog(repositoryPath ?? null)
    .then((snapshot) => {
      cacheEntry = { key, snapshot };
      inflight = null;
      return snapshot;
    })
    .catch((error) => {
      inflight = null;
      throw error;
    });

  inflight = pending;
  return pending;
}
