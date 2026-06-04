import type { ComposerPlainSurface } from "../components/ClaudeChatInput/slash-popover";
import { insertPlainAt } from "../components/ClaudeChatInput/composer-plain-utils";
import type { ComposerCommonPhrase } from "../constants/composerCommonPhrase";
import { resolveComposerCommonPhraseAction } from "../constants/composerCommonPhrase";

export function applyComposerCommonPhraseToSurface(
  surface: ComposerPlainSurface,
  phrase: Pick<ComposerCommonPhrase, "text" | "action">,
): void {
  const plain = surface.getPlain();
  const cursor = surface.getCursor();
  const next = insertPlainAt(plain, cursor, phrase.text);
  surface.setPlainAndCursor(next.plain, next.cursor);
  surface.focus();
}

export function shouldDisableComposerCommonPhraseSend(
  phrase: Pick<ComposerCommonPhrase, "action">,
  sessionBusyWithoutEnqueue: boolean,
): boolean {
  return (
    resolveComposerCommonPhraseAction(phrase) === "send" && sessionBusyWithoutEnqueue
  );
}
