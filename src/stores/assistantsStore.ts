/**
 * 「助手模板」跨组件共享缓存。
 *
 * - 模块级单例，所有 `SessionQuickActionsBar` / `AssistantsPanel` 共享同一份数据。
 * - 保存/删除助手模板后由 `AssistantsPanel` 调 `setAssistantsCache(rows)` 喂新数据，
 *   订阅方（`useSessionQuickActionsLayout`）立即重算 catalog → 「更多」弹窗刷新。
 * - 仅作缓存与广播，不在此层调 Tauri `invoke`：避免在 store 模块加载时拿到
 *   未实现的 `invoke` 引用。`useSessionQuickActionsLayout` 第一次订阅时会自己
 *   调 `listAssistants()` 写一次缓存。
 */

import type { AssistantEntry } from "../types/assistant";

type Listener = (rows: AssistantEntry[]) => void;

let cachedRows: AssistantEntry[] = [];
const listeners = new Set<Listener>();

function publish(): void {
  for (const listener of listeners) {
    try {
      listener(cachedRows);
    } catch {
      /* 订阅方异常不污染其他订阅方 */
    }
  }
}

export function subscribeAssistants(listener: Listener): () => void {
  listeners.add(listener);
  // 立即推一次当前缓存
  try {
    listener(cachedRows);
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(listener);
  };
}

export function getAssistantsSnapshot(): AssistantEntry[] {
  return cachedRows;
}

/**
 * 由 `AssistantsPanel` 保存/删除后调用，或由 `useSessionQuickActionsLayout`
 * 第一次拉取后调用，写入新数据并广播。
 */
export function setAssistantsCache(rows: AssistantEntry[]): void {
  cachedRows = rows;
  publish();
}

/** @internal test helper */
export function resetAssistantsStoreForTests(): void {
  cachedRows = [];
  listeners.clear();
}