/**
 * 会话级「发送后重新聚焦输入框」请求队列。
 *
 * 为什么需要模块级 store：发送消息时 `resolveClaudePanelActiveSession` 会因
 * sessions/repositories 更新而瞬时返回 undefined，命中 ClaudeSessionsChatHost 的
 * `!activeSession` 分支，令 ClaudeChat（含 ComposerRegion）卸载后重挂（见记忆
 * panelbelowmessages-remount-trap）。`composer-region.tsx` 里现有的 microtask 聚焦
 * 命中的是即将卸载的旧编辑器，重挂后的新编辑器不会被聚焦。
 *
 * 用模块级 Map 把「待聚焦」请求提升到卸载边界之上：发送完成时 request，新编辑器
 * `semiEditorReady` 后由 effect consume 并聚焦。请求带 TTL，避免陈旧触发。
 */
const refocusExpiryBySession = new Map<string, number>();
const listeners = new Set<() => void>();

const REFOCUS_TTL_MS = 2500;

/** 当前时间（ms）。测试可覆盖以验证 TTL，避免污染全局时钟。 */
let nowFn: () => number = () => Date.now();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** 发送完成时调用：请求本会话输入框在就绪后重新聚焦，支持连续输入。 */
export function requestComposerRefocus(sessionId: string): void {
  if (!sessionId) return;
  refocusExpiryBySession.set(sessionId, nowFn() + REFOCUS_TTL_MS);
  notify();
}

/** 取走本会话的待聚焦请求；过期或不存在返回 false。调用方据此决定是否真的聚焦。 */
export function consumeComposerRefocus(sessionId: string): boolean {
  const expiry = refocusExpiryBySession.get(sessionId);
  if (expiry == null) return false;
  refocusExpiryBySession.delete(sessionId);
  notify();
  return nowFn() <= expiry;
}

export function subscribeComposerRefocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** useSyncExternalStore 快照：返回本会话待聚焦请求的到期时间戳（无则 0）。 */
export function getComposerRefocusSnapshot(sessionId: string): number {
  return refocusExpiryBySession.get(sessionId) ?? 0;
}

/** 测试专用：清空全部请求与订阅。 */
export function resetComposerRefocusStoreForTests(): void {
  refocusExpiryBySession.clear();
  listeners.clear();
}

/** 测试专用：覆盖当前时间函数；传 null 恢复为 Date.now。 */
export function setComposerRefocusNowForTests(fn: (() => number) | null): void {
  nowFn = fn ?? (() => Date.now());
}
