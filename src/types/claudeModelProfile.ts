/** Claude / Codex / OpenCode 模型配置档案（`app_settings` / `claude_model_profiles_v1`）。 */

export type ModelProfileEngine = "claude" | "codex" | "opencode";

export interface ClaudeModelProfile {
  id: string;
  /** 供应商/公司（与 CC Switch 供应商名称或预设一致）。 */
  company: string;
  name: string;
  modelId: string;
  /** Claude / OpenCode：`settings.json` / `opencode.json`；Codex：`{ auth, config }` envelope。 */
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
  activeOpencodeProfileId: string | null;
  effectiveModel: string | null;
  effectiveCodexModel: string | null;
  effectiveOpencodeModel: string | null;
}

export interface ModelProfileEffectiveModels {
  effectiveModel: string | null;
  effectiveCodexModel: string | null;
  effectiveOpencodeModel: string | null;
}

export function normalizeModelProfileEngine(
  engine: string | undefined | null,
): ModelProfileEngine {
  const normalized = engine?.trim().toLowerCase();
  if (normalized === "codex") return "codex";
  if (normalized === "opencode") return "opencode";
  return "claude";
}

export function resolveActiveModelProfileId(
  engine: ModelProfileEngine,
  store: ClaudeModelProfileStoreView | null | undefined,
): string | null {
  if (!store) return null;
  if (engine === "codex") return store.activeCodexProfileId;
  if (engine === "opencode") return store.activeOpencodeProfileId;
  return store.activeProfileId;
}

export function resolveEffectiveModelForProfileEngine(
  engine: ModelProfileEngine,
  store: ClaudeModelProfileStoreView | null | undefined,
): string | null {
  if (!store) return null;
  if (engine === "codex") return store.effectiveCodexModel;
  if (engine === "opencode") return store.effectiveOpencodeModel;
  return store.effectiveModel;
}

export function modelProfileEngineLabel(engine: ModelProfileEngine): string {
  if (engine === "codex") return "Codex";
  if (engine === "opencode") return "OpenCode";
  return "Claude Code";
}

export function extractEffectiveModelsFromStore(
  store: ClaudeModelProfileStoreView,
): ModelProfileEffectiveModels {
  return {
    effectiveModel: store.effectiveModel,
    effectiveCodexModel: store.effectiveCodexModel,
    effectiveOpencodeModel: store.effectiveOpencodeModel,
  };
}

export function pickBadgeEffectiveModel(
  models: ModelProfileEffectiveModels | null | undefined,
): string | null {
  const claude = models?.effectiveModel?.trim();
  if (claude) return claude;
  const codex = models?.effectiveCodexModel?.trim();
  if (codex) return codex;
  return models?.effectiveOpencodeModel?.trim() || null;
}

/** 切换档案前的乐观 store 视图（IPC 返回前即时更新 active / effective）。 */
export function buildOptimisticApplyStoreView(
  store: ClaudeModelProfileStoreView,
  profileId: string,
): ClaudeModelProfileStoreView | null {
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) return null;
  const engine = normalizeModelProfileEngine(profile.engine);
  const modelId = profile.modelId?.trim() || null;
  return {
    ...store,
    activeProfileId: engine === "claude" ? profileId : store.activeProfileId,
    activeCodexProfileId: engine === "codex" ? profileId : store.activeCodexProfileId,
    activeOpencodeProfileId: engine === "opencode" ? profileId : store.activeOpencodeProfileId,
    effectiveModel: engine === "claude" ? modelId : store.effectiveModel,
    effectiveCodexModel: engine === "codex" ? modelId : store.effectiveCodexModel,
    effectiveOpencodeModel: engine === "opencode" ? modelId : store.effectiveOpencodeModel,
  };
}
