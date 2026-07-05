/**
 * 会话常用语按仓库隔离存储。
 *
 * 作用域语义（与 `useComposerCommonPhrases` 配合）：
 * - 全局常用语仍存 `wise.defaultConfig.v1.composerCommonPhrases`（兜底源，未改）。
 * - 本模块存「仓库级覆盖」：`wise.composer.commonPhrasesByRepo.v1` = `Record<repositoryId, ComposerCommonPhrase[]>`。
 * - 仓库有自己的配置时只显示仓库的；仓库无配置时回退全局。
 *
 * 存储沿用 `repositoryRunCommandRowActionPreference` 的 per-仓库 KV 先例：全局 app setting
 * 里用 `repositoryId`（number）分桶，避免新增 DB 表。chord 同列表去重由
 * `normalizeComposerCommonPhrases` 保证；跨 scope（全局↔仓库）chord 冲突第一版不强制，
 * 留作用户手动避免（不同仓库不会同时激活，全局与当前仓库同 chord 时当前仓库生效）。
 */
import type { ComposerCommonPhrase } from "../constants/composerCommonPhrase";
import { normalizeComposerCommonPhrases } from "../constants/composerCommonPhrase";
import { getAppSetting, setAppSetting } from "./appSettingsStore";

export const COMPOSER_COMMON_PHRASES_BY_REPO_KEY = "wise.composer.commonPhrasesByRepo.v1";
export const WISE_COMPOSER_COMMON_PHRASES_BY_REPO_CHANGED =
  "wise:composer-common-phrases-by-repo-changed";

export type ComposerCommonPhrasesByRepoMap = Record<number, ComposerCommonPhrase[]>;

function parseMap(raw: string | null | undefined): ComposerCommonPhrasesByRepoMap {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: ComposerCommonPhrasesByRepoMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const repositoryId = Number(key);
      if (!Number.isFinite(repositoryId) || repositoryId <= 0) continue;
      const phrases = normalizeComposerCommonPhrases(value);
      if (phrases.length === 0) continue;
      out[repositoryId] = phrases;
    }
    return out;
  } catch {
    return {};
  }
}

function serializeMap(map: ComposerCommonPhrasesByRepoMap): string {
  const out: Record<string, ComposerCommonPhrase[]> = {};
  for (const [repositoryId, phrases] of Object.entries(map)) {
    if (!phrases || phrases.length === 0) continue;
    out[repositoryId] = phrases;
  }
  return JSON.stringify(out);
}

function dispatchChanged(map: ComposerCommonPhrasesByRepoMap): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_COMPOSER_COMMON_PHRASES_BY_REPO_CHANGED, { detail: { map } }),
  );
}

export async function loadComposerCommonPhrasesByRepoMap(): Promise<ComposerCommonPhrasesByRepoMap> {
  const raw = await getAppSetting(COMPOSER_COMMON_PHRASES_BY_REPO_KEY);
  return parseMap(raw);
}

export async function loadComposerCommonPhrasesForRepo(
  repositoryId: number,
): Promise<ComposerCommonPhrase[]> {
  const map = await loadComposerCommonPhrasesByRepoMap();
  return map[repositoryId] ?? [];
}

export async function saveComposerCommonPhrasesForRepo(
  repositoryId: number,
  phrases: ComposerCommonPhrase[],
): Promise<ComposerCommonPhrase[]> {
  const normalized = normalizeComposerCommonPhrases(phrases);
  const map = await loadComposerCommonPhrasesByRepoMap();
  const next = { ...map };
  if (normalized.length === 0) {
    delete next[repositoryId];
  } else {
    next[repositoryId] = normalized;
  }
  await setAppSetting(COMPOSER_COMMON_PHRASES_BY_REPO_KEY, serializeMap(next));
  dispatchChanged(next);
  return normalized;
}

export async function deleteComposerCommonPhrasesForRepo(repositoryId: number): Promise<void> {
  const map = await loadComposerCommonPhrasesByRepoMap();
  if (!(repositoryId in map)) return;
  const next = { ...map };
  delete next[repositoryId];
  await setAppSetting(COMPOSER_COMMON_PHRASES_BY_REPO_KEY, serializeMap(next));
  dispatchChanged(next);
}
