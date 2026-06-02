import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import { isModelProfileAutoFailoverEnabled } from "../types/claudeModelProfile";

/** 内存快照：failover 热路径读取，避免每次限流重试都打 IPC。 */
let cachedStore: ClaudeModelProfileStoreView | null = null;

export function getCachedModelProfileStore(): ClaudeModelProfileStoreView | null {
  return cachedStore;
}

export function seedModelProfileStoreCache(store: ClaudeModelProfileStoreView | null | undefined): void {
  cachedStore = store ?? null;
}

export function isCachedModelProfileAutoFailoverEnabled(): boolean {
  return isModelProfileAutoFailoverEnabled(cachedStore);
}
