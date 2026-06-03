import type {
  ClaudeModelProfile,
  ClaudeModelProfileStoreView,
  ModelProfileEngine,
} from "../types/claudeModelProfile";
import {
  normalizeModelProfileEngine,
  resolveActiveModelProfileId,
  resolveEffectiveModelForProfileEngine,
} from "../types/claudeModelProfile";
import { formatClaudeModelLabel } from "./claudeModel";

/** 模型档案列表/顶栏展示名：优先用户配置的 `name`，否则回退格式化 `modelId`。 */
export function formatModelProfileDisplayLabel(
  profile: Pick<ClaudeModelProfile, "name" | "modelId">,
): string {
  const name = (profile.name ?? "").trim();
  if (name) return name;
  return formatClaudeModelLabel(profile.modelId ?? "");
}

/** 当前引擎生效档案的展示名（顶栏「当前」、保存提示等）。 */
export function resolveActiveModelProfileDisplayLabel(
  engine: ModelProfileEngine,
  store: ClaudeModelProfileStoreView | null | undefined,
): string {
  if (!store) return "—";
  const activeId = resolveActiveModelProfileId(engine, store);
  if (activeId) {
    const profile = store.profiles.find(
      (p) =>
        p.id === activeId && normalizeModelProfileEngine(p.engine) === engine,
    );
    if (profile) return formatModelProfileDisplayLabel(profile);
  }
  const effective = resolveEffectiveModelForProfileEngine(engine, store)?.trim();
  if (effective) return formatClaudeModelLabel(effective);
  return "—";
}
