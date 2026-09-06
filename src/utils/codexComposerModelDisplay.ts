import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import {
  formatCodexModelLabel,
  looksLikeOpenAiCatalogModel,
  resolveCodexProfileModelFromStore,
  type CodexModelRef,
} from "./codexModel";
import { resolveModelProfileDropdownParts, type ModelProfileDropdownParts } from "./modelProfileDisplay";

/** Codex 档案负责连接配置；底栏始终展示当前模型，不能用 default 档案名替代。 */
export function resolveCodexComposerModelDisplay(
  model: string,
  runtimeModels: readonly CodexModelRef[] | null,
  store: ClaudeModelProfileStoreView | null,
): ModelProfileDropdownParts {
  const selected = model.trim() || resolveCodexProfileModelFromStore(store) || "";
  const runtime = runtimeModels?.find((item) => item.id.trim() === selected);
  if (runtime) {
    return {
      company: runtime.provider?.trim() || "",
      modelName: formatCodexModelLabel(selected, runtime.displayName),
    };
  }
  const profile = store?.profiles.find((item) =>
    item.engine === "codex" && item.modelId?.trim() === selected);
  if (profile && !looksLikeOpenAiCatalogModel(selected)) {
    return resolveModelProfileDropdownParts(profile);
  }
  // 目录尚未加载或模型已不在缓存中时仍显示模型 id，不退回 default 档案名。
  return {
    company: profile?.company?.trim() || "",
    modelName: formatCodexModelLabel(selected),
  };
}
