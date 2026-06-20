import { getStatusSymbol } from "./gitPanelUtils";

interface RepoTreeGitFileDecorationProps {
  status: string | null;
  /** 编辑器中有未保存修改（相对 originalContent）。 */
  editorDirty?: boolean;
}

export function RepoTreeGitFileDecoration({ status, editorDirty = false }: RepoTreeGitFileDecorationProps) {
  if (status) {
    const symbol = getStatusSymbol(status);
    return (
      <span
        className={`repo-tree-git-letter repo-tree-git-letter--${status}${editorDirty ? " repo-tree-git-letter--editor-dirty" : ""}`}
        aria-label={`Git ${symbol}${editorDirty ? "，未保存" : ""}`}
        title={`Git ${symbol}${editorDirty ? " · 未保存" : ""}`}
      >
        {symbol}
      </span>
    );
  }
  if (editorDirty) {
    return (
      <span
        className="repo-tree-git-letter repo-tree-git-letter--dirty"
        aria-label="未保存"
        title="未保存"
      >
        M
      </span>
    );
  }
  return null;
}

interface RepoTreeGitDirDotProps {
  visible: boolean;
}

export function RepoTreeGitDirDot({ visible }: RepoTreeGitDirDotProps) {
  if (!visible) {
    return null;
  }
  return <span className="repo-tree-git-dot" aria-hidden />;
}

interface RepoTreeGitDirDecorationProps {
  status: string | null;
}

/** 目录右侧着色圆点——颜色跟随目录聚合状态。 */
export function RepoTreeGitDirDecoration({ status }: RepoTreeGitDirDecorationProps) {
  if (!status) {
    return null;
  }
  return (
    <span
      className={`repo-tree-git-dot repo-tree-git-dot--status-${status.toLowerCase()}`}
      aria-label={`Git ${getStatusSymbol(status)}`}
      title={`Git ${getStatusSymbol(status)}`}
    />
  );
}
