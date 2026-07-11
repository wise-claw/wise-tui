import { message } from "antd";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  createComposerCommonPhraseId,
  MAX_COMPOSER_COMMON_PHRASES,
  mergeComposerCommonPhrases,
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

/** 当前展示的常用语来自哪一层，供 UI 提示。merged=全局+仓库合并（仓库 scope 存在时）。 */
export type ComposerCommonPhrasesScopeLabel = "global" | "merged";

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
   * 当前会话所属仓库 id。提供时启用「全局 + 仓库合并」：
   * - effective = 全局 + 仓库级合并（全局在前，chord 冲突时仓库级优先、全局剥离 chord）。
   * - 全局条目只读，编辑（add/update/remove/persist）只作用于仓库级（scope="merged"）。
   * 不提供（undefined/null）→ 仅全局，可编辑（scope="global"，向后兼容）。
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

  // 订阅当前 scope 与全局 scope：合并场景需要全局变化时同步刷新。
  useSyncExternalStore(repoStore.subscribe, repoStore.getSnapshot, repoStore.getSnapshot);
  useSyncExternalStore(globalStore.subscribe, globalStore.getSnapshot, globalStore.getSnapshot);

  const repoPhrases = repoStore.getPhrases();
  const globalPhrases = globalStore.getPhrases();
  const loading = repoStore.getLoading() || globalStore.getLoading();
  const saving = repoStore.getSaving() || globalStore.getSaving();

  const hasRepositoryScope = repoStore.repositoryId != null;
  // 「全局 + 仓库合并」：仓库 scope 存在时，effective = 全局 + 仓库级合并（全局在前，
  // chord 冲突时仓库级优先、全局剥离 chord）；否则 effective = 全局。
  const effectivePhrases = hasRepositoryScope
    ? mergeComposerCommonPhrases(globalPhrases, repoPhrases)
    : globalPhrases;
  // 可编辑源：仓库 scope 存在时为仓库级（全局只读），否则为全局（向后兼容无仓库场景）。
  const editablePhrases = hasRepositoryScope ? repoPhrases : globalPhrases;
  const scope: ComposerCommonPhrasesScopeLabel = hasRepositoryScope ? "merged" : "global";

  const bindings = useMemo(() => buildBindings(effectivePhrases), [effectivePhrases]);

  const refresh = useCallback(async () => {
    await repoStore.ensureLoaded();
    if (hasRepositoryScope) {
      await globalStore.ensureLoaded();
    }
  }, [repoStore, globalStore, hasRepositoryScope]);

  // persist 写入当前 scope：有 repositoryId → 仓库 scope；否则 → 全局 scope。
  // 合并模式下编辑只作用于仓库级，全局通过 GlobalComposerCommonPhrasesManager 管理。
  const persist = useCallback(
    async (next: ComposerCommonPhrase[]) => {
      await repoStore.persist(next);
    },
    [repoStore],
  );

  const addPhrase = useCallback(async () => {
    if (editablePhrases.length >= MAX_COMPOSER_COMMON_PHRASES) {
      message.warning(`最多 ${MAX_COMPOSER_COMMON_PHRASES} 条常用语`);
      return;
    }
    const draft: ComposerCommonPhrase = {
      id: createComposerCommonPhraseId(),
      title: "新常用语",
      text: "请填写要发送的正文",
    };
    await persist([...editablePhrases, draft]);
  }, [persist, editablePhrases]);

  const updatePhrase = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ComposerCommonPhrase, "title" | "text" | "chord" | "action">>,
    ) => {
      const next = editablePhrases.map((phrase) => {
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
    [persist, editablePhrases],
  );

  const removePhrase = useCallback(
    async (id: string) => {
      await persist(editablePhrases.filter((phrase) => phrase.id !== id));
    },
    [persist, editablePhrases],
  );

  return {
    phrases: effectivePhrases,
    /** 可编辑源：仓库 scope 存在时为仓库级，否则为全局。add/update/remove 作用于此。 */
    editablePhrases,
    /** 全局常用语（仓库 scope 存在时为只读叠加源）。 */
    globalPhrases,
    bindings,
    loading,
    saving,
    refresh,
    addPhrase,
    updatePhrase,
    removePhrase,
    persist,
    /** 当前展示来源：global / merged。 */
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
