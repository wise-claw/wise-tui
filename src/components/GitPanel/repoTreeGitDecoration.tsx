import { getStatusSymbol } from "./gitPanelUtils";

interface RepoTreeGitFileDecorationProps {
  status: string | null;
}

export function RepoTreeGitFileDecoration({ status }: RepoTreeGitFileDecorationProps) {
  if (!status) {
    return null;
  }
  const symbol = getStatusSymbol(status);
  return (
    <span
      className={`repo-tree-git-letter repo-tree-git-letter--${status}`}
      aria-label={`Git ${symbol}`}
      title={`Git ${symbol}`}
    >
      {symbol}
    </span>
  );
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
