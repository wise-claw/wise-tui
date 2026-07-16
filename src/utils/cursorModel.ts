import { CURSOR_SDK_DEFAULT_MODEL } from "../constants/cursorSdk";

const LOCAL_MODEL_ALIAS_TO_ID: Record<string, string> = {
  auto: "composer-2.5",
  default: "composer-2.5",
};

/** Cursor CLI 常见模型 id 前缀（与 `agent --list-models` / `--model` 对齐）。 */
const CURSOR_SDK_MODEL_PREFIXES = [
  "composer-",
  "claude-",
  "sonnet-",
  "opus-",
  "haiku-",
  "gpt-",
  "o1",
  "o3",
  "o4",
  "gemini-",
  "grok-",
  "kimi-",
] as const;

/**
 * 第三方 Claude 代理模型（火山 glm、百炼 qwen 等）——不能传给 Cursor CLI。
 * 注意：`kimi-k2.5` 等 Cursor 自有模型不在此列。
 */
const NON_CURSOR_SDK_PROVIDER_RE =
  /^(glm|qwen|deepseek|bailian|doubao|minimax|moonshot)([-_.]|$)/i;

export interface CursorSdkModelRef {
  id: string;
  aliases?: string[];
}

/** 判断模型 id 是否可作为 Cursor Local SDK 的 `model.id`。 */
export function isCursorSdkModelId(
  raw: string | null | undefined,
  knownModels?: readonly CursorSdkModelRef[],
): boolean {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  if (normalized === "auto" || normalized === "default") return true;

  if (knownModels && knownModels.length > 0) {
    return knownModels.some(
      (item) =>
        item.id === trimmed || (item.aliases ?? []).some((alias) => alias === trimmed),
    );
  }

  if (NON_CURSOR_SDK_PROVIDER_RE.test(trimmed)) return false;
  return CURSOR_SDK_MODEL_PREFIXES.some((prefix) => {
    if (prefix.endsWith("-")) return normalized.startsWith(prefix);
    // o1 / o3 / o4：精确前缀或后接 `-`
    return normalized === prefix || normalized.startsWith(`${prefix}-`);
  });
}

/** 将 Composer / session.model 解析为 Cursor Local Agent 可用的 model id。 */
export function resolveCursorLocalModelId(
  raw: string | null | undefined,
  knownModels?: readonly CursorSdkModelRef[],
): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return CURSOR_SDK_DEFAULT_MODEL;
  const normalized = trimmed.toLowerCase();
  if (LOCAL_MODEL_ALIAS_TO_ID[normalized]) return LOCAL_MODEL_ALIAS_TO_ID[normalized];
  if (!isCursorSdkModelId(trimmed, knownModels)) return CURSOR_SDK_DEFAULT_MODEL;
  return trimmed;
}

/** Cursor 模型展示名（优先 displayName，否则格式化 id）。 */
export function formatCursorModelLabel(modelId: string, displayName?: string | null): string {
  const label = displayName?.replace(/\s+/g, " ").trim();
  if (label) return label;
  const v = modelId.trim();
  if (!v || v === "default") return "Auto";
  if (v.startsWith("composer-")) {
    const tail = v.slice("composer-".length);
    return `Composer ${tail}`;
  }
  return v
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface CursorModelPickerOption {
  value: string;
  label: string;
}

/** 构建 Cursor 模型下拉：仅 canonical id，按 displayName 去重。 */
export function buildCursorModelPickerOptions(
  models: ReadonlyArray<{ id: string; displayName: string; aliases?: string[] }>,
): CursorModelPickerOption[] {
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  const opts: CursorModelPickerOption[] = [];

  for (const item of models) {
    const id = item.id.trim();
    if (!id || seenIds.has(id)) continue;
    const label = formatCursorModelLabel(id, item.displayName).trim();
    const labelKey = label.toLowerCase();
    if (seenLabels.has(labelKey)) continue;
    seenIds.add(id);
    seenLabels.add(labelKey);
    opts.push({ value: id, label });
  }

  return opts;
}
