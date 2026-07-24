import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IDisposable } from "monaco-editor";
import { Button, Spin } from "antd";
import { ReloadOutlined, WarningOutlined, EyeOutlined, EditOutlined } from "@ant-design/icons";
import type * as Monaco from "monaco-editor";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { GitDiffMonacoPane } from "./GitDiffMonacoPane";
import type { FileEditorTab } from "../hooks/useRepositoryFileEditor";
import { registerImportNavigation } from "../utils/monacoImportNavigation";
import { monacoLanguageFromRepositoryPath } from "../utils/repositoryFilePreview";
import {
  configureWiseMonacoTypeScript,
  ensureRepositoryTypeScriptEnvironment,
  isTypeScriptLikeRepositoryPath,
  monacoUriForRepositoryPath,
  syncMonacoRepositoryTypeScriptModels,
} from "../services/monacoTypeScriptEnvironment";
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
import { resolveMonacoIdleDeferTimeoutMs } from "../utils/uiWorkDefer";
import { MonacoSelectionChatToolbar } from "./MonacoSelectionChatToolbar";
import { useGitRepositoryExplorerStatus } from "../hooks/useGitRepositoryExplorerStatus";
import { useMonacoGitModifiedLineDecorations } from "../hooks/useMonacoGitModifiedLineDecorations";
import { MarkdownBody } from "./ClaudeSessions/MarkdownElements";
import rehypeRaw from "rehype-raw";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

export interface RepositoryFileEditorTabSurfaceProps {
  tab: FileEditorTab;
  isActive: boolean;
  dark: boolean;
  repositoryPath: string | null | undefined;
  activeSessionId: string | null;
  onTabContentChange: (relativePath: string, content: string) => void;
  onCloseTab: (relativePath: string) => void;
  onReloadTab: (relativePath: string) => void;
  /**
   * 是否保留 Monaco 实例（keep-alive）。Panel 用 LRU 维护最近若干活跃 tab，
   * 被逐出时 keepAlive 翻 false，surface 执行与卸载等价的清理并允许重新挂载。
   */
  keepAlive: boolean;
  mdPreviewRequested: boolean;
  onMdPreviewRequestedChange: (value: boolean) => void;
  /** Ctrl/Cmd+Click import/export 路径时导航打开目标文件。 */
  onNavigateToFile?: (relativePath: string) => void;
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
  shouldFocus: boolean,
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
  if (shouldFocus) {
    editor.focus();
  }
  lastAppliedFocusRef.current = focusKey;
}

