/** Composer 默认：留空表示沿用 dsh 本地配置的默认模型（不显式下发 model 配置项）。 */
export const DEEPSEEK_DEFAULT_MODEL = "";

export interface DeepSeekModelRef {
  id: string;
  displayName?: string | null;
}

export function isDeepSeekAutoModelId(raw: string | null | undefined): boolean {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return !normalized || normalized === "auto" || normalized === "default";
}

const PLAIN_MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._+/-]{0,191}$/;

/**
 * DeepSeek Harness encodes a model route as a JSON string array
 * (e.g. `["deepseek-official","deepseek-v4-flash"]`) and uses it verbatim as the
 * ACP `model` config-option value. Plain ids stay valid for other providers.
 */
export function isDeepseekEncodedModelValue(raw: string | null | undefined): boolean {
  const trimmed = raw?.trim() ?? "";
  if (trimmed.length < 3 || trimmed.length > 512) return false;
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return false;
  if (/[\n\r]/.test(trimmed)) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((item) => typeof item === "string" && item.trim().length > 0)
    );
  } catch {
    return false;
  }
}

/** DeepSeek Harness ACP 的 model 配置项是不透明的目录项（明文 id 或 JSON 数组字符串）。 */
export function isDeepSeekModelId(
  raw: string | null | undefined,
  knownModels?: readonly DeepSeekModelRef[],
): boolean {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return false;
  if (isDeepSeekAutoModelId(trimmed)) return true;
  if (knownModels && knownModels.length > 0) {
    const lower = trimmed.toLowerCase();
    return knownModels.some(
      (item) => item.id === trimmed || item.id.toLowerCase() === lower,
    );
  }
  return PLAIN_MODEL_ID_RE.test(trimmed) || isDeepseekEncodedModelValue(trimmed);
}

/** 选中模型 → `session/set_config_option("model", …)` 的入参；空表示交给 dsh 默认。 */
export function resolveDeepseekExecModelId(model: string | null | undefined): string | undefined {
  const trimmed = model?.trim() ?? "";
  if (isDeepSeekAutoModelId(trimmed)) return undefined;
  return isDeepSeekModelId(trimmed) ? trimmed : undefined;
}

/** 把 dsh 的 JSON 数组路由还原成 `provider/model`，仅用于展示。 */
function fallbackEncodedModelLabel(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      const parts = parsed.map((item) => item.trim()).filter(Boolean);
      if (parts.length > 0) return parts.join("/");
    }
  } catch {
    /* 非 JSON，原样展示 */
  }
  return raw;
}

export function formatDeepSeekModelLabel(
  modelId: string | null | undefined,
  displayName?: string | null,
): string {
  const v = modelId?.trim() ?? "";
  if (!v) return "默认模型（dsh 配置）";
  const label = displayName?.replace(/\s+/g, " ").trim();
  if (label && label !== v) return label;
  return isDeepseekEncodedModelValue(v) ? fallbackEncodedModelLabel(v) : v;
}

export function buildDeepSeekModelPickerOptions(
  models: ReadonlyArray<{ id: string; displayName?: string | null }>,
): Array<{ value: string; label: string }> {
  return models.map((item) => ({
    value: item.id,
    label: formatDeepSeekModelLabel(item.id, item.displayName),
  }));
}
