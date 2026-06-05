import { message } from "antd";
import type { ComposerCommonPhrase } from "../constants/composerCommonPhrase";
import {
  loadComposerCommonPhrasesFromStore,
  saveComposerCommonPhrasesToStore,
  WISE_COMPOSER_COMMON_PHRASES_CHANGED,
} from "../services/wiseDefaultConfigStore";
import {
  isReservedComposerChord,
  normalizeChord,
} from "../utils/atMentionShortcutChord";

type Listener = () => void;

let phrases: ComposerCommonPhrase[] = [];
let loading = false;
let saving = false;
let loaded = false;
let generation = 0;
let loadPromise: Promise<void> | null = null;

const listeners = new Set<Listener>();

function bump(): void {
  generation += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function setPhrases(next: ComposerCommonPhrase[]): void {
  phrases = next;
  loaded = true;
  bump();
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (loadPromise) {
    await loadPromise;
    return;
  }
  loading = true;
  bump();
  loadPromise = (async () => {
    try {
      phrases = await loadComposerCommonPhrasesFromStore();
      loaded = true;
    } finally {
      loading = false;
      loadPromise = null;
      bump();
    }
  })();
  await loadPromise;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  void ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return generation;
}

function getPhrases(): readonly ComposerCommonPhrase[] {
  return phrases;
}

function getLoading(): boolean {
  return loading;
}

function getSaving(): boolean {
  return saving;
}

export async function persistComposerCommonPhrasesStore(
  next: ComposerCommonPhrase[],
): Promise<ComposerCommonPhrase[]> {
  for (const phrase of next) {
    const chord = phrase.chord ? normalizeChord(phrase.chord) : "";
    if (chord && isReservedComposerChord(chord)) {
      message.warning(`「${phrase.title}」快捷键与附加文件（⌘I）冲突，请修改`);
      throw new Error("reserved-chord");
    }
  }
  saving = true;
  bump();
  try {
    const saved = await saveComposerCommonPhrasesToStore(next);
    setPhrases(saved);
    return saved;
  } catch (err) {
    if (err instanceof Error && err.message === "reserved-chord") {
      throw err;
    }
    message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    saving = false;
    bump();
  }
}

export const composerCommonPhrasesStore = {
  subscribe,
  getSnapshot,
  getPhrases,
  getLoading,
  getSaving,
  ensureLoaded,
  persist: persistComposerCommonPhrasesStore,
};

if (typeof window !== "undefined") {
  window.addEventListener(WISE_COMPOSER_COMMON_PHRASES_CHANGED, (event) => {
    const detail = (event as CustomEvent<{ composerCommonPhrases?: ComposerCommonPhrase[] }>)
      .detail;
    if (!detail?.composerCommonPhrases) return;
    setPhrases(detail.composerCommonPhrases);
  });
}
