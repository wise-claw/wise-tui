import type { FeedbackConfigPatch } from "../utils/sessionFeedbackConfigPatch";
import {
  buildGlobalRuleFromPatch,
  isPatchPromotableToGlobalRule,
  type FeedbackGlobalRuleV1,
  upsertGlobalRule,
} from "../utils/sessionFeedbackGlobalRules";
import {
  loadSessionFeedbackLoopSettingsFromStore,
  saveSessionFeedbackLoopSettingsToStore,
} from "./wiseDefaultConfigStore";

export async function loadFeedbackGlobalRules(): Promise<FeedbackGlobalRuleV1[]> {
  return (await loadSessionFeedbackLoopSettingsFromStore()).globalRules;
}

export async function saveFeedbackGlobalRules(rules: FeedbackGlobalRuleV1[]): Promise<void> {
  await saveSessionFeedbackLoopSettingsToStore({ globalRules: rules });
}

export async function promotePatchToGlobalRule(input: {
  patch: FeedbackConfigPatch;
  repositoryPath?: string | null;
}): Promise<{ ok: true; rule: FeedbackGlobalRuleV1 } | { ok: false; reason: string }> {
  if (!isPatchPromotableToGlobalRule(input.patch)) {
    return { ok: false, reason: "仅已应用且含文本内容的 CLAUDE.md / rules / memory / skill 补丁可提升" };
  }

  const settings = await loadSessionFeedbackLoopSettingsFromStore();
  const rule = buildGlobalRuleFromPatch(input.patch, { repositoryPath: input.repositoryPath });
  const next = upsertGlobalRule(settings.globalRules, rule);
  await saveSessionFeedbackLoopSettingsToStore({ globalRules: next });
  return { ok: true, rule };
}

export async function removeFeedbackGlobalRule(ruleId: string): Promise<void> {
  const id = ruleId.trim();
  if (!id) return;
  const settings = await loadSessionFeedbackLoopSettingsFromStore();
  const next = settings.globalRules.filter((rule) => rule.id !== id);
  if (next.length === settings.globalRules.length) return;
  await saveSessionFeedbackLoopSettingsToStore({ globalRules: next });
}

export async function setFeedbackGlobalRuleEnabled(
  ruleId: string,
  enabled: boolean,
): Promise<void> {
  const id = ruleId.trim();
  if (!id) return;
  const settings = await loadSessionFeedbackLoopSettingsFromStore();
  const next = settings.globalRules.map((rule) =>
    rule.id === id ? { ...rule, enabled } : rule,
  );
  await saveSessionFeedbackLoopSettingsToStore({ globalRules: next });
}

export function isPatchAlreadyPromotedToGlobal(
  patchId: string,
  rules: readonly FeedbackGlobalRuleV1[],
): boolean {
  const id = patchId.trim();
  if (!id) return false;
  return rules.some((rule) => rule.sourcePatchId === id);
}
