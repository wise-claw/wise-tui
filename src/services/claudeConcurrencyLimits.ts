import { getAppSettingJson, setAppSettingJson } from "./appSettingsStore";

export const CLAUDE_CONCURRENCY_LIMITS_STORAGE_KEY = "wise.claudeConcurrencyLimitsByProjectRepo.v1";

export const DEFAULT_CLAUDE_CONCURRENCY_LIMIT = 16;
export const MIN_CLAUDE_CONCURRENCY_LIMIT = 1;
export const MAX_CLAUDE_CONCURRENCY_LIMIT = 32;

export type ClaudeConcurrencyLimitsMap = Record<string, number>;

export function claudeConcurrencyScopeKey(projectId: string, repositoryId: number): string {
  return `${projectId}:${repositoryId}`;
}

export function clampConcurrencyLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CLAUDE_CONCURRENCY_LIMIT;
  return Math.min(MAX_CLAUDE_CONCURRENCY_LIMIT, Math.max(MIN_CLAUDE_CONCURRENCY_LIMIT, Math.floor(value)));
}

export function getConcurrencyLimitForScope(
  map: ClaudeConcurrencyLimitsMap | null | undefined,
  projectId: string,
  repositoryId: number,
): number {
  const key = claudeConcurrencyScopeKey(projectId, repositoryId);
  const raw = map?.[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_CLAUDE_CONCURRENCY_LIMIT;
  }
  return clampConcurrencyLimit(raw);
}

export async function loadClaudeConcurrencyLimits(): Promise<ClaudeConcurrencyLimitsMap> {
  const raw = await getAppSettingJson<ClaudeConcurrencyLimitsMap>(CLAUDE_CONCURRENCY_LIMITS_STORAGE_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw;
}

export async function saveClaudeConcurrencyLimits(map: ClaudeConcurrencyLimitsMap): Promise<void> {
  await setAppSettingJson(CLAUDE_CONCURRENCY_LIMITS_STORAGE_KEY, map);
}
