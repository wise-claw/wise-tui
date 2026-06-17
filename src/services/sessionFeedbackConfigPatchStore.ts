import type { FeedbackConfigPatch } from "../utils/sessionFeedbackConfigPatch";
import { dedupeFeedbackConfigPatches } from "../utils/sessionFeedbackConfigPatch";

const STORAGE_PREFIX = "wise.sessionFeedbackLoop.configPatches.v1:";

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

export function loadFeedbackConfigPatches(sessionId: string): FeedbackConfigPatch[] {
  const id = sessionId.trim();
  if (!id) return [];
  const storage = readStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(storageKey(id));
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw) as FeedbackConfigPatch[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFeedbackConfigPatches(sessionId: string, patches: FeedbackConfigPatch[]): void {
  const id = sessionId.trim();
  if (!id) return;
  const storage = readStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(id), JSON.stringify(patches));
  } catch {
    /* quota */
  }
}

export function mergeFeedbackConfigPatches(
  sessionId: string,
  incoming: readonly FeedbackConfigPatch[],
): FeedbackConfigPatch[] {
  const existing = loadFeedbackConfigPatches(sessionId);
  const merged = dedupeFeedbackConfigPatches([...existing, ...incoming]);
  saveFeedbackConfigPatches(sessionId, merged);
  return merged;
}

export function updateFeedbackConfigPatch(
  sessionId: string,
  patchId: string,
  patch: Partial<FeedbackConfigPatch>,
): FeedbackConfigPatch[] {
  const next = loadFeedbackConfigPatches(sessionId).map((item) =>
    item.id === patchId ? { ...item, ...patch } : item,
  );
  saveFeedbackConfigPatches(sessionId, next);
  return next;
}

export function clearFeedbackConfigPatches(sessionId: string): void {
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
