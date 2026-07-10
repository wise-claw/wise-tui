/**
 * 搜索面板“最近打开的文件”历史，按仓库隔离存储。
 *
 * 文件名搜索与内容搜索各自维护一份最近打开文件列表，每仓库独立：
 * `wise.search.history.byRepo.v1` = `Record<repositoryId, { filename: SearchHistoryEntry[]; content: SearchHistoryEntry[] }>`。
 *
 * 沿用 `composerCommonPhrasesByRepo` 的 per-仓库 KV 先例：全局 app setting 里用
 * `repositoryId`（number）分桶，避免新增 DB 表。后端零改动，复用
 * `get_app_setting` / `set_app_setting`。同一仓库同一 mode 内按文件路径去重并保持
 * 最新在前，封顶 `MAX_SEARCH_HISTORY` 条，避免无界增长。
 */
import { getAppSetting, setAppSetting } from "./appSettingsStore";

export const SEARCH_HISTORY_BY_REPO_KEY = "wise.search.history.byRepo.v1";
export const WISE_SEARCH_HISTORY_BY_REPO_CHANGED = "wise:search-history-by-repo-changed";

export type SearchHistoryMode = "filename" | "content";

export interface SearchHistoryEntry {
  /** 仓库相对文件路径。 */
  path: string;
  /** content 模式命中行（可选），用于再次打开时定位到该行。 */
  line?: number | null;
  timestamp: number;
}

/** 单仓库的最近打开文件历史：文件名 / 内容两栏独立。 */
export type RepoSearchHistory = Record<SearchHistoryMode, SearchHistoryEntry[]>;

export type SearchHistoryByRepoMap = Record<number, RepoSearchHistory>;

/** 单仓库单 mode 最多保留的最近文件条数（文件名与内容各自计数）。 */
export const MAX_SEARCH_HISTORY = 20;

function emptyRepoHistory(): RepoSearchHistory {
  return { filename: [], content: [] };
}

/**
 * 规范化仓库相对文件路径：去首尾空白 + 去前导 `/`（与 `CommandPalette` 搜索逻辑一致，
 * 输入 `/src/foo` 时实际按 `src/foo` 检索）。规范化后为空串则不记录。
 */
export function normalizeSearchFilePath(raw: string): string {
  return raw.trim().replace(/^\/+/, "");
}

function parseEntry(value: unknown): SearchHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.path !== "string") return null;
  const path = entry.path.trim();
  if (!path) return null;
  const timestamp =
    typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)
      ? entry.timestamp
      : 0;
  const result: SearchHistoryEntry = { path, timestamp };
  if (typeof entry.line === "number" && Number.isFinite(entry.line)) {
    result.line = entry.line;
  }
  return result;
}

function parseRepoHistory(value: unknown): RepoSearchHistory {
  if (!value || typeof value !== "object") return emptyRepoHistory();
  const obj = value as Record<string, unknown>;
  const parseList = (raw: unknown): SearchHistoryEntry[] =>
    Array.isArray(raw)
      ? raw
          .map(parseEntry)
          .filter((entry): entry is SearchHistoryEntry => entry !== null)
      : [];
  return {
    filename: parseList(obj.filename),
    content: parseList(obj.content),
  };
}

function parseMap(raw: string | null | undefined): SearchHistoryByRepoMap {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: SearchHistoryByRepoMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const repositoryId = Number(key);
      if (!Number.isFinite(repositoryId) || repositoryId <= 0) continue;
      const repoHistory = parseRepoHistory(value);
      if (repoHistory.filename.length === 0 && repoHistory.content.length === 0) continue;
      out[repositoryId] = repoHistory;
    }
    return out;
  } catch {
    return {};
  }
}

function serializeMap(map: SearchHistoryByRepoMap): string {
  const out: Record<string, RepoSearchHistory> = {};
  for (const [repositoryId, repoHistory] of Object.entries(map)) {
    if (!repoHistory) continue;
    if (repoHistory.filename.length === 0 && repoHistory.content.length === 0) continue;
    out[repositoryId] = repoHistory;
  }
  return JSON.stringify(out);
}

