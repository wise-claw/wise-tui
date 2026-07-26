import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Spin } from "antd";
import type * as Monaco from "monaco-editor";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { configureWiseMonacoTypeScript } from "../services/monacoTypeScriptEnvironment";
import { installMonacoTrackpadSelectionGuard } from "../utils/monacoTrackpadSelectionGuard";
import {
  maxMonacoContentLength,
  MONACO_LARGE_FILE_CHANGE_DEBOUNCE_MS,
  resolveDiffEditorMountContent,
  resolveWiseMonacoEditorOptionsFromLength,
  shouldDebounceMonacoEditorContentChange,
  shouldDeferMonacoEditorMount,
  shouldRenderDiffSideBySide,
} from "../utils/monacoLargeFile";
import { scheduleMonacoLargeFileContentInjection } from "../utils/monacoLargeFileContentInjection";
import { runWhenIdle } from "../utils/deferIdle";
import { resolveMonacoIdleDeferTimeoutMs } from "../utils/uiWorkDefer";
import { useMonacoCodeReviewFindingDecorations } from "../hooks/useMonacoCodeReviewFindingDecorations";
import { MonacoSelectionChatToolbar } from "./MonacoSelectionChatToolbar";

const DiffEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })),
);

interface Props {
  relativePath: string;
  /** 用于叠加 Code Review findings（改动侧）。 */
  repositoryPath?: string | null;
  original: string;
  modified: string;
  language: string;
  readOnly: boolean;
  dark: boolean;
  /** keep-alive 下编辑器常驻挂载，仅在活跃时才需要 layout。 */
  isActive: boolean;
  activeSessionId?: string | null;
  onModifiedChange: (value: string) => void;
}

