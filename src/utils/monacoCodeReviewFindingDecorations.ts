import type { CodeReviewFinding } from "../types/codeReview";

export function monacoCodeReviewSeverityClassName(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return "wise-code-review-line wise-code-review-line--critical";
    case "HIGH":
      return "wise-code-review-line wise-code-review-line--high";
    case "MEDIUM":
      return "wise-code-review-line wise-code-review-line--medium";
    default:
      return "wise-code-review-line wise-code-review-line--low";
  }
}

export function monacoCodeReviewOverviewColor(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return "#c41d7f";
    case "HIGH":
      return "#ff4d4f";
    case "MEDIUM":
      return "#fa8c16";
    default:
      return "#8c8c8c";
  }
}

export function monacoCodeReviewGlyphClassName(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return "wise-code-review-glyph wise-code-review-glyph--critical";
    case "HIGH":
      return "wise-code-review-glyph wise-code-review-glyph--high";
    case "MEDIUM":
      return "wise-code-review-glyph wise-code-review-glyph--medium";
    default:
      return "wise-code-review-glyph wise-code-review-glyph--low";
  }
}

export function buildCodeReviewHoverMessage(finding: CodeReviewFinding): string {
  const parts = [
    `[${finding.severity}] ${finding.title}`,
    finding.detail && finding.detail !== finding.title ? finding.detail : "",
    finding.fix ? `修复建议：${finding.fix}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

export function codeReviewFindingListKey(
  finding: Pick<CodeReviewFinding, "path" | "line" | "title">,
  index: number,
): string {
  return `${finding.path}:${finding.line ?? "na"}:${finding.title}:${index}`;
}

export function findingMatchesCodeReviewFocus(
  finding: Pick<CodeReviewFinding, "path" | "line">,
  focus: { path: string; line?: number | null } | null | undefined,
): boolean {
  if (!focus?.path?.trim()) return false;
  const focusPath = focus.path.trim().replace(/\\/g, "/");
  const findingPath = finding.path.trim().replace(/\\/g, "/");
  if (findingPath !== focusPath) return false;
  if (focus.line == null) return true;
  return finding.line != null && Math.floor(finding.line) === Math.floor(focus.line);
}

/** Group findings by positive line number; line-less findings are omitted from gutter. */
export function groupCodeReviewFindingsByLine(
  findings: ReadonlyArray<CodeReviewFinding>,
): Map<number, CodeReviewFinding[]> {
  const map = new Map<number, CodeReviewFinding[]>();
  for (const finding of findings) {
    const line = finding.line;
    if (line == null || !Number.isFinite(line) || line < 1) continue;
    const key = Math.floor(line);
    const list = map.get(key);
    if (list) list.push(finding);
    else map.set(key, [finding]);
  }
  return map;
}
