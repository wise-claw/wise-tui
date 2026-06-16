import {
  MAX_COMPOSER_COMMON_PHRASES,
  type ComposerCommonPhrase,
} from "../constants/composerCommonPhrase";
import { loadComposerCommonPhrasesFromStore, saveComposerCommonPhrasesToStore } from "./wiseDefaultConfigStore";
import {
  buildFeedbackLoopHabitsPhraseText,
  FEEDBACK_LOOP_HABITS_PHRASE_ID,
  FEEDBACK_LOOP_HABITS_PHRASE_TITLE,
} from "../utils/sessionFeedbackLoop";

export async function upsertFeedbackLoopHabitsPhrase(
  habits: readonly string[],
): Promise<ComposerCommonPhrase | null> {
  const text = buildFeedbackLoopHabitsPhraseText(habits);
  if (!text.trim()) return null;

  const current = await loadComposerCommonPhrasesFromStore();
  const phrase: ComposerCommonPhrase = {
    id: FEEDBACK_LOOP_HABITS_PHRASE_ID,
    title: FEEDBACK_LOOP_HABITS_PHRASE_TITLE,
    text,
    action: "insert",
    showInQuickBar: true,
  };

  const existingIdx = current.findIndex((p) => p.id === FEEDBACK_LOOP_HABITS_PHRASE_ID);
  let next: ComposerCommonPhrase[];
  if (existingIdx >= 0) {
    next = [...current];
    next[existingIdx] = phrase;
  } else if (current.length >= MAX_COMPOSER_COMMON_PHRASES) {
    next = [phrase, ...current.slice(0, MAX_COMPOSER_COMMON_PHRASES - 1)];
  } else {
    next = [phrase, ...current];
  }

  await saveComposerCommonPhrasesToStore(next);
  return phrase;
}
