import type { ClaudeMessage, ClaudeSession } from "../../../types";
import type { DispatchClusterRawOutput } from "../../../services/prdSplit/splitterDispatch";
import type { TaskDetailVM } from "../presenter/types";

export interface DispatchSessionMatch {
  session: ClaudeSession;
  reason: "claude-session-id" | "prompt";
}

interface WeightedNeedle {
  text: string;
  weight: number;
}

const MIN_PROMPT_MATCH_SCORE = 1000;

/**
 * Resolve the Claude Code transcript that produced a Mission Control task.
 * Newer runs persist `claudeSessionId`; run-directory matching keeps older
 * in-memory runs reviewable when the backend did not capture the session id.
 */
export function resolveDispatchClaudeSession(input: {
  sessions: readonly ClaudeSession[];
  detail: TaskDetailVM | null;
  repoPath?: string;
}): DispatchSessionMatch | null {
  const { sessions, detail, repoPath } = input;
  if (!detail) return null;

  const raw = detail.technical.dispatchRaw;
  const byClaudeId = resolveByClaudeSessionId(sessions, raw);
  if (byClaudeId) {
    return { session: byClaudeId, reason: "claude-session-id" };
  }
  if (raw?.claudeSessionId?.trim()) {
    return null;
  }

  const byPrompt = resolveByPromptFingerprint(sessions, detail, raw, repoPath);
  if (byPrompt) {
    return { session: byPrompt, reason: "prompt" };
  }

  return null;
}

function resolveByClaudeSessionId(
  sessions: readonly ClaudeSession[],
  raw: DispatchClusterRawOutput | null,
): ClaudeSession | null {
  const sid = raw?.claudeSessionId?.trim();
  if (!sid) return null;
  return sessions.find((session) => session.id === sid || session.claudeSessionId?.trim() === sid) ?? null;
}

function resolveByPromptFingerprint(
  sessions: readonly ClaudeSession[],
  detail: TaskDetailVM,
  raw: DispatchClusterRawOutput | null,
  repoPath: string | undefined,
): ClaudeSession | null {
  const needles = buildWeightedDispatchSessionNeedles({ detail, raw, repoPath });
  if (needles.length === 0) return null;
  const requiredRunIdentities = findRunIdentityNeedles(needles.map((needle) => needle.text));
  if (requiredRunIdentities.length === 0) return null;

  const candidates = sessions
    .map((session) => {
      const promptText = sessionToSearchText(session);
      if (!promptText) return null;
      if (!containsAnyNormalized(promptText, requiredRunIdentities)) return null;
      const score = scoreDispatchTextMatch(promptText, needles);
      if (score < MIN_PROMPT_MATCH_SCORE) return null;
      const repositoryBonus = repositoryPathMatches(session.repositoryPath, repoPath) ? 50 : 0;
      const messagesBonus = session.messages.length > 0 ? 25 : 0;
      return { session, score: score + repositoryBonus + messagesBonus };
    })
    .filter((item): item is { session: ClaudeSession; score: number } => Boolean(item));

  if (candidates.length === 0) return null;
  return candidates
    .slice()
    .sort((a, b) => b.score - a.score || sessionUpdatedAt(b.session) - sessionUpdatedAt(a.session))[0]
    ?.session ?? null;
}

export function buildDispatchSessionNeedles(input: {
  detail: TaskDetailVM | null;
  raw: DispatchClusterRawOutput | null | undefined;
  repoPath?: string;
}): string[] {
  return uniqueNeedles(buildWeightedDispatchSessionNeedles(input).map((needle) => needle.text));
}

export function messagesToSearchText(messages: ClaudeMessage[]): string {
  return messages.map(messageToSearchText).filter(Boolean).join("\n\n");
}

export function textMatchesDispatchNeedles(text: string, needles: readonly string[]): boolean {
  const requiredRunIdentities = findRunIdentityNeedles(needles);
  if (requiredRunIdentities.length === 0 || !containsAnyNormalized(text, requiredRunIdentities)) return false;
  const weighted = needles.map((needle) => ({ text: needle, weight: 1 }));
  return scoreDispatchTextMatch(text, weighted) > 0;
}

function buildWeightedDispatchSessionNeedles(input: {
  detail: TaskDetailVM | null;
  raw: DispatchClusterRawOutput | null | undefined;
  repoPath?: string;
}): WeightedNeedle[] {
  const detail = input.detail;
  const raw = input.raw;
  const parentTaskName = detail?.technical.parentTaskLabel?.trim() ?? "";
  const repoPath = input.repoPath?.trim() ?? "";
  const parentTaskPath = parentTaskName && repoPath
    ? `${repoPath.replace(/\/+$/, "")}/.trellis/tasks/${parentTaskName}`
    : "";
  const parentTaskRelativePath = parentTaskName ? `.trellis/tasks/${parentTaskName}` : "";
  const clusterId = detail?.clusterId?.trim() ?? "";
  const clusterTitle = detail?.technical.clusterTitle?.trim() ?? detail?.title?.trim() ?? "";

  return [
    weighted(raw?.runDir, 5000),
    weighted(raw?.runId, 5000),
    weighted(parentTaskPath, 3500),
    weighted(parentTaskRelativePath, 2500),
    weighted(parentTaskName, 2000),
    weighted(clusterId ? `- id: \`${clusterId}\`` : "", 1800),
    weighted(clusterId ? `Cluster: ${clusterId}` : "", 1600),
    weighted(clusterId, 1000),
    weighted(clusterTitle, 700),
  ].filter((needle): needle is WeightedNeedle => Boolean(needle));
}

function weighted(value: string | null | undefined, weight: number): WeightedNeedle | null {
  const text = value?.trim();
  if (!text || text.length < 4) return null;
  return { text, weight };
}

function scoreDispatchTextMatch(text: string, needles: readonly WeightedNeedle[]): number {
  const haystack = normalizeSearchText(text);
  let score = 0;
  for (const needle of needles) {
    if (haystack.includes(normalizeSearchText(needle.text))) {
      score += needle.weight;
    }
  }
  return score;
}

function sessionToSearchText(session: ClaudeSession): string {
  return [session.diskPreview ?? "", messagesToSearchText(session.messages)].filter(Boolean).join("\n\n");
}

function messageToSearchText(message: ClaudeMessage): string {
  const partsText = message.parts
    .map((part) => {
      if (part.type === "text" || part.type === "reasoning") return part.text;
      return [
        part.name,
        JSON.stringify(part.input),
        part.output ?? "",
        part.error ?? "",
      ].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n");
  return [message.content, partsText].filter(Boolean).join("\n");
}

function repositoryPathMatches(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return Boolean(a && b && a === b);
}

function normalizePath(value: string | null | undefined): string {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function containsNormalized(text: string, needle: string): boolean {
  return normalizeSearchText(text).includes(normalizeSearchText(needle));
}

function containsAnyNormalized(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => containsNormalized(text, needle));
}

function findRunIdentityNeedles(needles: readonly string[]): string[] {
  return needles.filter((needle) => {
    const normalized = normalizeSearchText(needle);
    return normalized.includes("/prd-runs/") || normalized.includes("\\prd-runs\\") || normalized.startsWith("split-");
  });
}

function uniqueNeedles(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = normalizeSearchText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function sessionUpdatedAt(session: ClaudeSession): number {
  return session.messages[session.messages.length - 1]?.timestamp ?? session.createdAt;
}
