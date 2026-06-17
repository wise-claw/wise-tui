import { memo, useCallback, useMemo } from "react";
import { dispatchOpenRepositoryFile } from "../../constants/workflowUiEvents";
import { relativePathInRepository } from "../../utils/toolFileEditPreview";
import { ExplorerTreeFileIcon } from "../GitPanel/explorerTreeChrome";
import { highlightMarkdownCode } from "../../utils/markdownCodeHighlight";
import type { ToolFileEditPreview } from "../../utils/toolFileEditPreview";
import { useChatRepositoryPath } from "./chatRepositoryContext";
import "./markdownCodeHighlight.css";

function HighlightedCodeLine({ text, lang }: { text: string; lang: string }) {
  const highlighted = useMemo(() => {
    if (!text) return null;
    return highlightMarkdownCode(text, lang);
  }, [text, lang]);
  const codeClass = highlighted?.resolvedLang ? `hljs language-${highlighted.resolvedLang}` : "hljs";
  if (highlighted) {
    return <code className={codeClass} dangerouslySetInnerHTML={{ __html: highlighted.html }} />;
  }
  return <code className={codeClass}>{text || " "}</code>;
}

export const ToolFileEditCard = memo(function ToolFileEditCard({
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

  const handleOpenFile = useCallback(() => {
    if (!repositoryPath) return;
    const relativePath = relativePathInRepository(repositoryPath, preview.filePath);
    if (!relativePath) return;
    dispatchOpenRepositoryFile({ repositoryPath, relativePath });
  }, [preview.filePath, repositoryPath]);

  const statsLabel = useMemo(() => {
    if (preview.addedLineCount > 0 && preview.removedLineCount > 0) {
      return `+${preview.addedLineCount} -${preview.removedLineCount}`;
    }
    if (preview.addedLineCount > 0) return `+${preview.addedLineCount}`;
    if (preview.removedLineCount > 0) return `-${preview.removedLineCount}`;
    return "";
  }, [preview.addedLineCount, preview.removedLineCount]);

  const statsClass =
    preview.addedLineCount > 0 && preview.removedLineCount === 0
      ? "app-tool-edit-card__stats app-tool-edit-card__stats--add"
      : preview.removedLineCount > 0 && preview.addedLineCount === 0
        ? "app-tool-edit-card__stats app-tool-edit-card__stats--remove"
        : "app-tool-edit-card__stats";

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
      <div className="app-tool-edit-card__body">
        <pre className="app-tool-edit-card__code">
          {preview.lines.map((line, idx) => (
            <div
              key={`${idx}-${line.kind}-${line.text.slice(0, 24)}`}
              className={`app-tool-edit-card__line app-tool-edit-card__line--${line.kind}`}
            >
              <HighlightedCodeLine text={line.text} lang={preview.language} />
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
});
