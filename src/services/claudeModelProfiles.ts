import { invoke } from "@tauri-apps/api/core";
import type {
  ClaudeModelProfile,
  ClaudeModelProfileStoreView,
} from "../types/claudeModelProfile";

/** 全局 `settings.json` 已变更（模型切换或配置保存后派发）。 */
export const WISE_CLAUDE_USER_SETTINGS_CHANGED = "wise-claude-user-settings-changed";

export interface ClaudeUserSettingsChangedDetail {
  /** 写入磁盘后的生效模型（`env.ANTHROPIC_MODEL` 或 `model`）。 */
  effectiveModel?: string | null;
}

export function dispatchClaudeUserSettingsChanged(
  detail?: ClaudeUserSettingsChangedDetail,
): void {
  window.dispatchEvent(
    new CustomEvent<ClaudeUserSettingsChangedDetail>(WISE_CLAUDE_USER_SETTINGS_CHANGED, {
      detail: detail ?? {},
    }),
  );
}

export async function getClaudeModelProfileStore(): Promise<ClaudeModelProfileStoreView> {
  return invoke<ClaudeModelProfileStoreView>("get_claude_model_profile_store");
}

export async function createClaudeModelProfile(
  company: string,
  name: string,
  settingsJson: string,
  engine: import("../types/claudeModelProfile").ModelProfileEngine = "claude",
): Promise<ClaudeModelProfileStoreView> {
  return invoke<ClaudeModelProfileStoreView>("create_claude_model_profile", {
    company: company.trim() || null,
    name,
    settingsJson,
    engine,
  });
}

export async function createClaudeModelProfileFromCurrent(
  company: string,
  name: string,
  modelId?: string | null,
): Promise<ClaudeModelProfileStoreView> {
  return invoke<ClaudeModelProfileStoreView>("create_claude_model_profile_from_current", {
    company: company.trim() || null,
    name,
    modelId: modelId?.trim() || null,
  });
}

export async function upsertClaudeModelProfile(
  profile: ClaudeModelProfile,
): Promise<ClaudeModelProfileStoreView> {
  return invoke<ClaudeModelProfileStoreView>("upsert_claude_model_profile", { profile });
}

export async function deleteClaudeModelProfile(
  profileId: string,
): Promise<ClaudeModelProfileStoreView> {
  return invoke<ClaudeModelProfileStoreView>("delete_claude_model_profile", { profileId });
}

export async function applyClaudeModelProfile(
  profileId: string,
): Promise<ClaudeModelProfileStoreView> {
  return invoke<ClaudeModelProfileStoreView>("apply_claude_model_profile", { profileId });
}

export async function getClaudeUserSettingsJson(): Promise<string> {
  return invoke<string>("get_claude_user_settings_json");
}

export async function getCodexUserSettingsJson(): Promise<string> {
  return invoke<string>("get_codex_user_settings_json");
}

export async function getOpencodeUserSettingsJson(): Promise<string> {
  return invoke<string>("get_opencode_user_settings_json");
}

export async function saveClaudeUserSettingsJson(
  settingsJson: string,
  profileId?: string | null,
): Promise<ClaudeModelProfileStoreView> {
  return invoke<ClaudeModelProfileStoreView>("save_claude_user_settings_json", {
    settingsJson,
    profileId: profileId?.trim() || null,
  });
}

export interface CcSwitchSyncResult {
  store: ClaudeModelProfileStoreView;
  added: number;
  updated: number;
  skipped: number;
  source: string;
  message: string;
}

export async function syncClaudeModelProfilesFromCcSwitch(): Promise<CcSwitchSyncResult> {
  return invoke<CcSwitchSyncResult>("sync_claude_model_profiles_from_cc_switch");
}
