import type { GitBlameLineEntry } from "../../types";

export interface BlameCommitGroup {
  sha: string;
  author: string;
  summary: string;
  timestamp: number;
  lines: GitBlameLineEntry[];
}

export function groupBlameLinesByCommit(lines: GitBlameLineEntry[]): BlameCommitGroup[] {
  const groups: BlameCommitGroup[] = [];
  const indexBySha = new Map<string, number>();

  for (const line of lines) {
    const existingIndex = indexBySha.get(line.sha);
    if (existingIndex === undefined) {
      indexBySha.set(line.sha, groups.length);
      groups.push({
        sha: line.sha,
        author: line.author,
        summary: line.summary,
        timestamp: line.timestamp,
        lines: [line],
      });
      continue;
    }
    groups[existingIndex]?.lines.push(line);
  }

  return groups;
}
