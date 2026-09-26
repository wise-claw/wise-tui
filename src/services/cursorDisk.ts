import { invoke } from "@tauri-apps/api/core";
import type { LoadClaudeSessionJsonlOptions } from "./claudeDisk";
import type { CursorDiskSessionItem } from "../types";

/** 列出 Wise 在本仓库通过 Cursor 落盘的会话（`~/.wise/cursor-runs`）。 */
export async function listCursorDiskSessions(
  repositoryPath: string,
): Promise<CursorDiskSessionItem[]> {
  return invoke<CursorDiskSessionItem[]>("list_cursor_disk_sessions", {
    projectPath: repositoryPath,
  });
}

export async function loadCursorSessionJsonl(
  repositoryPath: string,
  tabSessionId: string,
  options?: LoadClaudeSessionJsonlOptions,
): Promise<string[]> {
  const tailLines =
    typeof options?.tailLines === "number" && options.tailLines > 0
      ? Math.floor(options.tailLines)
      : null;
  return invoke<string[]>("load_cursor_session_jsonl_command", {
    projectPath: repositoryPath,
    tabSessionId,
    tailLines,
  });
}
