import type { CodeReviewFinding } from "../../types/codeReview";
import { sortCodeReviewFindings } from "./parseCodeReviewResult";

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}

/**
 * Keep previous findings for files whose patch hash did not change;
 * prefer the fresh engine findings for focused files.
 */
export function mergeCarriedCodeReviewFindings(input: {
  previousFindings: ReadonlyArray<CodeReviewFinding>;
  nextFindings: ReadonlyArray<CodeReviewFinding>;
  unchangedFiles: readonly string[];
  currentFiles: readonly string[];
}): CodeReviewFinding[] {
  const unchanged = new Set(input.unchangedFiles.map(normalizePath).filter(Boolean));
  const current = new Set(input.currentFiles.map(normalizePath).filter(Boolean));
  const carried = input.previousFindings.filter((finding) => {
    const path = normalizePath(finding.path);
    return path.length > 0 && unchanged.has(path) && current.has(path);
  });
  return sortCodeReviewFindings([...input.nextFindings, ...carried]);
}
