import { invoke } from "@tauri-apps/api/core";
import type { LoadClaudeSessionJsonlOptions } from "./claudeDisk";

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
