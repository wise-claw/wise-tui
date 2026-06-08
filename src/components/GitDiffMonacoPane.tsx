import { lazy, Suspense, useEffect, useRef } from "react";
import { Spin } from "antd";
import { configureWiseMonacoTypeScript } from "../services/monacoTypeScriptEnvironment";
import { installMonacoGlobalFindRedirect } from "../utils/monacoGlobalFindRedirect";
import { installMonacoTrackpadSelectionGuard } from "../utils/monacoTrackpadSelectionGuard";
import { WISE_MONACO_EDITOR_OPTIONS } from "../utils/wiseMonacoEditorOptions";

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
  onModifiedChange: (value: string) => void;
}

export function GitDiffMonacoPane({
  relativePath,
  original,
  modified,
  language,
  readOnly,
  dark,
  onModifiedChange,
}: Props) {
  const modifiedListenerRef = useRef<{ dispose: () => void } | null>(null);
  const trackpadGuardRef = useRef<{ dispose: () => void } | null>(null);
  const onModifiedChangeRef = useRef(onModifiedChange);
  onModifiedChangeRef.current = onModifiedChange;

  useEffect(
    () => () => {
      modifiedListenerRef.current?.dispose();
      modifiedListenerRef.current = null;
      trackpadGuardRef.current?.dispose();
      trackpadGuardRef.current = null;
    },
    [relativePath],
  );

  return (
    <Suspense
      fallback={
        <div className="app-file-editor-loading">
          <Spin size="small" />
        </div>
      }
    >
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
          configureWiseMonacoTypeScript(monaco);
        }}
        onMount={(diffEditor) => {
          modifiedListenerRef.current?.dispose();
          modifiedListenerRef.current = null;
          trackpadGuardRef.current?.dispose();
          const guards = [
            installMonacoTrackpadSelectionGuard(diffEditor.getOriginalEditor()),
            installMonacoTrackpadSelectionGuard(diffEditor.getModifiedEditor()),
            installMonacoGlobalFindRedirect(diffEditor.getOriginalEditor()),
            installMonacoGlobalFindRedirect(diffEditor.getModifiedEditor()),
          ];
          trackpadGuardRef.current = {
            dispose: () => {
              for (const guard of guards) {
                guard.dispose();
              }
            },
          };
          if (!readOnly) {
            const mod = diffEditor.getModifiedEditor();
            modifiedListenerRef.current = mod.onDidChangeModelContent(() => {
              onModifiedChangeRef.current(mod.getValue());
            });
          }
        }}
        options={{
          ...WISE_MONACO_EDITOR_OPTIONS,
          readOnly,
          renderSideBySide: true,
        }}
      />
    </Suspense>
  );
}
