import type { SessionFeedbackLoopState } from "../utils/sessionFeedbackLoop";

const STORAGE_PREFIX = "wise.sessionFeedbackLoop.v1:";

function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId.trim()}`;
}

function readStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage;
    if (typeof globalThis !== "undefined" && "sessionStorage" in globalThis) {
      return globalThis.sessionStorage as Storage;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function loadSessionFeedbackLoopState(sessionId: string): SessionFeedbackLoopState | null {
  const id = sessionId.trim();
  if (!id) return null;
  const storage = readStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(id));
    if (!raw?.trim()) return null;
    const parsed = JSON.parse(raw) as SessionFeedbackLoopState;
    if (parsed.sessionId !== id || !Array.isArray(parsed.cycles)) return null;
    return {
      ...parsed,
      cycles: parsed.cycles.map((cycle) => ({
        ...cycle,
        baselineTurnCount: cycle.baselineTurnCount ?? 0,
      })),
    };
  } catch {
    return null;
  }
}

export function saveSessionFeedbackLoopState(state: SessionFeedbackLoopState): void {
  const id = state.sessionId.trim();
  if (!id) return;
  const storage = readStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(id), JSON.stringify(state));
  } catch {
    /* quota or private mode */
  }
}

export function clearSessionFeedbackLoopState(sessionId: string): void {
  const id = sessionId.trim();
  if (!id) return;
  const storage = readStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(id));
  } catch {
    /* ignore */
  }
}
