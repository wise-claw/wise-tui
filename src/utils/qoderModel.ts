/** Composer 默认：Qoder Smart Routing。 */
export const QODER_DEFAULT_MODEL = "auto";

export interface QoderModelRef {
  id: string;
  displayName?: string;
}

/** 文档内置档位（`--model` / `/model` Default 页）；CLI 未登录时也能切换。 */
export const QODER_BUILTIN_TIER_MODELS: ReadonlyArray<QoderModelRef> = [
  { id: "auto", displayName: "智能路由（Auto）" },
  { id: "ultimate", displayName: "Ultimate" },
  { id: "performance", displayName: "Performance" },
  { id: "efficient", displayName: "Efficient" },
  { id: "lite", displayName: "Lite" },
];

const QODER_TIER_IDS = new Set(QODER_BUILTIN_TIER_MODELS.map((item) => item.id));

export function isQoderAutoModelId(raw: string | null | undefined): boolean {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return !normalized || normalized === "auto" || normalized === "default";
}

/** 判断是否可作为 `qodercli --model` 传入的模型 id。 */
export function isQoderModelId(
  raw: string | null | undefined,
  knownModels?: readonly QoderModelRef[],
): boolean {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  if (isQoderAutoModelId(normalized) || QODER_TIER_IDS.has(normalized)) return true;
  if (knownModels && knownModels.length > 0) {
    return knownModels.some((item) => item.id === trimmed || item.id.toLowerCase() === normalized);
  }
  // 未拿到列表时：拒绝明显属于 Claude/Codex 档案的 id，避免切换引擎后残留错误模型。
  if (
    /^(claude-|sonnet|opus|haiku|gpt-|o1|o3|o4|composer-)/i.test(trimmed) ||
    trimmed.includes("/")
  ) {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._+-]{1,127}$/.test(trimmed);
}

export function formatQoderModelLabel(modelId: string, displayName?: string | null): string {
  const v = modelId.trim();
  if (!v || isQoderAutoModelId(v)) {
    return QODER_BUILTIN_TIER_MODELS[0]?.displayName ?? "智能路由（Auto）";
  }
  const label = displayName?.replace(/\s+/g, " ").trim();
  if (label && label !== v) return label;
  const builtin = QODER_BUILTIN_TIER_MODELS.find((item) => item.id === v.toLowerCase());
  if (builtin?.displayName) return builtin.displayName;
  return v;
}

export function buildQoderModelPickerOptions(
  models: ReadonlyArray<{ id: string; displayName?: string | null }>,
): Array<{ value: string; label: string }> {
  const seen = new Set<string>();
  const opts: Array<{ value: string; label: string }> = [];
  const push = (id: string, displayName?: string | null) => {
    const value = id.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    opts.push({ value, label: formatQoderModelLabel(value, displayName) });
  };
  for (const tier of QODER_BUILTIN_TIER_MODELS) {
    push(tier.id, tier.displayName);
  }
  for (const item of models) {
    if (isQoderAutoModelId(item.id) || QODER_TIER_IDS.has(item.id.trim().toLowerCase())) continue;
    push(item.id, item.displayName);
  }
  return opts;
}

/** Composer 模型下拉过滤：匹配 id 与展示名（大小写不敏感）。 */
export function matchesQoderModelPickerFilter(
  query: string,
  option: { value: string; label: string },
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    option.value.toLowerCase().includes(needle) ||
    option.label.toLowerCase().includes(needle)
  );
}

/** 解析传给 `qodercli --model` 的值；auto/default/空则不传。 */
export function resolveQoderExecModelId(sessionModel?: string | null): string | undefined {
  const session = sessionModel?.trim();
  if (!session || isQoderAutoModelId(session)) return undefined;
  return session;
}
