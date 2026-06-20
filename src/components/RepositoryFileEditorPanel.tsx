import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { IDisposable } from "monaco-editor";
import { CloseOutlined, ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Spin } from "antd";
import type * as Monaco from "monaco-editor";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { GitDiffMonacoPane } from "./GitDiffMonacoPane";
import type { FileEditorTab } from "../hooks/useRepositoryFileEditor";
import { monacoLanguageFromRepositoryPath } from "../utils/repositoryFilePreview";
import {
  configureWiseMonacoTypeScript,
  ensureRepositoryTypeScriptEnvironment,
  isTypeScriptLikeRepositoryPath,
  monacoUriForRepositoryPath,
  syncMonacoRepositoryTypeScriptModels,
} from "../services/monacoTypeScriptEnvironment";
import { installMonacoGlobalFindRedirect } from "../utils/monacoGlobalFindRedirect";
import { installMonacoTrackpadSelectionGuard } from "../utils/monacoTrackpadSelectionGuard";
import {
  isMonacoLargeFileContent,
  monacoEditorOptionsBucket,
  resolveWiseMonacoEditorOptionsFromLength,
  shouldDeferMonacoEditorMount,
  shouldInjectMonacoContentAfterMount,
  shouldSyncMonacoTypeScriptDependencies,
} from "../utils/monacoLargeFile";
import { scheduleMonacoLargeFileContentInjection } from "../utils/monacoLargeFileContentInjection";
import { runWhenIdle } from "../utils/deferIdle";
import { MonacoSelectionChatToolbar } from "./MonacoSelectionChatToolbar";
import { useGitRepositoryExplorerStatus } from "../hooks/useGitRepositoryExplorerStatus";
import { useMonacoGitModifiedLineDecorations } from "../hooks/useMonacoGitModifiedLineDecorations";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

interface Props {
  activePath: string | null;
  activeSessionId: string | null;
  dark: boolean;
  dirty: boolean;
  repositoryPath: string | null | undefined;
  saving: boolean;
  tabs: FileEditorTab[];
  onActivePathChange: (path: string) => void;
  onClosePanel: () => void;
  onCloseTab: (relativePath: string, event?: MouseEvent) => void;
  onReloadTab: (relativePath: string) => void;
  onSave: () => void;
  onTabContentChange: (relativePath: string, content: string) => void;
}

