const listeners = new Set<() => void>();
const preferences = new Map<string, boolean>();
const storageKey = (id: string) => `wise.codex.persistent.${id}`;

export function getCodexPersistentSession(id: string): boolean {
  if (preferences.has(id)) return preferences.get(id)!;
  try { return localStorage.getItem(storageKey(id)) === "true"; } catch { return false; }
}

export function subscribeCodexPersistentSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 后端确认后发布，让输入框开关与未打开的会话行同步更新。 */
export function publishCodexPersistentSession(id: string, persistent: boolean, save = true): void {
  preferences.set(id, persistent);
  if (save) {
    try { localStorage.setItem(storageKey(id), String(persistent)); } catch { /* 本次运行仍有效 */ }
  }
  listeners.forEach((listener) => listener());
}
