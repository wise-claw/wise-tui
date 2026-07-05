import { message } from "antd";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  createComposerCommonPhraseId,
  MAX_COMPOSER_COMMON_PHRASES,
  resolveComposerCommonPhraseAction,
  type ComposerCommonPhrase,
  type ComposerCommonPhraseAction,
} from "../constants/composerCommonPhrase";
import {
  formatChordForDisplay,
  normalizeChord,
} from "../utils/atMentionShortcutChord";
import {
  getComposerCommonPhrasesStore,
  type ComposerCommonPhrasesStoreApi,
} from "../stores/composerCommonPhrasesStore";

export interface ComposerCommonPhraseBinding {
  id: string;
  title: string;
  text: string;
  action: ComposerCommonPhraseAction;
  chord: string;
  displayKeys: string;
}

/** 当前展示的常用语来自哪一层，供 UI 提示。 */
export type ComposerCommonPhrasesScopeLabel = "global" | "repository" | "fallback-global";

function buildBindings(phrases: readonly ComposerCommonPhrase[]): ComposerCommonPhraseBinding[] {
  const out: ComposerCommonPhraseBinding[] = [];
  for (const phrase of phrases) {
    const chord = phrase.chord?.trim();
    if (!chord) continue;
    out.push({
      id: phrase.id,
      title: phrase.title,
      text: phrase.text,
      action: resolveComposerCommonPhraseAction(phrase),
      chord,
      displayKeys: formatChordForDisplay(chord),
    });
  }
  return out;
}

export interface UseComposerCommonPhrasesOptions {
  /**
   * 当前会话所属仓库 id。提供时启用「仓库优先 + 全局兜底」：
   * - 仓库有自己的配置 → 只显示仓库的（scope="repository"）。
   * - 仓库无配置 → 回退显示全局的（scope="fallback-global"，只读引用，不写入仓库）。
   * - 首次在该仓库编辑（add/update/remove/persist）时，以当前 effective phrases（可能是全局副本）
   *   为起点写入仓库 scope，之后该仓库独立。
   * 不提供（undefined/null）→ 全局（scope="global"，向后兼容）。
   */
  repositoryId?: number | null;
}

export function useComposerCommonPhrases({
  repositoryId,
}: UseComposerCommonPhrasesOptions = {}) {
  const repoStore = useMemo(
    () => getComposerCommonPhrasesStore({ repositoryId }),
    [repositoryId],
  );
  const globalStore = useMemo(() => getComposerCommonPhrasesStore({}), []);

  // 订阅当前 scope 与全局 scope：fallback 场景需要全局变化时同步刷新。
  useSyncExternalStore(repoStore.subscribe, repoStore.getSnapshot, repoStore.getSnapshot);
  useSyncExternalStore(globalStore.subscribe, globalStore.getSnapshot, globalStore.getSnapshot);

  const repoPhrases = repoStore.getPhrases();
  const globalPhrases = globalStore.getPhrases();
  const loading = repoStore.getLoading() || globalStore.getLoading();
  const saving = repoStore.getSaving() || globalStore.getSaving();

  const hasRepositoryScope = repoStore.repositoryId != null;
  const useRepositoryPhrases = hasRepositoryScope && repoPhrases.length > 0;
  const effectivePhrases = useRepositoryPhrases ? repoPhrases : globalPhrases;
  const scope: ComposerCommonPhrasesScopeLabel = !hasRepositoryScope
    ? "global"
    : useRepositoryPhrases
      ? "repository"
      : "fallback-global";

  const bindings = useMemo(() => buildBindings(effectivePhrases), [effectivePhrases]);

  const refresh = useCallback(async () => {
    await repoStore.ensureLoaded();
    if (hasRepositoryScope) {
      await globalStore.ensureLoaded();
    }
  }, [repoStore, globalStore, hasRepositoryScope]);

  // persist 写入当前 scope：有 repositoryId → 仓库 scope（首次写入以 effective 为起点）；
  // 否则 → 全局 scope。
  const persist = useCallback(
    async (next: ComposerCommonPhrase[]) => {
      await repoStore.persist(next);
    },
    [repoStore],
  );

  const addPhrase = useCallback(async () => {
    if (effectivePhrases.length >= MAX_COMPOSER_COMMON_PHRASES) {
      message.warning(`最多 ${MAX_COMPOSER_COMMON_PHRASES} 条常用语`);
      return;
    }
    const draft: ComposerCommonPhrase = {
      id: createComposerCommonPhraseId(),
      title: "新常用语",
      text: "请填写要发送的正文",
    };
    await persist([...effectivePhrases, draft]);
  }, [persist, effectivePhrases]);

  const updatePhrase = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ComposerCommonPhrase, "title" | "text" | "chord" | "action">>,
    ) => {
      const next = effectivePhrases.map((phrase) => {
        if (phrase.id !== id) return phrase;
        const updated = { ...phrase, ...patch };
        if (patch.chord !== undefined) {
          const normalized = normalizeChord(patch.chord);
          if (!normalized) {
            const { chord: _removed, ...rest } = updated;
            return rest;
          }
          return { ...updated, chord: normalized };
        }
        return updated;
      });
      await persist(next);
    },
    [persist, effectivePhrases],
  );

  const removePhrase = useCallback(
    async (id: string) => {
      await persist(effectivePhrases.filter((phrase) => phrase.id !== id));
    },
    [persist, effectivePhrases],
  );

  return {
    phrases: effectivePhrases,
    bindings,
    loading,
    saving,
    refresh,
    addPhrase,
    updatePhrase,
    removePhrase,
    persist,
    /** 当前展示来源：global / repository / fallback-global。 */
    scope,
    /** 是否绑定了仓库 scope（用于 UI 决定是否显示仓库提示）。 */
    hasRepositoryScope,
  };
}

/** 供不需要订阅、只取 store api 的调用方使用。 */
export function getComposerCommonPhrasesStoreApi(
  options: UseComposerCommonPhrasesOptions = {},
): ComposerCommonPhrasesStoreApi {
  return getComposerCommonPhrasesStore({ repositoryId: options.repositoryId });
}
