import { lazy, Suspense, useEffect, useMemo, useRef, useCallback, type MouseEvent } from "react";
import type { IDisposable } from "monaco-editor";
import { CloseOutlined } from "@ant-design/icons";
import { Button, Spin } from "antd";
import type * as Monaco from "monaco-editor";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { GitDiffMonacoPane } from "./GitDiffMonacoPane";
import type { FileEditorTab } from "../hooks/useRepositoryFileEditor";
import { monacoLanguageFromRepositoryPath } from "../utils/repositoryFilePreview";
import {
  configureWiseMonacoTypeScript,
  isTypeScriptLikeRepositoryPath,
  monacoUriForRepositoryPath,
  syncMonacoRepositoryTypeScriptModels,
} from "../services/monacoTypeScriptEnvironment";
import { installMonacoTrackpadSelectionGuard } from "../utils/monacoTrackpadSelectionGuard";
import { WISE_MONACO_EDITOR_OPTIONS } from "../utils/wiseMonacoEditorOptions";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

interface Props {
  activePath: string | null;
  dark: boolean;
  dirty: boolean;
  repositoryPath: string | null | undefined;
  saving: boolean;
  tabs: FileEditorTab[];
  onActivePathChange: (path: string) => void;
  onClosePanel: () => void;
  onCloseTab: (relativePath: string, event?: MouseEvent) => void;
  onSave: () => void;
  onTabContentChange: (relativePath: string, content: string) => void;
}

