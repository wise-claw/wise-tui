import { useSyncExternalStore } from "react";

const inFlightSessionIds = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setBackgroundContextCompactInFlight(sessionId: string, active: boolean): void {
  const key = sessionId.trim();
  if (!key) return;
  if (active) {
    if (inFlightSessionIds.has(key)) return;
    inFlightSessionIds.add(key);
  } else {
    if (!inFlightSessionIds.delete(key)) return;
  }
  emit();
}

export function isBackgroundContextCompactInFlight(sessionId: string): boolean {
  const key = sessionId.trim();
  return key.length > 0 && inFlightSessionIds.has(key);
}

export function useBackgroundContextCompactInFlight(sessionId: string): boolean {
  const key = sessionId.trim();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (key.length > 0 ? inFlightSessionIds.has(key) : false),
    () => false,
  );
}

/** @internal test helper */
export function resetBackgroundContextCompactStoreForTests(): void {
  inFlightSessionIds.clear();
  emit();
}
