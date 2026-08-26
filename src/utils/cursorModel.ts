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

export function isAutoCursorModelId(raw: string | null | undefined): boolean {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return normalized === "auto" || normalized === "default";
}

/** 判断模型 id 是否可作为 Cursor Local SDK 的 `model.id`。 */
export function isCursorSdkModelId(
  raw: string | null | undefined,
  knownModels?: readonly CursorSdkModelRef[],
): boolean {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  // Cursor CLI 把 Auto 与 Fast 档位也列为独立 id（展示名可能是 Grok 4.6 Fast）。
  if (normalized === "auto" || normalized === "default" || normalized === "fast") return true;

  if (knownModels && knownModels.length > 0) {
    const listed = knownModels.some(
      (item) =>
        item.id === trimmed ||
        item.id.toLowerCase() === normalized ||
        (item.aliases ?? []).some((alias) => alias === trimmed || alias.toLowerCase() === normalized),
    );
    if (listed) return true;
  }

  if (NON_CURSOR_SDK_PROVIDER_RE.test(trimmed)) return false;
  return CURSOR_SDK_MODEL_PREFIXES.some((prefix) => {
    if (prefix.endsWith("-")) return normalized.startsWith(prefix);
    // o1 / o3 / o4：精确前缀或后接 `-`
    return normalized === prefix || normalized.startsWith(`${prefix}-`);
  });
}

function isSpecificCursorModelId(
  raw: string | null | undefined,
  knownModels?: readonly CursorSdkModelRef[],
): boolean {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed || isAutoCursorModelId(trimmed)) return false;
  return isCursorSdkModelId(trimmed, knownModels);
}

/**
 * Composer Cursor 模型：菜单刚选的值最高优先，避免列表刷新 / 过期 session.model
 * 把 Grok 4.6 Fast 等打回 Auto。`auto`/`default` 只作为兜底。
 */
export function resolveCursorComposerModel(input: {
  pickedModel?: string | null;
  currentModel?: string | null;
  sessionModel?: string | null;
  savedDefault?: string | null;
  knownModels?: readonly CursorSdkModelRef[];
}): string {
  const known = input.knownModels;
  const picked = input.pickedModel?.trim() || "";
  const current = input.currentModel?.trim() || "";
  const session = input.sessionModel?.trim() || "";
  const saved = input.savedDefault?.trim() || "";
  if (picked && isCursorSdkModelId(picked, known)) return picked;
  if (isSpecificCursorModelId(current, known)) return current;
  if (isSpecificCursorModelId(session, known)) return session;
  if (isSpecificCursorModelId(saved, known)) return saved;
  if (current && isCursorSdkModelId(current, known)) return current;
  if (session && isCursorSdkModelId(session, known)) return session;
  if (saved && isCursorSdkModelId(saved, known)) return saved;
  return CURSOR_SDK_DEFAULT_MODEL;
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
  if (isAutoCursorModelId(modelId)) return "Auto";
  const label = displayName?.replace(/\s+/g, " ").trim();
  if (label) return label;
  const v = modelId.trim();
  if (!v) return "Auto";
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

/** 构建 Cursor 模型下拉：仅 canonical id，按 displayName 去重。Auto 固定展示为 Auto。 */
export function buildCursorModelPickerOptions(
  models: ReadonlyArray<{ id: string; displayName: string; aliases?: string[] }>,
): CursorModelPickerOption[] {
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  const opts: CursorModelPickerOption[] = [];

  const push = (rawId: string, displayName?: string | null) => {
    const id = rawId.trim();
    if (!id || seenIds.has(id)) return;
    const label = formatCursorModelLabel(id, displayName).trim();
    if (!label) return;
    const labelKey = label.toLowerCase();
    // Auto 不占用其它模型的展示名；否则「Grok 4.6 Fast (current)」会被收成 Auto。
    if (!isAutoCursorModelId(id) && seenLabels.has(labelKey)) return;
    seenIds.add(id);
    seenLabels.add(labelKey);
    opts.push({ value: id, label });
  };

  for (const item of models) {
    if (isAutoCursorModelId(item.id)) push(item.id, item.displayName);
  }
  for (const item of models) {
    if (!isAutoCursorModelId(item.id)) push(item.id, item.displayName);
  }

  return opts;
}
