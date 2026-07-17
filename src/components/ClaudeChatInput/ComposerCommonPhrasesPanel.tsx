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
import {
  useComposerCommonPhrases,
  type ComposerCommonPhrasesScopeLabel,
} from "../../hooks/useComposerCommonPhrases";
import { formatChordForDisplay } from "../../utils/atMentionShortcutChord";
import { ComposerCommonPhraseEditModal } from "./ComposerCommonPhraseEditModal";
import { ComposerDefaultInstructionField } from "./ComposerDefaultInstructionField";
import "./ComposerCommonPhrasesPanel.css";

type PhraseEditTarget = "local" | "global";

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

function EditablePhraseList({
  phrases,
  busy,
  idPrefix,
  emptyText,
  onOpenEdit,
  onRemove,
  onSetShowInQuickBar,
}: {
  phrases: readonly ComposerCommonPhrase[];
  busy: boolean;
  idPrefix: string;
  emptyText: string;
  onOpenEdit: (phrase: ComposerCommonPhrase) => void;
  onRemove: (id: string) => void;
  onSetShowInQuickBar: (id: string, showInQuickBar: boolean) => void;
}) {
  if (phrases.length === 0) {
    return <p className="app-composer-common-phrases-panel__empty">{emptyText}</p>;
  }

  return (
    <ul className="app-composer-common-phrases-panel__list">
      {phrases.map((phrase) => {
        const keys = phrase.chord ? formatChordForDisplay(phrase.chord) : "";
        const actionLabel =
          COMPOSER_COMMON_PHRASE_ACTION_LABELS[resolveComposerCommonPhraseAction(phrase)];
        return (
          <li key={`${idPrefix}:${phrase.id}`} className="app-composer-common-phrases-panel__item">
            <button
              type="button"
              className="app-composer-common-phrases-panel__item-main"
              disabled={busy}
              onClick={() => onOpenEdit(phrase)}
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
                  onChange={(checked) => onSetShowInQuickBar(phrase.id, checked)}
                />
              </label>
              <Button
                type="link"
                size="small"
                className="app-composer-common-phrases-panel__item-edit"
                disabled={busy}
                onClick={() => onOpenEdit(phrase)}
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
                onConfirm={() => onRemove(phrase.id)}
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
          </li>
        );
      })}
    </ul>
  );
}

