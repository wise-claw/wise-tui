/** Composer / 会话默认模型（展示为 Auto；传给 Local SDK 时由 resolve 映射为 `default`）。 */
export const CURSOR_SDK_DEFAULT_MODEL = "auto";

/**
 * Wise Cursor SDK bridge 默认不加载 project 设置层（避免目标仓库沙箱/钩子禁用写盘）。
 * 若需加载仓库 `.cursor/mcp.json` 与规则，可在 spawn extras 显式传入 project。
 */
export const CURSOR_SDK_SETTING_SOURCES = [] as const;
