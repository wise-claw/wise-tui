import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type * as Monaco from "monaco-editor";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { openCodeReviewDrawer } from "../constants/workflowUiEvents";
import {
  getCodeReviewFindingsForFile,
  getCodeReviewFindingsSnapshot,
  subscribeCodeReviewFindings,
} from "../stores/codeReviewFindingsStore";
import {
  buildCodeReviewHoverMessage,
  groupCodeReviewFindingsByLine,
  monacoCodeReviewGlyphClassName,
  monacoCodeReviewOverviewColor,
  monacoCodeReviewSeverityClassName,
} from "../utils/monacoCodeReviewFindingDecorations";

function subscribe(listener: () => void): () => void {
  return subscribeCodeReviewFindings(listener);
}

function getSnapshot(repositoryPath: string): string {
  const snap = getCodeReviewFindingsSnapshot(repositoryPath);
  if (!snap) return "";
  return `${snap.runId}:${snap.updatedAtMs}:${snap.findings.length}:${snap.stale ? 1 : 0}`;
}

/**
 * Overlay Code Review findings onto a Monaco editor (modified/right side for diffs).
 * Glyph-margin click opens the Code Review drawer focused on that finding.
 */
export function useMonacoCodeReviewFindingDecorations(args: {
  editor: MonacoEditorNamespace.IStandaloneCodeEditor | null;
  monaco: typeof Monaco | null;
  repositoryPath: string | null | undefined;
  relativePath: string | null | undefined;
  enabled?: boolean;
}): void {
  const decorationRef = useRef<MonacoEditorNamespace.IEditorDecorationsCollection | null>(null);
  const repo = args.repositoryPath?.trim() ?? "";
  const relativePath = args.relativePath?.trim() ?? "";
  const enabled = args.enabled !== false;
  const editor = args.editor;
  const monaco = args.monaco;
  const revision = useSyncExternalStore(
    subscribe,
    () => getSnapshot(repo),
    () => "",
  );
  const [styleReady, setStyleReady] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = "wise-code-review-finding-styles";
    if (document.getElementById(id)) {
      setStyleReady(true);
      return;
    }
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
.wise-code-review-line--critical { background: rgba(196, 29, 127, 0.12); }
.wise-code-review-line--high { background: rgba(255, 77, 79, 0.12); }
.wise-code-review-line--medium { background: rgba(250, 140, 22, 0.10); }
.wise-code-review-line--low { background: rgba(140, 140, 140, 0.08); }
.wise-code-review-glyph {
  margin-left: 2px;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-bottom: 7px solid #8c8c8c;
  cursor: pointer;
}
.wise-code-review-glyph--critical { border-bottom-color: #c41d7f; }
.wise-code-review-glyph--high { border-bottom-color: #ff4d4f; }
.wise-code-review-glyph--medium { border-bottom-color: #fa8c16; }
.wise-code-review-glyph--low { border-bottom-color: #8c8c8c; }
.wise-code-review-line--stale { opacity: 0.45; }
.wise-code-review-glyph--stale { opacity: 0.45; }
`;
    document.head.appendChild(style);
    setStyleReady(true);
  }, []);

  useEffect(() => {
    decorationRef.current?.clear();
    decorationRef.current = null;

    if (!enabled || !styleReady || !editor || !monaco || !repo || !relativePath) {
      return;
    }

    const snap = getCodeReviewFindingsSnapshot(repo);
    const stale = Boolean(snap?.stale);
    const findings = getCodeReviewFindingsForFile(repo, relativePath);
    const byLine = groupCodeReviewFindingsByLine(findings);
    if (byLine.size === 0) return;

    const lineCount = Math.max(1, editor.getModel()?.getLineCount() ?? 1);
    const decorations: MonacoEditorNamespace.IModelDeltaDecoration[] = [];
    for (const [line, lineFindings] of byLine) {
      if (line > lineCount) continue;
      const primary = lineFindings[0]!;
      const hover = [
        ...lineFindings.map(buildCodeReviewHoverMessage),
        stale ? "_工作区已变，结果可能过期_" : "",
        "_点击左侧标记打开审查详情_",
      ]
        .filter(Boolean)
        .join("\n\n---\n\n");
      const lineClass = [
        monacoCodeReviewSeverityClassName(String(primary.severity)),
        stale ? "wise-code-review-line--stale" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const glyphClass = [
        monacoCodeReviewGlyphClassName(String(primary.severity)),
        stale ? "wise-code-review-glyph--stale" : "",
      ]
        .filter(Boolean)
        .join(" ");
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: lineClass,
          glyphMarginClassName: glyphClass,
          glyphMarginHoverMessage: { value: hover },
          hoverMessage: { value: hover },
          overviewRuler: {
            color: monacoCodeReviewOverviewColor(String(primary.severity)),
            position: monaco.editor.OverviewRulerLane.Right,
          },
        },
      });
    }

    if (decorations.length === 0) return;
    decorationRef.current = editor.createDecorationsCollection(decorations);

    return () => {
      decorationRef.current?.clear();
      decorationRef.current = null;
    };
  }, [editor, enabled, monaco, relativePath, repo, revision, styleReady]);

  useEffect(() => {
    if (!enabled || !editor || !monaco || !repo || !relativePath) return;

    const glyphMargin =
      monaco.editor.MouseTargetType?.GUTTER_GLYPH_MARGIN ??
      // Monaco enum fallback (GUTTER_GLYPH_MARGIN === 2 in classic builds)
      2;

    const disposable = editor.onMouseDown((event) => {
      if (!event.event.leftButton) return;
      if (event.target.type !== glyphMargin) return;
      const line = event.target.position?.lineNumber;
      if (line == null || line < 1) return;
      const lineFindings = getCodeReviewFindingsForFile(repo, relativePath).filter(
        (finding) => finding.line != null && Math.floor(finding.line) === line,
      );
      if (lineFindings.length === 0) return;
      const snap = getCodeReviewFindingsSnapshot(repo);
      if (!snap?.run) return;
      event.event.preventDefault();
      event.event.stopPropagation();
      openCodeReviewDrawer({
        repositoryPath: repo,
        autoStart: false,
        seededRun: snap.run,
        initialScope: snap.run.scope === "branch" ? "branch" : "uncommitted",
        focusFinding: {
          path: relativePath,
          line,
        },
      });
    });

    return () => {
      disposable.dispose();
    };
  }, [editor, enabled, monaco, relativePath, repo, revision]);
}
