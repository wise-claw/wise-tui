import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { normalizeSessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { createLocalModelPreferenceCache } from "./localModelPreferenceCache";

/**
 * Composer 中由用户直接选择的模型，按执行环境保存。
 *
 * 模型档案仍由各自的 settings/config 管理；这里仅补足未创建档案时的
 * “本次选择作为后续新会话默认值”这一运行时偏好。
 */
export const WISE_EXECUTION_ENGINE_MODEL_DEFAULTS_KEY =
  "wise.executionEngineModelDefaults.v1";

export type ExecutionEngineModelDefaults = Partial<Record<SessionExecutionEngine, string>>;

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

const defaults = createLocalModelPreferenceCache(WISE_EXECUTION_ENGINE_MODEL_DEFAULTS_KEY, parseDefaults);

/** 本地镜像先供同步读取，桌面持久化只在冷启动加载一次。 */
export async function loadExecutionEngineModelDefaults(): Promise<ExecutionEngineModelDefaults> {
  return { ...await defaults.load() };
}

export function resetExecutionEngineModelDefaultsForTests(): void {
  defaults.reset();
}

/** 同步读取已加载的默认模型，适用于渲染热路径。 */
export function getCachedExecutionEngineDefaultModel(
  engine: SessionExecutionEngine,
): string | null {
  const cachedDefaults = defaults.read();
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
  await defaults.update(engine, normalizeModelId(value) ?? undefined);
}
