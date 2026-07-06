import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Spin } from "antd";
import type * as Monaco from "monaco-editor";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { configureWiseMonacoTypeScript } from "../services/monacoTypeScriptEnvironment";
import { installMonacoTrackpadSelectionGuard } from "../utils/monacoTrackpadSelectionGuard";
import {
  maxMonacoContentLength,
  resolveWiseMonacoEditorOptionsFromLength,
  shouldDeferMonacoEditorMount,
} from "../utils/monacoLargeFile";
import { runWhenIdle } from "../utils/deferIdle";
import { resolveMonacoIdleDeferTimeoutMs } from "../utils/uiWorkDefer";
import { MonacoSelectionChatToolbar } from "./MonacoSelectionChatToolbar";

const DiffEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })),
);

interface Props {
  relativePath: string;
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
  const diffEditorRef = useRef<MonacoEditorNamespace.IStandaloneDiffEditor | null>(null);
  const onModifiedChangeRef = useRef(onModifiedChange);
  onModifiedChangeRef.current = onModifiedChange;
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
      modifiedListenerRef.current?.dispose();
      modifiedListenerRef.current = null;
      trackpadGuardRef.current?.dispose();
      trackpadGuardRef.current = null;
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
            key={readOnly ? "wise-git-diff-ro" : "wise-git-diff-rw"}
            height="100%"
            className="app-file-editor-monaco app-file-editor-monaco--diff"
            theme={dark ? "vs-dark" : "vs"}
            original={original}
            modified={modified}
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
              if (!readOnly) {
                modifiedListenerRef.current = modifiedEditor.onDidChangeModelContent(() => {
                  onModifiedChangeRef.current(modifiedEditor.getValue());
                });
              }
            }}
            options={{
              ...diffEditorOptions,
              readOnly,
              renderSideBySide: true,
            }}
          />
        </>
      )}
    </Suspense>
  );
}
