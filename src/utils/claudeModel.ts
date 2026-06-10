import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import { resolveEffectiveModelForProfileEngine } from "../types/claudeModelProfile";

/** 将 `ANTHROPIC_MODEL` / CLI 模型 id 格式化为简短展示名（与标签页一致）。 */
export function formatClaudeModelLabel(modelId: string): string {
  const v = modelId.trim();
  if (!v) return "默认";
  const head = v.replace(/^claude-/i, "").split("-")[0] ?? "";
  if (!head) return v;
  return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
}

/** 从模型切换 Claude 页读取当前默认档案模型（effective → active profile modelId）。 */
export function resolveClaudeProfileModelFromStore(
  store: ClaudeModelProfileStoreView | null | undefined,
): string | undefined {
  const fromEffective = resolveEffectiveModelForProfileEngine("claude", store)?.trim();
  if (fromEffective) return fromEffective;
  const activeId = store?.activeProfileId?.trim();
  if (!activeId || !store) return undefined;
  const profile = store.profiles.find((item) => item.id === activeId);
  return profile?.modelId?.trim() || undefined;
}

export interface ResolveClaudeExecModelInput {
  /** 执行标签上的 session.model（可能滞后于全局档案切换）。 */
  sessionModel?: string | null;
  store?: ClaudeModelProfileStoreView | null;
}

/**
 * Claude 执行模型：优先「模型切换 → Claude」当前生效档案，再回退 session.model。
 */
export function resolveClaudeExecModelId(input: ResolveClaudeExecModelInput): string | undefined {
  const profileModel = resolveClaudeProfileModelFromStore(input.store);
  if (profileModel) return profileModel;
  const session = input.sessionModel?.trim();
  if (session) return session;
  return undefined;
}
