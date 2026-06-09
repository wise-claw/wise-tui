import { Button } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { memo, useMemo } from "react";
import {
  buildComposerCommonPhraseTooltipTitle,
  resolveComposerCommonPhraseAction,
  type ComposerCommonPhrase,
} from "../../constants/composerCommonPhrase";
import { formatChordForDisplay } from "../../utils/atMentionShortcutChord";
import { shouldDisableComposerCommonPhraseSend } from "../../utils/applyComposerCommonPhrase";
import "./ComposerCommonPhrasesBar.css";

const PhraseQuickLabel = memo(function PhraseQuickLabel({
  phrase,
  disabled,
  onApplyPhrase,
  tooltipTitle,
}: {
  phrase: ComposerCommonPhrase;
  disabled: boolean;
  onApplyPhrase: (phrase: ComposerCommonPhrase) => void;
  tooltipTitle: string;
}) {
  const action = resolveComposerCommonPhraseAction(phrase);
  const verb = action === "insert" ? "填入" : "发送";
  const keys = phrase.chord ? formatChordForDisplay(phrase.chord) : "";
  const ariaLabel = keys
    ? `${verb}常用语：${phrase.title}（${keys}）`
    : `${verb}常用语：${phrase.title}`;

  return (
    <HoverHint
      title={tooltipTitle}
     
      placement="top"
      destroyOnHidden
      classNames={{ root: "app-composer-common-phrases-tooltip-overlay" }}
    >
      <button
        type="button"
        className={`app-composer-common-phrases-quick-label${
          action === "insert" ? " app-composer-common-phrases-quick-label--insert" : ""
        }`}
        disabled={disabled}
        aria-label={ariaLabel}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onApplyPhrase(phrase)}
      >
        {phrase.title}
      </button>
    </HoverHint>
  );
});

const PhraseComposerChip = memo(function PhraseComposerChip({
  phrase,
  disabled,
  onApplyPhrase,
  tooltipTitle,
}: {
  phrase: ComposerCommonPhrase;
  disabled: boolean;
  onApplyPhrase: (phrase: ComposerCommonPhrase) => void;
  tooltipTitle: string;
}) {
  const action = resolveComposerCommonPhraseAction(phrase);
  const verb = action === "insert" ? "填入" : "发送";
  const keys = phrase.chord ? formatChordForDisplay(phrase.chord) : "";
  const ariaLabel = keys
    ? `${verb}常用语：${phrase.title}（${keys}）`
    : `${verb}常用语：${phrase.title}`;

  return (
    <HoverHint
      title={tooltipTitle}
     
      placement="top"
      destroyOnHidden
      classNames={{ root: "app-composer-common-phrases-tooltip-overlay" }}
    >
      <Button
        size="small"
        type="default"
        className={`app-composer-common-phrases-bar__chip${
          action === "insert" ? " app-composer-common-phrases-bar__chip--insert" : ""
        }`}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => onApplyPhrase(phrase)}
      >
        <span className="app-composer-common-phrases-bar__title">{phrase.title}</span>
        {keys ? <kbd className="app-composer-common-phrases-bar__keys">{keys}</kbd> : null}
      </Button>
    </HoverHint>
  );
});

export const ComposerCommonPhrasesBar = memo(function ComposerCommonPhrasesBar({
  phrases,
  variant = "composer",
  sessionBusyWithoutEnqueue = false,
  onApplyPhrase,
}: {
  phrases: readonly ComposerCommonPhrase[];
  variant?: "composer" | "quickBar";
  sessionBusyWithoutEnqueue?: boolean;
  onApplyPhrase: (phrase: ComposerCommonPhrase) => void;
}) {
  const isQuickBar = variant === "quickBar";

  const tooltipById = useMemo(
    () => new Map(phrases.map((phrase) => [phrase.id, buildComposerCommonPhraseTooltipTitle(phrase)])),
    [phrases],
  );

  if (phrases.length === 0) return null;

  return (
    <div
      className={
        isQuickBar
          ? "app-composer-common-phrases-bar app-composer-common-phrases-bar--quick"
          : "app-composer-common-phrases-bar"
      }
      aria-label="会话常用语"
    >
      {phrases.map((phrase) => {
        const disabled = shouldDisableComposerCommonPhraseSend(phrase, sessionBusyWithoutEnqueue);
        const tooltipTitle = tooltipById.get(phrase.id) ?? phrase.title;
        if (isQuickBar) {
          return (
            <PhraseQuickLabel
              key={phrase.id}
              phrase={phrase}
              disabled={disabled}
              onApplyPhrase={onApplyPhrase}
              tooltipTitle={tooltipTitle}
            />
          );
        }
        return (
          <PhraseComposerChip
            key={phrase.id}
            phrase={phrase}
            disabled={disabled}
            onApplyPhrase={onApplyPhrase}
            tooltipTitle={tooltipTitle}
          />
        );
      })}
    </div>
  );
});
