/** Claude Code 模型配置档案（`app_settings` / `claude_model_profiles_v1`）。 */

export interface ClaudeModelProfile {
  id: string;
  name: string;
  modelId: string;
  settingsJson: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ClaudeModelProfileStoreView {
  profiles: ClaudeModelProfile[];
  activeProfileId: string | null;
  effectiveModel: string | null;
}
