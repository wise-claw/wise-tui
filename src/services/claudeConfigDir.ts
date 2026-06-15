import { invoke } from "@tauri-apps/api/core";
import { hydrateOpenAppPreference } from "./openAppPreference";
import { openWorkspaceWithStoredPreference } from "./openWorkspaceWithPreference";

/** 用户级 Claude `settings.json`（固定 `~/.claude/settings.json`）；不存在时由后端创建空文件。 */
export async function getClaudeUserSettingsJsonPath(): Promise<string> {
  return invoke<string>("get_claude_user_settings_json_path");
}

/** 使用顶栏「打开方式」偏好在默认 IDE 中打开用户级 Claude `settings.json`。 */
export async function openClaudeUserSettingsJsonInIde(): Promise<void> {
  const path = await getClaudeUserSettingsJsonPath();
  await hydrateOpenAppPreference();
  await openWorkspaceWithStoredPreference(path);
}
