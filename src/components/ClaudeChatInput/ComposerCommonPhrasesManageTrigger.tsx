import { Popover } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { useState } from "react";
import type { ComposerCommonPhrase } from "../../constants/composerCommonPhrase";
import type { ComposerCommonPhrasesScopeLabel } from "../../hooks/useComposerCommonPhrases";
import { ComposerCommonPhrasesPanel } from "./ComposerCommonPhrasesPanel";
import "./ComposerCommonPhrasesManageTrigger.css";

export function ComposerCommonPhrasesManageTrigger({
  phrases,
  loading,
  saving,
  onPersist,
  scope = "global",
  defaultInstruction,
  defaultInstructionLoading,
  defaultInstructionSaving,
  onDefaultInstructionSave,
  repositoryPath,
}: {
  phrases: readonly ComposerCommonPhrase[];
  loading: boolean;
  saving: boolean;
  onPersist: (next: ComposerCommonPhrase[]) => Promise<void>;
  scope?: ComposerCommonPhrasesScopeLabel;
  defaultInstruction: string;
  defaultInstructionLoading: boolean;
  defaultInstructionSaving: boolean;
  onDefaultInstructionSave: (text: string) => Promise<void>;
  repositoryPath?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="topRight"
      destroyOnHidden
      classNames={{ root: "app-composer-common-phrases-popover" }}
      content={
        <div
          className="app-composer-common-phrases-popover__body"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <ComposerCommonPhrasesPanel
            phrases={phrases}
            loading={loading}
            saving={saving}
            onPersist={onPersist}
            scope={scope}
            defaultInstruction={defaultInstruction}
            defaultInstructionLoading={defaultInstructionLoading}
            defaultInstructionSaving={defaultInstructionSaving}
            onDefaultInstructionSave={onDefaultInstructionSave}
            repositoryPath={repositoryPath}
          />
        </div>
      }
    >
      <HoverHint title="管理会话常用语" placement="top" open={open ? false : undefined}>
        <button
          type="button"
          className="app-composer-common-phrases-trigger"
          aria-label="管理会话常用语"
          aria-expanded={open}
          aria-haspopup="dialog"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <span className="app-composer-common-phrases-trigger__label">常用语</span>
          {phrases.length > 0 ? (
            <span className="app-composer-common-phrases-trigger__count" aria-hidden>
              {phrases.length}
            </span>
          ) : null}
        </button>
      </HoverHint>
    </Popover>
  );
}
