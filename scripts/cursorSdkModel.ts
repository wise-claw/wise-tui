/** Cursor Local SDK Auto 的真实 model id（`auto` / `default` 映射为 `composer-2.5`，避免 `default` 路由无可见回复）。 */
export const CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID = "composer-2.5";

/** Agent 写盘自检固定使用的模型（避免 `default` 路由导致工具不落盘）。 */
export const CURSOR_SDK_AGENT_WRITE_PROBE_MODEL_ID = "composer-2.5";

const LOCAL_MODEL_ALIAS_TO_ID: Record<string, string> = {
  auto: CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID,
  default: CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID,
};

/** Cursor Local SDK 常见模型 id 前缀（与 `Cursor.models.list()` 返回集一致）。 */
const CURSOR_SDK_MODEL_PREFIXES = [
  "composer-",
  "claude-",
  "gpt-",
  "gemini-",
  "grok-",
  "kimi-",
] as const;

/** 第三方 Claude 代理模型（火山 glm、百炼 qwen 等）——不能传给 Cursor SDK。 */
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
  return CURSOR_SDK_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** 将 Composer / 配置中的模型名解析为 Local Agent 可用的 model id。 */
export function resolveCursorLocalModelId(
  raw: string | null | undefined,
  knownModels?: readonly CursorSdkModelRef[],
): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID;
  const normalized = trimmed.toLowerCase();
  if (LOCAL_MODEL_ALIAS_TO_ID[normalized]) return LOCAL_MODEL_ALIAS_TO_ID[normalized];
  if (!isCursorSdkModelId(trimmed, knownModels)) return CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID;
  return trimmed;
}
