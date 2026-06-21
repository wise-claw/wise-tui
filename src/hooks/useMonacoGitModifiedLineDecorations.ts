import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { gitShowRevision } from "../services/git";
import { getGitRepositoryExplorerStatusSnapshot } from "../stores/gitRepositoryExplorerStatusStore";
import {
  classifyLineChanges,
  monacoLineChangeGutterClassName,
  monacoLineChangeOverviewColor,
} from "../utils/monacoGitModifiedLineDecorations";
import { shouldDeferNonCriticalUiWork } from "../utils/uiWorkDefer";

function applyLineChangeDecorations(
  editor: MonacoEditorNamespace.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  base: string,
  current: string,
  decorationRef: { current: MonacoEditorNamespace.IEditorDecorationsCollection | null },
): void {
  const changes = classifyLineChanges(base, current);
  decorationRef.current?.clear();
  if (changes.length === 0) {
    decorationRef.current = null;
    return;
  }
  decorationRef.current = editor.createDecorationsCollection(
    changes.map(({ lineNumber, kind }) => ({
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: monacoLineChangeGutterClassName(kind),
        overviewRuler: {
          color: monacoLineChangeOverviewColor(kind),
          position: monaco.editor.OverviewRulerLane.Left,
        },
      },
    })),
  );
}

export function useMonacoGitModifiedLineDecorations(args: {
  editor: MonacoEditorNamespace.IStandaloneCodeEditor | null;
  monaco: typeof Monaco | null;
  repositoryPath: string | null | undefined;
  relativePath: string | null | undefined;
  /** 已保存/打开时的基准内容（通常是 tab.originalContent）。 */
  baselineContent: string | null | undefined;
  enabled: boolean;
  gitStatusRevision: number;
}): void {
  const decorationRef = useRef<MonacoEditorNamespace.IEditorDecorationsCollection | null>(null);
  const gitLoadGenerationRef = useRef(0);

  useEffect(() => {
    decorationRef.current?.clear();
    decorationRef.current = null;

    const { editor, monaco, repositoryPath, relativePath, baselineContent, enabled } = args;
    if (!enabled || !editor || !monaco || !relativePath?.trim() || baselineContent == null) {
      return;
    }

    const repoPath = repositoryPath?.trim() ?? "";
    const filePath = relativePath.trim();
    const baseline = baselineContent;
    let cancelled = false;
    let rafId = 0;

    const refreshFromEditor = () => {
      if (cancelled) return;
      const model = editor.getModel();
      if (!model) return;
      const current = model.getValue();
      if (current !== baseline) {
        applyLineChangeDecorations(editor, monaco, baseline, current, decorationRef);
        return;
      }
      decorationRef.current?.clear();
      decorationRef.current = null;
      void refreshGitDecorations();
    };

    const refreshGitDecorations = async () => {
      if (!repoPath) return;
      const gitStatus = getGitRepositoryExplorerStatusSnapshot(repoPath).fileStatusByPath.get(filePath);
      if (!gitStatus) return;

      const loadGeneration = ++gitLoadGenerationRef.current;
      try {
        const headContent = await gitShowRevision(repoPath, `HEAD:${filePath}`);
        if (cancelled || loadGeneration !== gitLoadGenerationRef.current) return;
        const model = editor.getModel();
        if (!model || model.getValue() !== baseline) return;

        applyLineChangeDecorations(editor, monaco, headContent, baseline, decorationRef);
      } catch {
        if (!cancelled) {
          decorationRef.current?.clear();
          decorationRef.current = null;
        }
      }
    };

    const scheduleRefresh = () => {
      if (shouldDeferNonCriticalUiWork() && !editor.hasTextFocus()) return;
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        refreshFromEditor();
      });
    };

    const contentListener = editor.onDidChangeModelContent(scheduleRefresh);
    scheduleRefresh();

    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      contentListener.dispose();
      decorationRef.current?.clear();
      decorationRef.current = null;
    };
  }, [
    args.editor,
    args.monaco,
    args.repositoryPath,
    args.relativePath,
    args.baselineContent,
    args.enabled,
    args.gitStatusRevision,
  ]);
}
