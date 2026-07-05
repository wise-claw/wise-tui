import { Button, message, Popconfirm, Switch } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  COMPOSER_COMMON_PHRASE_ACTION_LABELS,
  createComposerCommonPhraseId,
  MAX_COMPOSER_COMMON_PHRASES,
  resolveComposerCommonPhraseAction,
  resolveComposerCommonPhraseShowInQuickBar,
  type ComposerCommonPhrase,
} from "../../constants/composerCommonPhrase";
import type { ComposerCommonPhrasesScopeLabel } from "../../hooks/useComposerCommonPhrases";
import { formatChordForDisplay } from "../../utils/atMentionShortcutChord";
import { ComposerCommonPhraseEditModal } from "./ComposerCommonPhraseEditModal";
import { ComposerDefaultInstructionField } from "./ComposerDefaultInstructionField";
import "./ComposerCommonPhrasesPanel.css";

function buildNormalizedPhrase(draft: ComposerCommonPhrase): ComposerCommonPhrase | null {
  const text = draft.text.trim();
  if (!text) return null;
  const title = draft.title.trim() || (text.length > 16 ? `${text.slice(0, 16)}…` : text);
  const action = resolveComposerCommonPhraseAction(draft);
  const showInQuickBar = resolveComposerCommonPhraseShowInQuickBar(draft);
  const chord = draft.chord?.trim();
  const base = {
    id: draft.id,
    title,
    text,
    action,
    ...(showInQuickBar ? {} : { showInQuickBar: false as const }),
  };
  return chord ? { ...base, chord } : base;
}

function previewText(text: string, max = 28): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

