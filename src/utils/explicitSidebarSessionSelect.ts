/**
 * 侧栏会话行显式点选标记：用于挡住 ClaudeSessions 的 auto-ensure /
 * 项目主会话对齐 effect 在切换瞬间把用户刚点的会话抢回主会话。
 */
let selectedId: string | null = null;
let selectedAt = 0;

/** 侧栏（或同等入口）用户显式打开某会话时调用。 */
export function markExplicitSidebarSessionSelect(sessionId: string): void {
  const id = sessionId.trim();
  if (!id) return;
  selectedId = id;
  selectedAt = Date.now();
}

/** 当前 activeSessionId 是否仍处于用户刚点选的保护窗内。 */
export function isRecentExplicitSidebarSessionSelect(
  sessionId: string | null | undefined,
  withinMs = 1200,
): boolean {
  const id = sessionId?.trim() ?? "";
  if (!id || !selectedId) return false;
  if (Date.now() - selectedAt > withinMs) return false;
  return id === selectedId;
}

/** 测试专用。 */
export function resetExplicitSidebarSessionSelectForTests(): void {
  selectedId = null;
  selectedAt = 0;
}
