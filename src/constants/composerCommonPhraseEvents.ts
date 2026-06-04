import type { ComposerCommonPhrase } from "./composerCommonPhrase";

export const WISE_UI_EVENT_APPLY_COMPOSER_COMMON_PHRASE = "wise:apply-composer-common-phrase";

export interface ApplyComposerCommonPhraseDetail {
  sessionId: string;
  phrase: ComposerCommonPhrase;
}

export function dispatchApplyComposerCommonPhrase(
  sessionId: string,
  phrase: ComposerCommonPhrase,
): void {
  const id = sessionId.trim();
  if (!id) return;
  window.dispatchEvent(
    new CustomEvent<ApplyComposerCommonPhraseDetail>(WISE_UI_EVENT_APPLY_COMPOSER_COMMON_PHRASE, {
      detail: { sessionId: id, phrase },
    }),
  );
}