export function GitDiffMonacoPane({
  relativePath,
  repositoryPath = null,
  original,
  modified,
  language,
  readOnly,
  dark,
  isActive,
  activeSessionId = null,
  onModifiedChange,
}: Props) {
  const modifiedListenerRef = useRef<{ dispose: () => void } | null>(null);
  const trackpadGuardRef = useRef<{ dispose: () => void } | null>(null);
  const contentInjectionCancelRef = useRef<(() => void) | null>(null);
  const diffEditorRef = useRef<MonacoEditorNamespace.IStandaloneDiffEditor | null>(null);
  const modifiedChangeTimerRef = useRef<number | null>(null);
  const onModifiedChangeRef = useRef(onModifiedChange);
  onModifiedChangeRef.current = onModifiedChange;
  const originalRef = useRef(original);
  const modifiedRef = useRef(modified);
  originalRef.current = original;
  modifiedRef.current = modified;
  const debounceDiffChange =
    shouldDebounceMonacoEditorContentChange(modified.length) ||
    shouldDebounceMonacoEditorContentChange(original.length);
  const debounceDiffChangeRef = useRef(debounceDiffChange);
  debounceDiffChangeRef.current = debounceDiffChange;
  const [monacoApi, setMonacoApi] = useState<typeof Monaco | null>(null);
  const [diffEditors, setDiffEditors] = useState<{
    original: MonacoEditorNamespace.IStandaloneCodeEditor;
    modified: MonacoEditorNamespace.IStandaloneCodeEditor;
  } | null>(null);
  const diffEditorList = useMemo(
    () => (diffEditors ? [diffEditors.original, diffEditors.modified] : []),
    [diffEditors],
  );

  const diffContentLength = maxMonacoContentLength(original, modified);
  const mountContent = resolveDiffEditorMountContent({
    original,
    modified,
    contentLength: diffContentLength,
  });
  // medium/large：按 path/readOnly 快照冻结受控 props，避免 onChange→父重渲→DiffEditor 再 setValue。
  // inject/controlled 不读此快照（inject 传空；controlled 跟 live props）。
  const frozenContentRef = useRef({
    relativePath,
    readOnly,
    original,
    modified,
  });
  if (
    frozenContentRef.current.relativePath !== relativePath ||
    frozenContentRef.current.readOnly !== readOnly
  ) {
    frozenContentRef.current = { relativePath, readOnly, original, modified };
  }
  const editorOriginal =
    mountContent.strategy === "inject"
      ? ""
      : mountContent.strategy === "frozen"
        ? frozenContentRef.current.original
        : original;
  const editorModified =
    mountContent.strategy === "inject"
      ? ""
      : mountContent.strategy === "frozen"
        ? frozenContentRef.current.modified
        : modified;
  const renderSideBySide = shouldRenderDiffSideBySide(diffContentLength);
  const diffEditorOptions = useMemo(
    () => resolveWiseMonacoEditorOptionsFromLength(diffContentLength, relativePath),
    [diffContentLength, relativePath],
  );
  const [surfaceReady, setSurfaceReady] = useState(
    () => !shouldDeferMonacoEditorMount(diffContentLength),
  );

  useEffect(() => {
    if (!shouldDeferMonacoEditorMount(diffContentLength)) {
      setSurfaceReady(true);
      return;
    }
    setSurfaceReady(false);
    return runWhenIdle(() => setSurfaceReady(true), {
      timeoutMs: resolveMonacoIdleDeferTimeoutMs(48),
    });
  }, [diffContentLength, relativePath]);

  useEffect(() => {
    setDiffEditors(null);
    return () => {
      if (modifiedChangeTimerRef.current != null) {
        window.clearTimeout(modifiedChangeTimerRef.current);
        modifiedChangeTimerRef.current = null;
      }
      contentInjectionCancelRef.current?.();
      contentInjectionCancelRef.current = null;
      modifiedListenerRef.current?.dispose();
      modifiedListenerRef.current = null;
      trackpadGuardRef.current?.dispose();
      trackpadGuardRef.current = null;
      // 切到消息视图或 tab 关闭/重打开时 panels 容器 unmount，DiffEditor 与其
      // 持有的 original/modified model 必须显式 dispose，否则会持续占用 TS
      // worker / 模型 URI 注册表，跨多次会话累积。
      const diffEditor = diffEditorRef.current;
      if (diffEditor) {
        try {
          diffEditor.getOriginalEditor().getModel()?.dispose();
        } catch {
          /* model 可能已被共享引用，本组件 dispose 时不能动；忽略 */
        }
        try {
          diffEditor.getModifiedEditor().getModel()?.dispose();
        } catch {
          /* 同上 */
        }
        diffEditor.dispose();
      }
      diffEditorRef.current = null;
    };
  }, [relativePath]);

  // 用 ResizeObserver 替代 automaticLayout：仅在容器尺寸真正变化时调用 diffEditor.layout()。
  useEffect(() => {
    const diffEditor = diffEditorRef.current;
    if (!diffEditor) return;
    const container = diffEditor.getContainerDomNode()?.parentElement;
    if (!container) return;
    let lastWidth = container.clientWidth;
    let lastHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width !== lastWidth || height !== lastHeight) {
        lastWidth = width;
        lastHeight = height;
        diffEditor.layout();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [diffEditors]);

  // keep-alive：diff 编辑器常驻挂载，切回活跃态时 display:none→flex，需在下一帧
  // 显式 layout（双栏布局对尺寸更敏感），与普通编辑器的切回兜底对齐。
  useEffect(() => {
    if (!isActive) return;
    const diffEditor = diffEditorRef.current;
    if (!diffEditor) return;
    const frame = window.requestAnimationFrame(() => {
      diffEditor.layout();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isActive]);

  useMonacoCodeReviewFindingDecorations({
    editor: isActive ? (diffEditors?.modified ?? null) : null,
    monaco: isActive ? monacoApi : null,
    repositoryPath,
    relativePath,
    enabled: Boolean(isActive && repositoryPath),
  });

  return (
    <Suspense
      fallback={
        <div className="app-file-editor-loading">
          <Spin size="small" />
        </div>
      }
    >
      {!surfaceReady ? (
        <div className="app-file-editor-loading">
          <Spin size="small" tip="准备 diff 编辑器…" />
        </div>
      ) : (
        <>
          <MonacoSelectionChatToolbar
            editors={diffEditorList}
            monaco={monacoApi}
            relativePath={relativePath}
            language={language}
            sessionId={activeSessionId}
          />
          <DiffEditor
            key={`${relativePath}:${readOnly ? "ro" : "rw"}`}
            height="100%"
            className="app-file-editor-monaco app-file-editor-monaco--diff"
            theme={dark ? "vs-dark" : "vs"}
            original={editorOriginal}
            modified={editorModified}
            language={language}
            originalModelPath={`wise-diff-left:${relativePath}`}
            modifiedModelPath={`wise-diff-right:${relativePath}`}
            beforeMount={(monaco) => {
              setMonacoApi(monaco);
              configureWiseMonacoTypeScript(monaco);
            }}
            onMount={(diffEditor) => {
              modifiedListenerRef.current?.dispose();
              modifiedListenerRef.current = null;
              trackpadGuardRef.current?.dispose();
              contentInjectionCancelRef.current?.();
              contentInjectionCancelRef.current = null;
              diffEditorRef.current = diffEditor;
              const originalEditor = diffEditor.getOriginalEditor();
              const modifiedEditor = diffEditor.getModifiedEditor();
              setDiffEditors({ original: originalEditor, modified: modifiedEditor });
              // automaticLayout 已移除：挂载后立即 layout 一次，后续由 ResizeObserver 接管。
              diffEditor.layout();
              const guards = [
                installMonacoTrackpadSelectionGuard(originalEditor),
                installMonacoTrackpadSelectionGuard(modifiedEditor),
              ];
              trackpadGuardRef.current = {
                dispose: () => {
                  for (const guard of guards) {
                    guard.dispose();
                  }
                },
              };

              if (mountContent.injectAfterMount) {
                const left = originalRef.current;
                const right = modifiedRef.current;
                const cancelLeft = scheduleMonacoLargeFileContentInjection(
                  originalEditor,
                  left,
                  undefined,
                  resolveMonacoIdleDeferTimeoutMs(96),
                );
                const cancelRight = scheduleMonacoLargeFileContentInjection(
                  modifiedEditor,
                  right,
                  () => {
                    diffEditor.layout();
                  },
                  resolveMonacoIdleDeferTimeoutMs(96),
                );
                contentInjectionCancelRef.current = () => {
                  cancelLeft();
                  cancelRight();
                };
              }

              if (!readOnly) {
                // large/huge：getValue() 全量拷贝进 React 成本高，与普通编辑器共用防抖。
                const flushModified = () => {
                  onModifiedChangeRef.current(modifiedEditor.getValue());
                };
                modifiedListenerRef.current = modifiedEditor.onDidChangeModelContent(() => {
                  if (!debounceDiffChangeRef.current) {
                    flushModified();
                    return;
                  }
                  if (modifiedChangeTimerRef.current != null) {
                    window.clearTimeout(modifiedChangeTimerRef.current);
                  }
                  modifiedChangeTimerRef.current = window.setTimeout(() => {
                    modifiedChangeTimerRef.current = null;
                    flushModified();
                  }, MONACO_LARGE_FILE_CHANGE_DEBOUNCE_MS);
                });
              }
            }}
            options={{
              ...diffEditorOptions,
              readOnly,
              // large/huge 双栏 Diff 内存与布局开销过高，降级为 inline。
              renderSideBySide,
            }}
          />
        </>
      )}
    </Suspense>
  );
}
