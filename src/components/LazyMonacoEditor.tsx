import { lazy, Suspense, useCallback, useEffect, useRef, type ComponentProps } from "react";
import { Spin } from "antd";
import type { IDisposable } from "monaco-editor";
import { installMonacoTrackpadSelectionGuard } from "../utils/monacoTrackpadSelectionGuard";

const MonacoEditorLazy = lazy(() => import("@monaco-editor/react"));

type MonacoEditorProps = ComponentProps<typeof MonacoEditorLazy>;

export function LazyMonacoEditor({
  loadingClassName = "app-file-editor-loading",
  onMount,
  ...props
}: MonacoEditorProps & { loadingClassName?: string }) {
  const monacoMountGuardRef = useRef<IDisposable | null>(null);

  useEffect(
    () => () => {
      monacoMountGuardRef.current?.dispose();
      monacoMountGuardRef.current = null;
    },
    [],
  );

  const handleMount = useCallback<NonNullable<MonacoEditorProps["onMount"]>>(
    (editor, monaco) => {
      monacoMountGuardRef.current?.dispose();
      const trackpadGuard = installMonacoTrackpadSelectionGuard(editor);
      monacoMountGuardRef.current = {
        dispose: () => {
          trackpadGuard.dispose();
        },
      };
      onMount?.(editor, monaco);
    },
    [onMount],
  );

  return (
    <Suspense
      fallback={
        <div className={loadingClassName} aria-busy="true">
          <Spin size="small" />
        </div>
      }
    >
      <MonacoEditorLazy {...props} onMount={handleMount} />
    </Suspense>
  );
}
