import { invoke } from "@tauri-apps/api/core";
import type { ClaudeDiskSessionItem } from "../types";

export async function listClaudeDiskSessions(repositoryPath: string): Promise<ClaudeDiskSessionItem[]> {
  try {
    return await invoke<ClaudeDiskSessionItem[]>("list_claude_disk_sessions", { projectPath: repositoryPath });
  } catch {
    return [];
  }
}

export type LoadClaudeSessionJsonlOptions = {
  /**
   * 仅读取文件末尾若干行（Rust 侧环形缓冲，不整文件读入 String）。
   * 不传或 `null` 表示读全文件为行数组（仍比旧实现少一次全文件 String 拷贝峰值）。
   */
  tailLines?: number | null;
};

export async function loadClaudeSessionJsonl(
  repositoryPath: string,
  sessionId: string,
  options?: LoadClaudeSessionJsonlOptions,
): Promise<string[]> {
  const tailLines =
    typeof options?.tailLines === "number" && options.tailLines > 0 ? Math.floor(options.tailLines) : null;
  return invoke<string[]>("load_claude_session_jsonl", {
    projectPath: repositoryPath,
    sessionId,
    tailLines,
  });
}

/**
 * 物理删除 `~/.claude/projects/<encoded>/<sessionId>.jsonl`。
 *
 * 不可恢复，调用方必须先做二次确认。Rust 侧已对 `sessionId` 形态、目录沙箱做校验，
 * 但若 Claude Code CLI 正在写入同一 jsonl（例如同名会话仍在运行），删除可能扰动外部进程，
 * 调用方应保证会话当前不在运行状态。
 */
export async function deleteClaudeDiskSession(repositoryPath: string, sessionId: string): Promise<void> {
  await invoke<void>("delete_claude_disk_session", {
    projectPath: repositoryPath,
    sessionId,
  });
}
