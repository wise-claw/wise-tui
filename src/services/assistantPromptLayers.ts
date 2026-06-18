/**
 * 助手运行态分层(spec D4 + E2):一个 IPC 调用拿到 merge 后的
 * `{ promptLayers, skills, mcps, engineering, systemPrompt, tools }`,前端按需取槽位。
 *
 * 合并顺序(由 Rust runtime_resolver 实现):
 *   builtin assistant_default(若 assistant_id 是 builtin)
 *   → assistant scope override
 *   → project scope override(若提供 projectId)
 *   → repository scope override(若提供 repositoryId)
 *
 * **平台默认(`DEFAULT_SPLIT_PROMPT_*_LAYERS`)** 仍由前端 `splitPromptTemplate.ts`
 * 拥有,因为它需要参与占位符替换。本服务返回的 prompt bundle 在前端再次与平台默认 merge。
 */
import { invoke } from "@tauri-apps/api/core";

export interface AssistantResolvedRuntime {
  assistantId: string;
  source: "builtin" | "custom" | "extension" | "legacy";
  systemPrompt: string;
  tools: string[];
  model: string | null;
  engineId: string;
  /** v2 schema bundle JSON: `{ schemaVersion, prompts: { slot: layers } }`。 */
  promptBundleJson: string;
  skillBundleJson: string;
  mcpBundleJson: string;
  engineeringJson: string;
}

export interface AssistantResolveScopes {
  assistantId: string;
  projectId?: string | null;
  repositoryId?: string | number | null;
}

interface AssistantOverridesPatch {
  promptLayersJson?: string;
  skillBundleJson?: string;
  mcpBundleJson?: string;
  engineeringJson?: string;
}

export interface AssistantBundleItem {
  id: string;
  label: string;
  origin: string | null;
  sourcePath?: string;
}

export interface AssistantRuntimeBundle {
  disabled: string[];
  custom: AssistantBundleItem[];
}

export async function resolveAssistantRuntime(
  scopes: AssistantResolveScopes,
): Promise<AssistantResolvedRuntime> {
  const args = {
    assistantId: scopes.assistantId,
    projectId: scopes.projectId ?? null,
    repositoryId:
      scopes.repositoryId == null ? null : String(scopes.repositoryId),
  };
  return invoke<AssistantResolvedRuntime>("assistants_resolve_runtime", { args });
}

export async function saveAssistantRuntimeOverrides(input: {
  assistantId: string;
  scope: string;
  patch: AssistantOverridesPatch;
}): Promise<void> {
  await invoke("assistants_save_overrides", {
    args: {
      assistantId: input.assistantId,
      scope: input.scope,
      patch: input.patch,
    },
  });
}

export async function resetAssistantRuntimeOverrides(input: {
  assistantId: string;
  scope: string;
  sections?: Array<"prompts" | "skills" | "mcps" | "engineering" | "all">;
}): Promise<void> {
  await invoke("assistants_reset_overrides", {
    args: {
      assistantId: input.assistantId,
      scope: input.scope,
      sections: input.sections ?? ["all"],
    },
  });
}

export function parseAssistantRuntimeBundle(raw: string): AssistantRuntimeBundle {
  const fallback: AssistantRuntimeBundle = { disabled: [], custom: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim() || "{}");
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== "object") return fallback;
  const obj = parsed as Record<string, unknown>;
  const disabled = Array.isArray(obj.disabled)
    ? obj.disabled.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const custom = Array.isArray(obj.custom)
    ? obj.custom
      .map((item): AssistantBundleItem | null => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const id = typeof row.id === "string" ? row.id.trim() : "";
        const label = typeof row.label === "string" ? row.label.trim() : id;
        if (!id || !label) return null;
        const sourcePath = typeof row.sourcePath === "string" && row.sourcePath.trim()
          ? row.sourcePath.trim()
          : undefined;
        return {
          id,
          label,
          origin: typeof row.origin === "string" ? row.origin : null,
          sourcePath,
        };
      })
      .filter((item): item is AssistantBundleItem => item !== null)
    : [];
  return { disabled, custom };
}

export function buildAssistantRuntimeBundleJson(bundle: AssistantRuntimeBundle): string {
  return JSON.stringify(
    {
      disabled: Array.from(new Set(bundle.disabled.map((item) => item.trim()).filter(Boolean))),
      custom: bundle.custom.map((item) => ({
        id: item.id,
        label: item.label,
        origin: item.origin ?? "custom",
        ...(item.sourcePath ? { sourcePath: item.sourcePath } : {}),
      })),
    },
    null,
    2,
  );
}

export interface AssistantEngineeringPreferences {
  reuseExistingParents?: boolean;
  dispatchOnlyDirty?: boolean;
  formatProfile?: string;
}

export function parseAssistantEngineeringPreferences(
  raw: string,
): AssistantEngineeringPreferences {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim() || "{}");
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const obj = parsed as Record<string, unknown>;
  const out: AssistantEngineeringPreferences = {};
  if (typeof obj.reuseExistingParents === "boolean") {
    out.reuseExistingParents = obj.reuseExistingParents;
  }
  if (typeof obj.dispatchOnlyDirty === "boolean") {
    out.dispatchOnlyDirty = obj.dispatchOnlyDirty;
  }
  if (typeof obj.formatProfile === "string") {
    out.formatProfile = obj.formatProfile;
  }
  return out;
}

export function buildAssistantEngineeringJson(
  preferences: AssistantEngineeringPreferences,
): string {
  return JSON.stringify(
    {
      reuseExistingParents: preferences.reuseExistingParents ?? false,
      dispatchOnlyDirty: preferences.dispatchOnlyDirty ?? false,
      formatProfile: preferences.formatProfile?.trim() ?? "",
    },
    null,
    2,
  );
}

