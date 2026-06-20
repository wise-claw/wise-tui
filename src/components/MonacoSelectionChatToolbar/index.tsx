import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { IDisposable } from "monaco-editor";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { MessageOutlined } from "@ant-design/icons";
import { applyMonacoSelectionToComposer } from "../../constants/workflowUiEvents";
import { registerMonacoAddToChatAction } from "../../utils/registerMonacoAddToChatAction";
import {
  formatMonacoSelectionPreview,
  readMonacoSelectionSnapshotFromEditors,
  type MonacoSelectionSnapshot,
} from "../../utils/monacoSelectionSnapshot";
import "./index.css";

function snapshotsEqual(
  a: MonacoSelectionSnapshot | null,
  b: MonacoSelectionSnapshot | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.startLine === b.startLine &&
    a.endLine === b.endLine &&
    a.startChar === b.startChar &&
    a.endChar === b.endChar &&
    a.selectedText === b.selectedText
  );
}

interface Props {
  /** 单编辑器模式（与普通文件编辑兼容） */
  editor?: MonacoEditorNamespace.IStandaloneCodeEditor | null;
  /** 多编辑器模式（如 diff 左右两侧） */
  editors?: Array<MonacoEditorNamespace.IStandaloneCodeEditor | null | undefined>;
  monaco: typeof import("monaco-editor") | null;
  relativePath: string | null;
  language: string | null;
  sessionId: string | null;
}

function MonacoSelectionChatToolbarInner({
  editor = null,
  editors,
  monaco,
  relativePath,
  language,
  sessionId,
}: Props) {
  const editorList = useMemo(
    () => (editors ?? (editor ? [editor] : [])).filter(Boolean) as MonacoEditorNamespace.IStandaloneCodeEditor[],
    [editor, editors],
  );
  const [snapshot, setSnapshot] = useState<MonacoSelectionSnapshot | null>(null);
  const snapshotRef = useRef<MonacoSelectionSnapshot | null>(null);
  const pinnedSnapshotRef = useRef<MonacoSelectionSnapshot | null>(null);
  const pointerOnToolbarRef = useRef(false);
  const refreshRafRef = useRef(0);
  snapshotRef.current = snapshot;

  const refreshSnapshot = useCallback(() => {
    const next = readMonacoSelectionSnapshotFromEditors(editorList);
    if (next) {
      pinnedSnapshotRef.current = next;
      // 内容未变则跳过重渲染（如滚动后选区位置/文本均未变化）。
      if (!snapshotsEqual(next, snapshotRef.current)) {
        setSnapshot(next);
      }
      return;
    }
    if (pointerOnToolbarRef.current && pinnedSnapshotRef.current) {
      if (!snapshotsEqual(pinnedSnapshotRef.current, snapshotRef.current)) {
        setSnapshot(pinnedSnapshotRef.current);
      }
      return;
    }
    if (editorList.every((item) => !item)) {
      if (!pointerOnToolbarRef.current) {
        pinnedSnapshotRef.current = null;
        if (snapshotRef.current !== null) {
          setSnapshot(null);
        }
      }
      return;
    }
    pinnedSnapshotRef.current = null;
    if (snapshotRef.current !== null) {
      setSnapshot(null);
    }
  }, [editorList]);

  // Monaco 滚动/选区/布局变化与窗口滚动可达每帧多次触发，用 rAF 合并，一帧最多一次实际刷新。
  const scheduleRefreshSnapshot = useCallback(() => {
    if (refreshRafRef.current) return;
    refreshRafRef.current = requestAnimationFrame(() => {
      refreshRafRef.current = 0;
      refreshSnapshot();
    });
  }, [refreshSnapshot]);

  const addSelectionToComposer = useCallback(() => {
    const current = snapshotRef.current ?? pinnedSnapshotRef.current;
    const path = relativePath?.trim() ?? "";
    const targetSessionId = sessionId?.trim() ?? "";
    if (!current || !path || !targetSessionId) return;

    applyMonacoSelectionToComposer({
      sessionId: targetSessionId,
      relativePath: path,
      language,
      selectedText: current.selectedText,
      startLine: current.startLine,
      endLine: current.endLine,
      startChar: current.startChar,
      endChar: current.endChar,
    });
  }, [language, relativePath, sessionId]);

  useEffect(() => {
    if (editorList.every((item) => !item)) {
      setSnapshot(null);
      return;
    }

    refreshSnapshot();
    const disposables: IDisposable[] = [];
    for (const activeEditor of editorList) {
      if (!activeEditor) continue;
      disposables.push(
        activeEditor.onDidChangeCursorSelection(scheduleRefreshSnapshot),
        activeEditor.onDidScrollChange(scheduleRefreshSnapshot),
        activeEditor.onDidLayoutChange(scheduleRefreshSnapshot),
      );
    }

    const scrollNodes = editorList
      .map((activeEditor) => activeEditor?.getDomNode())
      .filter((node): node is HTMLElement => Boolean(node));
    const onWindowChange = () => scheduleRefreshSnapshot();
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
    for (const node of scrollNodes) {
      node.addEventListener("scroll", onWindowChange, true);
    }

    return () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
      for (const node of scrollNodes) {
        node.removeEventListener("scroll", onWindowChange, true);
      }
      if (refreshRafRef.current) {
        cancelAnimationFrame(refreshRafRef.current);
        refreshRafRef.current = 0;
      }
    };
  }, [editorList, refreshSnapshot, scheduleRefreshSnapshot]);

  useEffect(() => {
    if (!monaco) return;
    for (const activeEditor of editorList) {
      if (!activeEditor) continue;
      registerMonacoAddToChatAction(activeEditor, monaco, addSelectionToComposer);
    }
  }, [addSelectionToComposer, editorList, monaco]);

  if (!snapshot || typeof document === "undefined") return null;

  const canAdd = Boolean(relativePath?.trim() && sessionId?.trim());
  const shortcutLabel = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform)
    ? "⌘L"
    : "Ctrl+L";
  const filename = relativePath?.split(/[/\\]/).pop() ?? relativePath ?? "";
  const lineLabel =
    snapshot.startLine === snapshot.endLine
      ? `第 ${snapshot.startLine} 行`
      : `第 ${snapshot.startLine}-${snapshot.endLine} 行`;
  const preview = formatMonacoSelectionPreview(snapshot.selectedText);

  const handleAddPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canAdd) return;
    addSelectionToComposer();
  };

  return createPortal(
    <div
      className="monaco-selection-chat-toolbar"
      style={{ top: snapshot.top, left: snapshot.left }}
      role="toolbar"
      aria-label="选区操作"
      onPointerDown={(event) => {
        pointerOnToolbarRef.current = true;
        event.stopPropagation();
      }}
      onPointerUp={() => {
        pointerOnToolbarRef.current = false;
        refreshSnapshot();
      }}
      onPointerCancel={() => {
        pointerOnToolbarRef.current = false;
        refreshSnapshot();
      }}
    >
      <button
        type="button"
        className="monaco-selection-chat-toolbar__action"
        disabled={!canAdd}
        title={
          canAdd
            ? `${filename} ${lineLabel}\n${preview}\n添加到聊天（${shortcutLabel}）`
            : "请先选择左侧会话"
        }
        onPointerDown={handleAddPointerDown}
      >
        <MessageOutlined />
        <span>添加到聊天</span>
        <span className="monaco-selection-chat-toolbar__shortcut">{shortcutLabel}</span>
      </button>
    </div>,
    document.body,
  );
}

export const MonacoSelectionChatToolbar = memo(MonacoSelectionChatToolbarInner);
