import { invoke } from "@tauri-apps/api/core";
import type {
  ModelProfileEngine,
  ModelProfileFailoverResult,
} from "../types/claudeModelProfile";
import type { SessionExecutionEngine } from "../types";
import { dispatchModelProfileStoreChanged } from "./claudeModelProfiles";
import {
  isCachedModelProfileAutoFailoverEnabled,
  seedModelProfileStoreCache,
} from "../stores/modelProfileStoreCache";

export function resolveModelProfileEngineForExecution(
  engine: SessionExecutionEngine,
): ModelProfileEngine | null {
  if (engine === "claude") return "claude";
  if (engine === "codex") return "codex";
  return null;
}

export async function failoverToNextModelProfile(
  engine: ModelProfileEngine,
  excludeProfileIds: string[] = [],
): Promise<ModelProfileFailoverResult | null> {
  try {
    return await invoke<ModelProfileFailoverResult>("failover_to_next_model_profile", {
      engine,
      excludeProfileIds: excludeProfileIds.filter(Boolean),
    });
  } catch {
    return null;
  }
}

export function buildModelProfileFailoverSystemMessage(result: ModelProfileFailoverResult): string {
  const label = result.profileName.trim() || result.modelId.trim() || result.appliedProfileId;
  const model = result.modelId.trim();
  return model && model !== label
    ? `当前模型档案限流或不可用，已自动切换到「${label}」（${model}）并重试。`
    : `当前模型档案限流或不可用，已自动切换到「${label}」并重试。`;
}

/** 切换档案、广播 settings 变更，并返回系统提示文案。 */
export async function applyModelProfileFailover(
  engine: ModelProfileEngine,
  excludeProfileIds: string[] = [],
): Promise<{ result: ModelProfileFailoverResult; systemMessage: string } | null> {
  if (!isCachedModelProfileAutoFailoverEnabled()) {
    return null;
  }
  const result = await failoverToNextModelProfile(engine, excludeProfileIds);
  if (!result) return null;
  seedModelProfileStoreCache(result.store);
  dispatchModelProfileStoreChanged(result.store, {
    engine: result.engine,
    effectiveModel: result.modelId,
  });
  return {
    result,
    systemMessage: buildModelProfileFailoverSystemMessage(result),
  };
}
