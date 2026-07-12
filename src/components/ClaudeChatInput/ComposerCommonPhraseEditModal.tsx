import { Button, Input, Modal, Switch } from "antd";
import {
  resolveComposerCommonPhraseAction,
  resolveComposerCommonPhraseShowInQuickBar,
  type ComposerCommonPhrase,
  type ComposerCommonPhraseAction,
} from "../../constants/composerCommonPhrase";

const PHRASE_ACTION_OPTIONS: ReadonlyArray<{
  value: ComposerCommonPhraseAction;
  label: string;
  description: string;
}> = [
  { value: "send", label: "直接发送", description: "点击快捷栏 chip 或快捷键后立即发送" },
  { value: "insert", label: "填入输入框", description: "插入到输入框，不自动发送" },
];
import { KeyShortcutCapture } from "../DefaultConfigPanel/KeyShortcutCapture";
import "./ComposerCommonPhraseEditModal.css";

export function ComposerCommonPhraseEditModal({
  open,
  mode,
  draft,
  saving,
  onDraftChange,
  onCancel,
  onSave,
  onDelete,
}: {
  open: boolean;
  mode: "create" | "edit";
  draft: ComposerCommonPhrase | null;
  saving: boolean;
  onDraftChange: (
    patch: Partial<
      Pick<ComposerCommonPhrase, "title" | "text" | "chord" | "action" | "showInQuickBar">
    >,
  ) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  if (!draft) return null;

  return (
    <Modal
      open={open}
      title={mode === "create" ? "新增常用语" : "编辑常用语"}
      width={360}
      centered
      destroyOnHidden
      maskClosable={!saving}
      className="app-composer-common-phrase-edit-modal"
      onCancel={onCancel}
      footer={
        <div className="app-composer-common-phrase-edit-modal__footer">
          {mode === "edit" ? (
            <Button danger type="text" disabled={saving} onClick={onDelete}>
              删除
            </Button>
          ) : (
            <span />
          )}
          <div className="app-composer-common-phrase-edit-modal__footer-actions">
            <Button disabled={saving} onClick={onCancel}>
              取消
            </Button>
            <Button type="primary" loading={saving} onClick={onSave}>
              保存
            </Button>
          </div>
        </div>
      }
    >
      <p className="app-composer-common-phrase-edit-modal__hint">
        组合键须含修饰键，与 @ 快捷键不可重复；行为与会话快捷栏 chip 一致。
      </p>
      <fieldset className="app-composer-common-phrase-edit-modal__action">
        <legend className="app-composer-common-phrase-edit-modal__action-label">触发方式</legend>
        <div
          className="app-composer-common-phrase-edit-modal__action-options"
          role="radiogroup"
          aria-label="触发方式"
        >
          {PHRASE_ACTION_OPTIONS.map((option) => {
            const selected = resolveComposerCommonPhraseAction(draft) === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={saving}
                className={`app-composer-common-phrase-edit-modal__action-option${
                  selected
                    ? " app-composer-common-phrase-edit-modal__action-option--selected"
                    : ""
                }`}
                onClick={() => onDraftChange({ action: option.value })}
              >
                <span className="app-composer-common-phrase-edit-modal__action-option-label">
                  {option.label}
                </span>
                <span className="app-composer-common-phrase-edit-modal__action-option-desc">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="app-composer-common-phrase-edit-modal__fields">
        <Input
          size="small"
          placeholder="简称（按钮上显示）"
          disabled={saving}
          value={draft.title}
          onChange={(event) => onDraftChange({ title: event.target.value })}
        />
        <Input.TextArea
          size="small"
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder="请填写要发送的正文"
          disabled={saving}
          value={draft.text}
          onChange={(event) => onDraftChange({ text: event.target.value })}
        />
        <KeyShortcutCapture
          fieldLabel="快捷键"
          emptyText="未设置快捷键"
          setButtonText="设置快捷键"
          changeButtonText="更改快捷键"
          value={draft.chord ?? ""}
          disabled={saving}
          onChange={(chord) => onDraftChange({ chord })}
        />
        <label className="app-composer-common-phrase-edit-modal__quick-bar">
          <span className="app-composer-common-phrase-edit-modal__quick-bar-label">在快捷栏显示</span>
          <Switch
            size="small"
            disabled={saving}
            checked={resolveComposerCommonPhraseShowInQuickBar(draft)}
            onChange={(checked) => onDraftChange({ showInQuickBar: checked })}
          />
        </label>
      </div>
    </Modal>
  );
}
