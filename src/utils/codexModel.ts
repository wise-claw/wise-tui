import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
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
 * - 始终优先「模型切换 → Codex」默认档案；
 * - 仅当上下文执行环境已是 Codex 且无 Codex 档案时，才回退 session.model；
 * - Claude/Cursor 上下文下绝不使用 session.model（避免误用 Qwen/glm 等 Claude 档案）。
 */
export function resolveCodexExecModelId(input: ResolveCodexExecModelInput): string | undefined {
  const codexProfileModel = resolveCodexProfileModelFromStore(input.store);
  if (codexProfileModel) return codexProfileModel;

  if (input.contextExecutionEngine === "codex") {
    const session = input.sessionModel?.trim();
    if (session) return session;
  }

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
