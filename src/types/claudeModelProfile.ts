/** Claude / Codex 模型配置档案（`app_settings` / `claude_model_profiles_v1`）。 */

export type ModelProfileEngine = "claude" | "codex";

export interface ClaudeModelProfile {
  id: string;
  /** 供应商/公司（与 CC Switch 供应商名称或预设一致）。 */
  company: string;
  name: string;
  modelId: string;
  /** Claude：`settings.json`；Codex：`{ auth, config }` envelope。 */
  settingsJson: string;
  /** 运行引擎，缺省为 Claude。 */
  engine?: ModelProfileEngine;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ClaudeModelProfileStoreView {
  profiles: ClaudeModelProfile[];
  activeProfileId: string | null;
  activeCodexProfileId: string | null;
  effectiveModel: string | null;
  effectiveCodexModel: string | null;
}

export function normalizeModelProfileEngine(
  engine: string | undefined | null,
): ModelProfileEngine {
  return engine?.trim().toLowerCase() === "codex" ? "codex" : "claude";
}
