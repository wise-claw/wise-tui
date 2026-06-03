import { lazy, Suspense, type ComponentProps } from "react";
import { Spin } from "antd";

const MonacoEditorLazy = lazy(() => import("@monaco-editor/react"));

type MonacoEditorProps = ComponentProps<typeof MonacoEditorLazy>;

export function LazyMonacoEditor({
  loadingClassName = "app-file-editor-loading",
  ...props
}: MonacoEditorProps & { loadingClassName?: string }) {
  return (
    <Suspense
      fallback={
        <div className={loadingClassName} aria-busy="true">
          <Spin size="small" />
        </div>
      }
    >
      <MonacoEditorLazy {...props} />
    </Suspense>
  );
}
