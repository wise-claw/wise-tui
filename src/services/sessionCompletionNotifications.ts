import { subscribeClaudeSessionStatusChanges } from "../stores/claudeSessionsLiveStore";
import { collectHudSessionCompletions, type HudCompletionToastItem } from "../utils/hudCompletionToast";
import { wiseIslandNotifyCompletion } from "./wiseIsland";

/** 直接观察状态提交；顶部灵动岛独立于 HUD 输入模式。 */
export function subscribeSessionCompletionNotifications(
  notify: (items: readonly HudCompletionToastItem[]) => Promise<void> = wiseIslandNotifyCompletion,
): () => void {
  return subscribeClaudeSessionStatusChanges((previous, next) => {
    const statuses = new Map([...previous].map(([id, session]) => [id, session.status]));
    const items = collectHudSessionCompletions(statuses, next);
    if (items.length > 0) {
      void notify(items).catch((error) => console.error("[Island] 完成通知发送失败", error));
    }
  });
}
