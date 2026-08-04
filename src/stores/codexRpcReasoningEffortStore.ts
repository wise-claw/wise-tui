/**
 * Codex RPC 推理强度：按 tab session 记忆（不写 config.toml）。
 */

import {
  CODEX_REASONING_EFFORT_DEFAULT,
  normalizeCodexReasoningEffort,
  type CodexReasoningEffort,
} from "../constants/codexReasoningEffort";

type Listener = () => void;

const effortBySession = new Map<string, CodexReasoningEffort>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.warn("[wise:codex-rpc-effort] listener threw", err);
    }
  }
}

export function getCodexRpcReasoningEffort(sessionId: string): CodexReasoningEffort {
  const sid = sessionId.trim();
  if (!sid) return CODEX_REASONING_EFFORT_DEFAULT;
  return effortBySession.get(sid) ?? CODEX_REASONING_EFFORT_DEFAULT;
}

export function setCodexRpcReasoningEffort(
  sessionId: string,
  effort: CodexReasoningEffort | string,
): CodexReasoningEffort {
  const sid = sessionId.trim();
  const next = normalizeCodexReasoningEffort(effort);
  if (!sid) return next;
  const prev = effortBySession.get(sid);
  if (prev === next) return next;
  effortBySession.set(sid, next);
  notify();
  return next;
}

export function subscribeCodexRpcReasoningEffort(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 测试用：清空会话记忆。 */
export function clearCodexRpcReasoningEffortStoreForTests(): void {
  effortBySession.clear();
  notify();
}
