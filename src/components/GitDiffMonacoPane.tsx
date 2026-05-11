import { lazy, Suspense, useEffect, useRef } from "react";
import { Spin } from "antd";

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
  const onModifiedChangeRef = useRef(onModifiedChange);
  onModifiedChangeRef.current = onModifiedChange;

  useEffect(
    () => () => {
      modifiedListenerRef.current?.dispose();
      modifiedListenerRef.current = null;
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
        key={`wise-git-diff:${relativePath}:${readOnly ? "ro" : "rw"}`}
        height="100%"
        className="app-file-editor-monaco app-file-editor-monaco--diff"
        theme={dark ? "vs-dark" : "vs"}
        original={original}
        modified={modified}
        language={language}
        originalModelPath={`wise-diff-left:${relativePath}`}
        modifiedModelPath={`wise-diff-right:${relativePath}`}
        onMount={(diffEditor) => {
          modifiedListenerRef.current?.dispose();
          modifiedListenerRef.current = null;
          if (readOnly) {
            return;
          }
          const mod = diffEditor.getModifiedEditor();
          modifiedListenerRef.current = mod.onDidChangeModelContent(() => {
            onModifiedChangeRef.current(mod.getValue());
          });
        }}
        options={{
          readOnly,
          minimap: { enabled: false },
          stickyScroll: { enabled: false },
          renderSideBySide: true,
          automaticLayout: true,
          fontSize: 13,
          wordWrap: "on",
          scrollBeyondLastLine: false,
        }}
      />
    </Suspense>
  );
}
