import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { ClaudeModelProfile, ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import { resolveEffectiveModelForProfileEngine } from "../types/claudeModelProfile";

/** 从模型切换 Codex 页读取当前默认档案模型（effective → active profile modelId）。 */
export function resolveCodexProfileModelFromStore(
  store: ClaudeModelProfileStoreView | null | undefined,
): string | undefined {
  const fromEffective = resolveEffectiveModelForProfileEngine("codex", store)?.trim();
  if (fromEffective) return fromEffective;
  const activeId = store?.activeCodexProfileId?.trim();
  if (!activeId || !store) return undefined;
  const profile = store.profiles.find((item) => item.id === activeId);
  return profile?.modelId?.trim() || undefined;
}

export interface ResolveCodexExecModelInput {
  /** 执行标签上的 session.model（可能仍是 Claude 全局默认）。 */
  sessionModel?: string | null;
  /** 派发/发送上下文会话的默认执行引擎（主会话或当前 worker）。 */
  contextExecutionEngine: SessionExecutionEngine;
  store?: ClaudeModelProfileStoreView | null;
}

/**
 * Codex 执行模型：
 * - Codex 上下文中，会话级显式切换（session.model 与档案模型不同）优先于档案；
 * - 否则优先「模型切换 → Codex」默认档案；
 * - 仅当上下文执行环境已是 Codex 且无 Codex 档案时，才回退 session.model；
 * - Claude/Cursor 上下文下绝不使用 session.model（避免误用 Qwen/glm 等 Claude 档案）。
 */
export function resolveCodexExecModelId(input: ResolveCodexExecModelInput): string | undefined {
  const codexProfileModel = resolveCodexProfileModelFromStore(input.store);
  const session = input.sessionModel?.trim();
  const isCodexContext =
    input.contextExecutionEngine === "codex" || input.contextExecutionEngine === "codex-rpc";

  // Codex 会话里用户显式选的模型（与档案不同）优先，支持 Composer 快速切换运行时模型。
  if (isCodexContext && session && codexProfileModel && session !== codexProfileModel) {
    return session;
  }
  if (codexProfileModel) return codexProfileModel;
  if (isCodexContext && session) return session;

  return undefined;
}

/** 终端派发等场景：上下文引擎取主会话；否则取 worker 自身。 */
export function resolveCodexContextExecutionEngine<T extends ClaudeSessionLike>(input: {
  tabSessionId: string;
  terminalFreshTurn?: boolean;
  activeSessionId?: string | null;
  resolveEngine: (session: T) => SessionExecutionEngine;
  sessions: readonly T[];
}): SessionExecutionEngine {
  const tabId = input.tabSessionId.trim();
  if (
    input.terminalFreshTurn &&
    input.activeSessionId?.trim() &&
    input.activeSessionId.trim() !== tabId
  ) {
    const main = input.sessions.find((item) => item.id === input.activeSessionId!.trim());
    if (main) return input.resolveEngine(main);
  }
  const worker = input.sessions.find((item) => item.id === tabId);
  return worker ? input.resolveEngine(worker) : "claude";
}

type ClaudeSessionLike = { id: string; repositoryPath: string; repositoryName: string };

// ---------------------------------------------------------------------------
// Codex 模型选择器（Composer 快速切换）
// ---------------------------------------------------------------------------

/** 运行态 / 配置来源的 Codex 模型引用（后端 `codex_list_models`）。 */
export interface CodexModelRef {
  id: string;
  displayName?: string;
  /** `model_providers.<id>`（config.toml 来源）或档案公司名（档案来源）。 */
  provider?: string | null;
}

export interface CodexModelPickerOption {
  value: string;
  label: string;
  providerId?: string;
  /** 命中已配置的 Codex 档案时填充；选中该选项即应用档案。 */
  profileId?: string;
}

/** 判断是否可作为 Codex 模型 id 传入（无运行态列表时放行任意非空值）。 */
export function isCodexModelId(
  raw: string | null | undefined,
  knownModels?: readonly CodexModelRef[],
): boolean {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return false;
  if (knownModels && knownModels.length > 0) {
    return knownModels.some(
      (item) => item.id === trimmed || item.displayName?.trim() === trimmed,
    );
  }
  return true;
}

/**
 * Composer Codex 模型：
 * - 菜单刚选的目录模型最高优先，避免列表刷新把 GPT-5.6-Luna 打回本地档案；
 * - 用户刚应用本地档案时，档案模型覆盖之前的目录选择。
 */
export function resolveCodexComposerModel(input: {
  pickedModel?: string | null;
  sessionModel?: string | null;
  profileModel?: string | null;
  knownModels?: readonly CodexModelRef[];
  /** 用户刚点选并应用了本地档案。 */
  profileApplied?: boolean;
}): string | undefined {
  const picked = input.pickedModel?.trim() || "";
  if (picked) return picked;
  const session = input.sessionModel?.trim() || "";
  const profile = input.profileModel?.trim() || "";
  if (input.profileApplied) {
    return profile || session || undefined;
  }
  if (session && isCodexModelId(session, input.knownModels) && profile && session !== profile) {
    return session;
  }
  return profile || session || undefined;
}

/** 运行态目录 + 本地档案 modelId，供 Composer 判断「已知 Codex 模型」。 */
export function mergeCodexKnownModels(
  runtimeModels: readonly CodexModelRef[] | null | undefined,
  profiles: readonly ClaudeModelProfile[] = [],
): CodexModelRef[] {
  const out: CodexModelRef[] = [];
  const seen = new Set<string>();
  const push = (id: string, displayName?: string | null) => {
    const v = id.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(displayName?.trim() ? { id: v, displayName: displayName.trim() } : { id: v });
  };
  for (const item of runtimeModels ?? []) {
    push(item.id, item.displayName);
  }
  for (const profile of profiles) {
    if (profile.engine !== "codex") continue;
    push(profile.modelId, profile.name);
  }
  return out;
}

/** Codex 官方目录模型应走 OpenAI 默认 provider，不能套用 DeepSeek 等自定义档案。 */
export function looksLikeOpenAiCatalogModel(model: string | null | undefined): boolean {
  const m = model?.trim().toLowerCase() ?? "";
  return (
    m.startsWith("gpt-") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4") ||
    m.startsWith("chatgpt") ||
    m.startsWith("codex-")
  );
}

function codexConfigUsesCustomProvider(config: string): boolean {
  const lower = config.toLowerCase();
  if (
    lower.includes("deepseek.com") ||
    lower.includes("volces.com") ||
    lower.includes("volcengine.com") ||
    lower.includes("dashscope.aliyuncs.com")
  ) {
    return true;
  }
  const match = /^[ \t]*model_provider[ \t]*=[ \t]*"?([^"\n#]+)"?/m.exec(config);
  const provider = match?.[1]?.trim().toLowerCase() ?? "";
  return Boolean(provider) && provider !== "openai" && provider !== "chatgpt";
}

/** 选目录 GPT 时要套用的 OpenAI 默认档案（不含自定义 base_url）。 */
export function resolveCodexOpenAiDefaultProfileId(
  profiles: readonly ClaudeModelProfile[],
): string | undefined {
  let best: { id: string; score: number } | undefined;
  for (const profile of profiles) {
    if (profile.engine !== "codex") continue;
    let config = "";
    try {
      const parsed = JSON.parse(profile.settingsJson) as { config?: unknown };
      config = typeof parsed.config === "string" ? parsed.config : "";
    } catch {
      continue;
    }
    if (codexConfigUsesCustomProvider(config)) continue;
    const blob = `${profile.company} ${profile.name}`.toLowerCase();
    const score = blob.includes("openai") || blob.includes("chatgpt") ? 2 : 1;
    if (!best || score > best.score) best = { id: profile.id, score };
  }
  return best?.id;
}

export function formatCodexModelLabel(modelId: string, displayName?: string | null): string {
  const v = modelId.trim();
  if (!v) return "默认";
  const label = displayName?.replace(/\s+/g, " ").trim();
  if (label && label !== v) return label;
  return v;
}

/** Composer 模型下拉过滤：匹配 id、展示名与 provider（大小写不敏感）。 */
export function matchesCodexModelPickerFilter(
  query: string,
  option: CodexModelPickerOption,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    option.value.toLowerCase().includes(needle) ||
    option.label.toLowerCase().includes(needle) ||
    (option.providerId ?? "").toLowerCase().includes(needle)
  );
}

