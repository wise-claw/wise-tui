import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { CURSOR_SDK_DEFAULT_MODEL } from "../constants/cursorSdk";
import { getCachedExecutionEngineDefaultModel } from "../services/executionEngineModelDefaults";

/** 新建会话模型：已保存的环境默认优先，其次继承当前会话，再回退引擎缺省。 */
export function resolveNewSessionComposerModel(
  engine: SessionExecutionEngine,
  inheritModel?: string | null,
): string {
  const saved = getCachedExecutionEngineDefaultModel(engine)?.trim() || "";
  if (saved) return saved;
  const inherited = inheritModel?.trim() || "";
  if (inherited) return inherited;
  if (engine === "codex" || engine === "codex-rpc") return "";
  if (engine === "cursor") return CURSOR_SDK_DEFAULT_MODEL;
  return "sonnet";
}
