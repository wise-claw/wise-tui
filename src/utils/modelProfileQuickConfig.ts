/** Claude Code / Codex 模型档案快捷配置：URL、Auth、模型 → 写入 settings JSON 或 Codex envelope。 */

export interface ModelProfileQuickConfig {
  url: string;
  auth: string;
  model: string;
}

export const EMPTY_MODEL_PROFILE_QUICK_CONFIG: ModelProfileQuickConfig = {
  url: "",
  auth: "",
  model: "",
};

/** 与 CC Switch / Rust `CC_SWITCH_MODEL_ENV_KEYS` 对齐。 */
const CLAUDE_MODEL_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_REASONING_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
] as const;

function trimField(value: string | undefined | null): string {
  return value?.trim() ?? "";
}

export function normalizeModelProfileQuickConfig(
  patch: ModelProfileQuickConfig,
): ModelProfileQuickConfig {
  return {
    url: trimField(patch.url),
    auth: trimField(patch.auth),
    model: trimField(patch.model),
  };
}

export function isSameModelProfileQuickConfig(
  a: ModelProfileQuickConfig,
  b: ModelProfileQuickConfig,
): boolean {
  const left = normalizeModelProfileQuickConfig(a);
  const right = normalizeModelProfileQuickConfig(b);
  return left.url === right.url && left.auth === right.auth && left.model === right.model;
}

export function isModelProfileQuickConfigDirty(
  draft: ModelProfileQuickConfig,
  source: ModelProfileQuickConfig,
): boolean {
  return !isSameModelProfileQuickConfig(draft, source);
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

function readEnvObject(root: Record<string, unknown>): Record<string, unknown> {
  const env = root.env;
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  return { ...(env as Record<string, unknown>) };
}

function readClaudeModelFromEnv(env: Record<string, unknown>): string {
  for (const key of CLAUDE_MODEL_ENV_KEYS) {
    const value = trimField(typeof env[key] === "string" ? env[key] : undefined);
    if (value) return value;
  }
  for (const [key, raw] of Object.entries(env)) {
    if (!key.includes("MODEL")) continue;
    const value = trimField(typeof raw === "string" ? raw : undefined);
    if (value) return value;
  }
  return "";
}

export function extractClaudeQuickConfig(settingsJson: string): ModelProfileQuickConfig {
  try {
    const root = parseJsonObject(settingsJson, "配置 JSON");
    const env = readEnvObject(root);
    const auth =
      trimField(typeof env.ANTHROPIC_AUTH_TOKEN === "string" ? env.ANTHROPIC_AUTH_TOKEN : undefined) ||
      trimField(typeof env.ANTHROPIC_API_KEY === "string" ? env.ANTHROPIC_API_KEY : undefined);
    const url = trimField(
      typeof env.ANTHROPIC_BASE_URL === "string" ? env.ANTHROPIC_BASE_URL : undefined,
    );
    const model =
      readClaudeModelFromEnv(env) ||
      trimField(typeof root.model === "string" ? root.model : undefined);
    return { url, auth, model };
  } catch {
    return { ...EMPTY_MODEL_PROFILE_QUICK_CONFIG };
  }
}

function pushAvailableModel(root: Record<string, unknown>, modelId: string): void {
  const mid = modelId.trim();
  if (!mid) return;
  const existing = root.availableModels;
  const models = Array.isArray(existing)
    ? existing.filter((item): item is string => typeof item === "string")
    : [];
  const key = mid.toLowerCase();
  if (!models.some((item) => item.trim().toLowerCase() === key)) {
    models.push(mid);
  }
  root.availableModels = models;
}

function syncClaudeModelSelection(root: Record<string, unknown>, modelId: string): void {
  const mid = modelId.trim();
  if (!mid) return;
  const env = readEnvObject(root);
  const hasModelEnv =
    Object.keys(env).some((key) => key.includes("MODEL")) ||
    CLAUDE_MODEL_ENV_KEYS.some((key) => key in env);
  if (hasModelEnv) {
    for (const key of CLAUDE_MODEL_ENV_KEYS) {
      env[key] = mid;
    }
    for (const key of Object.keys(env)) {
      if (key.includes("MODEL")) {
        env[key] = mid;
      }
    }
  } else {
    env.ANTHROPIC_MODEL = mid;
  }
  root.env = env;
  root.model = mid;
  pushAvailableModel(root, mid);
}

function resolveClaudeAuthKey(env: Record<string, unknown>): "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY" {
  if ("ANTHROPIC_AUTH_TOKEN" in env) return "ANTHROPIC_AUTH_TOKEN";
  if ("ANTHROPIC_API_KEY" in env) return "ANTHROPIC_API_KEY";
  return "ANTHROPIC_AUTH_TOKEN";
}

export function mergeClaudeQuickConfig(
  settingsJson: string,
  patch: ModelProfileQuickConfig,
): string {
  const root = parseJsonObject(settingsJson, "配置 JSON");
  const env = readEnvObject(root);
  const normalized = normalizeModelProfileQuickConfig(patch);

  if (normalized.url) env.ANTHROPIC_BASE_URL = normalized.url;
  if (normalized.auth) env[resolveClaudeAuthKey(env)] = normalized.auth;
  root.env = env;
  if (normalized.model) syncClaudeModelSelection(root, normalized.model);
  return `${JSON.stringify(root, null, 2)}\n`;
}

export function tryMergeClaudeQuickConfig(
  settingsJson: string,
  patch: ModelProfileQuickConfig,
): { ok: true; value: string } | { ok: false; error: string } {
  try {
    return { ok: true, value: mergeClaudeQuickConfig(settingsJson, patch) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Claude 快捷配置合并失败",
    };
  }
}

function readTomlKeyValue(config: string, key: string): string {
  for (const line of config.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== key) continue;
    return trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
  }
  return "";
}

