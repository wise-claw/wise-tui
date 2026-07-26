import { openCodeReviewDrawer } from "../../constants/workflowUiEvents";
import type { CodeReviewRun } from "../../types/codeReview";
import { countCodeReviewFindingSeverities } from "../../stores/codeReviewFindingsStore";
import { getCodeReviewFindingsSnapshot } from "../../stores/codeReviewFindingsStore";
import { wiseNotificationIngestWithPet } from "../wiseMascot";

export const CODE_REVIEW_NOTIFICATION_CONVERSATION_PREFIX = "wise:code-review:";

export type CodeReviewNotificationPayload = {
  type: "code-review";
  runId: string;
  repositoryPath: string;
  recommendation: string;
  summary: string;
  findingCount: number;
  highOrCritical: number;
  scope: string;
  branch: string | null;
};

export function buildCodeReviewNotificationConversationId(repositoryPath: string): string {
  const path = repositoryPath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return `${CODE_REVIEW_NOTIFICATION_CONVERSATION_PREFIX}${encodeURIComponent(path)}`;
}

export function isCodeReviewNotificationConversationId(conversationId: string): boolean {
  return conversationId.trim().startsWith(CODE_REVIEW_NOTIFICATION_CONVERSATION_PREFIX);
}

export function parseCodeReviewNotificationRepositoryPath(
  conversationId: string,
): string | null {
  const raw = conversationId.trim();
  if (!isCodeReviewNotificationConversationId(raw)) return null;
  const encoded = raw.slice(CODE_REVIEW_NOTIFICATION_CONVERSATION_PREFIX.length);
  if (!encoded) return null;
  try {
    const path = decodeURIComponent(encoded).trim();
    return path || null;
  } catch {
    return null;
  }
}

export function buildCodeReviewNotificationPayload(run: CodeReviewRun): CodeReviewNotificationPayload {
  const counts = countCodeReviewFindingSeverities(run.findings);
  return {
    type: "code-review",
    runId: run.id,
    repositoryPath: run.repositoryPath.trim(),
    recommendation: String(run.recommendation),
    summary: run.summary.trim(),
    findingCount: counts.total,
    highOrCritical: counts.highOrCritical,
    scope: String(run.scope),
    branch: run.branch,
  };
}

export function buildCodeReviewNotificationBody(run: CodeReviewRun): string {
  const payload = buildCodeReviewNotificationPayload(run);
  const scopeLabel = payload.scope === "branch" ? "相对主干" : "未提交";
  const headline =
    payload.highOrCritical > 0
      ? `代码审查：${payload.highOrCritical} 项高危 / 共 ${payload.findingCount} 项`
      : payload.findingCount > 0
        ? `代码审查：${payload.findingCount} 项发现`
        : "代码审查：未发现问题";
  const lines = [
    `【代码审查】${headline}`,
    `结论 ${payload.recommendation} · ${scopeLabel}${payload.branch ? ` · ${payload.branch}` : ""}`,
    payload.summary ? `摘要：${payload.summary}` : "",
    `WISE_CR_JSON:${JSON.stringify(payload)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function parseCodeReviewNotificationPayload(
  body: string,
): CodeReviewNotificationPayload | null {
  const marker = "WISE_CR_JSON:";
  const idx = body.indexOf(marker);
  if (idx < 0) return null;
  const raw = body.slice(idx + marker.length).trim();
  try {
    const parsed = JSON.parse(raw) as Partial<CodeReviewNotificationPayload>;
    if (parsed.type !== "code-review" || typeof parsed.repositoryPath !== "string") {
      return null;
    }
    return {
      type: "code-review",
      runId: typeof parsed.runId === "string" ? parsed.runId : "",
      repositoryPath: parsed.repositoryPath.trim(),
      recommendation: typeof parsed.recommendation === "string" ? parsed.recommendation : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      findingCount: typeof parsed.findingCount === "number" ? parsed.findingCount : 0,
      highOrCritical: typeof parsed.highOrCritical === "number" ? parsed.highOrCritical : 0,
      scope: typeof parsed.scope === "string" ? parsed.scope : "uncommitted",
      branch: typeof parsed.branch === "string" ? parsed.branch : null,
    };
  } catch {
    return null;
  }
}

/** Whether a completed run should land in the Wise notification inbox. */
export function shouldIngestCodeReviewNotification(
  run: CodeReviewRun,
  options?: { reused?: boolean },
): boolean {
  if (options?.reused) return false;
  if (run.findings.length > 0) return true;
  return String(run.recommendation) === "REQUEST_CHANGES";
}

export async function ingestCodeReviewNotification(
  run: CodeReviewRun,
  options?: { reused?: boolean },
): Promise<boolean> {
  if (!shouldIngestCodeReviewNotification(run, options)) return false;
  const repositoryPath = run.repositoryPath.trim();
  if (!repositoryPath) return false;
  try {
    await wiseNotificationIngestWithPet({
      conversationId: buildCodeReviewNotificationConversationId(repositoryPath),
      body: buildCodeReviewNotificationBody(run),
      serverMsgId: `code-review:${run.id}`,
      source: "code-review",
      title: repositoryPath.split(/[\\/]/).filter(Boolean).pop() || repositoryPath,
    });
    return true;
  } catch {
    return false;
  }
}

/** Open drawer for a code-review notification row (uses published findings when available). */
export function openCodeReviewFromNotification(input: {
  conversationId: string;
  body: string;
}): boolean {
  const fromConversation = parseCodeReviewNotificationRepositoryPath(input.conversationId);
  const payload = parseCodeReviewNotificationPayload(input.body);
  const repositoryPath = (payload?.repositoryPath || fromConversation || "").trim();
  if (!repositoryPath) return false;

  const snap = getCodeReviewFindingsSnapshot(repositoryPath);
  const seededRun =
    snap?.run && (!payload?.runId || snap.run.id === payload.runId) ? snap.run : null;

  openCodeReviewDrawer({
    repositoryPath,
    autoStart: false,
    initialScope: payload?.scope === "branch" ? "branch" : "uncommitted",
    seededRun,
  });
  return true;
}
