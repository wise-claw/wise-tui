import type { ClaudeSpawnCliExtras } from "../services/claudeSpawnExtras";

/**
 * 协作执行会话 → 智能体 spawn 配置。
 * 存在条目时 spawn 使用智能体配置替代 Cockpit 助手层，保证仓库智能体的规则/MCP/工具范围独立生效。
 */
export type CollabSessionBinding =
  | {
      kind: "attempt";
      attemptId: string;
      fencingToken: number;
      requirementId: string;
      taskId: string;
      extras: ClaudeSpawnCliExtras;
    }
  | {
      /** 讨论模式只读会话：以智能体身份回答，不关联需求。 */
      kind: "discussion";
      agentId: string;
      originSessionId: string;
      extras: ClaudeSpawnCliExtras;
    };

const bindings = new Map<string, CollabSessionBinding>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function registerCollabSessionBinding(sessionId: string, binding: CollabSessionBinding): void {
  bindings.set(sessionId, binding);
  emit();
}

export function releaseCollabSessionBinding(sessionId: string): void {
  if (bindings.delete(sessionId)) emit();
}

export function getCollabSessionBinding(sessionId: string): CollabSessionBinding | null {
  return bindings.get(sessionId) ?? null;
}

export function getCollabSessionSpawnExtras(sessionId: string): ClaudeSpawnCliExtras | null {
  return bindings.get(sessionId)?.extras ?? null;
}

export function listCollabSessionBindings(): [string, CollabSessionBinding][] {
  return [...bindings.entries()];
}

export function subscribeCollabSessionBindings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