function readTomlSectionBaseUrl(config: string): string {
  const providerId = readTomlKeyValue(config, "model_provider");
  if (providerId) {
    const sectionHeader = `[model_providers.${providerId}]`;
    let inTargetSection = false;
    for (const line of config.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        inTargetSection = trimmed === sectionHeader;
        continue;
      }
      if (!inTargetSection) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const name = trimmed.slice(0, eq).trim();
      if (name !== "base_url") continue;
      return trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim();
    }
  }

  let inProviderSection = false;
  for (const line of config.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inProviderSection = trimmed.toLowerCase().includes("model_providers");
      continue;
    }
    if (!inProviderSection) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== "base_url") continue;
    return trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
  }
  return readTomlKeyValue(config, "base_url");
}

function patchTomlKeyValue(config: string, key: string, value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const nextLine = `${key} = "${escaped}"`;
  let replaced = false;
  const lines = config.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) return line;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return line;
    const name = trimmed.slice(0, eq).trim();
    if (name !== key) return line;
    replaced = true;
    return nextLine;
  });
  if (!replaced) lines.push(nextLine);
  let out = lines.join("\n");
  if (config.endsWith("\n") && !out.endsWith("\n")) out += "\n";
  return out;
}

function patchTomlProviderBaseUrl(config: string, url: string): string {
  const escaped = url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const nextLine = `base_url = "${escaped}"`;
  const providerId = readTomlKeyValue(config, "model_provider") || "custom";
  const sectionHeader = `[model_providers.${providerId}]`;
  const lines = config.split("\n");
  const output: string[] = [];
  let inTargetSection = false;
  let replaced = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inTargetSection = trimmed === sectionHeader;
      output.push(line);
      continue;
    }
    if (inTargetSection && !replaced) {
      const eq = trimmed.indexOf("=");
      if (eq > 0 && trimmed.slice(0, eq).trim() === "base_url") {
        output.push(nextLine);
        replaced = true;
        continue;
      }
    }
    output.push(line);
  }

  if (!replaced) {
    const hasSection = output.some((line) => line.trim() === sectionHeader);
    if (!hasSection) {
      if (!readTomlKeyValue(output.join("\n"), "model_provider")) {
        output.unshift(`model_provider = "${providerId}"`);
      }
      output.push(
        "",
        sectionHeader,
        `name = "${providerId}"`,
        nextLine,
        'env_key = "OPENAI_API_KEY"',
        "",
      );
    } else {
      const sectionIndex = output.findIndex((line) => line.trim() === sectionHeader);
      output.splice(sectionIndex + 1, 0, nextLine);
      replaced = true;
    }
  }

  let out = output.join("\n");
  if (config.endsWith("\n") && !out.endsWith("\n")) out += "\n";
  return out;
}

export function extractCodexQuickConfig(
  authJson: string,
  configToml: string,
): ModelProfileQuickConfig {
  try {
    const auth = parseJsonObject(authJson, "auth");
    const url =
      readTomlSectionBaseUrl(configToml) ||
      trimField(typeof auth.OPENAI_BASE_URL === "string" ? auth.OPENAI_BASE_URL : undefined);
    return {
      url,
      auth: trimField(typeof auth.OPENAI_API_KEY === "string" ? auth.OPENAI_API_KEY : undefined),
      model: readTomlKeyValue(configToml, "model"),
    };
  } catch {
    return { ...EMPTY_MODEL_PROFILE_QUICK_CONFIG };
  }
}