// 仓库目录名仅用于 scope 提示展示，不参与任何存储/匹配。
function repositoryBasename(path?: string | null): string {
  if (!path) return "";
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function scopeHintFor(
  scope: ComposerCommonPhrasesScopeLabel,
  repositoryPath?: string | null,
): { title: string; hint?: string } {
  const name = repositoryBasename(repositoryPath);
  switch (scope) {
    case "repository":
      return { title: name ? `当前仓库：${name}` : "当前仓库常用语" };
    case "fallback-global":
      return {
        title: name ? `当前仓库：${name}（未自定义）` : "当前仓库未自定义",
        hint: "当前显示全局常用语，编辑将创建该仓库独立配置。",
      };
    case "global":
    default:
      return { title: "全局常用语" };
  }
}

export function ComposerCommonPhrasesPanel({
  phrases,
  loading,
  saving,
  onPersist,
  scope = "global",
  defaultInstruction,
  defaultInstructionLoading,
  defaultInstructionSaving,
  onDefaultInstructionSave,
  hideDefaultInstruction = false,
  repositoryPath,
}: {
  phrases: readonly ComposerCommonPhrase[];
  loading: boolean;
  saving: boolean;
  onPersist: (next: ComposerCommonPhrase[]) => Promise<void>;
  scope?: ComposerCommonPhrasesScopeLabel;
  defaultInstruction?: string;
  defaultInstructionLoading?: boolean;
  defaultInstructionSaving?: boolean;
  onDefaultInstructionSave?: (text: string) => Promise<void>;
  hideDefaultInstruction?: boolean;
  repositoryPath?: string | null;
}) {
  const busy = loading || saving;
  const defaultBusy = (defaultInstructionLoading ?? false) || (defaultInstructionSaving ?? false);
  const [defaultDraft, setDefaultDraft] = useState(defaultInstruction ?? "");
  const scopeHint = scopeHintFor(scope, repositoryPath);

  useEffect(() => {
    setDefaultDraft(defaultInstruction ?? "");
  }, [defaultInstruction]);

  const saveDefaultInstruction = useCallback(
    async (next?: string) => {
      if (!onDefaultInstructionSave) return;
      const current = (defaultInstruction ?? "").trim();
      const candidate = (next ?? defaultDraft).trim();
      if (candidate === current) return;
      await onDefaultInstructionSave(candidate);
    },
    [defaultDraft, defaultInstruction, onDefaultInstructionSave],
  );
  const [editOpen, setEditOpen] = useState(false);
  const [editMode, setEditMode] = useState<"create" | "edit">("create");
  const [editDraft, setEditDraft] = useState<ComposerCommonPhrase | null>(null);

  const openCreate = useCallback(() => {
    if (phrases.length >= MAX_COMPOSER_COMMON_PHRASES) {
      message.warning(`最多 ${MAX_COMPOSER_COMMON_PHRASES} 条常用语`);
      return;
    }
    setEditMode("create");
    setEditDraft({
      id: createComposerCommonPhraseId(),
      title: "新常用语",
      text: "",
      action: "send",
    });
    setEditOpen(true);
  }, [phrases.length]);

  const openEdit = useCallback((phrase: ComposerCommonPhrase) => {
    setEditMode("edit");
    setEditDraft({ ...phrase });
    setEditOpen(true);
  }, []);

  const closeEdit = useCallback(() => {
    if (saving) return;
    setEditOpen(false);
    setEditDraft(null);
  }, [saving]);

  const patchDraft = useCallback(
    (
      patch: Partial<
        Pick<ComposerCommonPhrase, "title" | "text" | "chord" | "action" | "showInQuickBar">
      >,
    ) => {
      setEditDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!editDraft) return;
    const normalized = buildNormalizedPhrase(editDraft);
    if (!normalized) {
      message.warning("请填写要发送的正文");
      return;
    }

    const next =
      editMode === "create"
        ? [...phrases, normalized]
        : phrases.map((phrase) => (phrase.id === normalized.id ? normalized : phrase));
    await onPersist(next);
    setEditOpen(false);
    setEditDraft(null);
  }, [editDraft, editMode, onPersist, phrases]);

  const removePhraseById = useCallback(
    async (id: string) => {
      await onPersist(phrases.filter((phrase) => phrase.id !== id));
      if (editDraft?.id === id) {
        setEditOpen(false);
        setEditDraft(null);
      }
    },
    [editDraft?.id, onPersist, phrases],
  );

  const handleDelete = useCallback(async () => {
    if (!editDraft || editMode !== "edit") return;
    await removePhraseById(editDraft.id);
  }, [editDraft, editMode, removePhraseById]);

  const setPhraseShowInQuickBar = useCallback(
    async (id: string, showInQuickBar: boolean) => {
      const next = phrases.map((phrase) => {
        if (phrase.id !== id) return phrase;
        if (showInQuickBar) {
          const { showInQuickBar: _removed, ...rest } = phrase;
          return rest;
        }
        return { ...phrase, showInQuickBar: false as const };
      });
      await onPersist(next);
    },
    [onPersist, phrases],
  );

  return (
    <div className="app-composer-common-phrases-panel">
      <div
        className={`app-composer-common-phrases-panel__scope app-composer-common-phrases-panel__scope--${scope}`}
        role="status"
      >
        <span className="app-composer-common-phrases-panel__scope-title">{scopeHint.title}</span>
        {scopeHint.hint ? (
          <span className="app-composer-common-phrases-panel__scope-hint">{scopeHint.hint}</span>
        ) : null}
      </div>
      {hideDefaultInstruction ? null : (
        <section className="app-composer-common-phrases-panel__default" aria-label="主会话默认指令">
          <div className="app-composer-common-phrases-panel__default-head">
            <span className="app-composer-common-phrases-panel__default-title">默认指令</span>
            <span className="app-composer-common-phrases-panel__default-hint">
              自动前缀；已有 / 命令不追加；@终端优先终端默认
            </span>
          </div>
          <ComposerDefaultInstructionField
            value={defaultDraft}
            disabled={defaultBusy}
            loading={defaultBusy}
            repositoryPath={repositoryPath}
            placeholder="选择或输入 /autopilot"
            onChange={setDefaultDraft}
            onCommit={saveDefaultInstruction}
          />
        </section>
      )}
      <p className="app-composer-common-phrases-panel__hint">点击编辑；快捷栏按触发方式发送或填入</p>
      {phrases.length === 0 ? (
        <p className="app-composer-common-phrases-panel__empty">暂无常用语，点击下方新增。</p>
      ) : (
        <ul className="app-composer-common-phrases-panel__list">
          {phrases.map((phrase) => {
            const keys = phrase.chord ? formatChordForDisplay(phrase.chord) : "";
            const actionLabel =
              COMPOSER_COMMON_PHRASE_ACTION_LABELS[resolveComposerCommonPhraseAction(phrase)];
            return (
              <li key={phrase.id} className="app-composer-common-phrases-panel__item">
                <button
                  type="button"
                  className="app-composer-common-phrases-panel__item-main"
                  disabled={busy}
                  onClick={() => openEdit(phrase)}
                >
                  <span className="app-composer-common-phrases-panel__item-head">
                    <span className="app-composer-common-phrases-panel__item-title">{phrase.title}</span>
                    <span className="app-composer-common-phrases-panel__item-action" title={actionLabel}>
                      {actionLabel === "直接发送" ? "发送" : "填入"}
                    </span>
                    {keys ? (
                      <kbd className="app-composer-common-phrases-panel__item-keys">{keys}</kbd>
                    ) : null}
                  </span>
                  <span className="app-composer-common-phrases-panel__item-preview">
                    {previewText(phrase.text, 36)}
                  </span>
                </button>
                <div className="app-composer-common-phrases-panel__item-side">
                  <label
                    className="app-composer-common-phrases-panel__item-quick"
                    title="在会话快捷操作栏显示名称"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="app-composer-common-phrases-panel__item-quick-label">快捷栏</span>
                    <Switch
                      size="small"
                      disabled={busy}
                      checked={resolveComposerCommonPhraseShowInQuickBar(phrase)}
                      onChange={(checked) => void setPhraseShowInQuickBar(phrase.id, checked)}
                    />
                  </label>
                  <div className="app-composer-common-phrases-panel__item-actions">
                    <Button
                      type="link"
                      size="small"
                      className="app-composer-common-phrases-panel__item-edit"
                      disabled={busy}
                      onClick={() => openEdit(phrase)}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="删除这条常用语？"
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true, size: "small" }}
                      cancelButtonProps={{ size: "small" }}
                      disabled={busy}
                      onConfirm={() => void removePhraseById(phrase.id)}
                    >
                      <Button
                        type="link"
                        size="small"
                        danger
                        className="app-composer-common-phrases-panel__item-delete"
                        disabled={busy}
                        onClick={(event) => event.stopPropagation()}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="app-composer-common-phrases-panel__footer">
        <Button
          type="dashed"
          block
          className="app-composer-common-phrases-panel__add"
          disabled={busy || phrases.length >= MAX_COMPOSER_COMMON_PHRASES}
          onClick={openCreate}
        >
          新增
        </Button>
      </div>

      <ComposerCommonPhraseEditModal
        open={editOpen}
        mode={editMode}
        draft={editDraft}
        saving={saving}
        onDraftChange={patchDraft}
        onCancel={closeEdit}
        onSave={() => void handleSave()}
        onDelete={() => void handleDelete()}
      />
    </div>
  );
}
