import type { FeedbackConfigPatch } from "./sessionFeedbackConfigPatch";
import { feedbackConfigArtifactKindLabel } from "./sessionFeedbackConfigPatch";

export const MAX_FEEDBACK_GLOBAL_RULES = 16;

/** 跨会话效果门槛：达到此综合分且已应用的补丁建议提升为全局。 */
export const GLOBAL_RULE_PROMOTION_MIN_SESSION_SCORE = 65;

export interface FeedbackGlobalRuleV1 {
  id: string;
  title: string;
  body: string;
  kind?: FeedbackConfigPatch["kind"];
  sourcePatchId?: string;
  sourceRepositoryPath?: string;
  promotedAt: number;
  enabled: boolean;
}

const PROMOTABLE_KINDS = new Set<FeedbackConfigPatch["kind"]>([
  "claude_md",
  "agents_md",
  "rule",
  "memory",
  "skill",
]);

export function isPatchPromotableToGlobalRule(patch: FeedbackConfigPatch): boolean {
  if (patch.status !== "applied") return false;
  if (patch.action === "enable" || patch.action === "disable" || patch.action === "merge_json") {
    return false;
  }
  if (!PROMOTABLE_KINDS.has(patch.kind)) return false;
  return patch.content.trim().length > 0 || patch.rationale.trim().length > 0;
}

export function isPatchSuggestedForGlobalPromotion(
  patch: FeedbackConfigPatch,
  sessionFinalScore?: number | null,
): boolean {
  if (!isPatchPromotableToGlobalRule(patch)) return false;
  if (sessionFinalScore != null && sessionFinalScore >= GLOBAL_RULE_PROMOTION_MIN_SESSION_SCORE) {
    return true;
  }
  return patch.source === "ai";
}

export function buildGlobalRuleFromPatch(
  patch: FeedbackConfigPatch,
  input?: { repositoryPath?: string | null },
): FeedbackGlobalRuleV1 {
  const body = patch.content.trim() || patch.rationale.trim();
  const sectionPart = patch.section?.trim() ? ` · ${patch.section.trim()}` : "";
  const title = `${feedbackConfigArtifactKindLabel(patch.kind)} · ${patch.path}${sectionPart}`;
  return {
    id: `gr-${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: title.slice(0, 120),
    body,
    kind: patch.kind,
    sourcePatchId: patch.id,
    sourceRepositoryPath: input?.repositoryPath?.trim() || undefined,
    promotedAt: Date.now(),
    enabled: true,
  };
}

export function buildFeedbackGlobalRulesSystemPromptBlock(
  rules: readonly FeedbackGlobalRuleV1[],
): string | undefined {
  const enabled = rules.filter((rule) => rule.enabled && rule.body.trim());
  if (enabled.length === 0) return undefined;

  const lines: string[] = [
    "## Wise 全局配置规则（反馈神经网沉淀）",
    "",
  ];
  for (let i = 0; i < enabled.length; i += 1) {
    const rule = enabled[i]!;
    lines.push(`### ${i + 1}. ${rule.title.trim()}`, "", rule.body.trim(), "");
  }
  lines.push("以上规则来自跨会话验证的有效配置补丁；若与当前任务冲突，以任务目标为准。");
  return lines.join("\n");
}

export function normalizeFeedbackGlobalRule(raw: unknown): FeedbackGlobalRuleV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const body = typeof row.body === "string" ? row.body.trim() : "";
  if (!id || !title || !body) return null;

  const kindRaw = row.kind;
  const kind =
    kindRaw === "claude_md" ||
    kindRaw === "agents_md" ||
    kindRaw === "rule" ||
    kindRaw === "memory" ||
    kindRaw === "mcp" ||
    kindRaw === "skill" ||
    kindRaw === "settings"
      ? kindRaw
      : undefined;

  return {
    id,
    title: title.slice(0, 160),
    body: body.slice(0, 8000),
    kind,
    sourcePatchId:
      typeof row.sourcePatchId === "string" ? row.sourcePatchId.trim() || undefined : undefined,
    sourceRepositoryPath:
      typeof row.sourceRepositoryPath === "string"
        ? row.sourceRepositoryPath.trim() || undefined
        : undefined,
    promotedAt:
      typeof row.promotedAt === "number" && Number.isFinite(row.promotedAt)
        ? row.promotedAt
        : Date.now(),
    enabled: row.enabled !== false,
  };
}

export function normalizeFeedbackGlobalRules(raw: unknown): FeedbackGlobalRuleV1[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: FeedbackGlobalRuleV1[] = [];
  for (const item of raw) {
    const rule = normalizeFeedbackGlobalRule(item);
    if (!rule || seen.has(rule.id)) continue;
    seen.add(rule.id);
    out.push(rule);
    if (out.length >= MAX_FEEDBACK_GLOBAL_RULES) break;
  }
  return out;
}

export function upsertGlobalRule(
  rules: readonly FeedbackGlobalRuleV1[],
  incoming: FeedbackGlobalRuleV1,
): FeedbackGlobalRuleV1[] {
  const withoutDup = rules.filter(
    (rule) =>
      rule.id !== incoming.id &&
      !(incoming.sourcePatchId && rule.sourcePatchId === incoming.sourcePatchId),
  );
  return [incoming, ...withoutDup].slice(0, MAX_FEEDBACK_GLOBAL_RULES);
}