export function RepositoryFileEditorTabSurface({
  tab,
  isActive,
  dark,
  repositoryPath,
  activeSessionId,
  onTabContentChange,
  onCloseTab,
  onReloadTab,
  keepAlive,
  mdPreviewRequested,
  onMdPreviewRequestedChange,
  onNavigateToFile,
}: RepositoryFileEditorTabSurfaceProps) {
  const monacoRef = useRef<typeof Monaco | null>(null);
  const editorRef = useRef<MonacoEditorNamespace.IStandaloneCodeEditor | null>(null);
  const lastAppliedFocusRef = useRef<string | null>(null);
  const monacoMountGuardRef = useRef<IDisposable | null>(null);
  const contentInjectionCancelRef = useRef<(() => void) | null>(null);
  const lastInjectedContentVersionRef = useRef<number | null>(null);

  const language = monacoLanguageFromRepositoryPath(tab.relativePath);
  // 多 pane 下同 relativePath 但不同仓库的文件（典型：两屏各自打开 README.md）必须落到不同
  // Monaco model。@monaco-editor/react 按 `path` 取/建 model：若两屏 path 相同，会复用同一
  // model，导致两屏互相 setValue 覆盖内容（最后写者赢），且关闭一屏时 dispose 共享 model
  // 会让另一屏内容消失（tab 头还在）。非 TS 文件原先只用 relativePath 当 path，这里改成按
  // tab 自身 rootPath 哈希进 URI，保证 (rootPath, relativePath) 唯一。TS 分支保持原样
  // （已用 repositoryPath 走 monacoUriForRepositoryPath，且与 TS env 对齐）。
  const editorPath = isTypeScriptLikeRepositoryPath(tab.relativePath)
    ? monacoUriForRepositoryPath(tab.relativePath, repositoryPath)
    : monacoUriForRepositoryPath(tab.relativePath, tab.rootPath || repositoryPath);
  const typeScriptSources = useMemo(
    () =>
      tab.diffOriginal === undefined
        ? [{ relativePath: tab.relativePath, content: tab.content }]
        : [],
    [tab.content, tab.diffOriginal, tab.relativePath],
  );
  const contentLength = tab.content.length;
  const optionsBucket = monacoEditorOptionsBucket(contentLength);
  const editorOptions = useMemo(
    () => resolveWiseMonacoEditorOptionsFromLength(contentLength, tab.relativePath),
    [optionsBucket, tab.relativePath],
  );
  // medium 文件（50KB-128KB）仅关闭高亮特性，仍走受控 value 路径，
  // 不进入大文件的 defaultValue/延后注入流程。
  const largeFile = optionsBucket === "large" || optionsBucket === "huge";
  const hugeFile = optionsBucket === "huge";

  const isMdFile = useMemo(
    () => tab.relativePath.endsWith(".md") || tab.relativePath.endsWith(".mdx"),
    [tab.relativePath],
  );
  const mdPreview = isMdFile && mdPreviewRequested;

  const [monacoSurfaceReady, setMonacoSurfaceReady] = useState(true);
  const [monacoEditorSurface, setMonacoEditorSurface] = useState<{
    editor: MonacoEditorNamespace.IStandaloneCodeEditor;
    monaco: typeof Monaco;
  } | null>(null);

  // keep-alive：一旦被激活过即保留 Monaco 实例挂载，切换 tab 仅靠 CSS 显隐，
  // 不再随 isActive 销毁/重建编辑器。被 LRU 逐出（keepAlive 翻 false）时重置。
  const [everActivated, setEverActivated] = useState(false);
  useEffect(() => {
    if (isActive && !everActivated) {
      setEverActivated(true);
    }
  }, [isActive, everActivated]);

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const explorerGitStatus = useGitRepositoryExplorerStatus(repositoryPath ?? "");

  useMonacoGitModifiedLineDecorations({
    editor: isActive ? (monacoEditorSurface?.editor ?? null) : null,
    monaco: isActive ? (monacoEditorSurface?.monaco ?? null) : null,
    repositoryPath,
    relativePath: tab.relativePath,
    baselineContent: tab.originalContent,
    gitStatusRevision: explorerGitStatus.generation,
    enabled: Boolean(
      isActive &&
        tab.diffOriginal === undefined &&
        !tab.gitCommitSha &&
        !tab.gitCommitCompare,
    ),
  });

  useEffect(() => {
    if (tab.diffOriginal !== undefined) {
      lastInjectedContentVersionRef.current = null;
      return;
    }
    if (!largeFile) {
      // 非大文件走受控 value，无需注入；同步标记避免文件大小越过阈值时漏注入。
      lastInjectedContentVersionRef.current = tab.contentVersion ?? 0;
      return;
    }
    const editor = editorRef.current;
    // 编辑器尚未挂载/被 keep-alive 驱逐：不推进 version，等实例可用后由本 effect
    // （依赖 monacoEditorSurface）补注入，避免外部刷新内容丢失。
    if (!editor) return;
    const version = tab.contentVersion ?? 0;
    if (version === lastInjectedContentVersionRef.current) return;
    lastInjectedContentVersionRef.current = version;
    const view = editor.saveViewState();
    contentInjectionCancelRef.current?.();
    contentInjectionCancelRef.current = scheduleMonacoLargeFileContentInjection(
      editor,
      tab.content,
      () => {
        if (view) editor.restoreViewState(view);
      },
    );
  }, [largeFile, tab.contentVersion, tab.content, tab.diffOriginal, monacoEditorSurface]);

  useEffect(() => {
    // keep-alive：已挂载过的编辑器不再因内容长度变化重新 defer/卸载，
    // 避免隐藏 tab 内容增长越过 128KB 阈值时把已挂载编辑器卸载。
    if (everActivated) {
      setMonacoSurfaceReady(true);
      return;
    }
    if (tab.diffOriginal !== undefined) {
      setMonacoSurfaceReady(true);
      return;
    }
    if (!shouldDeferMonacoEditorMount(contentLength)) {
      setMonacoSurfaceReady(true);
      return;
    }
    setMonacoSurfaceReady(false);
    return runWhenIdle(() => setMonacoSurfaceReady(true), {
      timeoutMs: resolveMonacoIdleDeferTimeoutMs(hugeFile ? 96 : 24),
    });
  }, [everActivated, contentLength, hugeFile, tab.diffOriginal, tab.relativePath]);

  useEffect(() => {
    if (!isActive) return;
    const monaco = monacoRef.current;
    if (
      !monaco ||
      !repositoryPath ||
      !isTypeScriptLikeRepositoryPath(tab.relativePath) ||
      !shouldSyncMonacoTypeScriptDependencies(tab.content)
    ) {
      return;
    }
    const cancel = runWhenIdle(
      () => {
        void syncMonacoRepositoryTypeScriptModels({
          monaco,
          repositoryPath,
          sourceFiles: typeScriptSources,
        });
      },
      { timeoutMs: resolveMonacoIdleDeferTimeoutMs(isMonacoLargeFileContent(tab.content) ? 4000 : 1200) },
    );
    return cancel;
  }, [isActive, repositoryPath, tab.content, tab.relativePath, typeScriptSources]);

  useEffect(
    () => () => {
      contentInjectionCancelRef.current?.();
      contentInjectionCancelRef.current = null;
      monacoMountGuardRef.current?.dispose();
      monacoMountGuardRef.current = null;
    },
    [],
  );

  // keep-alive 驱逐：被 LRU 逐出（keepAlive 翻 false）时执行与卸载等价的清理，
  // 释放 trackpad/find guard、注入任务与编辑器引用，并重置 everActivated 以便
  // 重新激活时由 onMount 重建实例。注意清理职责从「isActive 翻 false」转移到
  // 「keepAlive 翻 false」——切 tab 不再卸载编辑器，故切走时不清理 refs。
  useEffect(() => {
    if (keepAlive || !everActivated) return;
    contentInjectionCancelRef.current?.();
    contentInjectionCancelRef.current = null;
    monacoMountGuardRef.current?.dispose();
    monacoMountGuardRef.current = null;
    // 显式 dispose Monaco editor 与其持有的 model，避免 keep-alive 驱逐后
    // TS worker / 模型 URI 注册表持续占用——切到消息视图（files pane 卸载）
    // 触发的 unmount 路径上同等清理由 React 卸载 cleanup 负责，此处专管
    // LRU 驱逐路径。
    const editor = editorRef.current;
    if (editor) {
      try {
        editor.getModel()?.dispose();
      } catch {
        /* model 可能与其它 pane 共享，不在此处强释放 */
      }
      try {
        editor.dispose();
      } catch {
        /* editor 已 dispose 忽略 */
      }
    }
    editorRef.current = null;
    monacoRef.current = null;
    lastInjectedContentVersionRef.current = null;
    setMonacoEditorSurface(null);
    setEverActivated(false);
  }, [keepAlive, everActivated]);

  // 用 ResizeObserver 替代 automaticLayout：仅在活跃 tab 且容器尺寸真正变化时
  // 调用 editor.layout()，避免每个实例持续轮询容器尺寸。
  useEffect(() => {
    if (!isActive) return;
    const editor = editorRef.current;
    if (!editor) return;
    const container = editor.getDomNode()?.parentElement;
    if (!container) return;
    let lastWidth = container.clientWidth;
    let lastHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width !== lastWidth || height !== lastHeight) {
        lastWidth = width;
        lastHeight = height;
        editor.layout();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [isActive, monacoEditorSurface]);

  const handleMonacoMount = useCallback(
    (editor: MonacoEditorNamespace.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      monacoMountGuardRef.current?.dispose();
      const trackpadGuard = installMonacoTrackpadSelectionGuard(editor);
      monacoMountGuardRef.current = {
        dispose: () => {
          trackpadGuard.dispose();
        },
      };
      editorRef.current = editor;
      monacoRef.current = monaco;
      setMonacoEditorSurface({ editor, monaco });
      // automaticLayout 已移除：挂载后立即 layout 一次以匹配容器尺寸，后续由 ResizeObserver 接管。
      editor.layout();
      // 用 tabRef.current 而非闭包 tab：本回调为 useCallback([]) 固定闭包，
      // 非活跃→活跃会重新挂载，需读取最新 tab（content 可能已被外部刷新更新）。
      const currentTab = tabRef.current;
      const reveal = () => {
        revealEditorLineFocus(editor, currentTab, lastAppliedFocusRef, isActiveRef.current);
      };
      if (shouldInjectMonacoContentAfterMount(currentTab.content.length)) {
        contentInjectionCancelRef.current?.();
        contentInjectionCancelRef.current = scheduleMonacoLargeFileContentInjection(
          editor,
          currentTab.content,
          reveal,
        );
        // huge 文件挂载已注入当前内容，标记 version 已同步，避免后续 effect 冗余注入。
        lastInjectedContentVersionRef.current = currentTab.contentVersion ?? 0;
        return;
      }
      if (isMonacoLargeFileContent(currentTab.content)) {
        // large 文件挂载由 defaultValue 提供当前内容，标记 version 已同步，
        // 后续外部刷新（contentVersion 自增）再由注入 effect 接管。
        lastInjectedContentVersionRef.current = currentTab.contentVersion ?? 0;
        runWhenIdle(reveal, { timeoutMs: 400 });
      } else {
        window.requestAnimationFrame(reveal);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isActive || tabRef.current.diffOriginal !== undefined) return;
    const editor = editorRef.current;
    if (!editor) return;
    const frame = window.requestAnimationFrame(() => {
      editor.layout();
      revealEditorLineFocus(editor, tabRef.current, lastAppliedFocusRef, true);
    });
    return () => window.cancelAnimationFrame(frame);
    // 依赖不含 tab.content：仅在激活态切换、文件切换、聚焦行、diff 模式变化时
    // layout + reveal；否则每次按键编辑都会触发 editor.layout() 造成输入卡顿。
  }, [isActive, tab.relativePath, tab.focusLine, tab.diffOriginal]);

  // ── import/export 路径 Ctrl/Cmd+Click 导航 ──
  useEffect(() => {
    if (!monacoEditorSurface || tab.diffOriginal !== undefined || !isActive) return;
    if (!repositoryPath || !onNavigateToFile) return;
    const { editor, monaco } = monacoEditorSurface;
    const disposable = registerImportNavigation(monaco, editor, {
      repositoryPath,
      fromRelativePath: tab.relativePath,
      onNavigate: onNavigateToFile,
    });
    return () => disposable.dispose();
  }, [monacoEditorSurface, repositoryPath, tab.relativePath, tab.diffOriginal, isActive, onNavigateToFile]);

  if (tab.diffOriginal !== undefined) {
    return (
      <div
        className={`app-file-editor-tab-surface${isActive ? " app-file-editor-tab-surface--active" : ""}`}
        aria-hidden={!isActive}
      >
        {everActivated ? (
          <GitDiffMonacoPane
            isActive={isActive}
            relativePath={tab.relativePath}
            original={tab.diffOriginal}
            modified={tab.content}
            language={language}
            readOnly={
              tab.gitDiffSection === "staged" ||
              Boolean(tab.gitCommitSha) ||
              Boolean(tab.gitCommitCompare)
            }
            dark={dark}
            activeSessionId={activeSessionId}
            onModifiedChange={(next) => onTabContentChange(tab.relativePath, next)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`app-file-editor-tab-surface${isActive ? " app-file-editor-tab-surface--active" : ""}`}
      aria-hidden={!isActive}
    >
      <div className="app-file-editor-monaco-wrap">
        {tab.externalDeleted ? (
          <div className="app-file-editor-external-banner app-file-editor-external-banner--deleted" role="alert">
            <WarningOutlined />
            <span className="app-file-editor-external-banner-text">
              文件已被外部删除，内容保留供复制。
            </span>
            <Button type="link" size="small" onClick={() => onCloseTab(tab.relativePath)}>
              关闭
            </Button>
          </div>
        ) : tab.externalChanged ? (
          <div className="app-file-editor-external-banner" role="alert">
            <WarningOutlined />
            <span className="app-file-editor-external-banner-text">
              文件已被外部修改，重新加载将覆盖当前未保存的修改。
            </span>
            <Button
              type="link"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => onReloadTab(tab.relativePath)}
            >
              重新加载
            </Button>
          </div>
        ) : null}
        {isActive ? (
          <MonacoSelectionChatToolbar
            editor={monacoEditorSurface?.editor ?? null}
            monaco={monacoEditorSurface?.monaco ?? null}
            relativePath={tab.relativePath}
            language={language}
            sessionId={activeSessionId}
          />
        ) : null}
        {isMdFile && isActive ? (
          <div className="app-file-editor-md-toggle">
            <Button
              type={mdPreview ? "default" : "primary"}
              size="small"
              icon={<EditOutlined />}
              onClick={() => onMdPreviewRequestedChange(false)}
            >
              编辑
            </Button>
            <Button
              type={mdPreview ? "primary" : "default"}
              size="small"
              icon={<EyeOutlined />}
              onClick={() => onMdPreviewRequestedChange(true)}
            >
              预览
            </Button>
          </div>
        ) : null}
        {mdPreview && isActive ? (
          <div className="app-file-editor-md-preview">
            <MarkdownBody source={tab.content} rehypePlugins={[rehypeRaw]} />
          </div>
        ) : everActivated ? (
          !monacoSurfaceReady ? (
            <div className="app-file-editor-loading">
              <Spin size="small" tip="准备编辑器…" />
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="app-file-editor-loading">
                  <Spin size="small" />
                </div>
              }
            >
              <MonacoEditor
                key={`${tab.relativePath}:${language}`}
                className="app-file-editor-monaco"
                height="100%"
                path={editorPath}
                defaultLanguage={language}
                language={language}
                {...(hugeFile
                  ? { defaultValue: "" }
                  : largeFile
                    ? { defaultValue: tab.content }
                    : { value: tab.content })}
                beforeMount={(monaco) => {
                  configureWiseMonacoTypeScript(monaco);
                  if (repositoryPath && isTypeScriptLikeRepositoryPath(tab.relativePath)) {
                    void ensureRepositoryTypeScriptEnvironment(monaco, repositoryPath);
                  }
                }}
                onMount={(editor, monaco) => {
                  handleMonacoMount(editor, monaco);
                }}
                onChange={(value) => onTabContentChange(tab.relativePath, value ?? "")}
                theme={dark ? "vs-dark" : "vs"}
                options={editorOptions}
                loading={
                  <div className="app-file-editor-loading">
                    <Spin size="small" />
                  </div>
                }
              />
            </Suspense>
          )
        ) : null}
      </div>
    </div>
  );
}
