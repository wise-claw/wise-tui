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

export const CLAUDE_TURN_WAIT_TIMEOUT_MESSAGE = "Claude 回合等待超时";
export const CLAUDE_TURN_WAIT_CANCELLED_MESSAGE = "Claude 回合等待已取消";

export function isClaudeTurnWaitControlError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message === CLAUDE_TURN_WAIT_TIMEOUT_MESSAGE ||
    message === CLAUDE_TURN_WAIT_CANCELLED_MESSAGE
  );
}

export function createClaudeTurnCompleteWaiter(): ClaudeTurnCompleteWaiter {
  const pendingByTab = new Map<string, PendingWaiter[]>();
  // invoke IPC 返回前可能已收到 complete；仅缓存尚无人等待的最近结果，消费后删除。
  const earlyByTab = new Map<string, { nonce: number; success: boolean }>();
  const MAX_EARLY_COMPLETIONS = 512;

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
      const early = earlyByTab.get(tabId);
      if (early?.nonce === nonce) {
        earlyByTab.delete(tabId);
        return Promise.resolve({ success: early.success });
      }
      return new Promise<TurnCompleteWaitResult>((resolve, reject) => {
        const timer = globalThis.setTimeout(() => {
          removeWaiter(tabId, waiter);
          reject(new Error(CLAUDE_TURN_WAIT_TIMEOUT_MESSAGE));
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
      if (!list?.some((waiter) => waiter.nonce === nonce)) {
        const previous = earlyByTab.get(tabId);
        if (!previous || nonce > previous.nonce) {
          earlyByTab.delete(tabId);
          earlyByTab.set(tabId, { nonce, success });
          if (earlyByTab.size > MAX_EARLY_COMPLETIONS) {
            earlyByTab.delete(earlyByTab.keys().next().value!);
          }
        }
        return;
      }
      for (const waiter of list) {
        if (waiter.nonce !== nonce) continue;
        globalThis.clearTimeout(waiter.timer);
        waiter.resolve({ success });
        removeWaiter(tabId, waiter);
      }
    },
    clear(tabId: string) {
      earlyByTab.delete(tabId);
      const list = pendingByTab.get(tabId);
      if (!list) return;
      for (const waiter of list) {
        globalThis.clearTimeout(waiter.timer);
        waiter.reject(new Error(CLAUDE_TURN_WAIT_CANCELLED_MESSAGE));
      }
      pendingByTab.delete(tabId);
    },
  };
}