function dispatchChanged(map: SearchHistoryByRepoMap): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_SEARCH_HISTORY_BY_REPO_CHANGED, { detail: { map } }),
  );
}

export async function loadSearchHistoryByRepoMap(): Promise<SearchHistoryByRepoMap> {
  const raw = await getAppSetting(SEARCH_HISTORY_BY_REPO_KEY);
  return parseMap(raw);
}

export async function loadSearchHistoryForRepo(
  repositoryId: number,
  mode: SearchHistoryMode,
): Promise<SearchHistoryEntry[]> {
  const map = await loadSearchHistoryByRepoMap();
  return map[repositoryId]?.[mode] ?? [];
}

/**
 * 同路径去重后置顶并封顶 `MAX_SEARCH_HISTORY`，返回新的该 mode 列表。
 * content 模式带 `line` 时记录定位行；filename 模式不带 line。
 */
function dedupeAndPrepend(
  entries: SearchHistoryEntry[],
  path: string,
  timestamp: number,
  line?: number | null,
): SearchHistoryEntry[] {
  const newEntry: SearchHistoryEntry = { path, timestamp };
  if (typeof line === "number" && Number.isFinite(line)) {
    newEntry.line = line;
  }
  const filtered = entries.filter((entry) => entry.path !== path);
  return [newEntry, ...filtered].slice(0, MAX_SEARCH_HISTORY);
}

export async function addSearchHistoryForRepo(
  repositoryId: number,
  mode: SearchHistoryMode,
  rawPath: string,
  line?: number | null,
): Promise<SearchHistoryEntry[]> {
  const path = normalizeSearchFilePath(rawPath);
  if (!path) return [];
  const map = await loadSearchHistoryByRepoMap();
  const current = map[repositoryId] ?? emptyRepoHistory();
  const next: RepoSearchHistory = {
    ...current,
    [mode]: dedupeAndPrepend(current[mode], path, Date.now(), line),
  };
  const nextMap = { ...map, [repositoryId]: next };
  await setAppSetting(SEARCH_HISTORY_BY_REPO_KEY, serializeMap(nextMap));
  dispatchChanged(nextMap);
  return next[mode];
}

export async function removeSearchHistoryForRepo(
  repositoryId: number,
  mode: SearchHistoryMode,
  rawPath: string,
): Promise<SearchHistoryEntry[]> {
  const normalized = normalizeSearchFilePath(rawPath);
  const map = await loadSearchHistoryByRepoMap();
  const current = map[repositoryId];
  if (!current) return [];
  const nextEntries = current[mode].filter((entry) => entry.path !== normalized);
  return commitRepoHistory(map, repositoryId, mode, { ...current, [mode]: nextEntries });
}

export async function clearSearchHistoryForRepo(
  repositoryId: number,
  mode: SearchHistoryMode,
): Promise<void> {
  const map = await loadSearchHistoryByRepoMap();
  const current = map[repositoryId];
  if (!current || current[mode].length === 0) return;
  await commitRepoHistory(map, repositoryId, mode, { ...current, [mode]: [] });
}

export async function clearAllSearchHistoryForRepo(repositoryId: number): Promise<void> {
  const map = await loadSearchHistoryByRepoMap();
  if (!(repositoryId in map)) return;
  const next = { ...map };
  delete next[repositoryId];
  await setAppSetting(SEARCH_HISTORY_BY_REPO_KEY, serializeMap(next));
  dispatchChanged(next);
}

/**
 * 写回某仓库的历史并广播变更。若两栏皆空则从 map 删除该仓库桶（避免遗留空对象）。
 * 返回写入的 `mode` 列表，供 store 刷新本地缓存。
 */
async function commitRepoHistory(
  map: SearchHistoryByRepoMap,
  repositoryId: number,
  mode: SearchHistoryMode,
  next: RepoSearchHistory,
): Promise<SearchHistoryEntry[]> {
  const nextMap = { ...map };
  if (next.filename.length === 0 && next.content.length === 0) {
    delete nextMap[repositoryId];
  } else {
    nextMap[repositoryId] = next;
  }
  await setAppSetting(SEARCH_HISTORY_BY_REPO_KEY, serializeMap(nextMap));
  dispatchChanged(nextMap);
  return next[mode];
}
