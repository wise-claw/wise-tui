import { invoke } from "@tauri-apps/api/core";

/** 用户级 Claude Code 配置目录的当前状态（默认 `~/.claude`，自定义时与磁盘解析后的绝对路径一并返回）。 */
export interface ClaudeUserConfigDirInfo {
  /** 用户填写的原始字符串（含 `~`）；未自定义时为 `null`。 */
  rawValue: string | null;
  /** 解析后绝对路径，例如 `/Users/foo/.claude` 或 `/Users/foo/.codefuse/engine/cc`。 */
  resolvedPath: string;
  /** 是否使用官方默认目录。 */
  isDefault: boolean;
  /** 默认目录解析后的绝对路径（用于在 UI 上做对比展示）。 */
  defaultResolvedPath: string;
  /** 解析后路径在磁盘上是否实际存在。 */
  exists: boolean;
}

/** Wise 内置的快捷选项；自定义路径不在此列表内。 */
export const CLAUDE_USER_CONFIG_DIR_PRESETS: ReadonlyArray<{ key: "default" | "codefuse"; rawValue: string | null; label: string; description: string }> = [
  {
    key: "default",
    rawValue: null,
    label: "~/.claude（默认）",
    description: "官方 Claude Code 的本机用户级引擎环境。",
  },
  {
    key: "codefuse",
    rawValue: "~/.codefuse/engine/cc",
    label: "~/.codefuse/engine/cc",
    description: "CodeFuse Engine CC 同源版本的用户级引擎环境。",
  },
];

export async function getClaudeUserConfigDir(): Promise<ClaudeUserConfigDirInfo> {
  return invoke<ClaudeUserConfigDirInfo>("get_claude_user_config_dir");
}

/**
 * 写入用户级 Claude Code 配置目录。
 * - 传 `null` 或空串 → 还原为默认 `~/.claude`，删除持久化记录。
 * - 传 `~/path/...` 或绝对路径 → 持久化并实时刷新后端缓存，后续 IPC 立刻按新路径解析。
 */
export async function setClaudeUserConfigDir(value: string | null): Promise<ClaudeUserConfigDirInfo> {
  const normalized = value == null ? null : value.trim();
  return invoke<ClaudeUserConfigDirInfo>("set_claude_user_config_dir", {
    value: normalized && normalized.length > 0 ? normalized : null,
  });
}
