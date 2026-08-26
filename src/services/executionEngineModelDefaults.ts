import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { normalizeSessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { getAppSetting, setAppSetting } from "./appSettingsStore";

/**
 * Composer 中由用户直接选择的模型，按执行环境保存。
 *
 * 模型档案仍由各自的 settings/config 管理；这里仅补足未创建档案时的
 * “本次选择作为后续新会话默认值”这一运行时偏好。
 */
export const WISE_EXECUTION_ENGINE_MODEL_DEFAULTS_KEY =
  "wise.executionEngineModelDefaults.v1";

export type ExecutionEngineModelDefaults = Partial<Record<SessionExecutionEngine, string>>;

let cachedDefaults: ExecutionEngineModelDefaults = {};
let loaded = false;
let loadPromise: Promise<ExecutionEngineModelDefaults> | null = null;

function normalizeModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  // 模型 id 是短文本；限制长度也避免把损坏配置带入每个新会话。
  return model && model.length <= 512 ? model : null;
}

function parseDefaults(raw: string | null): ExecutionEngineModelDefaults {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: ExecutionEngineModelDefaults = {};
    for (const [rawEngine, rawModel] of Object.entries(parsed)) {
      const engine = normalizeSessionExecutionEngine(rawEngine);
      // normalizeSessionExecutionEngine 会将未知值回退 Claude，须先排除未知键。
      if (rawEngine !== engine) continue;
      const model = normalizeModelId(rawModel);
      if (model) next[engine] = model;
    }
    return next;
  } catch {
    return {};
  }
}

/** 读取并缓存默认模型；重复调用不再产生 IPC。 */
export async function loadExecutionEngineModelDefaults(): Promise<ExecutionEngineModelDefaults> {
  if (loaded) return { ...cachedDefaults };
  if (!loadPromise) {
    loadPromise = getAppSetting(WISE_EXECUTION_ENGINE_MODEL_DEFAULTS_KEY)
      .then((raw) => {
        // 保存可能先于这次读取完成；勿用过期磁盘值覆盖刚选的模型。
        if (loaded) return { ...cachedDefaults };
        cachedDefaults = parseDefaults(raw);
        loaded = true;
        return { ...cachedDefaults };
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

/** 测试用：清空内存缓存，避免用例之间串状态。 */
export function resetExecutionEngineModelDefaultsForTests(): void {
  cachedDefaults = {};
  loaded = false;
  loadPromise = null;
}

/** 同步读取已加载的默认模型，适用于渲染热路径。 */
export function getCachedExecutionEngineDefaultModel(
  engine: SessionExecutionEngine,
): string | null {
  const direct = cachedDefaults[engine]?.trim() || "";
  if (direct) return direct;
  if (engine === "codex-rpc") return cachedDefaults.codex?.trim() || null;
  if (engine === "codex") return cachedDefaults["codex-rpc"]?.trim() || null;
  return null;
}

/** 保存用户刚在 Composer 中显式选择的模型。空值会清除该环境的覆盖。 */
export async function saveExecutionEngineDefaultModel(
  engine: SessionExecutionEngine,
  value: string,
): Promise<void> {
  const model = normalizeModelId(value);
  const next = { ...cachedDefaults };
  if (model) next[engine] = model;
  else delete next[engine];
  // 先更新内存，紧随其后的「新建会话」无需等待磁盘写入完成。
  cachedDefaults = next;
  loaded = true;
  await setAppSetting(WISE_EXECUTION_ENGINE_MODEL_DEFAULTS_KEY, JSON.stringify(next));
}

