/**
 * 标记「谁在前台驱动某会话的待执行队列」。
 *
 * ClaudeChat 挂载并绑定某 sessionId 时 claim；切走 / 卸载时 release。
 * 无 owner 的会话由后台 flush 在空闲时继续出队，避免未选中会话队列卡死或丢任务。
 */

const ownerRefCounts = new Map<string, number>();

function normalizeSessionId(sessionId: string): string {
  return sessionId.trim();
}

/** 声明当前 UI 拥有该会话队列的消费权。返回 release。 */
export function claimPendingTaskQueueOwner(sessionId: string): () => void {
  const id = normalizeSessionId(sessionId);
  if (!id) return () => {};
  ownerRefCounts.set(id, (ownerRefCounts.get(id) ?? 0) + 1);
  return () => {
    const current = ownerRefCounts.get(id) ?? 0;
    if (current <= 1) {
      ownerRefCounts.delete(id);
      return;
    }
    ownerRefCounts.set(id, current - 1);
  };
}

export function hasPendingTaskQueueOwner(sessionId: string): boolean {
  const id = normalizeSessionId(sessionId);
  return id ? (ownerRefCounts.get(id) ?? 0) > 0 : false;
}

/** @internal test helper */
export function resetPendingTaskQueueOwnerStoreForTests(): void {
  ownerRefCounts.clear();
}
