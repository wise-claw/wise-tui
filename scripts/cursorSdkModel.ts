/** Cursor Local SDK Auto 的真实 model id（`auto` 仅为 alias，须映射为 `default`）。 */
export const CURSOR_SDK_LOCAL_DEFAULT_MODEL_ID = "default";

/** Agent 写盘自检固定使用的模型（避免 `default` 路由导致工具不落盘）。 */
export const CURSOR_SDK_AGENT_WRITE_PROBE_MODEL_ID = "composer-2.5";

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
