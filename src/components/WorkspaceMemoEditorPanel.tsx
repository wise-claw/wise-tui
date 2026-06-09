import { CloseOutlined, DeleteOutlined } from "@ant-design/icons";
import { HoverHint } from "./shared/HoverHint";
import { App, Button, Input, Spin } from "antd";
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  useWorkspaceMemosContext,
  workspaceMemoTabKey,
  workspaceMemoTabLabel,
} from "../contexts/WorkspaceMemosContext";
import type { WorkspaceMemoSelection } from "../types/workspaceMemos";

const MilkdownEditor = lazy(() =>
  import("./MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })),
);

const BODY_SAVE_DEBOUNCE_MS = 500;

export function WorkspaceMemoEditorPanel() {
  const { modal } = App.useApp();
  const memos = useWorkspaceMemosContext();
  const [titleDraft, setTitleDraft] = useState("");
  const bodySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeMemo = memos.activeSelection
    ? memos.getMemoBySelection(memos.activeSelection)
    : null;

  useEffect(() => {
    setTitleDraft(activeMemo?.title ?? "");
  }, [activeMemo?.id, activeMemo?.scope, activeMemo?.title]);

  useEffect(
    () => () => {
      if (bodySaveTimerRef.current) clearTimeout(bodySaveTimerRef.current);
      if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
    },
    [],
  );

  const scheduleBodySave = useCallback(
    (markdown: string) => {
      const selection = memos.activeSelection;
      if (!selection) return;
      if (bodySaveTimerRef.current) clearTimeout(bodySaveTimerRef.current);
      bodySaveTimerRef.current = setTimeout(() => {
        bodySaveTimerRef.current = null;
        void memos.upsertMemo(selection.scope, selection.id, { bodyMarkdown: markdown });
      }, BODY_SAVE_DEBOUNCE_MS);
    },
    [memos],
  );

  const scheduleTitleSave = useCallback(
    (title: string) => {
      const selection = memos.activeSelection;
      if (!selection) return;
      if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
      titleSaveTimerRef.current = setTimeout(() => {
        titleSaveTimerRef.current = null;
        void memos.upsertMemo(selection.scope, selection.id, { title: title.trim() || "无标题" });
      }, BODY_SAVE_DEBOUNCE_MS);
    },
    [memos],
  );

  const flushTitleSave = useCallback(() => {
    const selection = memos.activeSelection;
    if (!selection) return;
    if (titleSaveTimerRef.current) {
      clearTimeout(titleSaveTimerRef.current);
      titleSaveTimerRef.current = null;
    }
    void memos.upsertMemo(selection.scope, selection.id, { title: titleDraft.trim() || "无标题" });
  }, [memos, titleDraft]);

  const handleCloseTab = useCallback(
    (selection: WorkspaceMemoSelection, event?: MouseEvent) => {
      event?.stopPropagation();
      memos.closeMemoTab(selection);
    },
    [memos],
  );

  const confirmDeleteActive = useCallback(() => {
    if (!activeMemo) return;
    modal.confirm({
      title: "删除该备忘录？",
      content: `「${activeMemo.title}」将被永久删除。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        await memos.deleteMemo(activeMemo);
      },
    });
  }, [activeMemo, memos, modal]);

  if (!memos.editorVisible) {
    return null;
  }

  return (
    <div className="app-memo-editor-panel">
      <div className="app-memo-editor-header">
        <div className="app-memo-editor-tab-bar">
          <div className="app-memo-editor-tabs-scroll" role="tablist" aria-label="已打开备忘录">
            {memos.openTabs.map((selection) => {
              const key = workspaceMemoTabKey(selection.scope, selection.id);
              const memo = memos.getMemoBySelection(selection);
              const isActive =
                memos.activeSelection?.scope === selection.scope &&
                memos.activeSelection.id === selection.id;
              const label = workspaceMemoTabLabel(memo, selection);
              return (
                <div
                  key={key}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={0}
                  className={`app-memo-editor-tab${isActive ? " app-memo-editor-tab--active" : ""}`}
                  title={label}
                  onClick={() => memos.setActiveMemoTab(selection)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      memos.setActiveMemoTab(selection);
                    }
                  }}
                >
                  <span className="app-memo-editor-tab-label">{label}</span>
                  <button
                    type="button"
                    className="app-memo-editor-tab-close"
                    aria-label={`关闭 ${label}`}
                    onClick={(event) => handleCloseTab(selection, event)}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="app-memo-editor-tab-bar-actions">
            <Button type="text" size="small" onClick={memos.closeMemoEditorPanel}>
              关闭全部
            </Button>
          </div>
        </div>
        {activeMemo ? (
          <div className="app-memo-editor-toolbar">
            <Input
              className="app-memo-editor-title-input"
              variant="borderless"
              placeholder="标题"
              value={titleDraft}
              maxLength={80}
              onChange={(event) => {
                const value = event.target.value;
                setTitleDraft(value);
                scheduleTitleSave(value);
              }}
              onBlur={flushTitleSave}
            />
            <HoverHint title="删除">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                aria-label="删除备忘录"
                onClick={confirmDeleteActive}
              />
            </HoverHint>
          </div>
        ) : null}
      </div>
      <div className="app-memo-editor-body">
        {activeMemo ? (
          <Suspense
            fallback={
              <div className="app-memo-editor-loading">
                <Spin size="small" />
              </div>
            }
          >
            <MilkdownEditor
              key={`${activeMemo.scope}:${activeMemo.id}`}
              text={activeMemo.bodyMarkdown}
              floatingToolbar
              onChange={scheduleBodySave}
            />
          </Suspense>
        ) : (
          <div className="app-memo-editor-loading">
            <Spin size="small" />
          </div>
        )}
      </div>
    </div>
  );
}
