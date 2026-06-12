export interface TurnCompleteWaitResult {
  success: boolean;
}

interface PendingWaiter {
  nonce: number;
  resolve: (result: TurnCompleteWaitResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ClaudeTurnCompleteWaiter {
  wait(tabId: string, nonce: number, timeoutMs?: number): Promise<TurnCompleteWaitResult>;
  resolve(tabId: string, nonce: number, success: boolean): void;
  clear(tabId: string): void;
}

const DEFAULT_TURN_COMPLETE_WAIT_MS = 15 * 60 * 1000;

export function createClaudeTurnCompleteWaiter(): ClaudeTurnCompleteWaiter {
  const pendingByTab = new Map<string, PendingWaiter[]>();

  function removeWaiter(tabId: string, waiter: PendingWaiter): void {
    const list = pendingByTab.get(tabId);
    if (!list) return;
    const next = list.filter((entry) => entry !== waiter);
    if (next.length === 0) {
      pendingByTab.delete(tabId);
    } else {
      pendingByTab.set(tabId, next);
    }
  }

  return {
    wait(tabId: string, nonce: number, timeoutMs = DEFAULT_TURN_COMPLETE_WAIT_MS) {
      return new Promise<TurnCompleteWaitResult>((resolve, reject) => {
        const timer = globalThis.setTimeout(() => {
          removeWaiter(tabId, waiter);
          reject(new Error("Claude 回合等待超时"));
        }, timeoutMs);
        const waiter: PendingWaiter = {
          nonce,
          resolve,
          reject,
          timer,
        };
        const list = pendingByTab.get(tabId) ?? [];
        list.push(waiter);
        pendingByTab.set(tabId, list);
      });
    },
    resolve(tabId: string, nonce: number, success: boolean) {
      const list = pendingByTab.get(tabId);
      if (!list || list.length === 0) return;
      for (const waiter of list) {
        if (waiter.nonce !== nonce) continue;
        globalThis.clearTimeout(waiter.timer);
        waiter.resolve({ success });
        removeWaiter(tabId, waiter);
      }
    },
    clear(tabId: string) {
      const list = pendingByTab.get(tabId);
      if (!list) return;
      for (const waiter of list) {
        globalThis.clearTimeout(waiter.timer);
        waiter.reject(new Error("Claude 回合等待已取消"));
      }
      pendingByTab.delete(tabId);
    },
  };
}
