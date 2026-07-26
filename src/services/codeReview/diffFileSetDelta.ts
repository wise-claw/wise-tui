export type CodeReviewFileSetDelta = {
  added: string[];
  removed: string[];
  retained: string[];
  /** Previous same-scope run existed and current fingerprint differs. */
  patchChanged: boolean;
  /** Files whose per-file patch hash changed (or newly added). */
  focusFiles?: string[];
  /** Files still present with identical per-file patch hash. */
  unchangedFiles?: string[];
  /** Prompt DIFF was filtered to focusFiles only. */
  filteredToFocus?: boolean;
  /** Findings carried forward from unchanged files. */
  carriedFindingCount?: number;
};

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}

/** Compare previous vs current review file sets (path-normalized). */
export function diffCodeReviewFileSets(
  previousPaths: readonly string[],
  currentPaths: readonly string[],
  options?: { patchChanged?: boolean },
): CodeReviewFileSetDelta {
  const prev = new Set(
    previousPaths.map(normalizePath).filter((path) => path.length > 0),
  );
  const curr = new Set(
    currentPaths.map(normalizePath).filter((path) => path.length > 0),
  );
  const added = [...curr].filter((path) => !prev.has(path)).sort();
  const removed = [...prev].filter((path) => !curr.has(path)).sort();
  const retained = [...curr].filter((path) => prev.has(path)).sort();
  return {
    added,
    removed,
    retained,
    patchChanged: Boolean(options?.patchChanged),
  };
}

export function describeCodeReviewIncremental(delta: CodeReviewFileSetDelta): string {
  const parts: string[] = [];
  if (delta.focusFiles && delta.focusFiles.length > 0 && delta.filteredToFocus) {
    parts.push(`仅重审 ${delta.focusFiles.length} 个变更文件`);
  }
  if (delta.added.length > 0) {
    parts.push(`新增 ${delta.added.length} 个文件`);
  }
  if (delta.removed.length > 0) {
    parts.push(`离开变更集 ${delta.removed.length} 个`);
  }
  if ((delta.carriedFindingCount ?? 0) > 0) {
    parts.push(`沿用 ${delta.carriedFindingCount} 项未变文件发现`);
  }
  if (parts.length === 0 && delta.patchChanged) {
    parts.push("文件集相同，patch 内容已变");
  }
  return parts.join(" · ");
}

/** Fallback path list when a historical run predates `filePaths`. */
export function inferCodeReviewRunFilePaths(run: {
  filePaths?: readonly string[] | null;
  findings: ReadonlyArray<{ path: string }>;
}): string[] {
  if (run.filePaths && run.filePaths.length > 0) {
    return [...new Set(run.filePaths.map(normalizePath).filter(Boolean))].sort();
  }
  return [...new Set(run.findings.map((finding) => normalizePath(finding.path)).filter(Boolean))].sort();
}
