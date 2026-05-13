import type { ClaudeSession } from "../../types";
import {
  notificationConversationInSessionInboxScope,
  notificationInboxConversationMatchesSession,
  notificationRowInSessionInboxScope,
  countSessionUnreadNotifications,
} from "./claudeChatHelpers";

export {
  notificationConversationInSessionInboxScope,
  notificationInboxConversationMatchesSession,
  notificationRowInSessionInboxScope,
  countSessionUnreadNotifications,
};

export function sessionNotificationInboxCount(
  rows: Array<{ conversationId: string; readAt?: string | number | null }>,
  sess: ClaudeSession,
  allSessions: ClaudeSession[],
): number {
  return countSessionUnreadNotifications(rows, sess, allSessions);
}
