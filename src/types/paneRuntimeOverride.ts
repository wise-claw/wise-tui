import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { SESSION_EXECUTION_ENGINE_LABELS } from "../constants/sessionExecutionEngine";

/** 多屏窗格预设已覆盖 Claude / Codex，其余引擎在弹窗中单独列出。 */
export const PANE_EXTRA_EXECUTION_ENGINES = ["cursor", "gemini", "opencode", "qoder"] as const satisfies readonly SessionExecutionEngine[];

/** 多屏窗格当前实际生效的执行引擎（含 Cursor / Gemini / OpenCode 等覆盖）。 */
export function resolvePaneEffectiveEngine(
  override: PaneRuntimeOverride | null | undefined,
  fallbackEngine: SessionExecutionEngine,
): SessionExecutionEngine {
  if (override?.executionEngine) {
    return override.executionEngine;
  }
  const preset = resolvePaneRuntimePreset(override, fallbackEngine);
  if (preset === "codex") return "codex";
  if (preset === "claude-direct" || preset === "claude-proxy") return "claude";
  return fallbackEngine;
}

export function isPaneExtraExecutionEngine(
  engine: SessionExecutionEngine,
): engine is (typeof PANE_EXTRA_EXECUTION_ENGINES)[number] {
  return (PANE_EXTRA_EXECUTION_ENGINES as readonly SessionExecutionEngine[]).includes(engine);
}

export function resolvePaneRuntimeDisplayLabel(
  override: PaneRuntimeOverride | null | undefined,
  fallbackEngine: SessionExecutionEngine,
): string {
  const preset = resolvePaneRuntimePreset(override, fallbackEngine);
  if (preset) {
    return preset === "claude-direct"
      ? "Claude Code"
      : preset === "claude-proxy"
        ? "代理"
        : "Codex";
  }
  return SESSION_EXECUTION_ENGINE_LABELS[resolvePaneEffectiveEngine(override, fallbackEngine)].title;
}

/** 多屏窗格 Claude 代理路由：auto=跟随全局 OpenCode/LLM/FCC，bypass=直连 Anthropic。 */
export type PaneClaudeProxyRoute = "auto" | "bypass";

/** 多屏模式下窗格级运行时覆盖（优先于仓库 executionEngine）。 */
export interface PaneRuntimeOverride {
  executionEngine?: SessionExecutionEngine;
  claudeProxyRoute?: PaneClaudeProxyRoute;
}

export type PaneRuntimePreset = "claude-direct" | "claude-proxy" | "codex";

/** 无实际覆盖字段时视为未设置（避免 `{}` 被误判为 claude-proxy）。 */
export function isPaneRuntimeOverrideEmpty(
  override: PaneRuntimeOverride | null | undefined,
): boolean {
  if (!override) return true;
  return !override.executionEngine && !override.claudeProxyRoute;
}

export function normalizePaneRuntimeOverride(
  override: PaneRuntimeOverride | null | undefined,
): PaneRuntimeOverride | null {
  if (isPaneRuntimeOverrideEmpty(override)) return null;
  return {
    ...(override?.executionEngine ? { executionEngine: override.executionEngine } : {}),
    ...(override?.claudeProxyRoute ? { claudeProxyRoute: override.claudeProxyRoute } : {}),
  };
}

export function paneRuntimePresetToOverride(preset: PaneRuntimePreset): PaneRuntimeOverride {
  if (preset === "claude-direct") {
    return { executionEngine: "claude", claudeProxyRoute: "bypass" };
  }
  if (preset === "claude-proxy") {
    return { executionEngine: "claude", claudeProxyRoute: "auto" };
  }
  return { executionEngine: "codex", claudeProxyRoute: undefined };
}

/** 新建额外窗格执行会话时继承主窗格运行时覆盖；未设置则与 Pane 0 一样走仓库默认。 */
export function companionPaneRuntimeFromPrimary(
  primary: PaneRuntimeOverride | null | undefined,
): Pick<PaneRuntimeOverride, "executionEngine" | "claudeProxyRoute"> {
  const normalized = normalizePaneRuntimeOverride(primary);
  if (!normalized) return {};
  return {
    ...(normalized.executionEngine ? { executionEngine: normalized.executionEngine } : {}),
    ...(normalized.claudeProxyRoute ? { claudeProxyRoute: normalized.claudeProxyRoute } : {}),
  };
}

export function resolvePaneRuntimePreset(
  override: PaneRuntimeOverride | null | undefined,
  resolvedEngine: SessionExecutionEngine,
): PaneRuntimePreset | null {
  if (isPaneRuntimeOverrideEmpty(override)) return null;
  const resolved = override!;
  const engine = resolved.executionEngine ?? resolvedEngine;
  if (engine === "codex") return "codex";
  if (engine === "claude") {
    return resolved.claudeProxyRoute === "bypass" ? "claude-direct" : "claude-proxy";
  }
  return null;
}

export function mergePaneRuntimeOverride(
  current: PaneRuntimeOverride | null | undefined,
  patch: Partial<PaneRuntimeOverride>,
): PaneRuntimeOverride {
  const next: PaneRuntimeOverride = { ...(current ?? {}) };
  if (patch.executionEngine !== undefined) {
    next.executionEngine = patch.executionEngine;
  }
  if (patch.claudeProxyRoute !== undefined) {
    next.claudeProxyRoute = patch.claudeProxyRoute;
  }
  if (Object.keys(next).length === 0) {
    return {};
  }
  if (next.executionEngine && next.executionEngine !== "claude") {
    delete next.claudeProxyRoute;
  }
  return next;
}
