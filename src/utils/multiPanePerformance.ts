import {
  IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX,
  IN_MEMORY_GLOBAL_MESSAGES_BUDGET,
  IN_MEMORY_SESSION_MESSAGES_MAX,
} from "../constants/claudeMessageListWindow";

/** 多屏离屏窗格延迟卸载（ms），避免快速滚动时反复挂载。 */
export const MULTI_PANE_LAZY_UNMOUNT_MS = 900;

/** 超过 2 屏时启用视口 lazy 挂载。 */
export function shouldLazyMountMultiPaneExtraCells(paneCount: number): boolean {
  return paneCount > 2;
}

/** 伴生窗格按数量分摊全局消息预算，避免 6/8 屏时内存线性膨胀。 */
export function resolveCompanionSessionMessagesMax(companionCount: number): number {
  if (companionCount <= 0) return IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX;
  const shareable = Math.max(24, IN_MEMORY_GLOBAL_MESSAGES_BUDGET - IN_MEMORY_SESSION_MESSAGES_MAX);
  return Math.max(
    8,
    Math.min(IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX, Math.floor(shareable / companionCount)),
  );
}

/** 多伴生会话时适度抬高全局预算上限。 */
export function resolveGlobalMessagesBudget(companionCount: number): number {
  const extra = Math.max(0, companionCount - 1) * 12;
  return Math.min(384, IN_MEMORY_GLOBAL_MESSAGES_BUDGET + extra);
}
