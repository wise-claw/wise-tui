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
  composerCommonPhrasesStore,
  persistComposerCommonPhrasesStore,
} from "../stores/composerCommonPhrasesStore";

export interface ComposerCommonPhraseBinding {
  id: string;
  title: string;
  text: string;
  action: ComposerCommonPhraseAction;
  chord: string;
  displayKeys: string;
}

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

export function useComposerCommonPhrases() {
  useSyncExternalStore(
    composerCommonPhrasesStore.subscribe,
    composerCommonPhrasesStore.getSnapshot,
    composerCommonPhrasesStore.getSnapshot,
  );

  const phrases = composerCommonPhrasesStore.getPhrases();
  const loading = composerCommonPhrasesStore.getLoading();
  const saving = composerCommonPhrasesStore.getSaving();

  const bindings = useMemo(() => buildBindings(phrases), [phrases]);

  const refresh = useCallback(async () => {
    await composerCommonPhrasesStore.ensureLoaded();
  }, []);

  const persist = useCallback(async (next: ComposerCommonPhrase[]) => {
    await persistComposerCommonPhrasesStore(next);
  }, []);

  const addPhrase = useCallback(async () => {
    if (phrases.length >= MAX_COMPOSER_COMMON_PHRASES) {
      message.warning(`最多 ${MAX_COMPOSER_COMMON_PHRASES} 条常用语`);
      return;
    }
    const draft: ComposerCommonPhrase = {
      id: createComposerCommonPhraseId(),
      title: "新常用语",
      text: "请填写要发送的正文",
    };
    await persist([...phrases, draft]);
  }, [persist, phrases]);

  const updatePhrase = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ComposerCommonPhrase, "title" | "text" | "chord" | "action">>,
    ) => {
      const next = phrases.map((phrase) => {
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
    [persist, phrases],
  );

  const removePhrase = useCallback(
    async (id: string) => {
      await persist(phrases.filter((phrase) => phrase.id !== id));
    },
    [persist, phrases],
  );

  return {
    phrases,
    bindings,
    loading,
    saving,
    refresh,
    addPhrase,
    updatePhrase,
    removePhrase,
    persist,
  };
}
