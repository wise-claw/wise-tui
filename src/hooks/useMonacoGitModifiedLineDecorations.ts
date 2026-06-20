import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { gitShowRevision } from "../services/git";
import { getGitRepositoryExplorerStatusSnapshot } from "../stores/gitRepositoryExplorerStatusStore";
import { computeLineNumbersDifferentFromBase } from "../utils/monacoGitModifiedLineDecorations";

export function useMonacoGitModifiedLineDecorations(args: {
  editor: MonacoEditorNamespace.IStandaloneCodeEditor | null;
  monaco: typeof Monaco | null;
  repositoryPath: string | null | undefined;
  relativePath: string | null | undefined;
  diskContent: string | null | undefined;
  enabled: boolean;
  gitStatusRevision: number;
}): void {
  const decorationRef = useRef<MonacoEditorNamespace.IEditorDecorationsCollection | null>(null);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    decorationRef.current?.clear();
    decorationRef.current = null;

    const { editor, monaco, repositoryPath, relativePath, diskContent, enabled } = args;
    if (!enabled || !editor || !monaco || !repositoryPath?.trim() || !relativePath?.trim() || diskContent == null) {
      return;
    }

    const repoPath = repositoryPath.trim();
    const filePath = relativePath.trim();
    const gitStatus = getGitRepositoryExplorerStatusSnapshot(repoPath).fileStatusByPath.get(filePath);
    if (!gitStatus) {
      return;
    }

    const loadGeneration = ++loadGenerationRef.current;
    let cancelled = false;

    void (async () => {
      try {
        const headContent = await gitShowRevision(repoPath, `HEAD:${filePath}`);
        if (cancelled || loadGeneration !== loadGenerationRef.current) {
          return;
        }
        const changedLines = computeLineNumbersDifferentFromBase(headContent, diskContent);
        decorationRef.current?.clear();
        if (changedLines.length === 0) {
          decorationRef.current = null;
          return;
        }
        decorationRef.current = editor.createDecorationsCollection(
          changedLines.map((lineNumber) => ({
            range: new monaco.Range(lineNumber, 1, lineNumber, 1),
            options: {
              isWholeLine: true,
              linesDecorationsClassName: "wise-monaco-git-modified-gutter",
            },
          })),
        );
      } catch {
        decorationRef.current?.clear();
        decorationRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      decorationRef.current?.clear();
      decorationRef.current = null;
    };
  }, [
    args.editor,
    args.monaco,
    args.repositoryPath,
    args.relativePath,
    args.diskContent,
    args.enabled,
    args.gitStatusRevision,
  ]);
}
