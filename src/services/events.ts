import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlisten } from "../utils/safeTauriUnlisten";

// ── Event Hub ──

type EventHubOptions = {
  onError?: (error: unknown) => void;
};

function createEventHub<T>(event: string) {
  const listeners = new Set<(data: T) => void>();
  let unlisten: UnlistenFn | null = null;
  let setupPromise: Promise<void> | null = null;

  async function setup(onError?: (error: unknown) => void) {
    if (setupPromise) return setupPromise;
    setupPromise = (async () => {
      try {
        unlisten = await listen<T>(event, ({ payload }) => {
          for (const fn of listeners) {
            try {
              fn(payload);
            } catch {
              // ignore individual listener errors
            }
          }
        });
      } catch (error) {
        onError?.(error);
      }
    })();
    return setupPromise;
  }

  return {
    subscribe(
      onEvent: (data: T) => void,
      options: EventHubOptions = {},
    ): () => void {
      listeners.add(onEvent);
      void setup(options.onError);
      return () => {
        listeners.delete(onEvent);
      };
    },
    teardown(): void {
      safeUnlisten(unlisten);
      unlisten = null;
      setupPromise = null;
      listeners.clear();
    },
  };
}

// ── Terminal Events ──

export type TerminalOutputEvent = {
  workspaceId: string;
  terminalId: string;
  data: string;
};

export type TerminalExitEvent = {
  workspaceId: string;
  terminalId: string;
  exitCode: number;
};

const terminalOutputHub = createEventHub<TerminalOutputEvent>("terminal-output");
const terminalExitHub = createEventHub<TerminalExitEvent>("terminal-exit");

export function subscribeTerminalOutput(
  onEvent: (event: TerminalOutputEvent) => void,
  options?: EventHubOptions,
): () => void {
  return terminalOutputHub.subscribe(onEvent, options);
}

export function subscribeTerminalExit(
  onEvent: (event: TerminalExitEvent) => void,
  options?: EventHubOptions,
): () => void {
  return terminalExitHub.subscribe(onEvent, options);
}
