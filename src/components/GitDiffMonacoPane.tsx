import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Spin } from "antd";
import type * as Monaco from "monaco-editor";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { configureWiseMonacoTypeScript } from "../services/monacoTypeScriptEnvironment";
import { installMonacoGlobalFindRedirect } from "../utils/monacoGlobalFindRedirect";
import { installMonacoTrackpadSelectionGuard } from "../utils/monacoTrackpadSelectionGuard";
import {
  maxMonacoContentLength,
  resolveWiseMonacoEditorOptionsFromLength,
  shouldDeferMonacoEditorMount,
} from "../utils/monacoLargeFile";
import { runWhenIdle } from "../utils/deferIdle";
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
  activeSessionId = null,
  onModifiedChange,
}: Props) {
  const modifiedListenerRef = useRef<{ dispose: () => void } | null>(null);
  const trackpadGuardRef = useRef<{ dispose: () => void } | null>(null);
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
  const diffEditorOptions = resolveWiseMonacoEditorOptionsFromLength(diffContentLength);
  const [surfaceReady, setSurfaceReady] = useState(
    () => !shouldDeferMonacoEditorMount(diffContentLength),
  );

  useEffect(() => {
    if (!shouldDeferMonacoEditorMount(diffContentLength)) {
      setSurfaceReady(true);
      return;
    }
    setSurfaceReady(false);
    return runWhenIdle(() => setSurfaceReady(true), { timeoutMs: 48 });
  }, [diffContentLength, relativePath]);

  useEffect(() => {
    setDiffEditors(null);
    return () => {
      modifiedListenerRef.current?.dispose();
      modifiedListenerRef.current = null;
      trackpadGuardRef.current?.dispose();
      trackpadGuardRef.current = null;
    };
  }, [relativePath]);

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
              const originalEditor = diffEditor.getOriginalEditor();
              const modifiedEditor = diffEditor.getModifiedEditor();
              setDiffEditors({ original: originalEditor, modified: modifiedEditor });
              const guards = [
                installMonacoTrackpadSelectionGuard(originalEditor),
                installMonacoTrackpadSelectionGuard(modifiedEditor),
                installMonacoGlobalFindRedirect(originalEditor),
                installMonacoGlobalFindRedirect(modifiedEditor),
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