export function RepositoryFileEditorPanel({
  activePath,
  activeSessionId,
  dark,
  dirty,
  repositoryPath,
  saving,
  tabs,
  onActivePathChange,
  onClosePanel,
  onCloseTab,
  onReloadTab,
  onSave,
  onTabContentChange,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const editorRef = useRef<MonacoEditorNamespace.IStandaloneCodeEditor | null>(null);
  const lastAppliedFocusRef = useRef<string | null>(null);
  const monacoMountGuardRef = useRef<IDisposable | null>(null);
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
  const activeContentLength = activeTab?.content.length ?? 0;
  const activeOptionsBucket = monacoEditorOptionsBucket(activeContentLength);
  const activeEditorOptions = useMemo(
    () => resolveWiseMonacoEditorOptionsFromLength(activeContentLength),
    [activeOptionsBucket],
  );
  const activeLargeFile = activeOptionsBucket !== "small";
  const activeHugeFile = activeOptionsBucket === "huge";
  const canSaveActiveTab = Boolean(
    activeTab?.relativePath &&
      !activeTab.loading &&
      activeTab.gitDiffSection !== "staged" &&
      !activeTab.gitCommitSha &&
      !activeTab.gitCommitCompare &&
      dirty &&
      !saving,
  );
  const [monacoSurfaceReady, setMonacoSurfaceReady] = useState(true);
  const [monacoEditorSurface, setMonacoEditorSurface] = useState<{
    editor: MonacoEditorNamespace.IStandaloneCodeEditor;
    monaco: typeof Monaco;
  } | null>(null);
  const explorerGitStatus = useGitRepositoryExplorerStatus(repositoryPath ?? "");
  const contentInjectionCancelRef = useRef<(() => void) | null>(null);

  useMonacoGitModifiedLineDecorations({
    editor: monacoEditorSurface?.editor ?? null,
    monaco: monacoEditorSurface?.monaco ?? null,
    repositoryPath,
    relativePath: activeTab?.relativePath,
    diskContent: activeTab?.originalContent,
    gitStatusRevision: explorerGitStatus.generation,
    enabled: Boolean(
      activeTab &&
        !activeTab.loading &&
        activeTab.diffOriginal === undefined &&
        !activeTab.gitCommitSha &&
        !activeTab.gitCommitCompare,
    ),
  });

  // 大文件（非受控 defaultValue）编辑器在外部内容替换后需显式重新注入。
  // contentVersion 仅在外部刷新时自增（保存路径不自增），故此 effect 不会误注入。
  const lastInjectedContentVersionRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeTab || activeTab.diffOriginal !== undefined) {
      lastInjectedContentVersionRef.current = null;
      return;
    }
    const version = activeTab.contentVersion ?? 0;
    if (version === lastInjectedContentVersionRef.current) return;
    lastInjectedContentVersionRef.current = version;
    if (!activeLargeFile) return; // 小文件受控 value 自动同步
    const editor = editorRef.current;
    if (!editor) return;
    const view = editor.saveViewState();
    contentInjectionCancelRef.current?.();
    contentInjectionCancelRef.current = scheduleMonacoLargeFileContentInjection(
      editor,
      activeTab.content,
      () => {
        if (view) editor.restoreViewState(view);
      },
    );
  }, [activeTab, activeLargeFile]);

  useEffect(() => {
    contentInjectionCancelRef.current?.();
    contentInjectionCancelRef.current = null;
  }, [activeTab?.relativePath]);

  useEffect(() => {
    if (!activeTab || activeTab.loading || activeTab.diffOriginal !== undefined) {
      setMonacoSurfaceReady(true);
      return;
    }
    if (!shouldDeferMonacoEditorMount(activeContentLength)) {
      setMonacoSurfaceReady(true);
      return;
    }
    setMonacoSurfaceReady(false);
    return runWhenIdle(() => setMonacoSurfaceReady(true), {
      timeoutMs: activeHugeFile ? 96 : 24,
    });
  }, [
    activeContentLength,
    activeHugeFile,
    activeTab?.diffOriginal,
    activeTab?.loading,
    activeTab?.relativePath,
  ]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (
      !monaco ||
      !repositoryPath ||
      !activeTab ||
      !isTypeScriptLikeRepositoryPath(activeTab.relativePath) ||
      !shouldSyncMonacoTypeScriptDependencies(activeTab.content)
    ) {
      return;
    }
    const cancel = runWhenIdle(
      () => {
        void syncMonacoRepositoryTypeScriptModels({
          monaco,
          repositoryPath,
          sourceFiles: activeTypeScriptSources,
        });
      },
      { timeoutMs: isMonacoLargeFileContent(activeTab.content) ? 4000 : 1200 },
    );
    return cancel;
  }, [activeTab, activeTypeScriptSources, repositoryPath]);

  useEffect(() => {
    lastAppliedFocusRef.current = null;
    editorRef.current = null;
    setMonacoEditorSurface(null);
    monacoMountGuardRef.current?.dispose();
    monacoMountGuardRef.current = null;
  }, [activeTab?.relativePath]);

  useEffect(
    () => () => {
      monacoMountGuardRef.current?.dispose();
      monacoMountGuardRef.current = null;
    },
    [],
  );

  const handleMonacoMount = useCallback(
    (
      editor: MonacoEditorNamespace.IStandaloneCodeEditor,
      monaco: typeof Monaco,
      tab: FileEditorTab,
      _tsSources: { relativePath: string; content: string }[],
    ) => {
      monacoMountGuardRef.current?.dispose();
      const trackpadGuard = installMonacoTrackpadSelectionGuard(editor);
      const findRedirect = installMonacoGlobalFindRedirect(editor);
      monacoMountGuardRef.current = {
        dispose: () => {
          trackpadGuard.dispose();
          findRedirect.dispose();
        },
      };
      editorRef.current = editor;
      monacoRef.current = monaco;
      setMonacoEditorSurface({ editor, monaco });
      const reveal = () => {
        revealEditorLineFocus(editor, tab, lastAppliedFocusRef);
      };
      if (shouldInjectMonacoContentAfterMount(tab.content.length)) {
        contentInjectionCancelRef.current?.();
        contentInjectionCancelRef.current = scheduleMonacoLargeFileContentInjection(
          editor,
          tab.content,
          reveal,
        );
        return;
      }
      if (isMonacoLargeFileContent(tab.content)) {
        runWhenIdle(reveal, { timeoutMs: 400 });
      } else {
        window.requestAnimationFrame(reveal);
      }
    },
    [],
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
    function handleSaveShortcut(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.altKey) {
        return;
      }
      if (event.key !== "s" && event.key !== "S" && event.code !== "KeyS") {
        return;
      }
      const panel = panelRef.current;
      const target = event.target;
      if (!panel || !(target instanceof Node) || !panel.contains(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!canSaveActiveTab) {
        return;
      }
      onSave();
    }
    window.addEventListener("keydown", handleSaveShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleSaveShortcut, { capture: true });
  }, [canSaveActiveTab, onSave]);

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
              disabled={!canSaveActiveTab}
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
        ) : !monacoSurfaceReady ? (
          <div className="app-file-editor-loading">
            <Spin size="small" tip="准备编辑器…" />
          </div>
        ) : (
          <div className="app-file-editor-monaco-wrap">
            {activeTab.diffOriginal !== undefined ? null : activeTab.externalDeleted ? (
              <div className="app-file-editor-external-banner app-file-editor-external-banner--deleted" role="alert">
                <WarningOutlined />
                <span className="app-file-editor-external-banner-text">
                  文件已被外部删除，内容保留供复制。
                </span>
                <Button
                  type="link"
                  size="small"
                  onClick={() => onCloseTab(activeTab.relativePath)}
                >
                  关闭
                </Button>
              </div>
            ) : activeTab.externalChanged ? (
              <div className="app-file-editor-external-banner" role="alert">
                <WarningOutlined />
                <span className="app-file-editor-external-banner-text">
                  文件已被外部修改，重新加载将覆盖当前未保存的修改。
                </span>
                <Button
                  type="link"
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => onReloadTab(activeTab.relativePath)}
                >
                  重新加载
                </Button>
              </div>
            ) : null}
            {activeTab.diffOriginal !== undefined ? null : (
              <MonacoSelectionChatToolbar
                editor={monacoEditorSurface?.editor ?? null}
                monaco={monacoEditorSurface?.monaco ?? null}
                relativePath={activeTab.relativePath}
                language={activeLanguage}
                sessionId={activeSessionId}
              />
            )}
            {activeTab.diffOriginal !== undefined ? (
              <GitDiffMonacoPane
                relativePath={activeTab.relativePath}
                original={activeTab.diffOriginal}
                modified={activeTab.content}
                language={monacoLanguageFromRepositoryPath(activeTab.relativePath)}
                readOnly={activeTab.gitDiffSection === "staged" || Boolean(activeTab.gitCommitSha) || Boolean(activeTab.gitCommitCompare)}
                dark={dark}
                activeSessionId={activeSessionId}
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
                  {...(activeHugeFile
                    ? { defaultValue: "" }
                    : activeLargeFile
                      ? { defaultValue: activeTab.content }
                      : { value: activeTab.content })}
                  beforeMount={(monaco) => {
                    configureWiseMonacoTypeScript(monaco);
                    if (repositoryPath && activeTab && isTypeScriptLikeRepositoryPath(activeTab.relativePath)) {
                      void ensureRepositoryTypeScriptEnvironment(monaco, repositoryPath);
                    }
                  }}
                  onMount={(editor, monaco) => {
                    handleMonacoMount(editor, monaco, activeTab, activeTypeScriptSources);
                  }}
                  onChange={(value) => onTabContentChange(activeTab.relativePath, value ?? "")}
                  theme={dark ? "vs-dark" : "vs"}
                  options={activeEditorOptions}
                  loading={
                    <div className="app-file-editor-loading">
                      <Spin size="small" />
                    </div>
                  }
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
