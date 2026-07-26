export type CodeReviewScope = "uncommitted" | "branch";

export type CodeReviewSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type CodeReviewConfidence = "HIGH" | "MEDIUM" | "LOW";

export type CodeReviewRecommendation = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface CodeReviewDiffPayload {
  repositoryPath: string;
  scope: CodeReviewScope | string;
  baseRef: string | null;
  headRef: string | null;
  branch: string | null;
  filePaths: string[];
  diffText: string;
  truncated: boolean;
  empty: boolean;
  /** Optional server-side fingerprint; frontend may recompute. */
  diffFingerprint?: string | null;
}

export interface CodeReviewFinding {
  severity: CodeReviewSeverity | string;
  confidence: CodeReviewConfidence | string;
  path: string;
  line: number | null;
  title: string;
  detail: string;
  fix: string;
}

export interface CodeReviewRun {
  id: string;
  repositoryPath: string;
  scope: CodeReviewScope | string;
  baseRef: string | null;
  branch: string | null;
  createdAtMs: number;
  recommendation: CodeReviewRecommendation | string;
  summary: string;
  findings: CodeReviewFinding[];
  openQuestions: string[];
  /** Same patch fingerprint → reuse prior review without re-invoking the engine. */
  diffFingerprint?: string | null;
  /** Files included in the reviewed diff (for incremental file-set delta). */
  filePaths?: string[];
  /** Per-file patch hashes used to focus true incremental re-reviews. */
  fileFingerprints?: Record<string, string>;
}

export interface CodeReviewParsedResult {
  recommendation: CodeReviewRecommendation;
  summary: string;
  findings: CodeReviewFinding[];
  openQuestions: string[];
}