/**
 * 合并 Codex 可选模型：已配置档案（优先，label 用档案名、company 作 provider）+
 * 运行态目录 / config.toml 模型。同 modelId 去重。
 */
export function buildCodexModelPickerOptions(
  runtimeModels: readonly CodexModelRef[],
  profiles: readonly ClaudeModelProfile[] = [],
): CodexModelPickerOption[] {
  const opts: CodexModelPickerOption[] = [];
  const seen = new Set<string>();
  const push = (
    value: string,
    label: string,
    providerId?: string,
    profileId?: string,
  ) => {
    const v = value.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    opts.push({
      value: v,
      label: label.trim() || v,
      ...(providerId?.trim() ? { providerId: providerId.trim() } : {}),
      ...(profileId?.trim() ? { profileId: profileId.trim() } : {}),
    });
  };

  for (const profile of profiles) {
    if (profile.engine !== "codex") continue;
    const id = profile.modelId?.trim();
    if (!id) continue;
    push(
      id,
      profile.name?.trim() || formatCodexModelLabel(id),
      profile.company?.trim(),
      profile.id,
    );
  }
  for (const item of runtimeModels) {
    const id = item.id.trim();
    if (!id) continue;
    push(id, formatCodexModelLabel(id, item.displayName), item.provider?.trim() || undefined);
  }
  return opts;
}
