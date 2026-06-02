import { invoke } from "@tauri-apps/api/core";
import type {
  ClaudeModelProfile,
  ClaudeModelProfileStoreView,
  ModelProfileEffectiveModels,
  ModelProfileEngine,
} from "../types/claudeModelProfile";
import {
  extractEffectiveModelsFromStore,
  pickBadgeEffectiveModel,
  resolveEffectiveModelForProfileEngine,
} from "../types/claudeModelProfile";
import { seedModelProfileStoreCache } from "../stores/modelProfileStoreCache";

/** 全局 `settings.json` 已变更（模型切换或配置保存后派发）。 */
export const WISE_CLAUDE_USER_SETTINGS_CHANGED = "wise-claude-user-settings-changed";

export interface ClaudeUserSettingsChangedDetail {
  /** 写入磁盘后的生效模型（`env.ANTHROPIC_MODEL` 或 `model`）。 */
  effectiveModel?: string | null;
  /** 完整 store 快照；监听方可直接合并，跳过 debounce refresh。 */
  storeSnapshot?: ClaudeModelProfileStoreView;
  /** 仅 SQLite 档案变更、未写全局 settings 时为 true。 */
  skipComposerPickerRefresh?: boolean;
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

/** 模型档案 mutating 后广播：携带 store 快照，避免监听方 debounce refresh。 */
export function dispatchModelProfileStoreChanged(
  store: ClaudeModelProfileStoreView,
  options?: {
    engine?: ModelProfileEngine;
    effectiveModel?: string | null;
    /** 未改写 Claude/Codex/OpenCode 全局配置时设为 true。 */
    skipComposerPickerRefresh?: boolean;
  },
): void {
  seedModelProfileStoreCache(store);
  const effectiveModel =
    options?.effectiveModel?.trim() ||
    (options?.engine
      ? resolveEffectiveModelForProfileEngine(options.engine, store)?.trim() || null
      : pickBadgeEffectiveModel(extractEffectiveModelsFromStore(store)));
  dispatchClaudeUserSettingsChanged({
    effectiveModel,
    storeSnapshot: store,
    skipComposerPickerRefresh: options?.skipComposerPickerRefresh,
  });
}

export async function getClaudeModelProfileStore(): Promise<ClaudeModelProfileStoreView> {
  const store = await invoke<ClaudeModelProfileStoreView>("get_claude_model_profile_store");
  seedModelProfileStoreCache(store);
  return store;
}

export async function getModelProfileEffectiveModels(): Promise<ModelProfileEffectiveModels> {
  return invoke<ModelProfileEffectiveModels>("get_model_profile_effective_models");
}

export async function createClaudeModelProfile(
  company: string,
  name: string,
  settingsJson: string,
  engine: import("../types/claudeModelProfile").ModelProfileEngine = "claude",
  officialWebsiteUrl?: string | null,
): Promise<ClaudeModelProfileStoreView> {
  return invoke<ClaudeModelProfileStoreView>("create_claude_model_profile", {
    company: company.trim() || null,
    name,
    settingsJson,
    engine,
    officialWebsiteUrl: officialWebsiteUrl?.trim() || null,
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

export async function setClaudeModelProfileAutoFailover(
  enabled: boolean,
): Promise<ClaudeModelProfileStoreView> {
  return invoke<ClaudeModelProfileStoreView>("set_claude_model_profile_auto_failover", {
    enabled,
  });
}

export async function reorderClaudeModelProfiles(
  engine: import("../types/claudeModelProfile").ModelProfileEngine,
  orderedProfileIds: string[],
): Promise<ClaudeModelProfileStoreView> {
  return invoke<ClaudeModelProfileStoreView>("reorder_claude_model_profiles", {
    engine,
    orderedProfileIds,
  });
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
