import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Alert, Spin, Typography } from "antd";
import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { readProjectRelativeFile } from "../../services/materializePrdSnapshot";
import { configureWiseMonacoTypeScript } from "../../services/monacoTypeScriptEnvironment";
import type { GraphNode } from "../../types/codeKnowledgeGraph";
import { isMonacoSupportedFilePath, monacoLanguageFromRepositoryPath } from "../../utils/repositoryFilePreview";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

function monacoSourcePath(node: GraphNode | null): string | null {
  if (!node?.path?.trim()) return null;
  if (!isMonacoSupportedFilePath(node.path)) return null;
  if (node.kind === "file" || node.kind === "symbol") return node.path;
  if (node.kind === "api_operation" || node.kind === "schema") return node.path;
  return null;
}

function revealSelection(monaco: typeof Monaco, ed: editor.IStandaloneCodeEditor, node: GraphNode | null) {
  if (!node?.range) {
    ed.setScrollTop(0);
    ed.setPosition({ lineNumber: 1, column: 1 });
    return;
  }
  const startLine = node.range.start.line + 1;
  const startCol = node.range.start.column + 1;
  const endLine = Math.max(node.range.end.line + 1, startLine);
  const endCol = Math.max(node.range.end.column + 1, 1);
  const range = new monaco.Range(startLine, startCol, endLine, endCol);
  ed.revealRangeInCenter(range, monaco.editor.ScrollType.Immediate);
  ed.setSelection(range);
}

interface Props {
  repositoryPath: string | null | undefined;
  selectedNode: GraphNode | null;
}

export function CodeGraphSourcePreview({ repositoryPath, selectedNode }: Props) {
  const sourcePath = monacoSourcePath(selectedNode);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const selectedRef = useRef(selectedNode);
  selectedRef.current = selectedNode;

  useEffect(() => {
    if (!repositoryPath?.trim() || !sourcePath) {
      setContent("");
      setLoadError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void readProjectRelativeFile(repositoryPath, sourcePath)
      .then((body) => {
        if (cancelled) return;
        setContent(body);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("读取文件失败");
        setContent("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repositoryPath, sourcePath]);

  const language = monacoLanguageFromRepositoryPath(sourcePath);
  const showEditor = Boolean(repositoryPath && sourcePath && !loadError);

  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco || loading || !showEditor) return;
    revealSelection(monaco, ed, selectedNode);
  }, [loading, showEditor, selectedNode?.id, selectedNode?.range, content]);

  if (!selectedNode) {
    return (
      <div className="app-code-graph-source-preview app-code-graph-source-preview--empty">
        <Typography.Text type="secondary">选择文件或符号查看源码</Typography.Text>
      </div>
    );
  }

  if (!sourcePath) {
    return (
      <div className="app-code-graph-source-preview app-code-graph-source-preview--empty">
        <Typography.Text type="secondary">当前节点无可用源码预览</Typography.Text>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app-code-graph-source-preview app-code-graph-source-preview--empty">
        <Alert type="error" message={loadError} showIcon />
      </div>
    );
  }

  return (
    <div className="app-code-graph-source-preview">
      {loading ? (
        <div className="app-code-graph-source-preview-loading">
          <Spin size="small" />
        </div>
      ) : null}
      {showEditor ? (
        <Suspense fallback={<div className="app-code-graph-source-preview-loading"><Spin /></div>}>
          <MonacoEditor
            key={sourcePath}
            height="100%"
            className="app-code-graph-source-preview-monaco"
            theme="vs-dark"
            path={sourcePath}
            language={language}
            value={content}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 12,
              wordWrap: "on",
              automaticLayout: true,
            }}
            beforeMount={(monaco) => {
              configureWiseMonacoTypeScript(monaco);
            }}
            onMount={(ed, monaco) => {
              editorRef.current = ed;
              monacoRef.current = monaco;
              revealSelection(monaco, ed, selectedRef.current);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
