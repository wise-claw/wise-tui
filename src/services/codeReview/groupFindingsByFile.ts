import type { CodeReviewFinding } from "../../types/codeReview";
import { codeReviewFindingListKey } from "../../utils/monacoCodeReviewFindingDecorations";

export type CodeReviewSeverityFilter =
  | "ALL"
  | "HIGH_PLUS"
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW";

export type CodeReviewFindingEntry = {
  finding: CodeReviewFinding;
  index: number;
  key: string;
};

export type CodeReviewFindingFileGroup = {
  path: string;
  entries: CodeReviewFindingEntry[];
  highOrCritical: number;
};

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/") || "(unknown)";
}

export function buildCodeReviewFindingEntries(
  findings: ReadonlyArray<CodeReviewFinding>,
): CodeReviewFindingEntry[] {
  return findings.map((finding, index) => ({
    finding,
    index,
    key: codeReviewFindingListKey(finding, index),
  }));
}

export function matchesCodeReviewSeverityFilter(
  severity: string,
  filter: CodeReviewSeverityFilter,
): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "HIGH_PLUS":
      return severity === "CRITICAL" || severity === "HIGH";
    case "CRITICAL":
    case "HIGH":
    case "MEDIUM":
    case "LOW":
      return severity === filter;
    default:
      return true;
  }
}

export function filterCodeReviewFindingEntries(
  entries: ReadonlyArray<CodeReviewFindingEntry>,
  filter: CodeReviewSeverityFilter,
): CodeReviewFindingEntry[] {
  if (filter === "ALL") return [...entries];
  return entries.filter((entry) =>
    matchesCodeReviewSeverityFilter(String(entry.finding.severity), filter),
  );
}

/** Group findings by file path; preserves first-seen file order. */
export function groupCodeReviewFindingsByFile(
  entries: ReadonlyArray<CodeReviewFindingEntry>,
): CodeReviewFindingFileGroup[] {
  const byPath = new Map<string, CodeReviewFindingEntry[]>();
  const order: string[] = [];

  for (const entry of entries) {
    const path = normalizePath(entry.finding.path);
    let list = byPath.get(path);
    if (!list) {
      list = [];
      byPath.set(path, list);
      order.push(path);
    }
    list.push(entry);
  }

  return order.map((path) => {
    const groupEntries = byPath.get(path) ?? [];
    return {
      path,
      entries: groupEntries,
      highOrCritical: groupEntries.filter((entry) => {
        const severity = String(entry.finding.severity);
        return severity === "CRITICAL" || severity === "HIGH";
      }).length,
    };
  });
}

export function findCodeReviewEntryIndex(
  entries: ReadonlyArray<CodeReviewFindingEntry>,
  key: string | null | undefined,
): number {
  if (!key) return -1;
  return entries.findIndex((entry) => entry.key === key);
}
