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

/** Composer 底栏 / 与模型切换列表一致：`公司 + 自定义名称`。 */
export function formatModelProfileComposerBarLabel(
  profile: Pick<ClaudeModelProfile, "company" | "name" | "modelId">,
): string {
  const company = (profile.company ?? "").trim();
  const displayLabel = formatModelProfileDisplayLabel(profile);
  return company ? `${company} ${displayLabel}` : displayLabel;
}

/** 当前引擎生效档案在 Composer 底栏的展示名；无档案时返回 null。 */
export function resolveActiveModelProfileComposerBarLabel(
  engine: ModelProfileEngine,
  store: ClaudeModelProfileStoreView | null | undefined,
): string | null {
  if (!store) return null;
  const activeId = resolveActiveModelProfileId(engine, store);
  if (!activeId) return null;
  const profile = store.profiles.find(
    (p) =>
      p.id === activeId && normalizeModelProfileEngine(p.engine) === engine,
  );
  if (!profile) return null;
  return formatModelProfileComposerBarLabel(profile);
}

/** 按 `modelId` 查找同引擎档案的展示名（下拉项等）。 */
export function resolveModelProfileComposerBarLabelByModelId(
  engine: ModelProfileEngine,
  modelId: string,
  store: ClaudeModelProfileStoreView | null | undefined,
): string | null {
  const trimmed = modelId.trim();
  if (!trimmed || !store) return null;
  const profile = store.profiles.find(
    (p) =>
      normalizeModelProfileEngine(p.engine) === engine &&
      (p.modelId ?? "").trim() === trimmed,
  );
  if (!profile) return null;
  return formatModelProfileComposerBarLabel(profile);
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
