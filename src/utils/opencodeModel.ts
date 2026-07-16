import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import { resolveEffectiveModelForProfileEngine } from "../types/claudeModelProfile";

/** Composer 默认：不传 `-m`，由 OpenCode 自身配置决定。 */
export const OPENCODE_DEFAULT_MODEL = "auto";

export interface OpencodeModelRef {
  id: string;
  displayName?: string;
}

export function isOpencodeAutoModelId(raw: string | null | undefined): boolean {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return !normalized || normalized === "auto" || normalized === "default";
}

/** 判断是否可作为 OpenCode `-m` 传入的模型 id。 */
export function isOpencodeModelId(
  raw: string | null | undefined,
  knownModels?: readonly OpencodeModelRef[],
): boolean {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return false;
  if (isOpencodeAutoModelId(trimmed)) return true;
  if (knownModels && knownModels.length > 0) {
    return knownModels.some((item) => item.id === trimmed);
  }
  // OpenCode 常见 `provider/model`；也允许裸模型名（由 CLI 自行解析）。
  return true;
}

export function formatOpencodeModelLabel(modelId: string, displayName?: string | null): string {
  const v = modelId.trim();
  if (!v || isOpencodeAutoModelId(v)) return "Auto";
  const label = displayName?.replace(/\s+/g, " ").trim();
  // displayName 若只是原样 id，仍按路径截断展示，避免列表全是 `opencode/...`。
  if (label && label !== v) return label;
  const slash = v.lastIndexOf("/");
  if (slash > 0 && slash < v.length - 1) {
    return v.slice(slash + 1);
  }
  return v;
}

/** Composer 模型下拉过滤：匹配 id 与展示名（大小写不敏感）。 */
export function matchesOpencodeModelPickerFilter(
  query: string,
  option: { value: string; label: string },
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    option.value.toLowerCase().includes(needle) ||
    option.label.toLowerCase().includes(needle)
  );
}

export function buildOpencodeModelPickerOptions(
  models: ReadonlyArray<{ id: string; displayName?: string | null }>,
): Array<{ value: string; label: string }> {
  const seen = new Set<string>();
  const opts: Array<{ value: string; label: string }> = [];
  const push = (id: string, displayName?: string | null) => {
    const value = id.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    opts.push({ value, label: formatOpencodeModelLabel(value, displayName) });
  };
  push(OPENCODE_DEFAULT_MODEL, "Auto");
  for (const item of models) {
    if (isOpencodeAutoModelId(item.id)) continue;
    push(item.id, item.displayName);
  }
  return opts;
}

/** 从 opencode.json（或档案 settingsJson）提取 `provider/model` 选项。 */
export function extractOpencodeModelOptionsFromSettingsJson(
  settingsJson: string,
): Array<{ id: string; displayName: string }> {
  try {
    const trimmed = settingsJson.trim();
    if (!trimmed) return [];
    const root = JSON.parse(trimmed) as Record<string, unknown>;
    const result: Array<{ id: string; displayName: string }> = [];
    const seen = new Set<string>();

    const push = (id: string, displayName?: string) => {
      const value = id.trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      result.push({
        id: value,
        displayName: (displayName ?? formatOpencodeModelLabel(value)).trim() || value,
      });
    };

    const topModel = typeof root.model === "string" ? root.model.trim() : "";
    if (topModel) push(topModel);

    const provider = root.provider;
    if (provider && typeof provider === "object" && !Array.isArray(provider)) {
      for (const [providerId, entry] of Object.entries(provider as Record<string, unknown>)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const models = (entry as Record<string, unknown>).models;
        if (!models || typeof models !== "object" || Array.isArray(models)) continue;
        for (const [modelName, modelMeta] of Object.entries(
          models as Record<string, unknown>,
        )) {
          const path = `${providerId}/${modelName}`;
          const name =
            modelMeta &&
            typeof modelMeta === "object" &&
            !Array.isArray(modelMeta) &&
            typeof (modelMeta as Record<string, unknown>).name === "string"
              ? String((modelMeta as Record<string, unknown>).name)
              : undefined;
          push(path, name);
        }
      }
    }
    return result;
  } catch {
    return [];
  }
}

export function resolveOpencodeProfileModelFromStore(
  store: ClaudeModelProfileStoreView | null | undefined,
): string | undefined {
  const fromEffective = resolveEffectiveModelForProfileEngine("opencode", store)?.trim();
  if (fromEffective) return fromEffective;
  const activeId = store?.activeOpencodeProfileId?.trim();
  if (!activeId || !store) return undefined;
  const profile = store.profiles.find((item) => item.id === activeId);
  return profile?.modelId?.trim() || undefined;
}

export interface ResolveOpencodeExecModelInput {
  sessionModel?: string | null;
  contextExecutionEngine: SessionExecutionEngine;
  store?: ClaudeModelProfileStoreView | null;
  /** OpenCode 全局配置中的默认 model（`~/.config/opencode/opencode.json`）。 */
  diskModel?: string | null;
}

/**
 * 解析传给 `opencode run -m` 的模型。
 * Composer 只做选择：有具体会话模型则传；`auto`/`default`/空则不传（由 OpenCode 自身配置决定）。
 */
export function resolveOpencodeExecModelId(
  input: ResolveOpencodeExecModelInput,
): string | undefined {
  const session = input.sessionModel?.trim();
  // 会话上明确选过的模型始终优先（即使 context 标记异常，也不回落到档案）。
  if (session && !isOpencodeAutoModelId(session)) return session;

  if (input.contextExecutionEngine === "opencode") {
    // Auto / 空：不传 `-m`，配置留在 OpenCode 本机。
    return undefined;
  }

  // 非 OpenCode 上下文的遗留兼容（一般不会走到）。
  const disk = input.diskModel?.trim();
  if (disk && !isOpencodeAutoModelId(disk)) return disk;

  const fromProfile = resolveOpencodeProfileModelFromStore(input.store);
  if (fromProfile && !isOpencodeAutoModelId(fromProfile)) return fromProfile;

  return undefined;
}
