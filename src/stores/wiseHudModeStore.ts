import { useSyncExternalStore } from "react";

let active = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

export function getWiseHudModeActive(): boolean {
  return active;
}

export function setWiseHudModeActive(next: boolean): void {
  if (active === next) return;
  active = next;
  emit();
}

export function subscribeWiseHudMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWiseHudModeActive(): boolean {
  return useSyncExternalStore(subscribeWiseHudMode, getWiseHudModeActive, getWiseHudModeActive);
}
