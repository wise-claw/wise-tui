import type { GitBranchEntry, GitGraphCommit } from "../../types";

export interface GitGraphBranchOption {
  label: string;
  value: string;
}

export function buildGitGraphBranchOptions(branches: GitBranchEntry[]): GitGraphBranchOption[] {
  const localBranches = branches
    .filter((branch) => !branch.isRemote)
    .sort((left, right) => left.name.localeCompare(right.name));
  const remoteBranches = branches
    .filter((branch) => branch.isRemote)
    .sort((left, right) => left.name.localeCompare(right.name));

  return [
    { label: "全部分支", value: "" },
    ...localBranches.map((branch) => ({
      label: branch.isCurrent ? `${branch.name} (当前)` : branch.name,
      value: branch.name,
    })),
    ...remoteBranches.map((branch) => ({
      label: branch.name,
      value: branch.name,
    })),
  ];
}

export function filterGitGraphCommits(
  commits: GitGraphCommit[],
  opts: { query?: string; author?: string | null },
): GitGraphCommit[] {
  const query = opts.query?.trim().toLowerCase() ?? "";
  const author = opts.author?.trim() ?? "";

  return commits.filter((commit) => {
    if (author && commit.author !== author) {
      return false;
    }
    if (!query) {
      return true;
    }
    return (
      commit.summary.toLowerCase().includes(query) ||
      commit.author.toLowerCase().includes(query) ||
      commit.sha.toLowerCase().includes(query) ||
      commit.sha.slice(0, 7).toLowerCase().includes(query) ||
      commit.refs.some((ref) => ref.name.toLowerCase().includes(query))
    );
  });
}

export function collectGitGraphAuthors(commits: GitGraphCommit[]): string[] {
  const authors = new Set<string>();
  for (const commit of commits) {
    if (commit.author.trim()) {
      authors.add(commit.author);
    }
  }
  return Array.from(authors).sort((left, right) => left.localeCompare(right));
}