export function mergeCodexQuickConfig(
  authJson: string,
  configToml: string,
  patch: ModelProfileQuickConfig,
): { authJson: string; configToml: string } {
  const auth = parseJsonObject(authJson, "auth");
  const normalized = normalizeModelProfileQuickConfig(patch);

  if (normalized.auth) {
    auth.OPENAI_API_KEY = normalized.auth;
    if (!auth.auth_mode) auth.auth_mode = "apikey";
  }

  let config = configToml;
  if (normalized.model) config = patchTomlKeyValue(config, "model", normalized.model);
  if (normalized.url) {
    if (config.includes("[model_providers")) {
      config = patchTomlProviderBaseUrl(config, normalized.url);
    } else {
      auth.OPENAI_BASE_URL = normalized.url;
    }
  }

  return {
    authJson: `${JSON.stringify(auth, null, 2)}\n`,
    configToml: config,
  };
}

export function tryMergeCodexQuickConfig(
  authJson: string,
  configToml: string,
  patch: ModelProfileQuickConfig,
): { ok: true; value: { authJson: string; configToml: string } } | { ok: false; error: string } {
  try {
    return { ok: true, value: mergeCodexQuickConfig(authJson, configToml, patch) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Codex 快捷配置合并失败",
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// OpenCode 快捷配置
//
// OpenCode (sst/opencode) 的 `opencode.json` provider 块遵循 AI SDK
// `@ai-sdk/openai-compatible` 形态：
//   {
//     "provider": {
//       "<id>": {
//         "name": "...", "npm": "@ai-sdk/openai-compatible",
//         "options": { "baseURL": "...", "apiKey": "..." },
//         "models": { "<model>": { "name": "<model>" } }
//       }
//     },
//     "model": "<id>/<model>"
//   }
// 顶层 `model` 必须为 `provider/model` 格式，其 provider id 与 provider 块 key 对应。
// 字段名 `options.baseURL` / `options.apiKey` 为规范写法；extract 侧兼容 snake_case 等
// 变体（其他工具生成的配置），merge 侧统一写规范字段。
// ──────────────────────────────────────────────────────────────────────────

/** 规范写入的 provider id（裸 model + url/auth 兜底挂载点）。 */
const OPENCODE_FALLBACK_PROVIDER_ID = "wise";
/** provider 块创建时的默认 npm 包（OpenAI 兼容）。 */
const OPENCODE_DEFAULT_PROVIDER_NPM = "@ai-sdk/openai-compatible";

/** 从 `provider/model` 解析 provider id 与 model name；无 `/` / 空段返回 null。 */
function parseOpencodeProviderId(model: string): { providerId: string; modelName: string } | null {
  const mid = model.trim();
  if (!mid) return null;
  const slash = mid.indexOf("/");
  if (slash <= 0) return null;
  const providerId = mid.slice(0, slash).trim();
  const modelName = mid.slice(slash + 1).trim();
  if (!providerId || !modelName) return null;
  return { providerId, modelName };
}

/** 按变体优先级读取 provider 的 baseURL / apiKey（兼容其他工具生成的配置）。 */
function readOpencodeProviderOptions(provider: Record<string, unknown>): {
  url: string;
  auth: string;
} {
  const options = provider.options;
  const opts =
    options !== null && typeof options === "object" && !Array.isArray(options)
      ? (options as Record<string, unknown>)
      : {};
  const url =
    trimField(typeof opts.baseURL === "string" ? opts.baseURL : undefined) ||
    trimField(typeof opts.api_base_url === "string" ? opts.api_base_url : undefined) ||
    trimField(typeof opts.base_url === "string" ? opts.base_url : undefined) ||
    trimField(typeof opts.url === "string" ? opts.url : undefined);
  const auth =
    trimField(typeof opts.apiKey === "string" ? opts.apiKey : undefined) ||
    trimField(typeof opts.api_key === "string" ? opts.api_key : undefined) ||
    trimField(typeof opts.apikey === "string" ? opts.apikey : undefined);
  return { url, auth };
}

export function extractOpencodeQuickConfig(settingsJson: string): ModelProfileQuickConfig {
  try {
    const root = parseJsonObject(settingsJson, "配置 JSON");
    const model = trimField(typeof root.model === "string" ? root.model : undefined);
    const parsed = parseOpencodeProviderId(model);
    if (!parsed) {
      // 裸 model 或空：model 可能仍有用，但 url/auth 无法定位 provider。
      return { url: "", auth: "", model };
    }
    const provider = root.provider;
    const providerMap =
      provider !== null && typeof provider === "object" && !Array.isArray(provider)
        ? (provider as Record<string, unknown>)
        : {};
    const entry = providerMap[parsed.providerId];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { url: "", auth: "", model };
    }
    const { url, auth } = readOpencodeProviderOptions(entry as Record<string, unknown>);
    return { url, auth, model };
  } catch {
    return { ...EMPTY_MODEL_PROFILE_QUICK_CONFIG };
  }
}

/** 确保 root.provider[id] 为对象；不存在时创建带默认字段的 provider 块。 */
function ensureOpencodeProviderEntry(
  root: Record<string, unknown>,
  providerId: string,
  modelName: string,
): Record<string, unknown> {
  const existingProvider = root.provider;
  const providerMap =
    existingProvider !== null && typeof existingProvider === "object" && !Array.isArray(existingProvider)
      ? (existingProvider as Record<string, unknown>)
      : {};
  root.provider = providerMap;
  const existing = providerMap[providerId];
  if (existing !== null && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  // 新建 provider 块：给 opencode 加载所需的最小默认字段。
  const entry: Record<string, unknown> = {
    name: providerId,
    npm: OPENCODE_DEFAULT_PROVIDER_NPM,
    options: {} as Record<string, unknown>,
  };
  providerMap[providerId] = entry;
  // 顺手登记 model，避免 opencode 不识别自定义模型。
  entry.models = { [modelName]: { name: modelName } };
  return entry;
}

/** 确保 entry.options 为对象并返回可写引用。 */
function ensureOpencodeOptions(entry: Record<string, unknown>): Record<string, unknown> {
  const existing = entry.options;
  if (existing !== null && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const opts: Record<string, unknown> = {};
  entry.options = opts;
  return opts;
}

/** 已存在 models 时 additive 登记 model（不覆盖用户已注册项）。 */
function ensureOpencodeModelRegistered(
  entry: Record<string, unknown>,
  modelName: string,
): void {
  const existing = entry.models;
  if (existing !== null && typeof existing === "object" && !Array.isArray(existing)) {
    const models = existing as Record<string, unknown>;
    if (models[modelName] === undefined) {
      models[modelName] = { name: modelName };
    }
    return;
  }
  entry.models = { [modelName]: { name: modelName } };
}

export function mergeOpencodeQuickConfig(
  settingsJson: string,
  patch: ModelProfileQuickConfig,
): string {
  const root = parseJsonObject(settingsJson, "配置 JSON");
  const normalized = normalizeModelProfileQuickConfig(patch);

  let effectiveModel = normalized.model;
  let parsed = parseOpencodeProviderId(effectiveModel);

  // 仅当提供 url/auth 时才需要 provider 块；此时若 model 为裸名，需兜底挂到 wise/ 下，
  // 否则 OpenCode 找不到 provider，url/auth 无效。
  const needsProviderBlock = Boolean(normalized.url || normalized.auth);
  if (needsProviderBlock && !parsed && effectiveModel) {
    effectiveModel = `${OPENCODE_FALLBACK_PROVIDER_ID}/${effectiveModel}`;
    root.model = effectiveModel;
    parsed = parseOpencodeProviderId(effectiveModel);
  } else if (effectiveModel) {
    root.model = effectiveModel;
  }

  if (parsed && needsProviderBlock) {
    const entry = ensureOpencodeProviderEntry(root, parsed.providerId, parsed.modelName);
    const opts = ensureOpencodeOptions(entry);
    if (normalized.url) opts.baseURL = normalized.url;
    if (normalized.auth) opts.apiKey = normalized.auth;
    ensureOpencodeModelRegistered(entry, parsed.modelName);
  }

  return `${JSON.stringify(root, null, 2)}\n`;
}

export function tryMergeOpencodeQuickConfig(
  settingsJson: string,
  patch: ModelProfileQuickConfig,
): { ok: true; value: string } | { ok: false; error: string } {
  try {
    return { ok: true, value: mergeOpencodeQuickConfig(settingsJson, patch) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "OpenCode 快捷配置合并失败",
    };
  }
}

function hasQuickConfigInput(patch: ModelProfileQuickConfig): boolean {
  return Boolean(trimField(patch.url) || trimField(patch.auth) || trimField(patch.model));
}

export function canApplyModelProfileQuickConfig(patch: ModelProfileQuickConfig): boolean {
  return hasQuickConfigInput(patch);
}
