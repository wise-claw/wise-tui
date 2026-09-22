import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { dispatchOpenRepositoryFile } from "../../constants/workflowUiEvents";
import {
  getClaudeChatMessageScrollBridge,
  rememberChatScrollBeforeFileOpen,
} from "../../stores/claudeChatMessageScrollBridge";
import type { TurnFileChangeEntry } from "../../utils/turnFileChangeSummary";
import { relativePathInRepository } from "../../utils/toolFileEditPreview";
import {
  FILE_DIFF_RECOVERY_VERSION,
  loadWorkingTreeFileDiffLines,
} from "../../utils/workingTreeFileDiff";
import { ExplorerTreeFileIcon } from "../GitPanel/explorerTreeChrome";
import { useChatRepositoryPath } from "./chatRepositoryContext";

/** 文件变更总结卡折叠展示上限：超过后默认只展示前 N 个，点击展开全部。 */
const FILES_CHANGED_COLLAPSED_LIMIT = 8;

type LineCounts = { added: number; removed: number };

function hasRecordedLineCounts(file: TurnFileChangeEntry): boolean {
  return file.addedLineCount > 0 || file.removedLineCount > 0;
}

/** 工具入参没有 +/- 时，用工作区或最近一次提交的 diff 补行数。 */
function useRecoveredLineCounts(
  files: readonly TurnFileChangeEntry[],
  repositoryPath: string | null,
): Record<string, LineCounts> {
  const missingKey = files
    .filter((file) => !hasRecordedLineCounts(file))
    .map((file) => file.filePath)
    .join("\n");
  const [counts, setCounts] = useState<Record<string, LineCounts>>({});

  useEffect(() => {
    if (!repositoryPath || !missingKey) {
      setCounts({});
      return;
    }
    const missing = missingKey.split("\n");
    let cancelled = false;
    void Promise.all(
      missing.map(async (filePath) => {
        const relativePath = relativePathInRepository(repositoryPath, filePath);
        if (!relativePath) return null;
        const lines = await loadWorkingTreeFileDiffLines(repositoryPath, relativePath);
        return [
          filePath,
          {
            added: lines.filter((line) => line.kind === "add").length,
            removed: lines.filter((line) => line.kind === "remove").length,
          },
        ] as const;
      }),
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, LineCounts> = {};
      for (const row of rows) {
        if (!row) continue;
        next[row[0]] = row[1];
      }
      setCounts(next);
    });
    return () => {
      cancelled = true;
    };
  }, [missingKey, repositoryPath, FILE_DIFF_RECOVERY_VERSION]);

  return counts;
}

function filesFingerprint(files: readonly TurnFileChangeEntry[]): string {
  return files
    .map((f) => `${f.filePath}:+${f.addedLineCount}-:${f.removedLineCount}`)
    .join("|");
}

export const TurnFilesChangedSummaryCard = memo(
  function TurnFilesChangedSummaryCard({ files }: { files: readonly TurnFileChangeEntry[] }) {
    const repositoryPath = useChatRepositoryPath();
    const recoveredCounts = useRecoveredLineCounts(files, repositoryPath);
    const [expanded, setExpanded] = useState(false);

    const hasMore = files.length > FILES_CHANGED_COLLAPSED_LIMIT;
    const visibleFiles =
      expanded || !hasMore ? files : files.slice(0, FILES_CHANGED_COLLAPSED_LIMIT);
    const hiddenCount = files.length - FILES_CHANGED_COLLAPSED_LIMIT;

    const toggleExpanded = useCallback(() => {
      setExpanded((prev) => !prev);
    }, []);

    const handleOpenFile = useCallback(
      (event: MouseEvent<HTMLButtonElement>, file: TurnFileChangeEntry) => {
        if (!repositoryPath) return;
        const relativePath = relativePathInRepository(repositoryPath, file.filePath);
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
      },
      [repositoryPath],
    );

    const title = useMemo(() => `${files.length} 个文件已修改`, [files.length]);

    if (files.length === 0) return null;

    return (
      <div className={`app-turn-files-changed${hasMore ? " app-turn-files-changed--has-more" : ""}`}>
        <div className="app-turn-files-changed__head">
          <span className="app-turn-files-changed__title">{title}</span>
        </div>
        <ul className="app-turn-files-changed__list">
          {visibleFiles.map((file) => {
            const canOpen =
              Boolean(repositoryPath) &&
              relativePathInRepository(repositoryPath ?? "", file.filePath) != null;
            const recorded = hasRecordedLineCounts(file);
            const added = recorded ? file.addedLineCount : (recoveredCounts[file.filePath]?.added ?? 0);
            const removed = recorded
              ? file.removedLineCount
              : (recoveredCounts[file.filePath]?.removed ?? 0);
            return (
              <li key={file.filePath} className="app-turn-files-changed__row">
                <ExplorerTreeFileIcon
                  fileName={file.fileName}
                  className="app-turn-files-changed__icon"
                />
                {canOpen ? (
                  <button
                    type="button"
                    className="app-turn-files-changed__filename app-turn-files-changed__filename--clickable"
                    title={file.filePath}
                    onClick={(event) => handleOpenFile(event, file)}
                  >
                    {file.fileName}
                  </button>
                ) : (
                  <span className="app-turn-files-changed__filename" title={file.filePath}>
                    {file.fileName}
                  </span>
                )}
                {added > 0 || removed > 0 ? (
                  <span className="app-turn-files-changed__stats">
                    {added > 0 ? (
                      <span className="app-turn-files-changed__add">+{added}</span>
                    ) : null}
                    {removed > 0 ? (
                      <span className="app-turn-files-changed__remove">-{removed}</span>
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {hasMore ? (
          <div className="app-turn-files-changed__footer">
            <button
              type="button"
              className="app-turn-files-changed__toggle"
              onClick={toggleExpanded}
              aria-expanded={expanded}
            >
              <span>{expanded ? "收起" : `展开全部（共 ${files.length} 个文件）`}</span>
              <span className="app-turn-files-changed__chevron" aria-hidden>
                {expanded ? "▴" : "▾"}
              </span>
            </button>
            {!expanded && hiddenCount > 0 ? (
              <span className="app-turn-files-changed__hidden-count">
                另有 {hiddenCount} 个文件未展示
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },
  (prev, next) => filesFingerprint(prev.files) === filesFingerprint(next.files),
);
