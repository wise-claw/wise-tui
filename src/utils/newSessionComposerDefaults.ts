import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { normalizeSessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { CURSOR_SDK_DEFAULT_MODEL } from "../constants/cursorSdk";
import { OPENCODE_DEFAULT_MODEL } from "./opencodeModel";
import { QODER_DEFAULT_MODEL } from "./qoderModel";
import { normalizeClaudeReasoningEffort } from "../constants/claudeReasoningEffort";
import { normalizeCodexReasoningEffort } from "../constants/codexReasoningEffort";
import {
  getCachedExecutionEngineDefaultModel,
  saveExecutionEngineDefaultModel,
} from "../services/executionEngineModelDefaults";
import {
  getCachedExecutionEngineDefaultReasoning,
  saveExecutionEngineDefaultReasoning,
} from "../services/executionEngineReasoningDefaults";
import {
  getCachedDefaultExecutionEngine,
  saveDefaultExecutionEngineToStore,
} from "../services/wiseDefaultConfigStore";

/** 新建会话可从当前会话继承的 Composer 选择。 */
export interface NewSessionComposerInherit {
  executionEngine?: string | null;
  model?: string | null;
  codexReasoningEffort?: string | null;
  claudeReasoningEffort?: string | null;
}

/** 新建 / 复用空白会话时套用的 Composer 默认值。 */
export interface NewSessionComposerPatch {
  executionEngine: SessionExecutionEngine;
  model: string;
  codexReasoningEffort?: string;
  claudeReasoningEffort?: string;
}

/** 各执行环境在没有任何已保存 / 可继承模型时的缺省选择。 */
export function engineDefaultComposerModel(engine: SessionExecutionEngine): string {
  if (engine === "codex" || engine === "codex-rpc") return "";
  if (engine === "cursor") return CURSOR_SDK_DEFAULT_MODEL;
  if (engine === "opencode") return OPENCODE_DEFAULT_MODEL;
  if (engine === "qoder") return QODER_DEFAULT_MODEL;
  return "sonnet";
}

/**
 * 模型域：同域的执行环境共用同一套模型 id（`codex` 与 `codex-rpc` 都是 Codex 模型），
 * 跨域的模型 id 互不通用（Cursor / OpenCode 的 `auto`、Claude 的 `sonnet` 等）。
 */
export function engineModelDomain(engine: SessionExecutionEngine): string {
  if (engine === "codex" || engine === "codex-rpc") return "codex";
  return engine;
}

/** 新建会话模型：已保存的环境默认优先，其次继承当前会话，再回退引擎缺省。 */
export function resolveNewSessionComposerModel(
  engine: SessionExecutionEngine,
  inheritModel?: string | null,
): string {
  const saved = getCachedExecutionEngineDefaultModel(engine)?.trim() || "";
  if (saved) return saved;
  const inherited = inheritModel?.trim() || "";
  if (inherited) return inherited;
  return engineDefaultComposerModel(engine);
}

/**
 * 切换执行环境后的模型：该环境上次保存的选择优先；只有同一模型域（`codex` ↔ `codex-rpc`）
 * 才可沿用当前会话模型，跨域一律退回目标环境自身缺省，避免把 Cursor / OpenCode 的 `auto`
 * 或 Claude 的 `sonnet` 带进新环境。
 */
export function resolveEngineSwitchComposerModel(
  engine: SessionExecutionEngine,
  currentModel?: string | null,
  previousEngine?: SessionExecutionEngine | null,
): string {
  const saved = getCachedExecutionEngineDefaultModel(engine)?.trim() || "";
  if (saved) return saved;
  const sameDomain =
    Boolean(previousEngine) && engineModelDomain(previousEngine!) === engineModelDomain(engine);
  if (sameDomain) return currentModel?.trim() || engineDefaultComposerModel(engine);
  return engineDefaultComposerModel(engine);
}

/** 新建会话执行环境：当前会话覆盖优先，其次全局「新建会话默认」，再回退仓库默认。 */
export function resolveNewSessionComposerEngine(
  repoEngine?: string | null,
  inheritEngine?: string | null,
): SessionExecutionEngine {
  const inherited = inheritEngine?.trim();
  if (inherited) return normalizeSessionExecutionEngine(inherited);
  return normalizeSessionExecutionEngine(repoEngine?.trim() || getCachedDefaultExecutionEngine());
}

/** 新建会话推理强度：已保存的环境默认优先，其次继承当前会话，再回退引擎缺省档。 */
export function resolveNewSessionComposerReasoning(
  engine: SessionExecutionEngine,
  inherit?: Pick<NewSessionComposerInherit, "codexReasoningEffort" | "claudeReasoningEffort"> | null,
): Pick<NewSessionComposerPatch, "codexReasoningEffort" | "claudeReasoningEffort"> {
  if (engine === "claude") {
    const saved = getCachedExecutionEngineDefaultReasoning(engine);
    return {
      claudeReasoningEffort: normalizeClaudeReasoningEffort(
        saved ?? inherit?.claudeReasoningEffort,
      ),
    };
  }
  if (engine === "codex" || engine === "codex-rpc") {
    const saved = getCachedExecutionEngineDefaultReasoning(engine);
    return {
      codexReasoningEffort: normalizeCodexReasoningEffort(saved ?? inherit?.codexReasoningEffort),
    };
  }
  return {};
}

/** 套用已保存 / 当前会话的授权以外 Composer 选择（授权已是全局默认）。 */
export function resolveNewSessionComposerDefaults(input: {
  repoEngine?: string | null;
  prior?: NewSessionComposerInherit | null;
  /** 为 false 时不继承当前会话引擎（侧栏打开仓库仍走仓库 / 全局默认）。 */
  inheritEngine?: boolean;
}): NewSessionComposerPatch {
  const executionEngine = resolveNewSessionComposerEngine(
    input.repoEngine,
    input.inheritEngine === false ? null : input.prior?.executionEngine,
  );
  // 同一模型域（codex ↔ codex-rpc）才继承当前会话模型，跨域的模型 id 互不通用。
  const inheritModel =
    input.prior &&
    engineModelDomain(
      normalizeSessionExecutionEngine(input.prior.executionEngine || executionEngine),
    ) === engineModelDomain(executionEngine)
      ? input.prior.model
      : null;
  return {
    executionEngine,
    model: resolveNewSessionComposerModel(executionEngine, inheritModel),
    ...resolveNewSessionComposerReasoning(executionEngine, input.prior),
  };
}

/** 把刚解析出的 Composer 选择落成后续新会话默认值（内存先写，磁盘异步）。 */
export function persistNewSessionComposerDefaults(patch: NewSessionComposerPatch): void {
  if (patch.executionEngine !== getCachedDefaultExecutionEngine()) {
    void saveDefaultExecutionEngineToStore(patch.executionEngine).catch(() => undefined);
  }
  if (patch.model.trim()) {
    void saveExecutionEngineDefaultModel(patch.executionEngine, patch.model).catch(() => undefined);
  }
  if (patch.codexReasoningEffort) {
    void saveExecutionEngineDefaultReasoning(patch.executionEngine, patch.codexReasoningEffort).catch(
      () => undefined,
    );
  }
  if (patch.claudeReasoningEffort) {
    void saveExecutionEngineDefaultReasoning(patch.executionEngine, patch.claudeReasoningEffort).catch(
      () => undefined,
    );
  }
}
