import type { UnlistenFn } from "@tauri-apps/api/event";

function getTauriEventInternals():
  | { unregisterListener: (event: string, eventId: number) => void }
  | undefined {
  return (window as Window & {
    __TAURI_EVENT_PLUGIN_INTERNALS__?: {
      unregisterListener: (event: string, eventId: number) => void;
    };
  }).__TAURI_EVENT_PLUGIN_INTERNALS__;
}

/**
 * Tauri 注入的 unregisterListener 在重复 unlisten 时会同步抛
 * `listeners[eventId].handlerId`；在 main 入口尽早 patch 一次兜底。
 */
export function patchTauriEventUnlistenInternals(): void {
  if (typeof window === "undefined") return;
  const internals = getTauriEventInternals();
  if (!internals || typeof internals.unregisterListener !== "function") return;

  type PatchedFn = ((event: string, eventId: number) => void) & { __wisePatched?: boolean };
  const current = internals.unregisterListener as PatchedFn;
  if (current.__wisePatched) return;

  const original = current.bind(internals);
  const patched: PatchedFn = (event, eventId) => {
    try {
      original(event, eventId);
    } catch {
      /* listener slot already cleared (HMR / double cleanup) */
    }
  };
  patched.__wisePatched = true;
  internals.unregisterListener = patched;
}

/** main / mascot 入口调用；Tauri 注入略晚时再补一次 patch。 */
export function ensureTauriEventUnlistenPatched(): void {
  patchTauriEventUnlistenInternals();
  if (typeof window === "undefined") return;
  type PatchedFn = ((event: string, eventId: number) => void) & { __wisePatched?: boolean };
  const fn = getTauriEventInternals()?.unregisterListener as PatchedFn | undefined;
  if (fn?.__wisePatched) return;
  queueMicrotask(() => patchTauriEventUnlistenInternals());
  window.setTimeout(() => patchTauriEventUnlistenInternals(), 0);
}

/** Tauri 2 的 unlisten 为 async；重复取消或 HMR 后可能 reject，统一吞掉。 */
export function safeUnlisten(unlisten?: UnlistenFn | null): void {
  ensureTauriEventUnlistenPatched();
  if (!unlisten) return;
  try {
    void Promise.resolve(unlisten()).catch(() => {
      /* listener already removed */
    });
  } catch {
    /* sync throw from unlisten */
  }
}

export function safeUnlistenPromise(unlistenPromise: Promise<UnlistenFn> | undefined | null): void {
  if (!unlistenPromise) return;
  void unlistenPromise
    .then((fn) => safeUnlisten(fn))
    .catch(() => {
      /* listen never registered */
    });
}
