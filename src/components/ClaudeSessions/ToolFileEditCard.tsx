import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { dispatchOpenRepositoryFile } from "../../constants/workflowUiEvents";
import {
  groupFileEditDiffRows,
  relativePathInRepository,
  type ToolFileEditPreviewLine,
} from "../../utils/toolFileEditPreview";
import { ExplorerTreeFileIcon } from "../GitPanel/explorerTreeChrome";
import { highlightMarkdownCode } from "../../utils/markdownCodeHighlight";
import type { ToolFileEditPreview } from "../../utils/toolFileEditPreview";
import {
  getClaudeChatMessageScrollBridge,
  rememberChatScrollBeforeFileOpen,
} from "../../stores/claudeChatMessageScrollBridge";
import { loadWorkingTreeFileDiffLines } from "../../utils/workingTreeFileDiff";
import { useChatRepositoryPath } from "./chatRepositoryContext";
import "./markdownCodeHighlight.css";

function HighlightedCodeLine({
  text,
  lang,
  streaming,
}: {
  text: string;
  lang: string;
  streaming: boolean;
}) {
  const highlighted = useMemo(() => {
    if (!text || streaming) return null;
    return highlightMarkdownCode(text, lang);
  }, [text, lang, streaming]);
  const codeClass = highlighted?.resolvedLang ? `hljs language-${highlighted.resolvedLang}` : "hljs";
  if (highlighted) {
    return <code className={codeClass} dangerouslySetInnerHTML={{ __html: highlighted.html }} />;
  }
  return <code className={codeClass}>{text || " "}</code>;
}

function useWorkingTreeDiffLines(
  repositoryPath: string | null,
  filePath: string,
  enabled: boolean,
): ToolFileEditPreviewLine[] {
  const relativePath = repositoryPath ? relativePathInRepository(repositoryPath, filePath) : null;
  const [lines, setLines] = useState<ToolFileEditPreviewLine[]>([]);
  useEffect(() => {
    if (!enabled || !repositoryPath || !relativePath) {
      setLines([]);
      return;
    }
    let cancelled = false;
    void loadWorkingTreeFileDiffLines(repositoryPath, relativePath)
      .then((next) => {
        if (!cancelled) setLines(next);
      })
      .catch(() => {
        if (!cancelled) setLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, repositoryPath, relativePath]);
  return lines;
}

function gutterLineNumber(line: ToolFileEditPreviewLine): string {
  if (line.kind === "remove") return line.oldLine == null ? "" : String(line.oldLine);
  return line.newLine == null ? "" : String(line.newLine);
}

function FoldChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {expanded ? <path d="M4 6l4 4 4-4" /> : <path d="M6 4l4 4-4 4" />}
    </svg>
  );
}

function toolFileEditPreviewFingerprint(
  preview: ToolFileEditPreview,
  streaming?: boolean,
): string {
  if (streaming) {
    const last = preview.lines[preview.lines.length - 1];
    const lastLen = last?.text.length ?? 0;
    return `s|${preview.filePath}|${preview.lines.length}|${Math.floor(lastLen / 128)}`;
  }
  return `d|${preview.filePath}|${preview.addedLineCount}|${preview.removedLineCount}|${preview.truncated}|${preview.lines
    .map((line) => `${line.kind}:${line.text}`)
    .join("\n")}`;
}

