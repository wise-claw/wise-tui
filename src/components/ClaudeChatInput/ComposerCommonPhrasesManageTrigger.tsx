import { Popover } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { useState } from "react";
import type { ComposerCommonPhrase } from "../../constants/composerCommonPhrase";
import { ComposerCommonPhrasesPanel } from "./ComposerCommonPhrasesPanel";
import "./ComposerCommonPhrasesManageTrigger.css";

export function ComposerCommonPhrasesManageTrigger({
  phrases,
  loading,
  saving,
  onPersist,
}: {
  phrases: readonly ComposerCommonPhrase[];
  loading: boolean;
  saving: boolean;
  onPersist: (next: ComposerCommonPhrase[]) => Promise<void>;
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