export function ComposerCommonPhrasesPanel({
  phrases,
  globalPhrases,
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
  /** 可编辑列表：scope=global 时为全局，scope=merged 时为当前仓库级。 */
  phrases: readonly ComposerCommonPhrase[];
  /** 全局列表：仅 scope=merged 时展示并可在此直接编辑。 */
  globalPhrases?: readonly ComposerCommonPhrase[];
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
  const isMerged = scope === "merged";
  // 合并模式下全局条目直接在此编辑，写入全局 scope。
  const globalScope = useComposerCommonPhrases({});
  const editableGlobalPhrases = globalPhrases ?? globalScope.phrases;
  const localBusy = loading || saving;
  const globalBusy = globalScope.loading || globalScope.saving;

  const defaultBusy = (defaultInstructionLoading ?? false) || (defaultInstructionSaving ?? false);
  const [defaultDraft, setDefaultDraft] = useState(defaultInstruction ?? "");

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
  const [editTarget, setEditTarget] = useState<PhraseEditTarget>("local");
  const [editDraft, setEditDraft] = useState<ComposerCommonPhrase | null>(null);

  const targetPhrases = editTarget === "global" ? editableGlobalPhrases : phrases;
  const targetPersist = editTarget === "global" ? globalScope.persist : onPersist;
  const targetSaving = editTarget === "global" ? globalScope.saving : saving;

  const openCreate = useCallback(
    (target: PhraseEditTarget) => {
      const list = target === "global" ? editableGlobalPhrases : phrases;
      if (list.length >= MAX_COMPOSER_COMMON_PHRASES) {
        message.warning(`最多 ${MAX_COMPOSER_COMMON_PHRASES} 条常用语`);
        return;
      }
      setEditTarget(target);
      setEditMode("create");
      setEditDraft({
        id: createComposerCommonPhraseId(),
        title: "新常用语",
        text: "",
        action: "send",
      });
      setEditOpen(true);
    },
    [editableGlobalPhrases, phrases],
  );

  const openEdit = useCallback((target: PhraseEditTarget, phrase: ComposerCommonPhrase) => {
    setEditTarget(target);
    setEditMode("edit");
    setEditDraft({ ...phrase });
    setEditOpen(true);
  }, []);

  const closeEdit = useCallback(() => {
    if (targetSaving) return;
    setEditOpen(false);
    setEditDraft(null);
  }, [targetSaving]);

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
        ? [...targetPhrases, normalized]
        : targetPhrases.map((phrase) => (phrase.id === normalized.id ? normalized : phrase));
    await targetPersist(next);
    setEditOpen(false);
    setEditDraft(null);
  }, [editDraft, editMode, targetPersist, targetPhrases]);

  const removePhraseById = useCallback(
    async (target: PhraseEditTarget, id: string) => {
      const list = target === "global" ? editableGlobalPhrases : phrases;
      const persist = target === "global" ? globalScope.persist : onPersist;
      await persist(list.filter((phrase) => phrase.id !== id));
      if (editDraft?.id === id && editTarget === target) {
        setEditOpen(false);
        setEditDraft(null);
      }
    },
    [
      editDraft?.id,
      editTarget,
      editableGlobalPhrases,
      globalScope.persist,
      onPersist,
      phrases,
    ],
  );

  const handleDelete = useCallback(async () => {
    if (!editDraft || editMode !== "edit") return;
    await removePhraseById(editTarget, editDraft.id);
  }, [editDraft, editMode, editTarget, removePhraseById]);

  const setPhraseShowInQuickBar = useCallback(
    async (target: PhraseEditTarget, id: string, showInQuickBar: boolean) => {
      const list = target === "global" ? editableGlobalPhrases : phrases;
      const persist = target === "global" ? globalScope.persist : onPersist;
      const next = list.map((phrase) => {
        if (phrase.id !== id) return phrase;
        if (showInQuickBar) {
          const { showInQuickBar: _removed, ...rest } = phrase;
          return rest;
        }
        return { ...phrase, showInQuickBar: false as const };
      });
      await persist(next);
    },
    [editableGlobalPhrases, globalScope.persist, onPersist, phrases],
  );

  return (
    <div className="app-composer-common-phrases-panel">
      {hideDefaultInstruction ? null : (
        <section className="app-composer-common-phrases-panel__default" aria-label="主会话默认指令">
          <div className="app-composer-common-phrases-panel__default-head-row">
            <span className="app-composer-common-phrases-panel__default-title">默认指令</span>
            <ComposerDefaultInstructionField
              value={defaultDraft}
              disabled={defaultBusy}
              loading={defaultBusy}
              repositoryPath={repositoryPath}
              placeholder="选择或输入 /autopilot"
              onChange={setDefaultDraft}
              onCommit={saveDefaultInstruction}
              compact
            />
          </div>
          <span className="app-composer-common-phrases-panel__default-hint">
            自动前缀；已有 / 命令不追加；@终端优先终端默认
          </span>
        </section>
      )}
      {isMerged ? (
        <section className="app-composer-common-phrases-panel__global" aria-label="全局常用语">
          <div className="app-composer-common-phrases-panel__hint-row">
            <p className="app-composer-common-phrases-panel__hint">
              全局常用语（所有仓库共享）：点击编辑
            </p>
            <Button
              type="dashed"
              size="small"
              className="app-composer-common-phrases-panel__add"
              disabled={globalBusy || editableGlobalPhrases.length >= MAX_COMPOSER_COMMON_PHRASES}
              onClick={() => openCreate("global")}
            >
              新增
            </Button>
          </div>
          <EditablePhraseList
            phrases={editableGlobalPhrases}
            busy={globalBusy}
            idPrefix="global"
            emptyText="暂无全局常用语，点击上方新增（所有仓库共享）。"
            onOpenEdit={(phrase) => openEdit("global", phrase)}
            onRemove={(id) => void removePhraseById("global", id)}
            onSetShowInQuickBar={(id, show) => void setPhraseShowInQuickBar("global", id, show)}
          />
        </section>
      ) : null}
      <div className="app-composer-common-phrases-panel__hint-row">
        <p className="app-composer-common-phrases-panel__hint">
          {isMerged ? "当前仓库独立常用语：点击编辑" : "点击编辑；快捷栏按触发方式发送或填入"}
        </p>
        <Button
          type="dashed"
          size="small"
          className="app-composer-common-phrases-panel__add"
          disabled={localBusy || phrases.length >= MAX_COMPOSER_COMMON_PHRASES}
          onClick={() => openCreate("local")}
        >
          新增
        </Button>
      </div>
      <EditablePhraseList
        phrases={phrases}
        busy={localBusy}
        idPrefix="local"
        emptyText={
          isMerged ? "当前仓库暂无独立常用语，点击上方新增。" : "暂无常用语，点击上方新增。"
        }
        onOpenEdit={(phrase) => openEdit("local", phrase)}
        onRemove={(id) => void removePhraseById("local", id)}
        onSetShowInQuickBar={(id, show) => void setPhraseShowInQuickBar("local", id, show)}
      />

      <ComposerCommonPhraseEditModal
        open={editOpen}
        mode={editMode}
        draft={editDraft}
        saving={targetSaving}
        onDraftChange={patchDraft}
        onCancel={closeEdit}
        onSave={() => void handleSave()}
        onDelete={() => void handleDelete()}
      />
    </div>
  );
}
