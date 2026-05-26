import type { ReactNode } from "react";
import type { GitFileStatus } from "../../types";
import { GitVirtualFileList } from "./GitVirtualFileList";
import { shouldUseGitVirtualFileList } from "./gitPanelUtils";

interface GitFileListSectionProps {
  files: GitFileStatus[];
  renderRow: (file: GitFileStatus) => ReactNode;
}

export function GitFileListSection({ files, renderRow }: GitFileListSectionProps) {
  if (shouldUseGitVirtualFileList(files.length)) {
    return <GitVirtualFileList files={files} renderRow={renderRow} />;
  }
  return (
    <div className="git-file-list">
      {files.map((file) => (
        <div key={file.path}>{renderRow(file)}</div>
      ))}
    </div>
  );
}
