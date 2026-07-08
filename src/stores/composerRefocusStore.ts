/**
 * 会话级「发送后重新聚焦输入框」请求队列。
 *
 * 为什么需要模块级 store：普通会话首次发送时，Claude 进程返回真实 session id，
 * `claudeStreamRuntime` 的 `buildStreamSessionUpdater` 会把 session.id 从临时 tabId
 * 改成 realSessionId（isInit 且非 preserveWiseTabId 分支），`ClaudeSessionsChatHost`
 * 用 `key={activeSession.id}` 渲染 ClaudeChat，id 变化导致 ClaudeChat（含 ComposerRegion）
 * 整个 remount，新编辑器没有焦点。
 *
 * 关键约束——consume 只读不删：旧 ComposerRegion（session.id=旧 tabId）的 refocus effect
 * 会在「发送后约 1 帧」触发，远早于「流返回 realSessionId 触发迁移」（通常 100ms+）。若
 * consume 删除请求，迁移时 migrateComposerRefocus 在旧 tabId 上找不到请求（no-op），remount
 * 后新 ComposerRegion 用 realSessionId consume 命中 0 -> 失焦。因此 consume 仅 peek：请求由
 * migrate（移走）或 TTL 过期（snapshot 归零）回收，旧编辑器提前 peek 不会清空请求。
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
  const now = nowFn();
  // consume 不再删除请求，顺带在此回收过期 entry，避免 map 随会话累积
  for (const [sid, exp] of refocusExpiryBySession) {
    if (exp <= now) refocusExpiryBySession.delete(sid);
  }
  refocusExpiryBySession.set(sessionId, now + REFOCUS_TTL_MS);
  notify();
}

/**
 * 探测本会话是否有未过期的待聚焦请求；据此决定是否聚焦。**只读不删**：旧编辑器可能在
 * session.id 迁移前提前触发本调用，若删除会令 migrate 拿不到请求（见文件头注释）。
 * 请求由 migrate 移走或 TTL 过期回收。
 */
export function consumeComposerRefocus(sessionId: string): boolean {
  const expiry = refocusExpiryBySession.get(sessionId);
  if (expiry == null) return false;
  return nowFn() <= expiry;
}

/**
 * 会话 id 迁移时把待聚焦请求一并迁移：普通会话首次发送时 session.id 从临时 tabId
 * 变成 realSessionId（见 `claudeStreamRuntime` 的 `onSessionTabIdMigrated`），若不迁移，
 * remount 后新 ComposerRegion 用 realSessionId consume 会找不到旧 tabId 上的请求。
 * consume 只读不删，故 fromSessionId 的请求在迁移时仍存在；此处移到 toSessionId。
 * fromSessionId 无请求时为 no-op；toSessionId 已有请求则取更晚到期，避免缩短窗口。
 */
export function migrateComposerRefocus(fromSessionId: string, toSessionId: string): void {
  if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return;
  const fromExpiry = refocusExpiryBySession.get(fromSessionId);
  if (fromExpiry == null) return;
  const existing = refocusExpiryBySession.get(toSessionId);
  refocusExpiryBySession.set(toSessionId, Math.max(fromExpiry, existing ?? 0));
  refocusExpiryBySession.delete(fromSessionId);
  notify();
}

export function subscribeComposerRefocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** useSyncExternalStore 快照：返回本会话未过期待聚焦请求的到期时间戳（无/过期则 0）。 */
export function getComposerRefocusSnapshot(sessionId: string): number {
  const expiry = refocusExpiryBySession.get(sessionId);
  if (expiry == null) return 0;
  return nowFn() <= expiry ? expiry : 0;
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
