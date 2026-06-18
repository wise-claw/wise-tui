import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import { resolveEffectiveModelForProfileEngine } from "../types/claudeModelProfile";

export function resolveOpencodeProfileModelFromStore(
  store: ClaudeModelProfileStoreView | null | undefined,
): string | undefined {
  const fromEffective = resolveEffectiveModelForProfileEngine("opencode", store)?.trim();
  if (fromEffective) return fromEffective;
  const activeId = store?.activeOpencodeProfileId?.trim();
  if (!activeId || !store) return undefined;
  const profile = store.profiles.find((item) => item.id === activeId);
  return profile?.modelId?.trim() || undefined;
}

export interface ResolveOpencodeExecModelInput {
  sessionModel?: string | null;
  contextExecutionEngine: SessionExecutionEngine;
  store?: ClaudeModelProfileStoreView | null;
}

export function resolveOpencodeExecModelId(
  input: ResolveOpencodeExecModelInput,
): string | undefined {
  const opencodeProfileModel = resolveOpencodeProfileModelFromStore(input.store);
  if (opencodeProfileModel) return opencodeProfileModel;

  if (input.contextExecutionEngine === "opencode") {
    const session = input.sessionModel?.trim();
    if (session) return session;
  }

  return undefined;
}