export function RepositoryFileEditorPanel({
  activePath,
  dark,
  dirty,
  repositoryPath,
  saving,
  tabs,
  onActivePathChange,
  onClosePanel,
  onCloseTab,
  onSave,
  onTabContentChange,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const editorRef = useRef<MonacoEditorNamespace.IStandaloneCodeEditor | null>(null);
  const lastAppliedFocusRef = useRef<string | null>(null);
  const trackpadGuardRef = useRef<IDisposable | null>(null);
  const activeTab = tabs.find((tab) => tab.relativePath === activePath) ?? null;
  const activeLanguage = monacoLanguageFromRepositoryPath(activeTab?.relativePath ?? null);
  const activeEditorPath =
    activeTab && isTypeScriptLikeRepositoryPath(activeTab.relativePath)
      ? monacoUriForRepositoryPath(activeTab.relativePath, repositoryPath)
      : activeTab?.relativePath;
  const activeTypeScriptSources = useMemo(
    () =>
      activeTab && !activeTab.loading && activeTab.diffOriginal === undefined
        ? [{ relativePath: activeTab.relativePath, content: activeTab.content }]
        : [],
    [activeTab],
  );

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !repositoryPath || !activeTab || !isTypeScriptLikeRepositoryPath(activeTab.relativePath)) {
      return;
    }
    void syncMonacoRepositoryTypeScriptModels({
      monaco,
      repositoryPath,
      sourceFiles: activeTypeScriptSources,
    });
  }, [activeTab, activeTypeScriptSources, repositoryPath]);

  useEffect(() => {
    lastAppliedFocusRef.current = null;
    editorRef.current = null;
    trackpadGuardRef.current?.dispose();
    trackpadGuardRef.current = null;
  }, [activeTab?.relativePath]);

  useEffect(
    () => () => {
      trackpadGuardRef.current?.dispose();
      trackpadGuardRef.current = null;
    },
    [],
  );

  const handleMonacoMount = useCallback(
    (
      editor: MonacoEditorNamespace.IStandaloneCodeEditor,
      monaco: typeof Monaco,
      tab: FileEditorTab,
      tsSources: { relativePath: string; content: string }[],
    ) => {
      trackpadGuardRef.current?.dispose();
      trackpadGuardRef.current = installMonacoTrackpadSelectionGuard(editor);
      editorRef.current = editor;
      monacoRef.current = monaco;
      if (repositoryPath && isTypeScriptLikeRepositoryPath(tab.relativePath)) {
        void syncMonacoRepositoryTypeScriptModels({
          monaco,
          repositoryPath,
          sourceFiles: tsSources,
        });
      }
      window.requestAnimationFrame(() => {
        revealEditorLineFocus(editor, tab, lastAppliedFocusRef);
      });
    },
    [repositoryPath],
  );

  useEffect(() => {
    if (!activeTab || activeTab.loading || activeTab.diffOriginal !== undefined) {
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const frame = window.requestAnimationFrame(() => {
      revealEditorLineFocus(editor, activeTab, lastAppliedFocusRef);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, activeTab?.relativePath, activeTab?.loading, activeTab?.diffOriginal, activeTab?.focusLine]);

  useEffect(() => {
    function handleCloseTabShortcut(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.altKey) {
        return;
      }
      if (event.key !== "w" && event.key !== "W" && event.code !== "KeyW") {
        return;
      }
      if (!activePath || tabs.length === 0) {
        return;
      }
      const panel = panelRef.current;
      const target = event.target;
      if (!panel || !(target instanceof Node) || !panel.contains(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onCloseTab(activePath);
    }
    window.addEventListener("keydown", handleCloseTabShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleCloseTabShortcut, { capture: true });
  }, [activePath, onCloseTab, tabs.length]);

  return (
    <div ref={panelRef} className="app-file-editor-panel">
      <div className="app-file-editor-header">
        <div className="app-file-editor-tab-bar">
          <div className="app-file-editor-tabs-scroll" role="tablist" aria-label="已打开文件">
            {tabs.map((tab) => {
              const isActive = tab.relativePath === activePath;
              const tabDirty = tab.content !== tab.originalContent;
              const label = tab.relativePath.split(/[/\\]/).pop() ?? tab.relativePath;
              return (
                <div
                  key={tab.relativePath}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={0}
                  className={`app-file-editor-tab${isActive ? " app-file-editor-tab--active" : ""}`}
                  title={tab.relativePath}
                  onClick={() => onActivePathChange(tab.relativePath)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onActivePathChange(tab.relativePath);
                    }
                  }}
                >
                  <span className={`app-file-editor-tab-label${tabDirty ? " app-file-editor-tab-label--dirty" : ""}`}>
                    {label}
                  </span>
                  <button
                    type="button"
                    className="app-file-editor-tab-close"
                    aria-label={`关闭 ${label}`}
                    onClick={(event) => onCloseTab(tab.relativePath, event)}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="app-file-editor-tab-bar-actions">
            {dirty ? <span className="app-file-editor-dirty app-file-editor-dirty--tab-bar">未保存</span> : null}
            <Button
              type="primary"
              size="small"
              onClick={onSave}
              loading={saving}
              disabled={!activeTab?.relativePath || activeTab.loading || activeTab.gitDiffSection === "staged" || !dirty}
            >
              保存
            </Button>
            <Button type="text" size="small" onClick={onClosePanel}>
              全部关闭
            </Button>
          </div>
        </div>
      </div>
      <div className="app-file-editor-body">
        {!activeTab || activeTab.loading ? (
          <div className="app-file-editor-loading">
            <Spin size="small" />
          </div>
        ) : (
          <div className="app-file-editor-monaco-wrap">
            {activeTab.diffOriginal !== undefined ? (
              <GitDiffMonacoPane
                relativePath={activeTab.relativePath}
                original={activeTab.diffOriginal}
                modified={activeTab.content}
                language={monacoLanguageFromRepositoryPath(activeTab.relativePath)}
                readOnly={activeTab.gitDiffSection === "staged"}
                dark={dark}
                onModifiedChange={(next) => onTabContentChange(activeTab.relativePath, next)}
              />
            ) : (
              <Suspense
                fallback={
                  <div className="app-file-editor-loading">
                    <Spin size="small" />
                  </div>
                }
              >
                <MonacoEditor
                  key={`${activeTab.relativePath}:${activeLanguage}`}
                  className="app-file-editor-monaco"
                  height="100%"
                  path={activeEditorPath}
                  defaultLanguage={activeLanguage}
                  language={activeLanguage}
                  value={activeTab.content}
                  beforeMount={(monaco) => {
                    configureWiseMonacoTypeScript(monaco);
                  }}
                  onMount={(editor, monaco) => {
                    handleMonacoMount(editor, monaco, activeTab, activeTypeScriptSources);
                  }}
                  onChange={(value) => onTabContentChange(activeTab.relativePath, value ?? "")}
                  theme={dark ? "vs-dark" : "vs"}
                  options={WISE_MONACO_EDITOR_OPTIONS}
                />
              </Suspense>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeEditorLine(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const line = Math.floor(value);
  return line > 0 ? line : null;
}

function revealEditorLineFocus(
  editor: MonacoEditorNamespace.IStandaloneCodeEditor,
  tab: FileEditorTab,
  lastAppliedFocusRef: { current: string | null },
): void {
  const line = normalizeEditorLine(tab.focusLine);
  if (line == null) return;
  const focusKey = `${tab.relativePath}:${line}`;
  if (lastAppliedFocusRef.current === focusKey) return;
  const lineCount = Math.max(1, editor.getModel()?.getLineCount() ?? 1);
  const targetLine = Math.min(Math.max(1, line), lineCount);
  editor.setPosition({ lineNumber: targetLine, column: 1 });
  const lineMaxColumn = Math.max(1, editor.getModel()?.getLineMaxColumn(targetLine) ?? 1);
  editor.setSelection({
    startLineNumber: targetLine,
    startColumn: 1,
    endLineNumber: targetLine,
    endColumn: lineMaxColumn,
  });
  editor.revealLineInCenter(targetLine);
  editor.focus();
  lastAppliedFocusRef.current = focusKey;
}
