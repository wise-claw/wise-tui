import { memo } from "react";
import { ExplorerTreeFileIcon, ExplorerTreeFolderIcon } from "./explorerTreeChrome";
import { useRepositoryExplorerGitStatus } from "./RepositoryExplorerGitStatusContext";
import { RepoTreeGitDirDot, RepoTreeGitFileDecoration } from "./repoTreeGitDecoration";
import type { ExplorerSearchResultRow } from "./fileTree";
import type { GitPanelOpenFileOptions } from "./types";

export interface ExplorerSearchResultListProps {
  rows: ExplorerSearchResultRow[];
  pending?: boolean;
  selectedPath: string | null;
  onSelect: (path: string, isDir: boolean) => void;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

function ExplorerSearchResultRowItem({
  row,
  selected,
  onSelect,
  onOpenFile,
}: {
  row: ExplorerSearchResultRow;
  selected: boolean;
  onSelect: ExplorerSearchResultListProps["onSelect"];
  onOpenFile?: ExplorerSearchResultListProps["onOpenFile"];
}) {
  const { getFileStatus, dirHasChanges, isEditorDirty } = useRepositoryExplorerGitStatus();
  const parentLabel = row.parentPath || "";
  const gitStatus = row.isDir ? null : getFileStatus(row.path);
  const showGitDot = row.isDir ? dirHasChanges(row.path) : false;
  const editorDirty = !row.isDir && isEditorDirty(row.path);
  return (
    <div
      className={`repo-search-result-row${selected ? " repo-search-result-row--selected" : ""}${row.isDir ? " repo-search-result-row--dir" : ""}${!row.isDir && onOpenFile ? " repo-search-result-row--file--clickable" : ""}`}
      data-repo-path={row.path}
      data-repo-is-dir={row.isDir ? "1" : "0"}
      title={row.path}
      role="treeitem"
      tabIndex={-1}
      onClick={() => {
        onSelect(row.path, row.isDir);
        if (!row.isDir) {
          onOpenFile?.(row.path);
        }
      }}
    >
      {row.isDir ? (
        <ExplorerTreeFolderIcon
          name={row.name}
          expanded={false}
          className="repo-search-result-row-icon repo-search-result-row-icon--dir"
        />
      ) : (
        <ExplorerTreeFileIcon fileName={row.name} className="repo-search-result-row-icon repo-search-result-row-icon--file" />
      )}
      <span className="repo-search-result-row-text">
        {parentLabel ? <span className="repo-search-result-row-parent">{parentLabel}/</span> : null}
        <span className="repo-search-result-row-name">{row.name}</span>
      </span>
      {row.isDir ? (
        <RepoTreeGitDirDot visible={showGitDot} />
      ) : (
        <RepoTreeGitFileDecoration status={gitStatus} editorDirty={editorDirty} />
      )}
    </div>
  );
}

const MemoSearchRow = memo(ExplorerSearchResultRowItem);

export function ExplorerSearchResultList({
  rows,
  pending = false,
  selectedPath,
  onSelect,
  onOpenFile,
}: ExplorerSearchResultListProps) {
  return (
    <div
      className={`repo-search-results${pending ? " repo-search-results--pending" : ""}`}
      role="tree"
      aria-busy={pending}
    >
      {rows.map((row) => (
        <MemoSearchRow
          key={row.path}
          row={row}
          selected={selectedPath === row.path}
          onSelect={onSelect}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}
