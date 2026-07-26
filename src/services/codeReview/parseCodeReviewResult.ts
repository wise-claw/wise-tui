import type {
  CodeReviewConfidence,
  CodeReviewFinding,
  CodeReviewParsedResult,
  CodeReviewRecommendation,
  CodeReviewSeverity,
} from "../../types/codeReview";

const SEVERITIES: ReadonlySet<string> = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
const CONFIDENCES: ReadonlySet<string> = new Set(["HIGH", "MEDIUM", "LOW"]);
const RECOMMENDATIONS: ReadonlySet<string> = new Set(["APPROVE", "REQUEST_CHANGES", "COMMENT"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSeverity(raw: string): CodeReviewSeverity {
  const upper = raw.trim().toUpperCase();
  return (SEVERITIES.has(upper) ? upper : "MEDIUM") as CodeReviewSeverity;
}

function normalizeConfidence(raw: string): CodeReviewConfidence {
  const upper = raw.trim().toUpperCase();
  return (CONFIDENCES.has(upper) ? upper : "MEDIUM") as CodeReviewConfidence;
}

function normalizeRecommendation(raw: string): CodeReviewRecommendation {
  const upper = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (upper === "REQUESTCHANGES") return "REQUEST_CHANGES";
  return (RECOMMENDATIONS.has(upper) ? upper : "COMMENT") as CodeReviewRecommendation;
}

function parseLine(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function parseFinding(raw: unknown): CodeReviewFinding | null {
  if (!isRecord(raw)) return null;
  const path = asString(raw.path) || asString(raw.file) || asString(raw.location);
  const title = asString(raw.title) || asString(raw.finding) || asString(raw.issue);
  if (!path && !title) return null;
  const detail = asString(raw.detail) || asString(raw.description) || asString(raw.issue) || title;
  return {
    severity: normalizeSeverity(asString(raw.severity)),
    confidence: normalizeConfidence(asString(raw.confidence)),
    path: path.replace(/\\/g, "/"),
    line: parseLine(raw.line) ?? parseLine(raw.lineNumber),
    title: title || detail.slice(0, 80) || path,
    detail,
    fix: asString(raw.fix) || asString(raw.suggestion) || "",
  };
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim();
  }

  const startObj = trimmed.indexOf("{");
  const endObj = trimmed.lastIndexOf("}");
  if (startObj >= 0 && endObj > startObj) {
    return trimmed.slice(startObj, endObj + 1);
  }
  return null;
}

function severityRank(severity: string): number {
  switch (severity) {
    case "CRITICAL":
      return 0;
    case "HIGH":
      return 1;
    case "MEDIUM":
      return 2;
    default:
      return 3;
  }
}

export function sortCodeReviewFindings(findings: CodeReviewFinding[]): CodeReviewFinding[] {
  return [...findings].sort((a, b) => {
    const bySev = severityRank(a.severity) - severityRank(b.severity);
    if (bySev !== 0) return bySev;
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    return (a.line ?? 0) - (b.line ?? 0);
  });
}

/**
 * Parse model output into a structured review result.
 * Accepts fenced JSON or raw JSON object; falls back to empty COMMENT on failure.
 */
export function parseCodeReviewResult(text: string): CodeReviewParsedResult {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return {
      recommendation: "COMMENT",
      summary: text.trim().slice(0, 240) || "未能解析结构化审查结果",
      findings: [],
      openQuestions: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return {
      recommendation: "COMMENT",
      summary: "审查输出不是合法 JSON",
      findings: [],
      openQuestions: [],
    };
  }

  if (!isRecord(parsed)) {
    return {
      recommendation: "COMMENT",
      summary: "审查输出格式无效",
      findings: [],
      openQuestions: [],
    };
  }

  const findingsRaw = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings = sortCodeReviewFindings(
    findingsRaw.map(parseFinding).filter((item): item is CodeReviewFinding => item != null),
  );

  const openQuestions = Array.isArray(parsed.openQuestions)
    ? parsed.openQuestions.map(asString).filter(Boolean)
    : Array.isArray(parsed.open_questions)
      ? parsed.open_questions.map(asString).filter(Boolean)
      : [];

  return {
    recommendation: normalizeRecommendation(asString(parsed.recommendation)),
    summary: asString(parsed.summary) || (findings.length > 0 ? `发现 ${findings.length} 项问题` : "未发现问题"),
    findings,
    openQuestions,
  };
}
