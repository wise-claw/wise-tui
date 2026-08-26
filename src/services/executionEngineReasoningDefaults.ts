import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { normalizeSessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { isClaudeReasoningEffort } from "../constants/claudeReasoningEffort";
import { isCodexReasoningEffort } from "../constants/codexReasoningEffort";
import { getAppSetting, setAppSetting } from "./appSettingsStore";

/**
 * Composer 中由用户直接选择的推理强度，按执行环境保存。
 * 新建会话复用该值，避免只写在当前标签上、下一会话掉回默认档。
 */
export const WISE_EXECUTION_ENGINE_REASONING_DEFAULTS_KEY =
  "wise.executionEngineReasoningDefaults.v1";

export type ExecutionEngineReasoningDefaults = Partial<Record<SessionExecutionEngine, string>>;

let cachedDefaults: ExecutionEngineReasoningDefaults = {};
let loaded = false;
let loadPromise: Promise<ExecutionEngineReasoningDefaults> | null = null;

function normalizeEffort(engine: SessionExecutionEngine, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const effort = value.trim().toLowerCase();
  if (!effort || effort.length > 32) return null;
  if (engine === "claude") return isClaudeReasoningEffort(effort) ? effort : null;
  if (engine === "codex" || engine === "codex-rpc") {
    return isCodexReasoningEffort(effort) ? effort : null;
  }
  return null;
}

function parseDefaults(raw: string | null): ExecutionEngineReasoningDefaults {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: ExecutionEngineReasoningDefaults = {};
    for (const [rawEngine, rawEffort] of Object.entries(parsed)) {
      const engine = normalizeSessionExecutionEngine(rawEngine);
      if (rawEngine !== engine) continue;
      const effort = normalizeEffort(engine, rawEffort);
      if (effort) next[engine] = effort;
    }
    return next;
  } catch {
    return {};
  }
}

function lookupEngines(engine: SessionExecutionEngine): SessionExecutionEngine[] {
  if (engine === "codex-rpc") return ["codex-rpc", "codex"];
  if (engine === "codex") return ["codex", "codex-rpc"];
  return [engine];
}

/** 读取并缓存默认推理强度；重复调用不再产生 IPC。 */
export async function loadExecutionEngineReasoningDefaults(): Promise<ExecutionEngineReasoningDefaults> {
  if (loaded) return { ...cachedDefaults };
  if (!loadPromise) {
    loadPromise = getAppSetting(WISE_EXECUTION_ENGINE_REASONING_DEFAULTS_KEY)
      .then((raw) => {
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
export function resetExecutionEngineReasoningDefaultsForTests(): void {
  cachedDefaults = {};
  loaded = false;
  loadPromise = null;
}

/** 同步读取已加载的默认推理强度，适用于渲染热路径。 */
export function getCachedExecutionEngineDefaultReasoning(
  engine: SessionExecutionEngine,
): string | null {
  for (const key of lookupEngines(engine)) {
    const effort = cachedDefaults[key]?.trim() || "";
    if (effort) return effort;
  }
  return null;
}

/** 保存用户刚在 Composer 中显式选择的推理强度。空值会清除该环境的覆盖。 */
export async function saveExecutionEngineDefaultReasoning(
  engine: SessionExecutionEngine,
  value: string,
): Promise<void> {
  const effort = normalizeEffort(engine, value);
  const next = { ...cachedDefaults };
  if (effort) next[engine] = effort;
  else delete next[engine];
  cachedDefaults = next;
  loaded = true;
  await setAppSetting(WISE_EXECUTION_ENGINE_REASONING_DEFAULTS_KEY, JSON.stringify(next));
}