export const ToolFileEditCard = memo(
  function ToolFileEditCard({
    preview,
    streaming = false,
  }: {
    preview: ToolFileEditPreview;
    streaming?: boolean;
  }) {
    const repositoryPath = useChatRepositoryPath();
    const canOpenFile = useMemo(() => {
      if (!repositoryPath) return false;
      return relativePathInRepository(repositoryPath, preview.filePath) != null;
    }, [preview.filePath, repositoryPath]);

    const handleOpenFile = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        if (!repositoryPath) return;
        const relativePath = relativePathInRepository(repositoryPath, preview.filePath);
        if (!relativePath) return;

        const scrollContainer = event.currentTarget.closest(".app-claude-messages");
        const messageId =
          event.currentTarget.closest("[data-message-id]")?.getAttribute("data-message-id") ?? null;
        if (scrollContainer instanceof HTMLElement) {
          rememberChatScrollBeforeFileOpen({
            scrollTop: scrollContainer.scrollTop,
            messageId,
          });
        }
        getClaudeChatMessageScrollBridge().pauseFollowForMessageNavigation();
        dispatchOpenRepositoryFile({ repositoryPath, relativePath });
        // 切到「文件」视图由 useRepositoryFileEditor.openRepositoryFile 统一处理
        //（按目标 pane 切，避免共享仓库边界下误切消息所在 pane）。
      },
      [preview.filePath, repositoryPath],
    );

    const recoveredLines = useWorkingTreeDiffLines(
      repositoryPath,
      preview.filePath,
      preview.lines.length === 0,
    );
    const displayLines = preview.lines.length > 0 ? preview.lines : recoveredLines;
    const addedLineCount =
      preview.lines.length > 0
        ? preview.addedLineCount
        : displayLines.filter((line) => line.kind === "add").length;
    const removedLineCount =
      preview.lines.length > 0
        ? preview.removedLineCount
        : displayLines.filter((line) => line.kind === "remove").length;

    const statsLabel = useMemo(() => {
      if (addedLineCount > 0 && removedLineCount > 0) {
        return `+${addedLineCount} -${removedLineCount}`;
      }
      if (addedLineCount > 0) return `+${addedLineCount}`;
      if (removedLineCount > 0) return `-${removedLineCount}`;
      return "";
    }, [addedLineCount, removedLineCount]);

    const statsClass =
      addedLineCount > 0 && removedLineCount === 0
        ? "app-tool-edit-card__stats app-tool-edit-card__stats--add"
        : removedLineCount > 0 && addedLineCount === 0
          ? "app-tool-edit-card__stats app-tool-edit-card__stats--remove"
          : "app-tool-edit-card__stats";

    const diffRows = useMemo(() => groupFileEditDiffRows(displayLines), [displayLines]);
    const foldSignature = `${preview.filePath}|${addedLineCount}|${removedLineCount}|${displayLines.length}`;
    const [foldState, setFoldState] = useState<{ signature: string; open: Record<string, boolean> }>({
      signature: foldSignature,
      open: {},
    });
    const openFolds = foldState.signature === foldSignature ? foldState.open : {};
    const toggleFold = useCallback((key: string) => {
      setFoldState((prev) => {
        const open = prev.signature === foldSignature ? prev.open : {};
        return { signature: foldSignature, open: { ...open, [key]: !open[key] } };
      });
    }, [foldSignature]);

    return (
      <div
        className={`app-tool-edit-card${streaming ? " app-tool-edit-card--streaming" : ""}${
          preview.truncated ? " app-tool-edit-card--truncated" : ""
        }`}
      >
        <div className="app-tool-edit-card__head">
          <ExplorerTreeFileIcon fileName={preview.fileName} className="app-tool-edit-card__icon" />
          {canOpenFile ? (
            <button
              type="button"
              className="app-tool-edit-card__filename app-tool-edit-card__filename--clickable"
              title={preview.filePath}
              onClick={handleOpenFile}
            >
              {preview.fileName}
            </button>
          ) : (
            <span className="app-tool-edit-card__filename" title={preview.filePath}>
              {preview.fileName}
            </span>
          )}
          {statsLabel ? <span className={statsClass}>{statsLabel}</span> : null}
        </div>
        {diffRows.length > 0 ? (
          <div className="app-tool-edit-card__body">
            <div className="app-tool-edit-card__code">
              {diffRows.map((row) => {
                if (row.type === "fold") {
                  const expanded = openFolds[row.key] === true;
                  return (
                    <div key={row.key} className="app-tool-edit-card__fold-block">
                      <button
                        type="button"
                        className="app-tool-edit-card__fold"
                        aria-expanded={expanded}
                        onClick={() => toggleFold(row.key)}
                      >
                        <FoldChevron expanded={expanded} />
                        <span>{expanded ? "收起未修改行" : `${row.count} 行未修改`}</span>
                      </button>
                      {expanded
                        ? row.lines.map((line, index) => (
                            <div
                              key={`${row.key}-${index}`}
                              className={`app-tool-edit-card__line app-tool-edit-card__line--${line.kind}`}
                            >
                              <span className="app-tool-edit-card__gutter">{gutterLineNumber(line)}</span>
                              <HighlightedCodeLine text={line.text} lang={preview.language} streaming={streaming} />
                            </div>
                          ))
                        : null}
                    </div>
                  );
                }
                const line = row.line;
                return (
                  <div
                    key={row.key}
                    className={`app-tool-edit-card__line app-tool-edit-card__line--${line.kind}`}
                  >
                    <span className="app-tool-edit-card__gutter">{gutterLineNumber(line)}</span>
                    <HighlightedCodeLine text={line.text} lang={preview.language} streaming={streaming} />
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
  },
  (prev, next) =>
    prev.streaming === next.streaming &&
    toolFileEditPreviewFingerprint(prev.preview, prev.streaming) ===
      toolFileEditPreviewFingerprint(next.preview, next.streaming),
);
