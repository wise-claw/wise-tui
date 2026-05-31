/** Cursor Local SDK 的 Auto 模型 id 为 `default`（`auto` 只是 alias，不能传给 Local Agent）。 */
export const CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID = "default";

const LOCAL_MODEL_ALIAS_TO_ID: Record<string, string> = {
  auto: CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID,
  default: CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID,
};

/** 将 Composer / 配置中的模型名解析为 Local Agent 可用的 model id。 */
export function resolveCursorLocalModelId(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID;
  const normalized = trimmed.toLowerCase();
  return LOCAL_MODEL_ALIAS_TO_ID[normalized] ?? trimmed;
}
