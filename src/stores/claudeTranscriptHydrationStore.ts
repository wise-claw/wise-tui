/** 会话磁盘 transcript 自动补全进行中（切 tab / 内存回收后懒加载）。 */
const hydratingSessionIds = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setSessionTranscriptHydrating(sessionId: string, active: boolean): void {
  const id = sessionId.trim();
  if (!id) return;
  if (active) {
    if (hydratingSessionIds.has(id)) return;
    hydratingSessionIds.add(id);
  } else {
    if (!hydratingSessionIds.delete(id)) return;
  }
  notify();
}

export function subscribeSessionTranscriptHydrating(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isSessionTranscriptHydrating(sessionId: string): boolean {
  return hydratingSessionIds.has(sessionId.trim());
}
