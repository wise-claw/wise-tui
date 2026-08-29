import type {
  ClaudeModelProfile,
  ClaudeModelProfileStoreView,
} from "../types/claudeModelProfile";
import {
  normalizeModelProfileEngine,
  resolveEffectiveModelForProfileEngine,
} from "../types/claudeModelProfile";

/** 将 `ANTHROPIC_MODEL` / CLI 模型 id 格式化为简短展示名（与标签页一致）。 */
export function formatClaudeModelLabel(modelId: string): string {
  const v = modelId.trim();
  if (!v) return "默认";
  const head = v.replace(/^claude-/i, "").split("-")[0] ?? "";
  if (!head) return v;
  return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
}

/** 从模型切换 Claude 页读取当前默认档案模型（effective → active profile modelId）。 */
export function resolveClaudeProfileModelFromStore(
  store: ClaudeModelProfileStoreView | null | undefined,
): string | undefined {
  const fromEffective = resolveEffectiveModelForProfileEngine("claude", store)?.trim();
  if (fromEffective) return fromEffective;
  const activeId = store?.activeProfileId?.trim();
  if (!activeId || !store) return undefined;
  const profile = store.profiles.find((item) => item.id === activeId);
  return profile?.modelId?.trim() || undefined;
}

export interface ResolveClaudeExecModelInput {
  /** 执行标签上的 session.model（可能滞后于全局档案切换）。 */
  sessionModel?: string | null;
  store?: ClaudeModelProfileStoreView | null;
}

/**
 * Claude 执行模型：优先「模型切换 → Claude」当前生效档案，再回退 session.model。
 */
export function resolveClaudeExecModelId(input: ResolveClaudeExecModelInput): string | undefined {
  const profileModel = resolveClaudeProfileModelFromStore(input.store);
  if (profileModel) return profileModel;
  const session = input.sessionModel?.trim();
  if (session) return session;
  return undefined;
}

// ---------------------------------------------------------------------------
// Claude 模型选择器（Composer 快速切换）
// ---------------------------------------------------------------------------

/** settings.json 未配置 `availableModels` 时的兜底官方 Claude 模型（与 Rust 本地代理 env 对齐）。 */
export const CLAUDE_DEFAULT_MODEL_FALLBACK = [
  "claude-sonnet-4-8",
  "claude-opus-4-8",
  "claude-haiku-4-8",
] as const;

/** settings.json 中 Claude CLI 实际支持的模型（`get_claude_model_picker_options`）。 */
export interface ClaudeModelPickerSource {
  defaultModel?: string | null;
  availableModels?: readonly string[] | null;
}

export interface ClaudeModelPickerOption {
  value: string;
  label: string;
  company?: string;
  /** 命中已配置的 Claude 档案时填充；选中该选项即应用档案。 */
  profileId?: string;
}

/** 模型 id 是否是某个本地 Claude 档案的模型（档案模型不在 settings.json 列表中也算已知）。 */
export function isClaudeProfileModelId(
  modelId: string,
  profiles: readonly ClaudeModelProfile[] | null | undefined,
): boolean {
  const v = modelId.trim();
  if (!v || !profiles) return false;
  return profiles.some(
    (profile) =>
      normalizeModelProfileEngine(profile.engine) === "claude" &&
      (profile.modelId ?? "").trim() === v,
  );
}

/** 模型 id 是否属于当前 Claude 环境已知模型（配置默认 / 可选列表 / 官方兜底）。 */
export function isKnownClaudePickerModel(
  modelId: string,
  picker: ClaudeModelPickerSource | null,
): boolean {
  const v = modelId.trim();
  if (!v) return false;
  if (v === picker?.defaultModel?.trim()) return true;
  if ((picker?.availableModels ?? []).includes(v)) return true;
  return (CLAUDE_DEFAULT_MODEL_FALLBACK as readonly string[]).includes(v);
}

/**
 * 合并 Claude 快捷模型：模型切换面板中的全部 claude 档案为第一来源（选中即应用档案
 * env/baseURL），再并入 settings.json 配置模型（defaultModel + availableModels，展示全量
 * id；与档案同 modelId 忽略大小写时不再重复出现），保证「模型切换」里的模型都在快捷列表。
 * 无档案且无配置模型时回退官方兜底，保证列表非空。
 */
export function buildClaudeModelPickerOptions(input: {
  picker: ClaudeModelPickerSource | null;
  profiles?: readonly ClaudeModelProfile[] | null;
  sessionModel?: string | null;
  currentModel?: string | null;
}): ClaudeModelPickerOption[] {
  const opts: ClaudeModelPickerOption[] = [];
  const seen = new Set<string>();
  const push = (value: string, label?: string, company?: string, profileId?: string) => {
    const v = value.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    const option: ClaudeModelPickerOption = {
      value: v,
      label: label?.trim() || v,
    };
    if (company?.trim()) option.company = company.trim();
    if (profileId?.trim()) option.profileId = profileId.trim();
    opts.push(option);
  };

  const claudeProfiles = (input.profiles ?? []).filter(
    (p) => normalizeModelProfileEngine(p.engine) === "claude",
  );
  // 1. 模型切换面板的全部 claude 档案：逐一进入快捷列表（同 modelId 精确去重，首个优先）。
  const seenProfileModels = new Set<string>();
  for (const profile of claudeProfiles) {
    const id = profile.modelId?.trim();
    if (!id || seenProfileModels.has(id)) continue;
    seenProfileModels.add(id);
    push(id, profile.name?.trim() || id, profile.company, profile.id);
  }

  // 2. settings.json 配置模型：展示全量 id；与档案同模型（忽略大小写）时由档案项覆盖。
  const configured: string[] = [];
  const def = input.picker?.defaultModel?.trim();
  if (def) configured.push(def);
  for (const item of input.picker?.availableModels ?? []) {
    const v = item.trim();
    if (v) configured.push(v);
  }
  for (const id of configured) {
    // 已由档案项覆盖（同模型忽略大小写）的配置模型不重复出现。
    if (seenProfileModels.has(id.toLowerCase())) continue;
    push(id);
  }

  // 3. 无档案且无配置模型时兜底官方模型，避免空列表。
  if (opts.length === 0) {
    for (const item of CLAUDE_DEFAULT_MODEL_FALLBACK) {
      push(item);
    }
  }

  // 4. 当前会话模型始终可选中（含 "sonnet" 等短名别名；已在列表时自动去重）。
  const sessionModel = input.sessionModel?.trim();
  if (sessionModel && isKnownClaudePickerModel(sessionModel, input.picker)) {
    push(sessionModel);
  }
  const currentModel = input.currentModel?.trim();
  if (currentModel) push(currentModel);
  return opts;
}
