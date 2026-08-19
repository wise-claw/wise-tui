import { memo, useCallback, useMemo } from "react";
import { filterComposerCommonPhrasesForQuickBar } from "../../constants/composerCommonPhrase";
import { dispatchApplyComposerCommonPhrase } from "../../constants/composerCommonPhraseEvents";
import { useComposerCommonPhrases } from "../../hooks/useComposerCommonPhrases";
import { ComposerCommonPhrasesBar } from "../ClaudeChatInput/ComposerCommonPhrasesBar";
import { SessionQuickActionsBar } from "./SessionQuickActionsBar";

export interface ClaudeChatQuickActionsChromeProps {
  sessionId: string;
  /** 当前会话所属仓库 id；提供时常用语走「仓库优先 + 全局兜底」，多屏下各 pane 显示各自仓库的。 */
  repositoryId?: number | null;
  onCreateNewSession?: () => void;
  creatingNewSession?: boolean;
  onOpenBuiltinAssistant?: (assistantId: string) => void;
  onActivateAssistant?: (assistant: import("../../types/assistant").AssistantEntry) => void | Promise<void>;
  onOpenAssistantsHub?: () => void;
  /** 与输入区一致：会话忙且无法入队时禁用「直接发送」类常用语 */
  composerSessionBusyWithoutEnqueue?: boolean;
}

export const ClaudeChatQuickActionsChrome = memo(function ClaudeChatQuickActionsChrome({
  sessionId,
  repositoryId,
  onCreateNewSession,
  creatingNewSession = false,
  onOpenBuiltinAssistant,
  onActivateAssistant,
  onOpenAssistantsHub,
  composerSessionBusyWithoutEnqueue = false,
}: ClaudeChatQuickActionsChromeProps) {
  const { phrases: composerCommonPhrases } = useComposerCommonPhrases({ repositoryId });
  const applyCommonPhrase = useCallback(
    (phrase: Parameters<typeof dispatchApplyComposerCommonPhrase>[1]) => {
      dispatchApplyComposerCommonPhrase(sessionId, phrase);
    },
    [sessionId],
  );
  const quickBarPhrases = useMemo(
    () => filterComposerCommonPhrasesForQuickBar(composerCommonPhrases),
    [composerCommonPhrases],
  );
  const commonPhrasesSlot = useMemo(
    () =>
      quickBarPhrases.length > 0 ? (
        <ComposerCommonPhrasesBar
          variant="quickBar"
          phrases={quickBarPhrases}
          sessionBusyWithoutEnqueue={composerSessionBusyWithoutEnqueue}
          onApplyPhrase={applyCommonPhrase}
        />
      ) : null,
    [applyCommonPhrase, quickBarPhrases, composerSessionBusyWithoutEnqueue],
  );

  return (
    <SessionQuickActionsBar
      onCreateNewSession={onCreateNewSession}
      creatingNewSession={creatingNewSession}
      onOpenBuiltinAssistant={onOpenBuiltinAssistant}
      onActivateAssistant={onActivateAssistant}
      onOpenAssistantsHub={onOpenAssistantsHub}
      commonPhrasesSlot={commonPhrasesSlot}
    />
  );
});
