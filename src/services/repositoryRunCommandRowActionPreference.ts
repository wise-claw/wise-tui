/**
 * 左栏仓库行「运行 / 停止」快捷按钮：按仓库 id 独立开关。
 * 在仓库「更多 → 运行」子菜单中切换。
 */
import { getAppSetting, setAppSetting } from "./appSettingsStore";

export const REPOSITORY_RUN_COMMAND_ROW_PINNED_BY_REPO_KEY =
  "wise.sidebar.repositoryRunCommandRowPinnedByRepo.v1";

/** @deprecated 全局开关；仅用于一次性迁入 per-repo 映射。 */
const LEGACY_GLOBAL_PINNED_KEY = "wise.sidebar.repositoryRunCommandRowPinned.v1";

export const WISE_REPOSITORY_RUN_COMMAND_ROW_PINNED_CHANGED =
  "wise:repository-run-command-row-pinned-changed";

export type RepositoryRunCommandRowPinnedMap = Record<number, boolean>;

function normalizeBoolean(raw: string | null | undefined, fallback = false): boolean {
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "1" || trimmed === "true") return true;
  if (trimmed === "0" || trimmed === "false") return false;
  return fallback;
}

function parsePinnedMap(raw: string | null | undefined): RepositoryRunCommandRowPinnedMap {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: RepositoryRunCommandRowPinnedMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const repositoryId = Number(key);
      if (!Number.isFinite(repositoryId) || repositoryId <= 0) continue;
      if (value === true || value === "1" || value === "true") out[repositoryId] = true;
    }
    return out;
  } catch {
    return {};
  }
}

function serializePinnedMap(map: RepositoryRunCommandRowPinnedMap): string {
  const out: Record<string, boolean> = {};
  for (const [repositoryId, pinned] of Object.entries(map)) {
    if (!pinned) continue;
    out[String(repositoryId)] = true;
  }
  return JSON.stringify(out);
}

function dispatchChanged(map: RepositoryRunCommandRowPinnedMap): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_REPOSITORY_RUN_COMMAND_ROW_PINNED_CHANGED, {
      detail: { map },
    }),
  );
}

async function migrateLegacyGlobalFlag(): Promise<RepositoryRunCommandRowPinnedMap | null> {
  const raw = await getAppSetting(LEGACY_GLOBAL_PINNED_KEY);
  if (raw == null) return null;
  if (!normalizeBoolean(raw)) {
    await setAppSetting(LEGACY_GLOBAL_PINNED_KEY, "0");
    return {};
  }
  return null;
}

export async function loadRepositoryRunCommandRowPinnedMap(): Promise<RepositoryRunCommandRowPinnedMap> {
  const stored = await getAppSetting(REPOSITORY_RUN_COMMAND_ROW_PINNED_BY_REPO_KEY);
  if (stored != null) return parsePinnedMap(stored);

  const migrated = await migrateLegacyGlobalFlag();
  const resolved = migrated ?? {};
  await setAppSetting(REPOSITORY_RUN_COMMAND_ROW_PINNED_BY_REPO_KEY, serializePinnedMap(resolved));
  return resolved;
}

export function isRepositoryRunCommandRowPinned(
  map: RepositoryRunCommandRowPinnedMap,
  repositoryId: number,
): boolean {
  return map[repositoryId] === true;
}

export async function setRepositoryRunCommandRowPinned(
  repositoryId: number,
  pinned: boolean,
): Promise<RepositoryRunCommandRowPinnedMap> {
  const current = await loadRepositoryRunCommandRowPinnedMap();
  const next = { ...current };
  if (pinned) next[repositoryId] = true;
  else delete next[repositoryId];
  await setAppSetting(REPOSITORY_RUN_COMMAND_ROW_PINNED_BY_REPO_KEY, serializePinnedMap(next));
  dispatchChanged(next);
  return next;
}

export async function toggleRepositoryRunCommandRowPinned(
  repositoryId: number,
): Promise<boolean> {
  const current = await loadRepositoryRunCommandRowPinnedMap();
  const nextPinned = !isRepositoryRunCommandRowPinned(current, repositoryId);
  await setRepositoryRunCommandRowPinned(repositoryId, nextPinned);
  return nextPinned;
}
