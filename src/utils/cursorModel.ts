import { CURSOR_SDK_DEFAULT_MODEL } from "../constants/cursorSdk";

const LOCAL_MODEL_ALIAS_TO_ID: Record<string, string> = {
  auto: "default",
  default: "default",
};

/** 将 Composer / session.model 解析为 Cursor Local Agent 可用的 model id。 */
export function resolveCursorLocalModelId(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return CURSOR_SDK_DEFAULT_MODEL;
  const normalized = trimmed.toLowerCase();
  return LOCAL_MODEL_ALIAS_TO_ID[normalized] ?? trimmed;
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
