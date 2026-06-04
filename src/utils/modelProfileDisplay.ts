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

export type ModelProfileDropdownParts = {
  company: string;
  modelName: string;
};

/** 公司 + 模型名拼成单行（tooltip / aria）。 */
export function formatModelProfileDropdownPartsTitle(
  parts: ModelProfileDropdownParts,
): string {
  const { company, modelName } = parts;
  if (!company) return modelName;
  return `${company} ${modelName}`;
}

function normalizeDropdownModelName(
  company: string,
  name: string,
  modelId: string,
): string {
  const modelIdLabel = formatClaudeModelLabel(modelId).trim();
  const rawModelId = modelId.trim();
  let modelName =
    name && name !== company ? name : modelIdLabel || name || company;

  if (!company || !modelName) {
    return modelName || modelIdLabel || company;
  }

  const lowerCompany = company.toLowerCase();
  const lowerModel = modelName.toLowerCase();

  if (lowerModel === lowerCompany) {
    return modelIdLabel || rawModelId || modelName;
  }
  if (modelName.startsWith(`${company} `)) {
    const rest = modelName.slice(company.length + 1).trim();
    return rest || modelIdLabel || rawModelId;
  }
  if (lowerModel.startsWith(`${lowerCompany}-`)) {
    const rest = modelName.slice(company.length + 1).trim();
    return rest || modelIdLabel || rawModelId;
  }
  return modelName;
}

/** 模型下拉两行展示：左侧公司、右侧模型名（去重司名前缀）。 */
export function resolveModelProfileDropdownParts(
  profile: Pick<ClaudeModelProfile, "company" | "name" | "modelId">,
): ModelProfileDropdownParts {
  const company = (profile.company ?? "").trim();
  const name = (profile.name ?? "").trim();
  const modelName = normalizeDropdownModelName(
    company,
    name,
    profile.modelId ?? "",
  );
  return { company, modelName };
}

/** 模型下拉列表：`公司 + 模型名`（与 {@link resolveModelProfileDropdownParts} 一致）。 */
export function formatModelProfileDropdownLabel(
  profile: Pick<ClaudeModelProfile, "company" | "name" | "modelId">,
): string {
  const { company, modelName } = resolveModelProfileDropdownParts(profile);
  if (!company) return modelName;
  return `${company} ${modelName}`;
}

/** Composer 底栏按钮：`公司 + 自定义名称`（可与下拉不同，允许更短）。 */
export function formatModelProfileComposerBarLabel(
  profile: Pick<ClaudeModelProfile, "company" | "name" | "modelId">,
): string {
  const company = (profile.company ?? "").trim();
  const displayLabel = formatModelProfileDisplayLabel(profile);
  if (!company) return displayLabel;
  if (company === displayLabel) return displayLabel;
  const companyPrefix = `${company} `;
  if (displayLabel.startsWith(companyPrefix)) return displayLabel;
  return `${company} ${displayLabel}`;
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

/** 按 `modelId` 查找同引擎档案的下拉展示名。 */
export function resolveModelProfileDropdownLabelByModelId(
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
  return formatModelProfileDropdownLabel(profile);
}

/** 按 `modelId` 查找同引擎档案的展示名（底栏按钮等）。 */
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
