import { stringSetEqual } from "../utils/adaptivePoll";

type Listener = () => void;

const EMPTY_SET: ReadonlySet<string> = new Set();
let runningSessionIds: ReadonlySet<string> = EMPTY_SET;
const listeners = new Set<Listener>();

export function getRunningClaudeSessionIdsSnapshot(): ReadonlySet<string> {
  return runningSessionIds;
}

export function subscribeRunningClaudeSessionIds(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 由 `useClaudeSessions` 宿主注册表轮询写入；其它消费者通过 `useSyncExternalStore` 订阅。 */
export function publishRunningClaudeSessionIds(next: ReadonlySet<string>): void {
  if (stringSetEqual(runningSessionIds, next)) return;
  runningSessionIds = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** @internal test helper */
export function resetClaudeRunningSessionsRegistryStoreForTests(): void {
  runningSessionIds = EMPTY_SET;
  listeners.clear();
}
